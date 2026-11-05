#!/usr/bin/env bash
# Rehearse packaged runtime as an isolated, never-public synthetic container.
set -euo pipefail

image="mizvo-ci-stage-${GITHUB_RUN_ID:-local}-$$"
volume="mizvo-ci-data-${GITHUB_RUN_ID:-local}-$$"
first="mizvo-ci-first-${GITHUB_RUN_ID:-local}-$$"
second="mizvo-ci-second-${GITHUB_RUN_ID:-local}-$$"

cleanup() {
  docker rm -f "$first" "$second" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Source labels are exact checkout/tree identities. The OCI proof checks
# copied image bytes independently against the existing built distribution.
docker build --file Dockerfile --tag "$image" \
  --build-arg "MIZVO_SOURCE_COMMIT=$(git rev-parse HEAD)" \
  --build-arg "MIZVO_SOURCE_TREE=$(git rev-parse 'HEAD^{tree}')" \
  .
node scripts/oci-image-proof.mjs "$image"

MIZVO_ORIGIN=https://staging.example.invalid docker compose -f compose.staging.yaml config --quiet

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
        "http://127.0.0.1:$port/api/health" \
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

echo "PASS: rootless packaged runtime, loopback port, hardened filesystem, and SQLite persistence after replacement."
