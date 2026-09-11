import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, test } from "node:test";
import {
  deleteObjects,
  getObject,
  listObjectKeys,
  putObject,
  S3Error,
  type S3Config,
} from "../app/lib/s3.server.ts";

/**
 * The S3 client is hand-rolled SigV4 against a live bucket, which is the one
 * part of this codebase where a wrong answer is silent: a signature that drifts
 * by one byte reads as a bad secret key, and nothing in the e2e suite touches a
 * bucket at all. So these run against a stub that verifies each request the way
 * a real bucket does — by re-deriving the signature from what actually arrived
 * over the wire and comparing it to what the client claimed.
 *
 * That check is the point. It catches canonicalisation drift, a header signed
 * but not sent, a payload hash that doesn't match the body, and any change to
 * path or query encoding, none of which a round-trip test would notice.
 */

const ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
const SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

type Recorded = {
  method: string;
  /** Raw target, still percent-encoded, exactly as it arrived. */
  target: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  body: Buffer;
  /** Null when the signature verified; otherwise why it did not. */
  signatureError: string | null;
};

type Reply = { status?: number; body?: string | Buffer; headers?: Record<string, string> };
type Handler = (request: Recorded, index: number) => Reply | "hang" | "destroy";

/**
 * Starts a stub bucket and gives back a config pointed at it plus the log of
 * what it received. Path-style only: a virtual-hosted test would have to resolve
 * `<bucket>.127.0.0.1`, so that mode stays covered by the manual MinIO run.
 */
async function withBucket(
  handler: Handler,
  overrides: Partial<S3Config> = {},
): Promise<{ config: S3Config; received: Recorded[]; server: Server }> {
  const received: Recorded[] = [];

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const target = req.url ?? "/";
      const [path, query = ""] = target.split("?");
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers[name.toLowerCase()] = value;
      }

      const record: Recorded = {
        method: req.method ?? "",
        target,
        path,
        query,
        headers,
        body: Buffer.concat(chunks),
        signatureError: null,
      };
      record.signatureError = verifySignature(record);
      received.push(record);

      const reply = handler(record, received.length - 1);
      if (reply === "hang") return; // never answers; the client's timeout must fire
      if (reply === "destroy") return void req.socket.destroy();

      res.writeHead(reply.status ?? 200, reply.headers ?? {});
      res.end(reply.body ?? "");
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    server,
    received,
    config: {
      bucket: "library",
      endpoint: `http://127.0.0.1:${port}`,
      region: "us-east-1",
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
      forcePathStyle: true,
      prefix: "",
      // Long enough never to fire by accident, short enough that the one test
      // that wants it fire doesn't hold the suite up for a minute.
      timeoutMs: 5_000,
      ...overrides,
    },
  };
}

const servers: Server[] = [];
after(() => {
  for (const server of servers) server.close();
});

async function bucket(handler: Handler, overrides?: Partial<S3Config>) {
  const started = await withBucket(handler, overrides);
  servers.push(started.server);
  return started;
}

/**
 * Re-derives the request's signature from what arrived, the way a bucket does,
 * and reports the first thing that doesn't line up.
 *
 * Deliberately written from the AWS spec rather than by calling into the client:
 * a verifier that shared the client's helpers would agree with any mistake they
 * made.
 */
