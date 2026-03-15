---
name: quality-gate
description: This skill should be used when the user asks to "check code quality", "verify code before committing", "run linters and tests", "is my code clean", or when an agent needs to validate code quality as part of a workflow. Provides quality gate checks including lint, format, test, and typecheck.
version: 1.0.0
---

# Quality Gate

Run project quality checks (lint, format, test, typecheck) to verify code is clean.

This skill provides the same functionality as the `/allclear:quality-gate` command. When auto-invoked, run all checks by default unless the context suggests a specific subset.

For full execution instructions, invoke the `/allclear:quality-gate` command which contains the complete procedure for detecting project type, selecting tools, running checks, and reporting results.
