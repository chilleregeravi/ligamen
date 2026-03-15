#!/usr/bin/env bash
# AllClear test helper — loads bats-support and bats-assert
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$TEST_DIR/.." && pwd)"

load "$TEST_DIR/test_helper/bats-support/load"
load "$TEST_DIR/test_helper/bats-assert/load"
