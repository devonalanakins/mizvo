import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function pinnedStages(source) {
  const statements = source
    .split(/\r?\n/)
    .filter((line) => /^FROM\s+/i.test(line));
  assert.equal(statements.length, 2, "Expected exactly two stages");
  const parsed = statements.map((line) => {
    const m = line.match(
      /^FROM (node:24-bookworm-slim@sha256:[a-f0-9]{64}) AS (build|runtime)$/,
    );
    assert(m, "OCI stage has mutable or unsupported Node base");
    return { reference: m[1], stage: m[2] };
  });
  assert.equal(parsed[0].stage, "build");
  assert.equal(parsed[1].stage, "runtime");
  assert.equal(parsed[0].reference, parsed[1].reference);
  return parsed[0].reference;
}

test("OCI base must remain pinned across build and runtime stages", () => {
  const source = readFileSync("Dockerfile", "utf8");
  assert.match(
    pinnedStages(source),
    /^node:24-bookworm-slim@sha256:[a-f0-9]{64}$/,
  );
});

test("OCI base guard rejects mutable, split and extra stage definitions", () => {
  const a = "a".repeat(64);
  const b = "b".repeat(64);
  const valid = [
    `FROM node:24-bookworm-slim@sha256:${a} AS build`,
    `FROM node:24-bookworm-slim@sha256:${a} AS runtime`,
  ].join("\n");
  assert.doesNotThrow(() => pinnedStages(valid));
  assert.throws(() => pinnedStages(valid.replace(a, b)));
  assert.throws(() => pinnedStages(valid.replace("@sha256:" + a, "")));
  assert.throws(() => pinnedStages(valid + "\nFROM alpine:latest AS third"));
});
