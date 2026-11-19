TASK: configless-install-3-4 — Preserve the pipeline's per-member structural re-detect and its two skip branches as the runtime one-level backstop: member re-detecting collection → skip with 'nested collections not supported — skipping'; not-agntc → skip with 'not a valid agntc plugin — skipping'. Siblings continue. Warning from PIPELINE not detector. One level only.

ACCEPTANCE CRITERIA: collection-member skipped w/ pipeline warning + skipped result; siblings install; not-agntc-member skipped w/ warning; warning from pipeline (onWarn) not detectType; no recursion into nested member; skipped reflected in summary.

STATUS: Complete

SPEC CONTEXT: Collection Membership (nested collections unsupported, one level down); Manifest Keying (nested skipped w/ warning, bounds recursion); Error & Abort (partial outcomes — member skip non-fatal, siblings continue, skipped in summary; only failed → non-zero exit).

IMPLEMENTATION: Implemented. src/commands/add.ts.
- :562 per-member detectType; :570-579 not-agntc branch (onWarn '<member>: not a valid agntc plugin — skipping' + push skipped + continue); :581-590 collection branch (onWarn '<member>: nested collections not supported — skipping' + push skipped + continue).
- :746-754 renderCollectionAddSummary receives skipped results; :761-763 non-zero exit only on failed not skipped.
- Sibling isolation: both branches continue the for loop, neither throws. One-level structural: loop calls detectType only, no runCollectionPipeline recursion. Warnings pipeline-sourced (literals at 571/582), independent of detector.
- findPresentAssetDirs forcePlugin gate (560-567) forces plugin only when asset dir at member's own root; genuine member-dirs child (zero asset dirs) stays collection → skipped at 581.

TESTS: Adequate. tests/commands/add.test.ts describe("nested-collection member backstop") 1474-1690: collection-member skip + sibling install + exact warning + selectCollectionPlugins once (1475); not-agntc skip (1512); warning from pipeline not detector (1542); recurses one level only — detectType never called on grandchild (1574); summary counts skipped (1600); all nested/not-agntc skipped nothing installs no error (1624); selector at collection-member same skip (1649). REAL-path test 3288 ("still skips a genuine nested members-collection child") exercises real detectType/findPresentAssetDirs — strongest coverage against the gate swallowing the skip. Behaviour-focused, not over-tested.

CODE QUALITY: Conventions followed (matches existing per-member skip pattern, shared onWarn, discriminated PluginInstallResult). SOLID good (single-purpose branches; summary owns presentation; exit-code distinguishes skipped/failed). Complexity acceptable (linear, early continue). Modern idioms. Readability good (membership/forcePlugin comment documents the invariant).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES: None.
