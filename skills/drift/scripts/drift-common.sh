#!/usr/bin/env bash
# drift-common.sh — Shared helpers for all drift subcommand scripts.
# Source this file; do not execute directly.

[[ "${BASH_SOURCE[0]}" != "${0}" ]] || { echo "Source this file; do not execute directly." >&2; exit 1; }

# PLUGIN_ROOT: resolve from script location or from environment
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# SHOW_INFO: default false; set true when --all is in args (set by parse_drift_args)
SHOW_INFO=false

# emit_finding LEVEL ITEM REPOS DETAILS
# LEVEL = CRITICAL | WARN | INFO
# INFO findings are suppressed unless SHOW_INFO=true
emit_finding() {
  local level="$1"
  local item="$2"
  local repos="$3"
  local details="$4"

  case "$level" in
    CRITICAL)
      printf "[CRITICAL] %s\n           %s\n           Repos: %s\n" "$item" "$details" "$repos"
      ;;
    WARN)
      printf "[ WARN  ] %s\n           %s\n           Repos: %s\n" "$item" "$details" "$repos"
      ;;
    INFO)
      if $SHOW_INFO; then
        printf "[ INFO  ] %s\n           %s\n           Repos: %s\n" "$item" "$details" "$repos"
      fi
      ;;
  esac
}

# parse_drift_args "$@"
# Sets SHOW_INFO=true if --all is present in args
parse_drift_args() {
  for arg in "$@"; do
    if [[ "$arg" == "--all" ]]; then
      SHOW_INFO=true
    fi
  done
}

# Source siblings library and discover sibling repos
source "${PLUGIN_ROOT}/lib/siblings.sh"

# SIBLINGS: space-separated list of sibling repo paths
SIBLINGS=$(list_siblings "${PLUGIN_ROOT}" 2>/dev/null | tr '\n' ' ' | sed 's/ $//')

if [[ -z "${SIBLINGS:-}" ]]; then
  echo "No sibling repos found. Run from a directory with sibling git repos." >&2
  exit 0
fi

export PLUGIN_ROOT SHOW_INFO SIBLINGS