function verifySignature(request: Recorded): string | null {
  const authorization = request.headers.authorization;
  if (!authorization) return "no Authorization header";

  const parsed = authorization.match(
    /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\S+?), SignedHeaders=(\S+?), Signature=([0-9a-f]+)$/,
  );
  if (!parsed) return `malformed Authorization header: ${authorization}`;
  const [, keyId, scope, signedHeaders, claimed] = parsed;

  if (keyId !== ACCESS_KEY_ID) return `wrong access key id: ${keyId}`;

  // The payload hash the client signed has to be the hash of the bytes it sent,
  // or the signature is over a body nobody received.
  const contentSha = request.headers["x-amz-content-sha256"];
  const actualSha = createHash("sha256").update(request.body).digest("hex");
  if (contentSha !== actualSha) {
    return `x-amz-content-sha256 ${contentSha} does not match the body's ${actualSha}`;
  }

  // Every signed header must actually be present: signing a name whose value is
  // missing is the failure mode that reads as a bad secret key.
  const names = signedHeaders.split(";");
  if (!names.includes("host")) return "host was not signed";
  const sorted = [...names].sort();
  if (sorted.join(";") !== signedHeaders) return `SignedHeaders is not sorted: ${signedHeaders}`;

  let canonicalHeaders = "";
  for (const name of names) {
    const value = request.headers[name];
    if (value === undefined) return `signed header "${name}" was not sent`;
    canonicalHeaders += `${name}:${value.trim()}\n`;
  }

  // Query pairs stay percent-encoded and must arrive sorted by encoded name.
  const pairs = request.query === "" ? [] : request.query.split("&");
  const canonicalQuery = [...pairs].sort().join("&");
  if (canonicalQuery !== pairs.join("&")) return `query is not sorted: ${request.query}`;

  const canonicalRequest = [
    request.method,
    request.path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    contentSha,
  ].join("\n");

  const amzDate = request.headers["x-amz-date"];
  if (!amzDate) return "no x-amz-date header";
  if (!/^\d{8}T\d{6}Z$/.test(amzDate)) return `x-amz-date is not ISO8601 basic: ${amzDate}`;
  if (!scope.startsWith(`${amzDate.slice(0, 8)}/`)) {
    return `scope ${scope} disagrees with x-amz-date ${amzDate}`;
  }
  if (!scope.endsWith("/s3/aws4_request")) return `unexpected scope: ${scope}`;

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  let key: Buffer | string = `AWS4${SECRET_ACCESS_KEY}`;
  for (const part of scope.split("/")) {
    key = createHmac("sha256", key).update(part, "utf8").digest();
  }
  const expected = createHmac("sha256", key).update(stringToSign, "utf8").digest("hex");

  return expected === claimed
    ? null
    : `signature mismatch over canonical request:\n${canonicalRequest}`;
}

/** Every request the stub saw verified, and there were the expected number. */
function assertAllVerified(received: Recorded[], count: number) {
  assert.equal(received.length, count, `expected ${count} request(s), saw ${received.length}`);
  for (const request of received) {
    assert.equal(request.signatureError, null, request.signatureError ?? "");
  }
}

