TASK: 1.5 — Wire runAllUpdates group-first (replace per-member check/categorize loops)

ACCEPTANCE CRITERIA:
1. A 3-member collection at one (cloneUrl, versionIntent) triggers exactly one cloneSource call and one resolveGroupTarget call for the whole group.
2. A local entry (commit===null) reinstalls as a group-of-one with no cloneSource call, interleaved in manifest order.
3. runSingleUpdate (single-key), executeUpdateAction (list update), and executeChangeVersionAction (list change-version) still call cloneAndReinstall per entry — unchanged.
4. The grouped path emits no "Cloning repository..." / "Cloned successfully" spinner (that spinner lives only in cloneAndReinstall, used by singletons and locals).
5. Existing single-key and reinstall-half regression tests stay green.

STATUS: Complete

SPEC CONTEXT:
Spec "Grouping covers the whole manifest, before checking" — group-first replaces the per-member check + category loops with group -> check once -> categorize members. All-mode is the only site with a collection to dedup; the three singletons (single-key update, list update, list change-version) stay on cloneAndReinstall by design ("Rejected: unify all four entry points"). Task 1-5 was scoped to ship "functional-but-interim output," with the two-granularity progress stream + trailing collapse deferred to Phase 2. Local entries (commit===null) are excluded from grouping, never clone, and stream inline in manifest (processing) order. The never-downgrade guard isAtOrAboveVersion (update.ts:488) is preserved.

NOTE ON FINAL-STATE REVIEW: This review sees the fully-integrated codebase (all phases merged). Task 1-5's "interim output" has been legitimately superseded by the Phase 2 streaming layer (streamGroupWork spinners, formatGroupHeader, emitCollapsedGroupSummary). That is planned later-phase work layered on top of the 1-5 wiring, NOT drift or scope creep — the 1-5 "do not build Phase 2 here" constraint is moot at final state. The core 1-5 wiring (group-first pipeline, singletons untouched, no per-clone spinner on grouped path, local group-of-one) is intact and independently verifiable.

IMPLEMENTATION:
- Status: Implemented
- Location: src/commands/update.ts:378-445 (runAllUpdates), :452-508 (categorizeGroups), :546-575 (splitMember, never-downgrade guard), :586-607 (orderWork interleave), :622-639 (streamActionedWork), :313-331 (processLocalUpdate). src/update-groups.ts:57-82 (groupEntriesForUpdate), :384-420 (processGroupUpdate → cloneRepoOnce). src/clone-reinstall.ts:315-326 (spinner-free cloneRepoOnce), :328-347 (cloneAndReinstall local branch — no clone when sourceDir set).
- Notes:
  - Criterion 1: runAllUpdates calls groupEntriesForUpdate(manifest), then Promise.all(groups.map(resolveGroupTarget)) — one resolveGroupTarget per group; processGroupUpdate clones once via cloneRepoOnce. A 3-member collection sharing (url, constraint) forms one group → one resolve, one clone. Verified.
  - Criterion 2: localEntries = entries.filter(commit===null) are excluded from grouping and routed through streamLocalWork → processLocalUpdate → cloneAndReinstall with sourceDir set, which takes the local branch (clone-reinstall.ts:334) — no cloneSource. orderWork interleaves groups and locals by manifest index (position map + sort), so a local streams at its own manifest position. Verified.
  - Criterion 3: runSinglePluginUpdate still uses cloneAndReinstall (update.ts:235); runAllUpdates is the only rewired path. list-update-action.ts:49 and list-change-version-action.ts:95 still call cloneAndReinstall — untouched. Verified.
  - Criterion 4: processGroupUpdate uses cloneRepoOnce, which is spinner-free (clone-reinstall.ts:310-326 doc: "Deliberately spinner-free"). The "Cloning repository..." / "Cloned successfully" spinner exists only in cloneAndReinstall's remote branch (clone-reinstall.ts:353-371), reached only by singletons and (non-clone) locals. Grouped path uses its own "Updating <label>" spinner. Verified.
  - Never-downgrade guard: splitMember re-applies isAtOrAboveVersion(entry.ref, result.tag) on the constrained-update-available arm, demoting an at/above member to up-to-date so it never clones — preserving update.ts:488 behaviour. Verified.

