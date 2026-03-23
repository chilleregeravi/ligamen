---
phase: 90-discovery-improvements
plan: 01
subsystem: api
tags: [discovery, mono-repo, client-files, agent-prompt, scan]

# Dependency graph
requires: []
provides:
  - "Mono-repo detection heuristic in discovery agent prompt (subdirectory manifest scan)"
  - "client_files schema field in discovery output JSON for outbound HTTP call pre-identification"
affects: [phase-91, phase-2-deep-scan, agent-prompt-discovery]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Discovery prompt instructs agent to scan */package.json and peer manifests one level deep"
    - "Two or more subdirectory manifests triggers mono-repo classification with per-subdirectory service_hints"
    - "client_files array pre-identifies outbound HTTP call sites for Phase 2 deep scan efficiency"

key-files:
  created: []
  modified:
    - plugins/ligamen/worker/scan/agent-prompt-discovery.md

key-decisions:
  - "Subdirectory manifest scan limited to one level deep to keep discovery fast"
  - "client_files import scanning limited to files already opened for entry-point detection (no extra reads)"
  - "client_files placed between event_config_files and has_dockerfile in schema for logical grouping"

patterns-established:
  - "Discovery prompt item 8 pattern: filename match + import scan scoped to already-opened files"
  - "Mono-repo heuristic: 2+ subdirectory manifests => list each as separate service_hints with root_path"

requirements-completed: [DISC-01, DISC-02]

# Metrics
duration: 10min
completed: 2026-03-23
---

# Phase 90 Plan 01: Discovery Improvements Summary

**Mono-repo heuristic (subdirectory manifest detection) and client_files schema field added to discovery agent prompt for THE-951**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-23T11:28:00Z
- **Completed:** 2026-03-23T11:38:14Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Added subdirectory manifest scan instruction (`*/package.json`, `*/pyproject.toml`, `*/Cargo.toml`, `*/go.mod`) to discovery prompt
- Added mono-repo detection rule: 2+ subdirectory manifests triggers separate `service_hints` entries per subdirectory with correct `root_path`
- Added item 8 "Client/HTTP files" to "What to Check" with filename pattern and scoped import scanning rules
- Added `client_files` array to output JSON schema between `event_config_files` and `has_dockerfile`

## Task Commits

Each task was committed atomically:

1. **Task 1: Add mono-repo detection heuristic (DISC-01)** - `fc9d7c1` (feat)
2. **Task 2: Add client_files field to output schema (DISC-02)** - `59ea98a` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified
- `plugins/ligamen/worker/scan/agent-prompt-discovery.md` — Added subdirectory manifest scan, client_files instruction (item 8), updated mono-repo rule, and inserted client_files field in JSON schema

## Decisions Made
- Subdirectory manifest scan is limited to one level deep to preserve discovery speed (matches plan intent)
- Import scanning for client_files is scoped to files already opened for entry-point detection — avoids extra file reads
- client_files positioned between event_config_files and has_dockerfile in the schema per plan specification

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Discovery agent prompt now contains mono-repo heuristic (DISC-01) and client_files field (DISC-02)
- Phase 2 deep scan can consume `client_files` array to locate outbound HTTP call sites without re-scanning the full repo
- Both DISC-01 and DISC-02 requirements fulfilled; Phase 90 plan 01 is complete

---
*Phase: 90-discovery-improvements*
*Completed: 2026-03-23*
