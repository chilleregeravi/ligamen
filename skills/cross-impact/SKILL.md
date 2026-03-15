---
name: cross-impact
description: Scan sibling repos for references to changed symbols. Use when the user
  invokes /allclear impact, asks about cross-repo breaking changes, or wants to know
  what other repos reference a symbol before removing or renaming it.
disable-model-invocation: false
allowed-tools: Bash
argument-hint: "[symbol...] [--changed] [--exclude <repo>]"
---

# Cross-Repo Impact Scanner

Scans sibling repositories for references to specified symbols or auto-detected changed symbols. Classifies each match as code, config, docs, or test based on file path, and groups results by repo.

Discovered siblings: !`source ${CLAUDE_PLUGIN_ROOT}/lib/siblings.sh && list_siblings`

## Usage

- `/allclear impact <symbol>` — scan all sibling repos for `<symbol>`
- `/allclear impact --changed` — auto-detect changed symbols from `git diff HEAD~1` and scan
- `/allclear impact <symbol> --exclude <repo>` — skip a specific repo from the scan

## Steps

1. Parse arguments from the user's invocation: collect positional args as symbols, detect `--changed` flag, collect `--exclude` repo names.

2. Run the impact scanner:
   ```
   bash ${CLAUDE_PLUGIN_ROOT}/scripts/impact.sh [args]
   ```

3. Read the structured output. Each match line is tab-separated:
   ```
   {repo}  {term}  {type}  {filepath}
   ```

4. Summarize by repo: which repos have matches, what match types appear, how many unique files per repo.

5. Highlight `code`-type matches as highest risk — these are direct source code references that will break if the symbol is removed or renamed.

6. If no matches found anywhere, confirm the symbol appears safe to change or remove.

## Output Interpretation

Match types and their risk levels:

| Type   | Risk   | Meaning                                                             |
|--------|--------|---------------------------------------------------------------------|
| code   | HIGH   | Direct source reference — will break if symbol is removed/renamed  |
| config | MEDIUM | Configuration reference — may need updating                        |
| test   | LOW    | Test reference — tests will need updating, not a runtime break     |
| docs   | LOW    | Documentation reference — no runtime impact                        |

### Reporting format

- Group matches by repo, then by match type within each repo.
- Report unique file count per repo, not line count. One file containing 40 references is less significant than 40 different files containing one reference each.
- List file paths (not line numbers) so the user knows exactly where to look.
- Lead with a one-line summary: "X repos reference `<symbol>`, Y with code matches."