function listing(keys: string[], next?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>${keys
    .map((key) => `<Contents><Key>${key}</Key></Contents>`)
    .join("")}<IsTruncated>${next ? "true" : "false"}</IsTruncated>${
    next ? `<NextContinuationToken>${next}</NextContinuationToken>` : ""
  }</ListBucketResult>`;
}

describe("request signing", () => {
  test("a PUT is signed over exactly what it sends", async () => {
    const { config, received } = await bucket(() => ({ status: 200 }));
    const bytes = Buffer.from("not really a jpeg, but bytes all the same");

    await putObject(config, "8f14e45f/original.jpg", bytes);

    assertAllVerified(received, 1);
    assert.equal(received[0].method, "PUT");
    assert.equal(received[0].path, "/library/8f14e45f/original.jpg");
    assert.deepEqual(received[0].body, bytes);
  });

  test("keys needing RFC 3986 escapes still verify", async () => {
    const { config, received } = await bucket(() => ({ status: 200 }));

    // Spaces, a plus, non-ASCII, and characters encodeURIComponent leaves alone
    // but the signature does not.
    const key = "ünïcode dir/a+b (1)'2'!.png";
    await putObject(config, key, Buffer.from("x"));

    assertAllVerified(received, 1);
    assert.equal(
      received[0].path,
      "/library/%C3%BCn%C3%AFcode%20dir/a%2Bb%20%281%29%272%27%21.png",
    );
    // The slash inside the key stays a path separator; nothing else survives raw.
    assert.ok(!received[0].path.includes("+"));
  });

  test("a listing's query arrives sorted and encoded", async () => {
    const { config, received } = await bucket(() => ({ body: listing([]) }));

    await listObjectKeys(config, "8f14e45f/");

    assertAllVerified(received, 1);
    assert.equal(received[0].query, "list-type=2&prefix=8f14e45f%2F");
  });

  test("content type comes from the key's extension", async () => {
    const seen: string[] = [];
    const { config } = await bucket((request) => {
      seen.push(request.headers["content-type"] ?? "");
      return { status: 200 };
    });

    await putObject(config, "id/original.jpg", Buffer.from("a"));
    await putObject(config, "id/thumb.webp", Buffer.from("b"));
    await putObject(config, "id/original.avif", Buffer.from("c"));
    await putObject(config, "id/mystery.xyz", Buffer.from("d"));

    assert.deepEqual(seen, ["image/jpeg", "image/webp", "image/avif", "application/octet-stream"]);
  });
});

describe("objects", () => {
  test("bytes round-trip unchanged", async () => {
    const stored = Buffer.from([0x00, 0xff, 0x10, 0x89, 0x50, 0x4e, 0x47]);
    const { config, received } = await bucket(() => ({ body: stored }));

    assert.deepEqual(await getObject(config, "id/original.png"), stored);
    assertAllVerified(received, 1);
  });

  test("a missing key raises a 404 S3Error, and does not retry", async () => {
    const { config, received } = await bucket(() => ({
      status: 404,
      body: "<Error><Code>NoSuchKey</Code><Message>The key does not exist</Message></Error>",
    }));

    const error = await getObject(config, "gone/original.png").then(
      () => null,
      (e: unknown) => e,
    );

    assert.ok(error instanceof S3Error);
    assert.equal(error.status, 404);
    assert.equal(error.code, "NoSuchKey");
    assert.match(error.message, /key does not exist/);
    // A 404 is the request being wrong, not the bucket being busy.
    assert.equal(received.length, 1);
  });
});

describe("listing", () => {
  test("follows continuation tokens to the end", async () => {
    const { config, received } = await bucket((_request, index) =>
      index === 0
        ? { body: listing(["id/a.webp", "id/b.webp"], "token-two") }
        : { body: listing(["id/c.webp"]) },
    );

    assert.deepEqual(await listObjectKeys(config, "id/"), ["id/a.webp", "id/b.webp", "id/c.webp"]);
    assertAllVerified(received, 2);
    assert.ok(!received[0].query.includes("continuation-token"));
    assert.match(received[1].query, /continuation-token=token-two/);
  });

  test("a token on an untruncated page does not send us round again", async () => {
    // Some implementations echo the token on the last page. Following it loops.
    const { config, received } = await bucket(() => ({
      body: `<ListBucketResult><Contents><Key>id/a.webp</Key></Contents><IsTruncated>false</IsTruncated><NextContinuationToken>trap</NextContinuationToken></ListBucketResult>`,
    }));

    assert.deepEqual(await listObjectKeys(config, "id/"), ["id/a.webp"]);
    assert.equal(received.length, 1);
  });

  test("XML-escaped keys come back as their real names", async () => {
    const { config } = await bucket(() => ({
      body: listing(["id/tom &amp; jerry &lt;1&gt;.webp"]),
    }));

    assert.deepEqual(await listObjectKeys(config, "id/"), ["id/tom & jerry <1>.webp"]);
  });
});

describe("batch delete", () => {
  test("chunks at S3's limit of 1000 keys", async () => {
    const { config, received } = await bucket(() => ({ body: "<DeleteResult/>" }));
    const keys = Array.from({ length: 1001 }, (_, i) => `id/${i}.webp`);

    await deleteObjects(config, keys);

    assertAllVerified(received, 2);
    const counts = received.map(
      (request) => request.body.toString("utf8").match(/<Object>/g)?.length ?? 0,
    );
    assert.deepEqual(counts, [1000, 1]);
    assert.match(received[0].query, /^delete=$/);
    // Content-MD5 is still what MinIO and older implementations check.
    for (const request of received) {
      assert.equal(
        request.headers["content-md5"],
        createHash("md5").update(request.body).digest("base64"),
      );
    }
  });

  test("an error inside a quiet result is raised, not ignored", async () => {
    const { config } = await bucket(() => ({
      body: "<DeleteResult><Error><Key>id/a.webp</Key><Code>AccessDenied</Code><Message>Access Denied</Message></Error></DeleteResult>",
    }));

    const error = await deleteObjects(config, ["id/a.webp"]).then(
      () => null,
      (e: unknown) => e,
    );

    assert.ok(error instanceof S3Error);
    assert.equal(error.code, "AccessDenied");
    // The transport said 200; the operation did not succeed, so the error must
    // not claim a success status.
    assert.equal(error.status, 502);
    assert.match(error.message, /Batch delete failed/);
  });
});

describe("retries", () => {
  test("a 503 is retried and then succeeds", async () => {
    const { config, received } = await bucket((_request, index) =>
      index === 0
        ? { status: 503, body: "<Error><Code>SlowDown</Code><Message>slow down</Message></Error>" }
        : { status: 200 },
    );

    await putObject(config, "id/original.jpg", Buffer.from("bytes"));
    assertAllVerified(received, 2);
  });

  test("a 429 is retried", async () => {
    const { config, received } = await bucket((_request, index) =>
      index === 0 ? { status: 429 } : { status: 200 },
    );

    await putObject(config, "id/original.jpg", Buffer.from("bytes"));
    assert.equal(received.length, 2);
  });

  test("a 403 fails immediately rather than burning the budget", async () => {
    const { config, received } = await bucket(() => ({
      status: 403,
      body: "<Error><Code>SignatureDoesNotMatch</Code><Message>computed does not match</Message></Error>",
    }));

    const error = await putObject(config, "id/original.jpg", Buffer.from("x")).then(
      () => null,
      (e: unknown) => e,
    );

    assert.ok(error instanceof S3Error);
    assert.equal(error.code, "SignatureDoesNotMatch");
    assert.equal(received.length, 1);
  });

  test("a persistent 500 reports the bucket's own error after the last attempt", async () => {
    const { config, received } = await bucket(() => ({
      status: 500,
      body: "<Error><Code>InternalError</Code><Message>We encountered an internal error</Message></Error>",
    }));

    const error = await getObject(config, "id/original.jpg").then(
      () => null,
      (e: unknown) => e,
    );

    assert.ok(error instanceof S3Error);
    assert.equal(error.code, "InternalError");
    assert.match(error.message, /internal error/);
    assert.equal(received.length, 3);
  });

  test("a dropped connection is retried", async () => {
    const { config, received } = await bucket((_request, index) =>
      index === 0 ? "destroy" : { status: 200 },
    );

    await putObject(config, "id/original.jpg", Buffer.from("bytes"));
    assert.equal(received.length, 2);
  });

  test("a bucket that accepts and then goes quiet times out rather than hanging", async () => {
    // The regression this guards: without a timeout the first attempt waits on
    // Node's own five-minute floor, so nothing below ever runs.
    const { config, received } = await bucket(
      (_request, index) => (index === 0 ? "hang" : { status: 200 }),
      { timeoutMs: 250 },
    );

    const started = Date.now();
    await putObject(config, "id/original.jpg", Buffer.from("bytes"));

    assert.equal(received.length, 2);
    assert.ok(
      Date.now() - started < 5_000,
      "the stalled attempt should have been abandoned and retried",
    );
  });
});

describe("key prefix", () => {
  test("is applied on the way out and stripped on the way back", async () => {
    const { config, received } = await bucket(
      (request) =>
        request.method === "PUT"
          ? { status: 200 }
          : { body: listing(["instance-a/id/thumb.webp", "instance-a/id/medium.webp"]) },
      { prefix: "instance-a/" },
    );

    await putObject(config, "id/thumb.webp", Buffer.from("x"));
    assert.equal(received[0].path, "/library/instance-a/id/thumb.webp");

    // Callers above this module never see the prefix, in either direction.
    assert.deepEqual(await listObjectKeys(config, "id/"), ["id/thumb.webp", "id/medium.webp"]);
    assert.match(received[1].query, /prefix=instance-a%2Fid%2F/);
    assertAllVerified(received, 2);
  });
});
