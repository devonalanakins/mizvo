import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { application } from "../apps/api/server.ts";

const entry = fileURLToPath(new URL("../apps/api/server.ts", import.meta.url));

test("direct production application rejects unsafe storage and origin before opening SQLite", () => {
  const root = mkdtempSync(join(tmpdir(), "mizvo-invalid-config-"));
  try {
    const database = join(root, "uncreated", "database.sqlite");
    const cases = [
      {
        name: "HTTP origin",
        database,
        origin: "http://localhost:4173",
        error: /Production requires an HTTPS origin/,
      },
      {
        name: "relative database",
        database: "var/unreviewed-production.sqlite",
        origin: "https://stage.example.invalid",
        error: /Production requires an explicit absolute MIZVO_DATABASE path/,
      },
      {
        name: "origin with trailing slash",
        database,
        origin: "https://stage.example.invalid/",
        error: /Production requires an exact HTTPS origin/,
      },
      {
        name: "origin with credentials",
        database,
        origin: "https://user:token@stage.example.invalid",
        error: /Production requires an exact HTTPS origin/,
      },
      {
        name: "origin with default-port alias",
        database,
        origin: "https://stage.example.invalid:443",
        error: /Production requires an exact HTTPS origin/,
      },
      {
        name: "origin with path",
        database,
        origin: "https://stage.example.invalid/review",
        error: /Production requires an exact HTTPS origin/,
      },
    ];
    for (const scenario of cases) {
      assert.throws(
        () =>
          application({
            database: scenario.database,
            origin: scenario.origin,
            organization: "fictional",
            production: true,
          }),
        scenario.error,
        scenario.name,
      );
      assert.equal(existsSync(join(root, "uncreated")), false, scenario.name);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("direct production application accepts a canonical HTTPS origin and absolute path", () => {
  const root = mkdtempSync(join(tmpdir(), "mizvo-valid-config-"));
  try {
    const database = join(root, "private", "database.sqlite");
    const app = application({
      database,
      origin: "https://stage.example.invalid",
      organization: "fictional",
      production: true,
    });
    try {
      assert.equal(existsSync(database), true);
    } finally {
      app.s.close();
    }
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
      if (
        Object.hasOwn(scenario.overrides, "MIZVO_DATABASE") &&
        scenario.overrides.MIZVO_DATABASE === undefined
      )
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
