# Commands

Ligamen adds slash commands to Claude Code. Type `/ligamen:<command>` in any Claude Code session where the plugin is installed.

## `/ligamen:map` — Build Your Service Dependency Map

Use this when you want to see how your services connect to each other. Ligamen scans your repositories with Claude agents, extracts services, endpoints, and connections, and builds an interactive graph you can explore in your browser.

```
/ligamen:map              # scan repos and build dependency graph
/ligamen:map full         # force full re-scan of all repos
/ligamen:map view         # open graph UI without scanning
```

After scanning, open `http://localhost:37888` to explore the graph. See [Service Map](service-map.md) for a full walkthrough.

## `/ligamen:cross-impact` — See What Your Changes Affect

Use this before making changes to a shared service or after modifying code to understand the blast radius. Ligamen traces dependencies through your service graph and flags downstream services that could be affected, ranked by severity (CRITICAL / WARN / INFO).

```
/ligamen:cross-impact                    # auto-detect changes from git diff
/ligamen:cross-impact UserService        # query impact for a specific symbol
/ligamen:cross-impact --exclude legacy   # exclude a repo
```

If you haven't built a dependency map yet, Ligamen falls back to grep-based symbol scanning — still useful, but less precise.

## `/ligamen:drift` — Catch Inconsistencies Across Repos

Use this to find places where your repos have drifted out of sync — mismatched dependency versions, diverged type definitions, or OpenAPI specs that don't agree with each other.

```
/ligamen:drift                # run all drift checks
/ligamen:drift versions       # dependency version alignment
/ligamen:drift types          # type/interface/struct consistency
/ligamen:drift openapi        # OpenAPI spec alignment
/ligamen:drift --all          # include INFO-level findings
```

## `/ligamen:quality-gate` — Run Quality Checks

Use this to run linting, formatting, type checking, and tests for your project. Ligamen auto-detects your project type and uses the right tools. If your project has a Makefile, it prefers those targets.

```
/ligamen:quality-gate              # run all checks
/ligamen:quality-gate lint         # lint only
/ligamen:quality-gate format       # format check (dry-run)
/ligamen:quality-gate test         # tests only
/ligamen:quality-gate typecheck    # type checking only
/ligamen:quality-gate quick        # lint + format (fast)
/ligamen:quality-gate fix          # auto-fix lint and format
```

## Graph UI

After running `/ligamen:map`, open the graph at `http://localhost:37888` to explore your service dependencies visually. See [Service Map](service-map.md) for full details on the graph UI including node colors, interactions, keyboard shortcuts, subgraph isolation, and export.