TESTS:
- Status: Adequate
- Coverage:
  - tests/commands/update.test.ts:803-837 — "a 3-member collection clones once and runs one group check": asserts cloneSource called once AND resolveGroupTarget called once (criterion 1).
  - :839-866 — "a local entry reinstalls as a group-of-one without cloning": asserts resolveGroupTarget NOT called, cloneSource NOT called, copyBareSkill called with sourceDir=LOCAL_KEY, writeManifest called (criterion 2).
  - :868-911 — "the grouped path does not emit the per-clone Cloning repository... spinner": asserts no "Cloning repository" spinner start, "Checking for updates" present (criterion 4).
  - :913-953 — "single-key still routes through cloneAndReinstall": asserts "Cloning repository" spinner present, resolveGroupTarget NOT called, checkForUpdate called for single-key (criterion 3, single-key arm).
  - list update / list change-version arms of criterion 3 are covered by their dedicated files (tests/commands/list-update-action.test.ts, list-change-version-action.test.ts) which assert cloneAndReinstall usage — the task's suggested combined test was split across files, coverage intact.
  - Migrated all-mode regression cases onto the resolveGroupTarget seam via a documented groupTargetFromCheckResult bridge (default resolveGroupTarget mock derives the group target from the still-mocked checkForUpdate, keeping REAL categorizeMember + processGroupUpdate): "processes update-available plugins via git update" (:365), "handles mixed types in a single run" (:571), "continues processing when one plugin fails during update" (:523). The old single-end-write case was correctly retired (note :517-521) and superseded by task 1-6's per-group-write test.
  - Manifest-order interleaving verified by :1317 ("streams updatable groups and local entries in manifest order": git A, local, git B ordering asserted via invocation call order).
  - Never-downgrade guard on the group path verified by :6115 ("never downgrades constrained plugins in batch mode": no clone; demoted to the collapsed up-to-date count).
- Notes: The migration bridge is a sound seam-preservation technique — categorizeMember and processGroupUpdate remain real, so the migrated cases exercise production categorization logic, not a stubbed verdict. Tests are focused, no redundant assertions, no over-mocking beyond the necessary boundary seams. Would fail if the wiring broke (e.g. if a collection re-cloned per member, criterion-1's toHaveBeenCalledTimes(1) would trip).

CODE QUALITY:
- Project conventions: Followed. Discriminated unions (WorkItem, PluginOutcome, GroupTarget), lenient/loud posture, identity=basename, and the single-responsibility factoring match the codebase's established TypeScript idioms.
- SOLID principles: Good. runAllUpdates delegates to focused helpers (groupEntriesForUpdate, categorizeGroups, splitMember, orderWork, streamActionedWork, processGroupUpdate, processLocalUpdate), each single-purpose. The clone/reinstall seam (cloneRepoOnce vs cloneAndReinstall) cleanly separates the deduped group path from the battle-tested singleton path without rewriting the latter.
- DRY: Good. mapReinstallResultToOutcome, failedOutcome, groupTargetFacets, and resolveGuardedSourceDir are shared across the local path, group orchestrator, and singleton path, so outcome/wording/containment logic lives in one place and cannot drift.
- Complexity: Low/Acceptable. orderWork's position-map + stable sort is a clean, deterministic interleave. splitMember is a flat switch. categorizeGroups is a single pass.
- Modern idioms: Yes — Map-based grouping, Promise.all for parallel per-group resolution, exhaustive discriminated-union switches.
- Readability: Good. Extensive, accurate JSDoc explains the non-obvious "why" (per-group persistence honesty, divergent-old header/member XOR, collapsed group-of-one stop-frame, never-downgrade demotion). Intent is clear throughout.
- Issues: None material to task 1-5.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- None.
