import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { application } from "../apps/api/server.ts";

const entry = fileURLToPath(new URL("../apps/api/server.ts", import.meta.url));

test("direct production application rejects HTTP before making a database directory", () => {
  const root = mkdtempSync(join(tmpdir(), "mizvo-invalid-config-"));
  try {
    const path = join(root, "uncreated", "database.sqlite");
    assert.throws(
      () =>
        application({
          database: path,
          origin: "http://localhost:4173",
          organization: "fictional",
          production: true,
        }),
      /Production requires an HTTPS origin/,
    );
    assert.equal(existsSync(join(root, "uncreated")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("standalone startup rejects unsafe production configuration before creating SQLite", () => {
  const root = mkdtempSync(join(tmpdir(), "mizvo-startup-guard-"));
  try {
    const database = join(root, "uncreated", "database.sqlite");
    const valid = {
      ...process.env,
      NODE_ENV: "production",
      PORT: "4173",
      MIZVO_ORIGIN: "https://stage.example.invalid",
      MIZVO_DATABASE: database,
      MIZVO_BIND_HOST: "127.0.0.1",
    };
    delete valid.MIZVO_EXPECTED_SERVER_SHA256;
    const cases = [
      {
        name: "missing production database setting",
        overrides: { MIZVO_DATABASE: undefined },
        error: /Production requires an explicit absolute MIZVO_DATABASE path/,
      },
      {
        name: "relative production database path",
        overrides: { MIZVO_DATABASE: "var/unexpected.sqlite" },
        error: /Production requires an explicit absolute MIZVO_DATABASE path/,
      },
      {
        name: "invalid public bind address",
        overrides: { MIZVO_BIND_HOST: "192.0.2.1" },
        error: /Unsupported bind address/,
      },
      {
        name: "public bind without production",
        overrides: { NODE_ENV: "development", MIZVO_BIND_HOST: "0.0.0.0" },
        error: /Container network binding requires production HTTPS origin/,
      },
      {
        name: "invalid port",
        overrides: { PORT: "65536" },
        error: /PORT must be an integer between 1 and 65535/,
      },
      {
        name: "non-numeric port",
        overrides: { PORT: "not-a-port" },
        error: /PORT must be an integer between 1 and 65535/,
      },
      {
        name: "HTTP origin in production",
        overrides: { MIZVO_ORIGIN: "http://localhost:4173" },
        error: /Production requires an HTTPS origin/,
      },
    ];
    for (const scenario of cases) {
      const env = { ...valid, ...scenario.overrides };
      if (scenario.overrides.MIZVO_DATABASE === undefined)
        delete env.MIZVO_DATABASE;
      const result = spawnSync(
        process.execPath,
        ["--experimental-strip-types", entry],
        {
          cwd: root,
          env,
          encoding: "utf8",
          timeout: 8000,
          maxBuffer: 32 * 1024,
        },
      );
      assert.notEqual(result.status, 0, scenario.name);
      assert.notEqual(result.status, 124, scenario.name);
      assert.match(result.stderr, scenario.error, scenario.name);
      assert.equal(existsSync(join(root, "uncreated")), false, scenario.name);
      assert.equal(existsSync(join(root, "var")), false, scenario.name);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
