TASK: configless-install-analysis-2-6 — TypeConflictError message must attribute a --plugin-flag conflict to the flag and a config-type:plugin conflict to the config; non-zero pre-flight exit unchanged.

ACCEPTANCE CRITERIA: --plugin-flag conflict on bare skill/members-collection → message attributes to flag (not config "type plugin"); config type:plugin conflict → config-attributed message; non-zero pre-flight exit unchanged for both.

STATUS: Complete

SPEC CONTEXT: Error & Abort → Hard errors (452-454) — type-vs-structure conflicts + --plugin on non-bundleable are pre-flight failures, non-zero, message "names the offending source/unit and what conflicted." Single combined handler previously hard-coded "declares type plugin but…" for both origins, mis-attributing when only --plugin (no config type) triggered it — violation of the name-the-source contract. Fix targets message accuracy; behaviour already correct.

IMPLEMENTATION: Implemented. src/commands/add.ts:272-290 (handler), branch at 282-285. Trigger: detectType (type-detection.ts:79-103) raises TypeConflictError for bare-skill (87) + members (99) when wantsPlugin = forcePlugin===true || configType==="plugin" (79).
- Handler branches on options?.forcePlugin===true → flag-attributed ("the --plugin flag cannot bundle this source — {err.message}"), else config-attributed ("{manifestKey} declares type plugin but {err.message}").
- Precedence (flag wins when both set) correct — mirrors detectType's documented --plugin > config precedence. Structural half (err.message) preserved verbatim in both branches (keeps "what conflicted" accurate). throw new ExitSignal(1) (287) unchanged for both. Both detector throw-sites reachable by either origin → both branches correct for both structures.

TESTS: Adequate. tests/commands/add.test.ts: flag attribution bare skill (6189-6214) asserts code 1 + source key + "--plugin flag" + not.toContain("declares type plugin") + preserves structural half + no manifest/copy; flag attribution members collection (6216-6242) + pipeline never entered; config attribution (6244-6264) "declares type plugin but" + not.toContain("--plugin flag"); flag attribution on direct-path subpath (3878-3900); pre-flight ordering (6284-6293). Pre-existing config-type collection tests (2992,3040) remain green (compatible with config branch). Both attribution paths have positive AND negative substring assertions (prevents regression to old mis-attribution). Non-zero exit on every path. Not over-tested.

CODE QUALITY: Conventions followed (options?.forcePlugin===true strict-boolean, consistent w/ detectType guard). SOLID good (detectType sole authority for structural half; handler only layers source attribution — SRP). Complexity low (single added ternary). Modern idioms. Readability good (expanded comment 276-281 explains dual origin + why flag wins).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES:
- [idea] src/commands/add.ts:282-285 — flag-attributed message uses leading "{manifestKey}: " separator while config-attributed inlines the key as sentence subject ("{manifestKey} declares…"). Minor stylistic asymmetry; consider unifying source-name framing across hard-error paths. Pure presentation.
