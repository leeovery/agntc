TASK: configless-install-4-7 — Wire runAllUpdates so update operates per manifest entry: plugin one-entry atomic; collection members independent; each aborted entry reported loudly with own reason; command exits non-zero if ANY unit aborted/hard-errored (partial success); no collection-level coherence rollback.

ACCEPTANCE CRITERIA: one member abort doesn't stop siblings (siblings written); plugin abort whole-entry atomic; each aborted reported loudly with recorded-vs-current reason + remedy; non-zero exit when any aborted/failed/copy-failed after writing successes + full summary; summary lists per-unit outcomes; no rollback; aborted entry not added/removed (intact); abort not swallowed by allUpToDate.

STATUS: Complete

SPEC CONTEXT: Error & Abort (Partial outcomes — per-entry; member abort doesn't stop siblings, each reported loudly; non-zero exit if any aborted even on partial success; summary per-unit); Manifest Keying & Lifecycle (per-member abort granularity, no collection coherence; derive-before-delete abort leaves install intact, distinct from copy-failed).

IMPLEMENTATION: Implemented. src/commands/update.ts.
- runAllUpdates loop 471-502 per-entry via processUpdateForAll, outcomes collected not thrown.
- processUpdateForAll 287-389 returns aborted PluginOutcome (325-333) not throwing; try/catch wraps unexpected throws → failed (382-388). No early loop escape.
- Manifest-build loop 508-523: only updated/refreshed addEntry; only copy-failed removeEntry; aborted/blocked/skipped-no-agents fall through untouched.
- Per-plugin summary 586-607: aborted/copy-failed/blocked → p.log.error(outcome.summary); summary = buildAbortMessage(key,recordedType,reason) w/ remedy (from 4-6).
- Exit 616-618 + hasFailedOutcome 621-629: after writeManifest (526-528) + summary + out-of-constraint, throws ExitSignal(1) if any aborted/blocked/failed/copy-failed.
- allUpToDate 571-583 computed from check categories; aborted entry from updatable category so already false — can't swallow.
- Single-key path 226-233 throws ExitSignal(1) immediately (unchanged from 4-6).

TESTS: Adequate. tests/commands/update.test.ts describe("all-updates partial-success exit") 1500-1860 + abort 1265-1354 + symlink all-updates 1420-1497: member abort doesn't stop siblings, repo-b written (1555); partial abort non-zero (1572); write-before-throw callOrder ["write","throw"] (1581); no rollback removeEntry never for repo-b (1598); aborted entry deep-equals original (1612); loud per-unit own reason + remedy (1625); summary lists both (1638); two distinct reasons (1651); exits once on multiple aborts (1692); abort not swallowed by allUpToDate, no "up to date" outro (1725); plugin atomic no nuke/removeEntry/write (1766); no-agents benign skip exits 0 (1800 — boundary test). Behaviour-focused, not over-tested.

CODE QUALITY: Conventions followed (discriminated PluginOutcome exhaustive switch; mapCloneFailure<PluginOutcome> reuse). SOLID good (decide/apply/render/exit-decision stages separated single-responsibility). Complexity acceptable (long but linear, commented). Modern idioms. Readability good (rationale comments at 611-615, 325-343).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES:
- [quickfix] src/commands/update.ts:586-607 — per-plugin summary status routing duplicates the exit-decision set in hasFailedOutcome (621-629); consider a single status→{logLevel,countsAsFailure} map so a future variant can't drift between "rendered as error" and "counts toward non-zero exit".
- [idea] src/commands/update.ts:531-568 — non-actionable category summaries pushed into outcomes AFTER the manifest-build loop; correct today (none are add/remove-relevant) but a latent footgun if a future status needs manifest action. Consider building full outcomes up front, then manifest-build/summary as pure consumers.
