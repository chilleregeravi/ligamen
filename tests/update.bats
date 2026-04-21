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
