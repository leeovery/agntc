AGENT: architecture
CYCLE: 3
STATUS: findings
FINDINGS_COUNT: 2

FINDINGS:

- FINDING: Symlink-escape violation on update is laundered into a "type no longer supported" abort message
  SEVERITY: medium
  FILES: src/nuke-reinstall-pipeline.ts:84-95, src/clone-reinstall.ts:213-223, src/commands/update.ts:223-230
  DESCRIPTION: In executeNukeAndReinstall, a SymlinkEscapeError (a copy-safety/security violation) is mapped to status:"aborted" carrying recordedType: existingEntry.type ?? "skill" and reason: err.message. That structured cause is fed to buildAbortMessage, which is hard-wired to phrase every abort as a derive-before-delete type mismatch: "<key> was installed as a skill, but its source no longer supports that type (symlink "x" points outside the clone). To migrate: npx agntc remove ... then npx agntc add ...". This conflates two structurally distinct abort causes — a recorded-type incompatibility (where remove+add is the correct remedy) and a malicious/escaping symlink in the remote (where remove+add just re-trips the same guard, so the "migrate" remedy is wrong). The add path keeps these separate — SymlinkEscapeError gets its own identity-prefixed cancel (add.ts:313-321) — so the two install paths diverge in how they report the same violation. (Note: this exact issue was flagged as a follow-up candidate when the update symlink guard was wired in task 5-4.)
  RECOMMENDATION: Give the symlink-escape case its own discriminated outcome (e.g. a status:"blocked"/copy-safety variant on CloneReinstallResult, or failed with a dedicated failureReason) rather than overloading aborted. The reporting layer emits a copy-safety message ("a symlink in the source escapes the clone — update blocked, install left intact") instead of the type-migration remedy. Keep the install-intact posture; only the classification and message split.

- FINDING: ManifestEntry.type derivation lives in two independent code paths that can drift
  SEVERITY: low
  FILES: src/manifest.ts:59-63, src/manifest.ts:111-129
  DESCRIPTION: Two functions answer "what is this unit's manifest type": manifestTypeFromDetected (maps a fresh DetectedType to skill|plugin on the add path) and deriveTypeFromFiles (legacy backfill from installed files). They derive the same recorded fact from different inputs (structure vs installed files), sharing the same target enum and the same "bare-skill collapses to skill; multi-skill/asset is plugin" intent, side by side with no shared anchor. A future change to what counts as "plugin" (e.g. a new asset kind) must be made in both. Spec-acceptable (single-skill ambiguity is documented collateral), but the two-site coupling is undocumented at the code level.
  RECOMMENDATION: Add a cross-reference comment linking the two, or extract the shared skill-vs-plugin discriminator (the "any agents/hooks target, or >1 skill dir => plugin" rule) so both backfill and any future file-based check call one predicate. Low priority — flagged only because the drift risk is real if asset kinds change.

SUMMARY: Module structure and seams are largely sound — toComputeInput/copyUnit cleanly shared across standalone and collection-member paths, mapCloneFailure dispatch + prepareReinstall/cloneAndReinstall unify four update entry points, boundary types use narrowed DetectedType extracts and discriminated outcome unions. The one issue worth fixing is the symlink-escape violation routed through the derive-before-delete aborted channel on update, yielding a misleading classification and an incorrect remedy.
