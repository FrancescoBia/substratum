import { createHash, createHmac } from "node:crypto";
import { createReadStream, openAsBlob } from "node:fs";

/**
 * A minimal S3 client: request signing, plus the handful of calls the storage
 * adapter makes.
 *
 * Hand-rolled rather than taken from an SDK because the surface needed here is
 * tiny — whole objects in, whole or ranged objects out, no multipart. The one
 * streaming call is `openObject`, which exists because a browser plays video by
 * asking for byte ranges and an original should not have to sit in memory to be
 * served. It also sidesteps a real compatibility problem: recent AWS SDK
 * versions send integrity checksums by default that several S3-compatible
 * providers reject, and turning those back off is configuration we would have
 * to carry anyway to talk to the very backends this exists to support.
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
  /**
   * Per-attempt timeout, defaulting to {@link REQUEST_TIMEOUT_MS}. A seam for
   * the tests, which would otherwise have to wait a minute to watch one expire;
   * nothing in the app sets it.
   */
  timeoutMs?: number;
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

/**
 * How a stored object is labelled, by its key's extension.
 *
 * A copy of `FORMAT_CONTENT_TYPES` from @repo/shared, deliberately: this module
 * is also loaded by `scripts/migrate-storage.mjs`, which runs under plain Node
 * inside the container. There @repo/shared is TypeScript under node_modules,
 * which Node will not strip types from, so importing it stops the migration
 * before it starts. A test holds the two maps together.
 */
const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  mp4: "video/mp4",
  mov: "video/mp4",
  webm: "video/webm",
};

export async function putObject(config: S3Config, key: string, body: Buffer): Promise<void> {
  await send(config, { method: "PUT", key, body, headers: { "content-type": contentType(key) } });
}

/**
 * Uploads a file from disk without holding it in memory — what a video needs,
 * at up to 95 MB.
 *
 * Still a single PUT (S3 takes up to 5 GB in one), with the file as a Blob that
 * `fetch` reads lazily and sizes up front: a stream of unknown length would go
 * out chunked, and S3 refuses a chunked PUT unless it is wrapped in its own
 * signed-chunk encoding, which isn't worth carrying for this. The payload is
 * hashed in a first pass, so the signature covers the real bytes on every
 * provider rather than relying on `UNSIGNED-PAYLOAD`, which not all of them
 * accept.
 */
export async function putObjectFromFile(
  config: S3Config,
  key: string,
  path: string,
): Promise<void> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const body = await openAsBlob(path);

  await send(config, {
    method: "PUT",
    key,
    body,
    payloadHash: hash.digest("hex"),
    headers: { "content-type": contentType(key) },
  });
}

/** Objects are labelled by extension so a bucket fronted by a CDN serves them correctly. */
function contentType(key: string): string {
  const extension = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

export async function getObject(config: S3Config, key: string): Promise<Buffer> {
  const { body } = await send(config, { method: "GET", key });
  return body;
}

/** What `openObject` hands back: a live body, and where it sits in the object. */
export type OpenedS3Object = {
  body: ReadableStream<Uint8Array>;
  /** The whole object's size, whatever part of it the body covers. */
  size: number;
  /** Inclusive byte offsets of the body, or null when it is the whole object. */
  range: { start: number; end: number } | null;
};

/**
 * Streams an object, or one byte range of it.
 *
 * `range` is an HTTP `Range` value (`bytes=0-99`, `bytes=-500`) passed through
 * as-is, so the bucket resolves it against a size only it knows — one request
 * rather than a HEAD and then a GET. A range the bucket finds unsatisfiable
 * comes back as a 416 `S3Error`. A bucket that ignores the header and answers
 * 200 is honoured too: the result then says it is the whole object, and the
 * caller serves it as such.
 */
export async function openObject(
  config: S3Config,
  key: string,
  range?: string,
): Promise<OpenedS3Object> {
  const response = await send(config, {
    method: "GET",
    key,
    headers: range ? { range } : undefined,
    stream: true,
  });
  const body = response.stream as ReadableStream<Uint8Array>;

  if (response.status === 206) {
    const match = response.headers.get("content-range")?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (!match) {
      await body.cancel();
      throw new S3Error(
        502,
        "BadContentRange",
        "Bucket sent a partial answer it did not describe.",
      );
    }
    return {
      body,
      size: Number(match[3]),
      range: { start: Number(match[1]), end: Number(match[2]) },
    };
  }

  const length = response.headers.get("content-length");
  if (length === null) {
    await body.cancel();
    throw new S3Error(502, "NoContentLength", "Bucket did not say how large the object is.");
  }
  return { body, size: Number(length), range: null };
}

/** An object's size, without its bytes. */
export async function headObject(config: S3Config, key: string): Promise<{ size: number }> {
  const { headers } = await send(config, { method: "HEAD", key });
  return { size: Number(headers.get("content-length") ?? 0) };
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

    const xml = (await send(config, { method: "GET", query })).body.toString("utf8");

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
    // A partial failure comes back under a 200, so the status is no use as the
    // error's own — 502 says what it is: the bucket refused part of the work.
    const xml = response.body.toString("utf8");
    const failure = xml.match(/<Error>[\s\S]*?<\/Error>/)?.[0];
    if (failure) {
      const { code, message } = parseErrorXml(failure);
      throw new S3Error(
        502,
        code ?? "DeleteFailed",
        `Batch delete failed: ${message ?? unescapeXml(failure)}`,
      );
    }
  }
}

