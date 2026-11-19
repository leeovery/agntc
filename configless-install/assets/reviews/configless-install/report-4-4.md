TASK: configless-install-4-4 — Rework executeNukeAndReinstall to consume recorded type from existingEntry.type, replacing blind re-detection with recorded-type replay + derive-before-delete validation gate (recorded skill: root SKILL.md must exist before nuke; absent → abort install intact). Introduce NukeReinstallAborted/CloneReinstallAborted variant.

ACCEPTANCE CRITERIA: reads existingEntry.type==='skill' replays (no re-derive); SKILL.md present → copyBareSkill, added asset dirs ignored; SKILL.md vanished → aborted, nukeManifestFiles NOT called; validation BEFORE nuke; member subdir vanished aborts; configless recorded-skill proceeds (no null-config bail); abort carries recordedType + reason.

STATUS: Complete

SPEC CONTEXT: Manifest Keying & Lifecycle (replay recorded type; derive-before-delete; recorded-skill predicate = root SKILL.md exists → replay regardless of added asset dirs, gone → abort; member entries replay by own subdir); Error & Abort (install intact, recorded-vs-current message, aborted status, distinct from post-nuke copy-failed).

IMPLEMENTATION: Implemented. src/nuke-reinstall-pipeline.ts + src/clone-reinstall.ts.
- nuke-reinstall-pipeline.ts:127 recordedType = existingEntry.type ?? "skill" (authority; ?? defensive backfill-aligned fallback). :153-155 dispatch to replayRecordedSkill/replayRecordedPlugin.
- :174-201 replayRecordedSkill: pathExists(join(sourceDir,'SKILL.md')) gate at 180 BEFORE nukeManifestFiles at 190; absent → {status:'aborted',recordedType:'skill',reason} no nuke/copy; present → nuke + copyBareSkill (194) ignoring asset dirs.
- NukeReinstallAborted variant 58-62 (union 83). Plumbed clone-reinstall.ts: CloneReinstallAborted (222-226), isCloneReinstallFailure (143-148), mapCloneFailure/onAborted (155-156), buildAbortMessage (260-270), runPipeline re-emits (443-449); handleCopyFailedRemoval (377-392) leaves entry intact (only failed+copy-failed removes).
- Member subdir: getSourceDirFromKey resolves owner/repo/<unit> → subdir; SKILL.md check targets it. Configless: readConfig null handled by resolveAgents as no-restriction; no early bail; onAgentsDropped gated on config!==null.
- Uses existing pathExists helper (naming variance from plan's exists, behaviourally identical).

TESTS: Adequate. tests/nuke-reinstall-pipeline.test.ts: recorded-skill replay via copyBareSkill, copyPluginAssets NOT called (102-142); type preserved (144); SKILL.md-gone abort no nuke/copy (370-383); ordering spy validate-before-nuke abort callOrder=["validate"] + success ["validate","nuke","copy"] (385-425); member subdir vanished aborts asserts pathExists path (442-462); configless null-config proceeds via copyBareSkill no onAgentsDropped (464-496); abort reason contains "SKILL.md" (427-439). tests/clone-reinstall.test.ts: aborted plumbed w/ recordedType+reason (391-442); no nuke + no entry removal (444-489); temp cleanup (491-511); member subdir abort (513-537); configless proceeds (539-564); mapCloneFailure/isCloneReinstallFailure/buildAbortMessage dispatch (1064-1294). Behaviour-focused; ordering via real call-order spies.

CODE QUALITY: Conventions followed (result-union + status dispatch, single-source message builders, Partial test factory; existing pathExists). SOLID good (replayRecordedSkill/Plugin separated single-responsibility sharing ReplayContext; abort variant single-site addition). Complexity low. Modern idioms. Readability good (JSDoc documents ordering + recorded-type-authoritative).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES:
- [quickfix] tests/nuke-reinstall-pipeline.test.ts:144 — add one explicit test for existingEntry.type undefined → ?? "skill" fallback (entry without type reaching replayRecordedSkill), so the defensive backfill default has a direct assertion rather than only incidental coverage.
