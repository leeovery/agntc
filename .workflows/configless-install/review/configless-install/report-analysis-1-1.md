TASK: configless-install-analysis-1-1 — Consolidate the clone-and-reinstall flow across the four update entry points (lift isLocal detection + local-path validation + options assembly into prepareReinstall; route both list actions' aborted branch through mapCloneFailure + buildAbortMessage).

ACCEPTANCE CRITERIA: all four obtain input via prepareReinstall; both list actions render aborts via buildAbortMessage (incl recordedType + remedy); observable behaviour unchanged.

STATUS: Complete

SPEC CONTEXT: Duplication-removal refactor over Phase 4 lifecycle + Phase 5 copy-safety. Spec 458/466 — abort leaves install intact, message names recorded-vs-current + remove/add remedy, entry reported aborted, non-zero exit. List actions previously hand-rolled abort strings discarding recordedType + remedy; refactor routes them through canonical buildAbortMessage (behavioural correction to spec compliance).

IMPLEMENTATION: Implemented (all four routed; behaviour-correcting for the previously-noncompliant list actions).
- src/clone-reinstall.ts:32-77 prepareReinstall (+ PrepareReinstallOpts/Result): isLocal via entry.commit===null, validates local path, assembles CloneAndReinstallOptions w/ conditional manifest/sourceDir:key/newRef/newCommit spreads.
- update.ts:202-209 (single) + :296-305 (all-updates) call prepareReinstall.
- list-update-action.ts:38-47 + :51-52 route failure through failureMessage → mapCloneFailure → buildAbortMessage for aborted. list-change-version-action.ts:89-98 + :102-103 same.
- Grep confirms validateLocalSourcePath + sourceDir:key spread now only in clone-reinstall.ts. Conditional-spread assembly honours exactOptionalPropertyTypes. update.ts keeps richer per-status handler; list actions collapse to failureMessage. List abort output now spec-compliant (recordedType + remedy).

TESTS: Adequate. tests/prepare-reinstall.test.ts: remote omits sourceDir skips validation (20-36); remote carries manifest/newRef/newCommit (38-54); local validates + sets sourceDir:key (58-68); invalid local → {ok:false,reason} (70-83). list-update-action.test.ts:584-618 + list-change-version-action.test.ts:564-602 assert canonical abort message ("installed as a skill", "unchanged", "npx agntc remove/add owner/repo") + install-intact. Regression for all four flows (remote/local success, clone-failure, agents-dropped, copy-failed, blocked, constrained). update.test.ts covers both update.ts blocks incl aborted (1265,1320,1612). Not over-tested.

CODE QUALITY: Conventions followed (discriminated-union result, conditional spreads honouring exactOptionalPropertyTypes, JSDoc). SOLID good (prepareReinstall SRP input-prep separated from cloneAndReinstall execution; callers own presentation channel via reason). Complexity low (flat detect→validate→assemble, one early return). Modern idioms. Readability good.

BLOCKING ISSUES: None.

NON-BLOCKING NOTES:
- [quickfix] src/commands/update.ts:200 & :294 — const isLocal = entry.commit === null recomputed in both blocks after prepareReinstall already computed it internally. Legitimately needed for downstream summary/cancel branching (not the targeted duplication), but consider exposing computed isLocal on PrepareReinstallResult so callers read rather than re-derive.
- [do-now] tests/commands/list-update-action.test.ts:136 & list-change-version-action.test.ts:136 — INSTALLED_SHA declared but unused (only REMOTE_SHA referenced); remove dead constant.
- [do-now] tests/commands/list-update-action.test.ts:118/:124 + change-version suite — several vi.mocked handles (mockCopyPluginAssets/mockRemoveEntry) assigned but never read; prune.