/**
 * A bucket answer, read to completion — unless the request asked to stream.
 *
 * `send` buffers the body by default rather than handing back a live
 * `Response`: an unread body holds its connection out of the pool until the
 * `Response` is collected, and a caller that never reads leaks one per call.
 * Buffering also means the per-attempt timeout can cover the whole exchange and
 * then be cleared, rather than either expiring mid-download or not existing at
 * all.
 *
 * A streaming request gets its successful body as `stream` instead, and takes
 * on the obligation to read or cancel it. Error answers are always buffered:
 * they are small, and their XML is what says what went wrong.
 */
type S3Response = {
  status: number;
  headers: Headers;
  body: Buffer;
  /** Set only for a successful answer to a request with `stream: true`. */
  stream: ReadableStream<Uint8Array> | null;
};

type S3Request = {
  method: "GET" | "HEAD" | "PUT" | "POST" | "DELETE";
  key?: string;
  query?: Record<string, string>;
  /** A Buffer already in memory, or a Blob backed by a file on disk. */
  body?: Buffer | Blob;
  /** Required with a Blob body, whose hash can't be taken synchronously. */
  payloadHash?: string;
  headers?: Record<string, string>;
  stream?: boolean;
};

/**
 * How hard to try before giving up. Three attempts covers the throttle or blip
 * that a single retry often lands in the middle of, without making a genuinely
 * unreachable bucket take most of a minute to say so.
 */
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 150;

/**
 * How long one attempt gets, from opening the connection to holding the whole
 * body, before it is abandoned and retried. A streamed body is bounded
 * differently — see `idleTimeout`.
 *
 * A bucket that refuses a connection fails fast; one that accepts it and then
 * says nothing does not. Without a bound, Node's own timeouts are the only
 * floor — five minutes an attempt, so a single `/img/:id/:variant` could hold a
 * server connection for a quarter of an hour before answering. Sixty seconds
 * carries a 50 MB original, the largest object this stores, over anything from
 * about 7 Mbit/s up, while still failing a dead endpoint inside three minutes.
 * Same intent as `FETCH_TIMEOUT_MS` in `ingest.server.ts`: outbound fetches get
 * a bound.
 */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * The slowest upload rate a file PUT is given time for, on top of the base
 * budget: 2 Mbit/s, so a 95 MB video gets about six and a half minutes. Slow
 * enough for any uplink a self-hosted instance plausibly sits on, while a dead
 * bucket still fails inside the retries rather than holding an upload for ever.
 */
const SLOWEST_UPLOAD_BYTES_PER_MS = 250;

/**
 * Sends one signed request, retrying the answers an object store gives when it
 * wants you to come back rather than when your request is wrong.
 *
 * Local disk never failed transiently, so nothing above this module is built to
 * cope with it: a throttle or a dropped connection partway through an ingest
 * would otherwise reach the Owner as a failed upload. Every operation here is
 * idempotent — writing the same bytes to the same key, reading, listing,
 * deleting keys already on their way out — so a retry can only repeat itself,
 * never double-apply.
 */
async function send(config: S3Config, request: S3Request): Promise<S3Response> {
  // No sentinel: the loop always runs at least once and always assigns before
  // it can throw, so an initial value would only be a state that cannot happen.
  let lastError: unknown;

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      // Exponential, with jitter: one ingest writes three derivatives at once,
      // and they should not all come back in lockstep.
      const backoff = RETRY_BASE_MS * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, backoff + Math.random() * backoff));
    }

    let response: S3Response;
    try {
      // Signed inside the loop, not once outside it: a signature carries its
      // own timestamp, and one held across a backoff drifts towards the edge of
      // the window the bucket will accept.
      response = await signedFetch(config, request);
    } catch (error) {
      // A refused connection, a dropped one, or one that went quiet past the
      // timeout: all three are exactly what retrying is for.
      lastError = error;
      continue;
    }

    if (response.status >= 200 && response.status < 300) return response;

    // HEAD answers carry no body, so a failed one has no XML to explain it.
    const { code, message } = parseErrorXml(response.body.toString("utf8"));
    lastError = new S3Error(
      response.status,
      code ?? String(response.status),
      message ?? `Bucket answered ${response.status}.`,
    );

    // Throttling and the 5xx family mean "come back". Anything else is the
    // request itself being wrong, and it will be just as wrong next time.
    if (response.status !== 429 && response.status < 500) throw lastError;
  }

  throw lastError;
}

