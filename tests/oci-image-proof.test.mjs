import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePinnedBase } from "../scripts/oci-image-proof.mjs";

const digest = "a".repeat(64);
const other = "b".repeat(64);
const pinned = (hash, stage) =>
  "FROM node:24-bookworm-slim@sha256:" + hash + " AS " + stage;

test("OCI base proof requires exactly two stages with the same immutable index", () => {
  const example = [
    "# private, unshipped synthetic sample",
    pinned(digest, "build"),
    "RUN node --version",
    pinned(digest, "runtime"),
    "USER node",
  ].join("\n");
  assert.equal(
    parsePinnedBase(example).reference,
    "node:24-bookworm-slim@sha256:" + digest,
  );
  assert.equal(parsePinnedBase(example).stage, "build");

  assert.throws(
    () => parsePinnedBase(example.replace(digest, other)),
    /same approved base/,
  );
  assert.throws(
    () =>
      parsePinnedBase(
        example.replace(
          pinned(digest, "runtime"),
          "FROM node:24-bookworm-slim AS runtime",
        ),
      ),
    /immutable/,
  );
  assert.throws(
    () => parsePinnedBase("FROM node:24-bookworm-slim AS runtime"),
    /exactly two/,
  );
  assert.throws(
    () =>
      parsePinnedBase(example + "\nFROM alpine:latest AS extra"),
    /exactly two/,
  );
  assert.throws(
    () =>
      parsePinnedBase(example.replace(" AS build", " AS runtime")),
    /stage order/,
  );
});

test("production OCI Dockerfile has matching immutable build and runtime bases", () => {
  const source = readFileSync("Dockerfile", "utf8");
  const result = parsePinnedBase(source);
  assert.match(result.reference, /^node:24-bookworm-slim@sha256:[a-f0-9]{64}$/);
  assert.equal(result.digest.length, 64);
});
