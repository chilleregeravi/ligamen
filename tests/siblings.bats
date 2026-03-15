#!/usr/bin/env bats
# AllClear — siblings.bats
# Tests: TEST-06 (sibling repo discovery library)
# Covers: discover_siblings / list_siblings from lib/siblings.sh
#
# These tests source lib/siblings.sh directly (Pattern 5 from RESEARCH.md).
# Tests are in RED state until lib/siblings.sh is implemented.
# Note: lib/siblings.sh exists at Phase 13 time — tests should pass GREEN.
#
# IMPORTANT: Function name must match lib/siblings.sh — the primary function is
# `list_siblings`; `discover_siblings` is an alias for backward compatibility.
# Update if lib/siblings.sh uses a different name.

setup() {
  load 'test_helper/bats-support/load'
  load 'test_helper/bats-assert/load'
  FIXTURES_DIR="$(mktemp -d)"
  export CLAUDE_PLUGIN_ROOT="${BATS_TEST_DIRNAME}/.."
}

teardown() {
  rm -rf "${FIXTURES_DIR}"
}

# ---------------------------------------------------------------------------
# discover_siblings — basic discovery (TEST-06)
# ---------------------------------------------------------------------------

@test "siblings.sh - discovers sibling repos from parent dir" {
  local PARENT="${FIXTURES_DIR}/workspace"
  mkdir -p "${PARENT}/repo-a/.git"
  mkdir -p "${PARENT}/repo-b/.git"
  mkdir -p "${PARENT}/not-a-repo"  # no .git — should be excluded
  # shellcheck source=lib/siblings.sh
  source "${BATS_TEST_DIRNAME}/../lib/siblings.sh"
  run discover_siblings "${PARENT}/repo-a"
  assert_success
  assert_output --partial "repo-b"
  refute_output --partial "not-a-repo"
}

@test "siblings.sh - excludes the current repo from results" {
  local PARENT="${FIXTURES_DIR}/workspace"
  mkdir -p "${PARENT}/repo-a/.git"
  mkdir -p "${PARENT}/repo-b/.git"
  source "${BATS_TEST_DIRNAME}/../lib/siblings.sh"
  # Calling from repo-a: repo-a must not appear in output
  run discover_siblings "${PARENT}/repo-a"
  assert_success
  refute_output --partial "repo-a"
}

@test "siblings.sh - returns empty when no siblings exist" {
  local PARENT="${FIXTURES_DIR}/workspace"
  mkdir -p "${PARENT}/only-repo/.git"
  source "${BATS_TEST_DIRNAME}/../lib/siblings.sh"
  run discover_siblings "${PARENT}/only-repo"
  assert_success
  assert_output ""
}

@test "siblings.sh - handles parent dir with no git repos (empty dir)" {
  local PARENT="${FIXTURES_DIR}/empty-workspace"
  mkdir -p "${PARENT}/not-a-repo"   # only non-git directory
  mkdir -p "${PARENT}/calling-dir"  # the "current repo" with no .git
  source "${BATS_TEST_DIRNAME}/../lib/siblings.sh"
  run discover_siblings "${PARENT}/calling-dir"
  # Must not crash — exit 0 with no output
  assert_success
  assert_output ""
}

@test "siblings.sh - discovers multiple siblings" {
  local PARENT="${FIXTURES_DIR}/workspace"
  mkdir -p "${PARENT}/repo-a/.git"
  mkdir -p "${PARENT}/repo-b/.git"
  mkdir -p "${PARENT}/repo-c/.git"
  source "${BATS_TEST_DIRNAME}/../lib/siblings.sh"
  run discover_siblings "${PARENT}/repo-a"
  assert_success
  assert_output --partial "repo-b"
  assert_output --partial "repo-c"
  refute_output --partial "repo-a"
}

@test "siblings.sh - list_siblings is the primary function (alias test)" {
  # list_siblings is the real function; discover_siblings is an alias
  local PARENT="${FIXTURES_DIR}/workspace"
  mkdir -p "${PARENT}/src-repo/.git"
  mkdir -p "${PARENT}/another-repo/.git"
  source "${BATS_TEST_DIRNAME}/../lib/siblings.sh"
  run list_siblings "${PARENT}/src-repo"
  assert_success
  assert_output --partial "another-repo"
  refute_output --partial "src-repo"
}

# ---------------------------------------------------------------------------
# allclear.config.json override (TEST-06 config path)
# ---------------------------------------------------------------------------

@test "siblings.sh - uses allclear.config.json siblings list when present" {
  local PARENT="${FIXTURES_DIR}/workspace"
  mkdir -p "${PARENT}/my-repo/.git"
  mkdir -p "${PARENT}/configured-sibling"
  # Write a config file that specifies a sibling via explicit path
  cat > "${PARENT}/my-repo/allclear.config.json" << EOF
{
  "siblings": [
    {"path": "${PARENT}/configured-sibling"}
  ]
}
EOF
  source "${BATS_TEST_DIRNAME}/../lib/siblings.sh"
  run discover_siblings "${PARENT}/my-repo"
  assert_success
  assert_output --partial "configured-sibling"
}