async function signedFetch(config: S3Config, request: S3Request): Promise<S3Response> {
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
  const payloadHash =
    request.payloadHash ??
    sha256Hex(Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0));

  // Names are lowercased on the way in, because the canonical form signs the
  // lowercase name. A caller writing "Content-Type" would otherwise have the
  // string "undefined" signed in place of the value, and the bucket rejects
  // that as a signature mismatch — an error that reads like a bad secret key
  // and sends you looking in entirely the wrong place.
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    headers[name.toLowerCase()] = value;
  }
  headers.host = host;
  headers["x-amz-content-sha256"] = payloadHash;
  headers["x-amz-date"] = amzDate;

  const signedNames = Object.keys(headers).sort();
  const canonicalHeaders = signedNames.map((name) => `${name}:${headers[name].trim()}\n`).join("");
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

  // Per attempt, not per operation: a retry that follows a timeout gets its own
  // full budget, which is the point of retrying at all. Cleared as soon as the
  // body is in hand, so a fast answer leaves no timer behind.
  //
  // A file upload's budget grows with the file: the server may sit on a home
  // uplink, and a flat minute would refuse a 95 MB video to anything under
  // about 13 Mbit/s.
  const budget =
    (config.timeoutMs ?? REQUEST_TIMEOUT_MS) +
    (request.body instanceof Blob ? Math.ceil(request.body.size / SLOWEST_UPLOAD_BYTES_PER_MS) : 0);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error(`Bucket did not answer within ${budget}ms.`)),
    budget,
  );
  let streaming = false;

  try {
    const response = await fetch(
      `${endpoint.protocol}//${host}${path}${canonicalQuery ? `?${canonicalQuery}` : ""}`,
      {
        method: request.method,
        headers: {
          ...sendHeaders,
          Authorization: `${ALGORITHM} Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        },
        // A Buffer goes as a view rather than a copy: originals run to 50 MB
        // and are already in memory. The cast is because Node types the
        // backing store as possibly shared, which `fetch` will not take.
        body: Buffer.isBuffer(request.body)
          ? new Uint8Array(
              request.body.buffer as ArrayBuffer,
              request.body.byteOffset,
              request.body.byteLength,
            )
          : request.body,
        signal: controller.signal,
      },
    );

    if (request.stream && response.ok && response.body) {
      // The headers are in, so this attempt has succeeded and `send` will not
      // retry it. From here the whole-exchange budget would cut off any
      // original slower to download than it — so it hands over to a bound on
      // silence instead, which the body wrapper owns from now on.
      streaming = true;
      clearTimeout(timeout);
      return {
        status: response.status,
        headers: response.headers,
        body: Buffer.alloc(0),
        stream: idleTimeout(response.body, controller, budget),
      };
    }

    return {
      status: response.status,
      headers: response.headers,
      body: Buffer.from(await response.arrayBuffer()),
      stream: null,
    };
  } finally {
    if (!streaming) clearTimeout(timeout);
  }
}

/**
 * Passes a streamed body through, abandoning it if the bucket goes quiet for
 * `budget` milliseconds mid-download.
 *
 * The clock runs only while waiting on the bucket, never while the consumer is
 * busy: a browser on a slow link applies backpressure, and a timer that kept
 * running through that would cut off the viewer rather than a dead bucket.
 */
function idleTimeout(
  body: ReadableStream<Uint8Array>,
  controller: AbortController,
  budget: number,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();

  return new ReadableStream<Uint8Array>({
    async pull(consumer) {
      const timer = setTimeout(
        () => controller.abort(new Error(`Bucket went quiet for ${budget}ms mid-download.`)),
        budget,
      );
      try {
        const { done, value } = await reader.read();
        if (done) consumer.close();
        else consumer.enqueue(value);
      } catch (error) {
        consumer.error(error);
      } finally {
        clearTimeout(timer);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/**
 * S3 reports what went wrong in the same `<Code>`/`<Message>` envelope whether
 * it arrives as the whole body of a non-2xx answer or as one entry inside a
 * batch-delete result, so both readers share this.
 */
function parseErrorXml(xml: string): { code: string | null; message: string | null } {
  const message = xml.match(/<Message>([\s\S]*?)<\/Message>/)?.[1];
  return {
    code: xml.match(/<Code>([\s\S]*?)<\/Code>/)?.[1] ?? null,
    message: message === undefined ? null : unescapeXml(message),
  };
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
