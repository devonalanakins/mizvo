#!/usr/bin/env bash
# Rehearse packaged runtime as an isolated, never-public synthetic container.
set -euo pipefail

image="mizvo-ci-stage-${GITHUB_RUN_ID:-local}-${BASHPID}"
inspector="mizvo-ci-inspect-${GITHUB_RUN_ID:-local}-${BASHPID}"
receipt_dir=""
volume="mizvo-ci-data-${GITHUB_RUN_ID:-local}-$$"
first="mizvo-ci-first-${GITHUB_RUN_ID:-local}-$$"
second="mizvo-ci-second-${GITHUB_RUN_ID:-local}-$$"

cleanup() {
  docker rm -f "$first" "$second" "$inspector" >/dev/null 2>&1 || true
  if [[ -n "$receipt_dir" ]]; then
    rm -rf -- "$receipt_dir"
  fi
  docker volume rm "$volume" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# GitHub PR builds use a synthetic merge checkout. Bind this test to the
# checked-out Git source; never confuse it with the PR branch head.
commit="$(git rev-parse HEAD)"
tree="$(git rev-parse 'HEAD^{tree}')"
[[ -z "${GITHUB_SHA:-}" || "$GITHUB_SHA" == "$commit" ]] || {
  echo "FAIL: GitHub checkout SHA does not match expected source" >&2
  exit 1
}
[[ "${GITHUB_REPOSITORY:-devonalanakins/mizvo}" == "devonalanakins/mizvo" ]] || {
  echo "FAIL: unrelated GitHub repository identity" >&2
  exit 1
}
[[ -f build-proof.json && -d dist ]] || {
  echo "FAIL: run build and artifact:create before container rehearsal" >&2
  exit 1
}
# Fail closed if either OCI stage uses a floating, mixed or malformed base.
mapfile -t base_refs < <(awk '$1 == "FROM" {print $2}' Dockerfile)
if [[ "${#base_refs[@]}" -ne 2 ||
      "${base_refs[0]}" != "${base_refs[1]}" ||
      ! "${base_refs[0]}" =~ ^node:24-bookworm-slim@sha256:[a-f0-9]{64}$ ]]; then
  echo "FAIL: both OCI stages must use the same immutable Node 24 index" >&2
  exit 1
fi
base_ref="${base_refs[0]}"
manifest_sha="$(sha256sum build-proof.json | cut -d ' ' -f 1)"
docker build --file Dockerfile --tag "$image" \
  --build-arg "MIZVO_SOURCE_COMMIT=$commit" \
  --build-arg "MIZVO_SOURCE_TREE=$tree" .
MIZVO_ORIGIN=https://staging.example.invalid docker compose -f compose.staging.yaml config --quiet

# Compare the ACTUAL image filesystem with the host's already-verified
# checkout manifest, not just the Dockerfile or its easily forged labels.
image_id="$(docker image inspect --format '{{.Id}}' "$image")"
[[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "FAIL: missing content-addressed local OCI image ID" >&2
  exit 1
}
[[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" == "$commit" ]] || {
  echo "FAIL: image's untrusted source label differs from CI checkout" >&2
  exit 1
}
[[ "$(docker image inspect --format '{{index .Config.Labels "com.mizvo.checkout-tree"}}' "$image")" == "$tree" ]] || {
  echo "FAIL: image's untrusted source tree label differs from CI checkout" >&2
  exit 1
}
receipt_dir="$(mktemp -d)"
chmod 700 "$receipt_dir"
mkdir "$receipt_dir/extracted"
docker create --name "$inspector" "$image" >/dev/null
docker cp "$inspector:/app/dist/." "$receipt_dir/extracted/"
docker rm "$inspector" >/dev/null
node scripts/installation-preflight.mjs \
  "$receipt_dir/extracted" build-proof.json "$manifest_sha" "$commit" "$tree" devonalanakins/mizvo
# The harness must reject an unreviewed addition to the extracted OCI file set.
printf '%s\n' 'unreviewed bytes' > "$receipt_dir/extracted/injected.txt"
if node scripts/installation-preflight.mjs \
  "$receipt_dir/extracted" build-proof.json "$manifest_sha" "$commit" "$tree" devonalanakins/mizvo >/dev/null 2>&1; then
  echo "FAIL: unreviewed image-content injection was accepted" >&2
  exit 1
fi
rm "$receipt_dir/extracted/injected.txt"

# A local Docker image ID is content-addressed, but not a remote registry
# digest or proof of what an external service is actually running.
MIZVO_OCI_IMAGE_ID="$image_id" \
MIZVO_OCI_COMMIT="$commit" \
MIZVO_OCI_TREE="$tree" \
MIZVO_OCI_MANIFEST="$manifest_sha" \
MIZVO_OCI_BASE_REF="$base_ref" \
node --input-type=module <<'JS'
import { mkdir, writeFile } from "node:fs/promises";
const path = "docs/evidence/oci-candidate-check.json";
await mkdir("docs/evidence", { recursive: true });
await writeFile(path, JSON.stringify({
  schema: "mizvo.oci-candidate-check.v1",
  observed_at: new Date().toISOString(),
  local_image_id: process.env.MIZVO_OCI_IMAGE_ID,
  checkout_commit: process.env.MIZVO_OCI_COMMIT,
  checkout_tree: process.env.MIZVO_OCI_TREE,
  manifest_sha256: process.env.MIZVO_OCI_MANIFEST,
  pinned_base_index_reference: process.env.MIZVO_OCI_BASE_REF,
  base_registry_signature_verified: false,
  entire_compiled_image_file_set_matches_ci_manifest: true,
  injected_unreviewed_file_rejected: true,
  image_source_labels_match_checkout: true,
  registry_digest_verified: false,
  provider_deployment_observed: false,
  independent_signed_provenance: false,
  production_release_approved: false,
}, null, 2) + "\n");
JS

# A public container bind must fail closed for an untrusted address or
# missing production HTTPS origin. Prevent a hanging broken server from
# accidentally looking like a successful rejection.
expect_rejected_start() {
  local expected="$1" output status
  shift
  set +e
  output="$(timeout 8s docker run --rm --network none "$@" "$image" 2>&1)"
  status=$?
  set -e
  if [[ "$status" -eq 0 || "$status" -eq 124 || "$output" != *"$expected"* ]]; then
    echo "FAIL: container network binding guard did not reject unsafe configuration" >&2
    exit 1
  fi
}

expect_rejected_start "Production requires an HTTPS origin." \
  -e MIZVO_ORIGIN=http://localhost:4173
expect_rejected_start "Container network binding requires production HTTPS origin." \
  -e NODE_ENV=test -e MIZVO_ORIGIN=http://localhost:4173
expect_rejected_start "Unsupported bind address." \
  -e MIZVO_ORIGIN=https://staging.example.invalid -e MIZVO_BIND_HOST=192.0.2.1

docker volume create "$volume" >/dev/null

start_container() {
  docker run --detach --name "$1" \
    --read-only \
    --cap-drop=ALL \
    --security-opt=no-new-privileges:true \
    --pids-limit=128 \
    --memory=512m \
    --cpus=1 \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m \
    --mount "type=volume,source=$volume,target=/var/lib/mizvo" \
    -e MIZVO_ORIGIN=https://staging.example.invalid \
    -e MIZVO_ORGANIZATION=mizvo-synthetic-stage \
    -p 127.0.0.1::4173 \
    "$image" >/dev/null
}

wait_until_healthy() {
  local name="$1" mapping port
  mapping="$(docker port "$name" 4173/tcp)"
  [[ "$mapping" == 127.0.0.1:* ]] || {
    echo "FAIL: container port is not bound to loopback" >&2
    exit 1
  }
  port="${mapping##*:}"
  for i in $(seq 1 60); do
    if curl --silent --fail --max-time 2 \
        "http://127.0.0.1:$port/api/ready" \
        | grep -q '"status":"ok"'; then
      return
    fi
    sleep 1
  done
  docker inspect --format '{{.State.Status}} {{.State.Health.Status}}' "$name" >&2
  echo "FAIL: container health did not become ready" >&2
  exit 1
}

check_hardening() {
  local name="$1"
  [[ "$(docker exec "$name" id -u)" == 1000 ]] || {
    echo "FAIL: application is not running as unprivileged UID 1000" >&2
    exit 1
  }
  [[ "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$name")" == true ]] || exit 1
  [[ "$(docker inspect -f '{{.HostConfig.SecurityOpt}}' "$name")" == *no-new-privileges* ]] || exit 1
  [[ "$(docker inspect -f '{{.HostConfig.CapDrop}}' "$name")" == *ALL* ]] || exit 1
  [[ "$(docker inspect -f '{{.HostConfig.Memory}}' "$name")" -gt 0 ]] || exit 1
  docker exec "$name" test ! -w /app/dist
  docker exec "$name" test -w /var/lib/mizvo
}

check_count() {
  docker exec "$1" node -e "
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync('/var/lib/mizvo/mizvo.sqlite', {readOnly:true});
    const row = db.prepare('SELECT COUNT(*) AS count FROM users').get();
    db.close();
    if (row.count !== 1) process.exit(1);
  "
}

start_container "$first"
wait_until_healthy "$first"
check_hardening "$first"
docker exec -e MIZVO_ACCOUNT_PASSWORD=CI-Synthetic-Only-Password-2026 \
  "$first" node dist/scripts/account.js \
  synthetic-container-founder@example.test "Synthetic Container Founder" founder >/dev/null
check_count "$first"

docker stop "$first" >/dev/null
docker rm "$first" >/dev/null
start_container "$second"
wait_until_healthy "$second"
check_hardening "$second"
check_count "$second"

echo "PASS: OCI image content compared to exact checkout; injected-file rejection, private runtime and SQLite persistence passed."
