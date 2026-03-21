#!/usr/bin/env bash
# lib/config.sh — Sourceable library: loads ligamen.config.json if present.
# Safe to source multiple times (guard variable prevents double-loading).
# Does NOT source any other library (leaf node in the source graph).
#
# Populates after sourcing:
#   LIGAMEN_CONFIG_LINKED_REPOS  — bash array of linked repo paths from config
#
# Environment variables honoured:
#   LIGAMEN_CONFIG_FILE  — override path to config file
#                           (default: ligamen.config.json in current directory)

# Guard against double-source
if [[ -n "${_LIGAMEN_CONFIG_LOADED:-}" ]]; then
  return 0
fi
_LIGAMEN_CONFIG_LOADED=1

# Resolve config file path (default: ligamen.config.json relative to cwd)
LIGAMEN_CONFIG_FILE="${LIGAMEN_CONFIG_FILE:-ligamen.config.json}"

# CONF-01: linked repo path overrides — initialize to empty array
LIGAMEN_CONFIG_LINKED_REPOS=()

if [[ -f "$LIGAMEN_CONFIG_FILE" ]]; then
  # Validate JSON first — warn on malformed config and skip parsing
  if ! jq '.' "$LIGAMEN_CONFIG_FILE" >/dev/null 2>&1; then
    echo "ligamen: warning: ligamen.config.json is malformed, using defaults" >&2
  else
    # Use while-read loop (NOT mapfile) for bash 3.2 compatibility (macOS default)
    while IFS= read -r _linked_repo_path; do
      [[ -n "$_linked_repo_path" ]] && LIGAMEN_CONFIG_LINKED_REPOS+=("$_linked_repo_path")
    done < <(jq -r '.["linked-repos"][]? // empty' "$LIGAMEN_CONFIG_FILE" 2>/dev/null)
  fi
fi

# Note: Do NOT export LIGAMEN_CONFIG_LINKED_REPOS — bash cannot export arrays
# across subshells. Consumers must source this file directly.
