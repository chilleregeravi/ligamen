#!/usr/bin/env bats
# tests/update.bats — /arcanon:update command and scripts/update.sh (Phase 98, plan 98-01).
# Covers UPD-01 (installed vs remote read), UPD-02/UPD-13 (semver matrix),
# UPD-03 (latest release path), UPD-04 (changelog preview), UPD-11 (offline fallback).

load 'test_helper/bats-support/load'
load 'test_helper/bats-assert/load'

PLUGIN_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../plugins/arcanon" && pwd)"

setup() {
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
  # Isolate marketplaces dir so we can control remote version under test.
  TEST_FAKE_HOME="$(mktemp -d)"
  export HOME="$TEST_FAKE_HOME"
  mkdir -p "$TEST_FAKE_HOME/.claude/plugins/marketplaces/arcanon/plugins/arcanon/.claude-plugin"
}

teardown() {
  rm -rf "$TEST_FAKE_HOME"
}

write_remote_manifest() {
  local version="$1"
  local changelog="${2:-}"
  cat > "$TEST_FAKE_HOME/.claude/plugins/marketplaces/arcanon/plugins/arcanon/.claude-plugin/marketplace.json" <<EOF
{"version":"${version}"}
EOF
  if [[ -n "$changelog" ]]; then
    printf '%s\n' "$changelog" > "$TEST_FAKE_HOME/.claude/plugins/marketplaces/arcanon/plugins/arcanon/CHANGELOG.md"
  fi
}

# Skip the `claude plugin marketplace update` refresh for test isolation — write
# the manifest directly and shim `claude` to a no-op. Otherwise tests hit the network.
shim_claude() {
  mkdir -p "$TEST_FAKE_HOME/bin"
  cat > "$TEST_FAKE_HOME/bin/claude" <<'EOF'
#!/bin/sh
exit 0
EOF
  chmod +x "$TEST_FAKE_HOME/bin/claude"
  export PATH="$TEST_FAKE_HOME/bin:$PATH"
}

# ─── UPD-02 / UPD-13: semver comparison matrix ──────────────────────────────
@test "UPD-13: node+semver says 0.10.0 > 0.9.0 (not lexicographic)" {
  run env NODE_PATH="${PLUGIN_ROOT}/node_modules" node -e \
    "const s=require('semver'); process.exit(s.gt('0.10.0','0.9.0')?0:1)"
  assert_success
}

@test "UPD-13: node+semver says 0.10.0 is NOT less than 0.9.0 (anti-lex proof)" {
  run env NODE_PATH="${PLUGIN_ROOT}/node_modules" node -e \
    "const s=require('semver'); process.exit(s.lt('0.10.0','0.9.0')?0:1)"
  # If lexical compare was used, "0.10.0" < "0.9.0" would be TRUE and exit 0.
  # semver.lt('0.10.0','0.9.0') is FALSE, so this must exit 1 (assert_failure).
  assert_failure
}

@test "UPD-13: node+semver says 0.1.1 > 0.1.0" {
  run env NODE_PATH="${PLUGIN_ROOT}/node_modules" node -e \
    "const s=require('semver'); process.exit(s.gt('0.1.1','0.1.0')?0:1)"
  assert_success
}

@test "UPD-13: node+semver says 1.0.0 == 1.0.0" {
  run env NODE_PATH="${PLUGIN_ROOT}/node_modules" node -e \
    "const s=require('semver'); process.exit(s.eq('1.0.0','1.0.0')?0:1)"
  assert_success
}

# ─── UPD-01 / UPD-03: update.sh --check, installed==remote path ──────────────
@test "UPD-03: --check emits status=equal when installed matches remote" {
  shim_claude
  INSTALLED=$(jq -r '.version' "$PLUGIN_ROOT/.claude-plugin/plugin.json")
  write_remote_manifest "$INSTALLED"
  run bash -c "bash '$PLUGIN_ROOT/scripts/update.sh' --check | jq -er '.status'"
  assert_success
  assert_output "equal"
}

# ─── UPD-04: changelog preview when newer ─────────────────────────────────────
@test "UPD-04: --check emits non-empty changelog_preview when remote is newer" {
  shim_claude
  write_remote_manifest "99.99.99" "$(cat <<'CHG'
# Changelog

## [Unreleased]

- Fix something critical
- Add helpful feature
CHG
)"
  run bash -c "bash '$PLUGIN_ROOT/scripts/update.sh' --check | jq -er '.changelog_preview'"
  assert_success
  [[ "$output" == *"Fix something critical"* ]] || { echo "preview missing expected bullet: $output"; return 1; }
}

@test "UPD-04: --check marks update_available=true when remote is newer" {
  shim_claude
  write_remote_manifest "99.99.99"
  run bash -c "bash '$PLUGIN_ROOT/scripts/update.sh' --check | jq -er '.update_available'"
  assert_success
  assert_output "true"
}

# ─── UPD-11: offline graceful fallback ────────────────────────────────────────
@test "UPD-11: --check exits 0 with status=offline when marketplace manifest is absent" {
  shim_claude
  # Do NOT write the manifest — simulate "could not reach update server"
  rm -rf "$TEST_FAKE_HOME/.claude/plugins/marketplaces/arcanon"
  run bash -c "bash '$PLUGIN_ROOT/scripts/update.sh' --check | jq -er '.status'"
  assert_success
  assert_output "offline"
}

