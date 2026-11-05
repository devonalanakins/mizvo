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

docker build --file Dockerfile --tag "$image" .
MIZVO_ORIGIN=https://staging.example.invalid docker compose -f compose.staging.yaml config --quiet

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
