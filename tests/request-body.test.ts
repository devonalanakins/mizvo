import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { application } from "../apps/api/server.ts";

test("HTTP JSON ingestion enforces raw byte limits and strict UTF-8 without data corruption", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mizvo-body-"));
  const origin = "http://localhost";
  const config = {
    database: join(directory, "data.sqlite"),
    origin,
    organization: "body-test",
  };
  const app = application(config);
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  assert(address && typeof address !== "string");
  const localOrigin = origin + ":" + address.port;
  config.origin = localOrigin;
  // The application validates Origin against the configured public URL.
  // Keep it the same as the loopback test request.
  const endpoint = "/api/inquiries";
  const base = {
    name: "Synthetic tester",
    email: "body-test@example.test",
    goal: "Make request validation safe for all clients.",
    consent: true,
    padding: "",
  };
  async function post(parts: Buffer[], options: Record<string, string> = {}) {
    return await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path: endpoint,
          method: "POST",
          headers: {
            Origin: localOrigin,
            "Content-Type": "application/json",
            Connection: "close",
            ...options,
          },
        },
        (res) => {
          const data: Buffer[] = [];
          res.on("data", (chunk: Buffer) => data.push(chunk));
          res.on("error", reject);
          res.on("end", () => {
            const text = Buffer.concat(data).toString("utf8");
            resolve({
              status: res.statusCode ?? 0,
              body: text ? JSON.parse(text) : null,
            });
          });
        },
      );
      req.on("error", reject);
      for (const part of parts) req.write(part);
      req.end();
    });
  }
  try {
    // The old string-length check erroneously accepted more than 32 KiB of
    // multibyte data as long as JavaScript .length stayed below the limit.
    const prefix = Buffer.byteLength(JSON.stringify(base));
    const boundary = Buffer.from(
      JSON.stringify({ ...base, padding: "x".repeat(32768 - prefix) }),
    );
    assert.equal(boundary.byteLength, 32768);
    const atLimit = await post([boundary]);
    assert.equal(atLimit.status, 201, JSON.stringify(atLimit.body));

    const oversized = Buffer.from(
      JSON.stringify({ ...base, padding: "é".repeat(18000) }),
    );
    assert(oversized.byteLength > 32768);
    assert(oversized.toString("utf8").length < 32768);
    const overLimit = await post([
      oversized.subarray(0, 13000),
      oversized.subarray(13000, 29000),
      oversized.subarray(29000),
    ]);
    assert.equal(overLimit.status, 413, JSON.stringify(overLimit.body));

    const contentLength = await post([oversized], {
      "Content-Length": String(oversized.byteLength),
    });
    assert.equal(contentLength.status, 413);

    // Invalid content-type prefixes must not be mistaken for JSON.
    const valid = Buffer.from(JSON.stringify(base));
    assert.equal(
      (await post([valid], { "Content-Type": "application/jsonp" })).status,
      415,
    );
    assert.equal(
      (await post([valid], { "Content-Encoding": "gzip" })).status,
      415,
    );

    const brokenUtf8 = Buffer.concat([
      Buffer.from(
        '{"name":"Synthetic","email":"bad-utf8@example.test","goal":"Review Unicode parsing safely","consent":true,"details":"',
      ),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('"}'),
    ]);
    assert.equal((await post([brokenUtf8])).status, 400);
    assert.equal(
      app.s.get(
        "SELECT COUNT(*) AS count FROM inquiries WHERE email=?",
        "bad-utf8@example.test",
      )?.count,
      0,
      "Invalid UTF-8 must never create an inquiry.",
    );

    const details = "A multi-byte character 🧭 must survive chunk boundaries.";
    const split = Buffer.from(
      JSON.stringify({
        ...base,
        email: "split-body@example.test",
        details,
      }),
    );
    const middle = split.indexOf(Buffer.from("🧭"));
    assert(middle > 0);
    const response = await post([
      split.subarray(0, middle + 2),
      split.subarray(middle + 2),
    ]);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(
      app.s.get(
        "SELECT details FROM inquiries WHERE email=?",
        "split-body@example.test",
      )?.details,
      details,
    );
  } finally {
    await new Promise<void>((done) => app.server.close(() => done()));
    app.s.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