# ─── Output shape validation ──────────────────────────────────────────────────
@test "--check emits valid JSON with all required keys" {
  shim_claude
  write_remote_manifest "99.99.99"
  run bash -c "bash '$PLUGIN_ROOT/scripts/update.sh' --check | jq -e 'has(\"status\") and has(\"installed\") and has(\"remote\") and has(\"update_available\") and has(\"changelog_preview\")'"
  assert_success
}

# ─── UPD-07 / UPD-08: --kill mode tests (Phase 98, plan 98-02) ───────────────

# UPD-07: scan-lock abort (live lock)
@test "UPD-07: --kill emits scan_in_progress when scan.lock has a live PID" {
  export ARCANON_DATA_DIR="$(mktemp -d)"
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"

  # Create a scan.lock containing a live PID (use $$ — the current shell)
  echo "$$" > "${ARCANON_DATA_DIR}/scan.lock"
  # Also create a worker.pid (so --kill would be tempted to act without the lock guard)
  echo "$$" > "${ARCANON_DATA_DIR}/worker.pid"

  run bash -c "bash '$PLUGIN_ROOT/scripts/update.sh' --kill | jq -er '.status'"
  assert_success
  assert_output "scan_in_progress"

  # worker.pid must still exist — we did NOT kill
  [[ -f "${ARCANON_DATA_DIR}/worker.pid" ]] || { echo "worker.pid was removed despite scan_in_progress"; return 1; }

  rm -rf "$ARCANON_DATA_DIR"
}

# UPD-07: stale scan.lock is cleared and kill proceeds
@test "UPD-07: --kill clears stale scan.lock (dead PID) and proceeds" {
  export ARCANON_DATA_DIR="$(mktemp -d)"
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"

  # PID 999999 is virtually guaranteed not to exist on a test machine
  echo "999999" > "${ARCANON_DATA_DIR}/scan.lock"

  run bash -c "bash '$PLUGIN_ROOT/scripts/update.sh' --kill | jq -er '.status'"
  assert_success
  assert_output "killed"

  # scan.lock should be gone now
  [[ ! -f "${ARCANON_DATA_DIR}/scan.lock" ]] || { echo "stale scan.lock was not cleared"; return 1; }

  rm -rf "$ARCANON_DATA_DIR"
}

# UPD-08: sigterm path with live worker
@test "UPD-08: --kill sends SIGTERM and removes worker.pid/worker.port on live worker" {
  export ARCANON_DATA_DIR="$(mktemp -d)"
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
  export ARCANON_WORKER_PORT="37999"

  bash "$PLUGIN_ROOT/scripts/worker-start.sh" >/dev/null
  # shellcheck source=../plugins/arcanon/lib/worker-client.sh
  source "$PLUGIN_ROOT/lib/worker-client.sh"
  wait_for_worker 20 250

  [[ -f "${ARCANON_DATA_DIR}/worker.pid" ]] || { echo "worker never started"; return 1; }
  local pre_pid; pre_pid=$(cat "${ARCANON_DATA_DIR}/worker.pid")

  run bash -c "bash '$PLUGIN_ROOT/scripts/update.sh' --kill | jq -er '.status'"
  assert_success
  assert_output "killed"

  # worker.pid and worker.port must be gone
  [[ ! -f "${ARCANON_DATA_DIR}/worker.pid" ]] || { echo "worker.pid survived --kill"; return 1; }
  [[ ! -f "${ARCANON_DATA_DIR}/worker.port" ]] || { echo "worker.port survived --kill"; return 1; }

  # Worker process must be gone (give kernel 0.5s to reap)
  sleep 0.5
  ! kill -0 "$pre_pid" 2>/dev/null || { echo "worker PID $pre_pid still alive after --kill"; kill -9 "$pre_pid"; return 1; }

  rm -rf "$ARCANON_DATA_DIR"
}

# UPD-08: no-pid path
@test "UPD-08: --kill emits reason=no_pid_file when worker not running" {
  export ARCANON_DATA_DIR="$(mktemp -d)"
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"

  run bash -c "bash '$PLUGIN_ROOT/scripts/update.sh' --kill | jq -er '.reason'"
  assert_success
  assert_output "no_pid_file"

  rm -rf "$ARCANON_DATA_DIR"
}

# UPD-08: update.sh never references restart_worker_if_stale or worker_start_background (Anti-Pattern 2 regression guard)
@test "UPD-08: scripts/update.sh does not reference restart_worker_if_stale or worker_start_background" {
  run grep -E 'restart_worker_if_stale|worker_start_background' "$PLUGIN_ROOT/scripts/update.sh"
  # grep exits 1 when no match — that's success for us
  assert_failure
}

# UPD-08: after --kill, no new Arcanon worker has been started
@test "UPD-08: --kill does not spawn a new worker (kill-only semantics)" {
  export ARCANON_DATA_DIR="$(mktemp -d)"
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
  export ARCANON_WORKER_PORT="37999"

  bash "$PLUGIN_ROOT/scripts/worker-start.sh" >/dev/null
  source "$PLUGIN_ROOT/lib/worker-client.sh"
  wait_for_worker 20 250

  bash "$PLUGIN_ROOT/scripts/update.sh" --kill >/dev/null
  sleep 0.5

  # No worker.pid file means no new worker started (--kill is kill-only, 98-03 starts the new one)
  [[ ! -f "${ARCANON_DATA_DIR}/worker.pid" ]] || { echo "worker.pid reappeared — --kill spawned a new worker"; return 1; }

  # No Node process listening on 37999
  ! lsof -i :37999 >/dev/null 2>&1 || { echo "something is listening on 37999 after --kill"; return 1; }

  rm -rf "$ARCANON_DATA_DIR"
}
