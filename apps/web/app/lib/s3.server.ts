import { createHash, createHmac } from "node:crypto";

/**
 * A minimal S3 client: request signing, plus the four calls the storage adapter
 * makes.
 *
 * Hand-rolled rather than taken from an SDK because the surface needed here is
 * tiny — whole objects in and out, no multipart and no streaming, since images
 * are held in memory end to end and capped at 50 MB. It also sidesteps a real
 * compatibility problem: recent AWS SDK versions send integrity checksums by
 * default that several S3-compatible providers reject, and turning those back
 * off is configuration we would have to carry anyway to talk to the very
 * backends this exists to support.
 *
 * Keys here are adapter-relative, exactly as `storageKeys` builds them. The
 * bucket-side prefix is applied on the way out and stripped on the way back in,
 * so nothing above this module ever sees it.
 */

export type S3Config = {
  bucket: string;
  /** Origin of the S3 API, e.g. `https://<account>.r2.cloudflarestorage.com`. */
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Path-style addressing (`/bucket/key`) — what R2, B2 and MinIO all accept. */
  forcePathStyle: boolean;
  /** Optional key prefix, normalised to `""` or something ending in `/`. */
  prefix: string;
};

/** A non-2xx answer from the bucket, carrying S3's own error code where it sent one. */
export class S3Error extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "S3Error";
    this.status = status;
    this.code = code;
  }
}

const ALGORITHM = "AWS4-HMAC-SHA256";
const SERVICE = "s3";

/** Objects are labelled by extension so a bucket fronted by a CDN serves them correctly. */
const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
};

export async function putObject(config: S3Config, key: string, body: Buffer): Promise<void> {
  const extension = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  await send(config, {
    method: "PUT",
    key,
    body,
    headers: { "content-type": CONTENT_TYPES[extension] ?? "application/octet-stream" },
  });
}

export async function getObject(config: S3Config, key: string): Promise<Buffer> {
  const response = await send(config, { method: "GET", key });
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Every key under `prefix`, following continuation tokens to the end.
 *
 * Returns adapter-relative keys, so the result feeds straight back into
 * `deleteObjects` without either side thinking about the bucket-side prefix.
 */
export async function listObjectKeys(config: S3Config, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const query: Record<string, string> = {
      "list-type": "2",
      prefix: objectKey(config, prefix),
    };
    if (continuationToken) query["continuation-token"] = continuationToken;

    const response = await send(config, { method: "GET", query });
    const xml = await response.text();

    for (const match of xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)) {
      keys.push(adapterKey(config, unescapeXml(match[1])));
    }

    // The token is only meaningful while the listing is truncated; a provider
    // that omits IsTruncated on the last page must not send us round again.
    continuationToken = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml)
      ? xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1]
      : undefined;
  } while (continuationToken);

  return keys;
}

/** S3 caps a batch delete at 1000 keys, so anything longer goes in chunks. */
export async function deleteObjects(config: S3Config, keys: string[]): Promise<void> {
  for (let start = 0; start < keys.length; start += 1000) {
    const chunk = keys.slice(start, start + 1000);
    const body = Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><Delete>${chunk
        .map((key) => `<Object><Key>${escapeXml(objectKey(config, key))}</Key></Object>`)
        .join("")}<Quiet>true</Quiet></Delete>`,
      "utf8",
    );

    const response = await send(config, {
      method: "POST",
      query: { delete: "" },
      body,
      headers: {
        "content-type": "application/xml",
        // Still required by MinIO and older implementations, and harmless where
        // a newer checksum header would also have done.
        "content-md5": createHash("md5").update(body).digest("base64"),
      },
    });

    // Quiet mode reports only failures, so anything at all here is a problem.
    const xml = await response.text();
    const failure = xml.match(/<Error>[\s\S]*?<\/Error>/)?.[0];
    if (failure) {
      throw new S3Error(
        response.status,
        failure.match(/<Code>([\s\S]*?)<\/Code>/)?.[1] ?? "DeleteFailed",
        `Batch delete failed: ${unescapeXml(failure.match(/<Message>([\s\S]*?)<\/Message>/)?.[1] ?? failure)}`,
      );
    }
  }
}

type S3Request = {
  method: "GET" | "PUT" | "POST" | "DELETE";
  key?: string;
  query?: Record<string, string>;
  body?: Buffer;
  headers?: Record<string, string>;
};

async function send(config: S3Config, request: S3Request): Promise<Response> {
  const endpoint = new URL(config.endpoint);
  let host = endpoint.host;

  // The bucket goes in the path or the hostname; the signature has to be built
  // over whichever one we are about to send.
  let path = endpoint.pathname.replace(/\/+$/, "");
  if (config.forcePathStyle) path += `/${uriEncode(config.bucket, true)}`;
  else host = `${config.bucket}.${host}`;
  if (request.key) path += `/${uriEncode(objectKey(config, request.key), false)}`;
  if (path === "") path = "/";

  const canonicalQuery = Object.entries(request.query ?? {})
    .map(([name, value]) => [uriEncode(name, true), uriEncode(value, true)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");

  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(request.body ?? Buffer.alloc(0));

  const headers: Record<string, string> = {
    ...request.headers,
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };

  const signedNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = signedNames
    .map((name) => `${name}:${String(headers[name] ?? headers[name.toLowerCase()]).trim()}\n`)
    .join("");
  const signedHeaders = signedNames.join(";");

  const canonicalRequest = [
    request.method,
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${config.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const dateKey = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.region);
  const serviceKey = hmac(regionKey, SERVICE);
  const signature = hmac(hmac(serviceKey, "aws4_request"), stringToSign).toString("hex");

  // `host` is set by the runtime from the URL; sending it again is rejected.
  const { host: _host, ...sendHeaders } = headers;

  const response = await fetch(`${endpoint.protocol}//${host}${path}${canonicalQuery ? `?${canonicalQuery}` : ""}`, {
    method: request.method,
    headers: {
      ...sendHeaders,
      Authorization: `${ALGORITHM} Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    // A view rather than a copy: originals run to 50 MB and are already in
    // memory. The cast is because Node types the backing store as possibly
    // shared, which `fetch` will not take.
    body: request.body
      ? new Uint8Array(
          request.body.buffer as ArrayBuffer,
          request.body.byteOffset,
          request.body.byteLength,
        )
      : undefined,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new S3Error(
      response.status,
      detail.match(/<Code>([\s\S]*?)<\/Code>/)?.[1] ?? String(response.status),
      unescapeXml(detail.match(/<Message>([\s\S]*?)<\/Message>/)?.[1] ?? response.statusText),
    );
  }

  return response;
}

/** Adapter-relative key to the key as it exists in the bucket. */
function objectKey(config: S3Config, key: string): string {
  return `${config.prefix}${key}`;
}

/** The inverse, for keys coming back off a listing. */
function adapterKey(config: S3Config, key: string): string {
  return key.startsWith(config.prefix) ? key.slice(config.prefix.length) : key;
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * RFC 3986 percent-encoding, which is stricter than `encodeURIComponent` and is
 * what the signature is computed over — a mismatch here reads as a bad secret.
 * Byte-wise so multi-byte characters in a key encode correctly.
 */
function uriEncode(value: string, encodeSlash: boolean): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const char = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-._~]/.test(char)) out += char;
    else if (char === "/" && !encodeSlash) out += char;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
