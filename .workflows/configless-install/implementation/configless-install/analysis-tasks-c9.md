---
topic: configless-install
cycle: 9
total_proposed: 1
---
# Analysis Tasks: Configless-install (Cycle 9)

## Task 1: Make skills-only collection members updatable — preserve the source subpath the update path needs to relocate `skills/<name>`
status: pending
severity: high
sources: architecture

**Problem**: Skills-only collection members (the flag-free Vercel-style `skills/`-only root added in cycle 8) are permanently unupdatable — a verified-real regression introduced by the cycle-8 skills-only enumeration fix. Mechanics, confirmed against source:
- On install, each inner skill is enumerated with the dir-relative SEGMENT `skills/<name>` (locates the on-disk dir) but keyed in the manifest by basename only: `owner/repo/<name>` (`memberKey`, `src/commands/add.ts:95-102`; `pluginManifestKey` at `src/commands/add.ts:640`). Integration test (d) asserts keys `owner/skills-only-repo/alpha` / `beta`, NOT `.../skills/alpha` (`tests/integration/workflows.test.ts:619-622`).
- `update` reconstructs the re-cloned source dir PURELY from the manifest key via `getSourceDirFromKey(tempDir, key)` (`src/source-parser.ts:443-450`), called at `src/clone-reinstall.ts:352` inside `cloneAndReinstall`. It slices everything after `owner/repo` and joins to the clone: for key `owner/repo/alpha` → `tempDir/alpha`, but the real unit lives at `tempDir/skills/alpha`.
- The recorded `type` for these members is `skill` (`src/manifest.ts:12-21`), so derive-before-delete (`replayRecordedSkill`, via `executeNukeAndReinstall`) checks `SKILL.md` at the WRONG path, finds nothing, and ABORTS every update. The member is permanently unupdatable; the only remedy is manual remove + add.
- Worse, a basename key `owner/repo/alpha` is now indistinguishable from a genuine root-child member whose dir really is `tempDir/alpha`, so `update` cannot recover the true location even in principle from the key alone.
The spec's lifecycle contract ("Member entries replay by path … re-copy its own subdir", spec line 221; identity = directory basename, spec lines 174/178) is silently broken because the stored key no longer encodes the subdir. This survived because the existing suite installs skills-only members (test (d)) and tests update-abort/blocked/no-agents paths, but NEVER drives a successful update of a skills-only member.

**Solution**: Make the update path able to relocate a skills-only member's true source dir (`skills/<name>`) while preserving its basename identity (basename key + basename install destination per spec). Orchestrator-preferred direction is option (a); option (b) is an acceptable equivalent if the implementer judges it cleaner — pick exactly one and state the choice.

- **Option (a) — PREFERRED**: Persist the member's dir-relative SOURCE segment on the manifest entry — add an OPTIONAL field (e.g. `sourceSubpath?: string`) to `ManifestEntry` (`src/manifest.ts:12-21`) — set to the member segment (e.g. `"skills/alpha"`) when it diverges from the basename key. Populate it where the member entry is built during install (collection per-member path in `src/commands/add.ts`, where `pluginManifestKey`/`memberSegment` are in scope). Then have the update source-resolver PREFER this stored segment when present, falling back to the key-derived path (`getSourceDirFromKey`) when absent. The cleanest seam is the `cloneAndReinstall` caller in `src/clone-reinstall.ts:352`: compute `sourceDir` as `entry.sourceSubpath ? join(tempDir, entry.sourceSubpath) : getSourceDirFromKey(tempDir, key)`. Keep the basename key and basename install destination unchanged.
- **Option (b) — ACCEPTABLE ALTERNATIVE**: Key skills-only members by their true segment (`owner/repo/skills/<name>`) so the key→source round-trip is lossless via the existing `getSourceDirFromKey`. If chosen, you MUST re-verify that the install DESTINATION stays the basename bare-skill location (`.claude/skills/<name>/`, `.agents/skills/<name>/`, etc.) — identity-by-basename per spec — and that `list` / `remove` UX for the longer key is acceptable.

**Outcome**: A skills-only collection member installed flag-free can be updated successfully end-to-end: `update` relocates the member's `skills/<name>` source dir in the re-clone, derive-before-delete finds `SKILL.md`, files are refreshed, and the manifest entry stays intact (basename identity preserved). Existing root-child members and all non-member entries continue to update via the unchanged key-derived fallback.

**Do**:
1. Choose option (a) or (b) and record the decision (and rationale if (b)) in the task/code comments.
2. **If option (a)**:
   a. Add `sourceSubpath?: string` to `ManifestEntry` in `src/manifest.ts:12-21`. Keep it OPTIONAL so existing manifests and entries without it remain valid (preserve the byte-identical entry shape when absent — mirror how `constraint`/`type` are handled in `buildManifestEntry` / `ManifestEntryInput`).
   b. In the collection per-member install path in `src/commands/add.ts`, set `sourceSubpath` to the member's dir-relative segment (`memberSegment`) ONLY when it diverges from the basename key segment (i.e. when `memberSegment !== basename(memberSegment)`, e.g. `skills/alpha`). For root-child members where segment === basename, omit it (no-op, key-derived path already correct).
   c. In `src/clone-reinstall.ts` at the `getSourceDirFromKey(tempDir, key)` call site (line 352), prefer the stored segment when present: `const sourceDir = entry.sourceSubpath ? join(tempDir, entry.sourceSubpath) : getSourceDirFromKey(tempDir, key);`. Ensure `entry` is the manifest entry already in scope for `cloneAndReinstall`. Do NOT change the local-install `sourceDir: key` branch.
   d. Backward-compatibility: confirm entries WITHOUT `sourceSubpath` (existing/root-child) still resolve via `getSourceDirFromKey` exactly as today. Explicitly consider and NOTE the legacy case — skills-only members installed BEFORE this fix (basename key, no `sourceSubpath`) will still be unupdatable until reinstalled; decide whether to handle it (e.g. heuristic: a `skill`-typed member whose key-derived dir lacks `SKILL.md` but `skills/<basename>/SKILL.md` exists in the clone could fall back to that path) or to document it as a known limitation requiring remove+add. State the decision; do not silently leave it unaddressed.
3. **If option (b)**: Change `memberKey` (`src/commands/add.ts:95-102`) to emit the true segment for divergent (skills-only) members so the key is `owner/repo/skills/<name>`. Verify the install destination stays basename (bare-skill location), update integration test (d)'s key assertions accordingly, and check `list`/`remove`/`update` flows for the longer key.
4. Do NOT add new features, change `--plugin` / `type: plugin` bundle behaviour for the skills-only root, alter the root-child member-dirs collection path, or touch unrelated detection branches.

**Acceptance Criteria**:
- A skills-only collection member installed flag-free can be updated end-to-end: `update` (driving `cloneAndReinstall` / `executeNukeAndReinstall`) resolves the member's source to the clone's `skills/<name>` dir, derive-before-delete locates `SKILL.md`, the update succeeds, files are refreshed at the bare-skill destination, and the manifest entry remains intact.
- Member identity/install destination is unchanged from spec: basename bare-skill location (`.claude/skills/<name>/`, `.agents/skills/<name>/`, etc.). If option (a), the manifest key stays the basename (`owner/repo/<name>`); if option (b), the destination is still basename even though the key is the longer segment.
- Existing root-child collection members and all standalone (bare-skill / plugin) entries update exactly as before — no behaviour change for entries that round-trip correctly via the key today.
- Existing manifests remain readable and valid (optional field, backward-compatible).
- The legacy pre-fix skills-only-member case is explicitly handled OR documented as a known remove+add limitation (no silent broken state introduced or ignored).
- `--plugin` / `type: plugin` bundling of the skills-only root is unchanged.

**Tests**:
- NEW integration test (the gap that let this regression survive): INSTALL a flag-free skills-only collection member (a populated `skills/`-only repo, e.g. `skills/alpha/SKILL.md` + `skills/alpha/references/g.md`, `skills/beta/SKILL.md`), THEN UPDATE that member, driving `executeNukeAndReinstall` / `cloneAndReinstall` end-to-end. Assert the update SUCCEEDS: source is relocated to the clone's `skills/<name>` dir, derive-before-delete passes, files are refreshed at the bare-skill destination for each agent, and the manifest entry is intact (basename identity preserved; if option (a), key unchanged and `sourceSubpath` persisted; if option (b), the longer key round-trips). Model this alongside the existing install test (d) at `tests/integration/workflows.test.ts:544-629` which never updates a skills-only member.
- Regression test: a genuine root-child collection member `owner/repo/alpha` (whose real dir IS `tempDir/alpha`) still updates correctly via the key-derived fallback (option (a)) — i.e. the new branch does not divert it.
- `list` update-check / change-version paths for skills-only members are covered or at least asserted not-regressed (the same source-resolution flows back these actions).
- If option (a): a unit/integration assertion that `ManifestEntry.sourceSubpath` is absent for root-child and standalone entries and present (`skills/<name>`) for divergent skills-only members; existing manifests without the field still load.
- Existing skills-only install test (d) and the `--plugin` / `type:plugin` bundle test (e) still pass unchanged.

## Discarded findings (noted, not proposed)

- architecture MEDIUM "forcePlugin overloads installer-intent flag" — KNOWN RECURRENCE (flagged medium c8, discarded "no restructuring required for correctness"); behaviour-neutral, seam works today.
- architecture LOW "no-agents skip routed through failureMessage in list actions" — below action bar; benign consistency nit, no behaviour defect (install stays intact, no non-zero exit).
- duplication MEDIUM "prepareReinstall reason re-authored at 3 sites" — KNOWN RECURRENCE (flagged low c7/c8); behaviour-neutral message cosmetics.
- duplication MEDIUM "PluginInstallResult skipped/failed literal repeated 6x in add.ts" — KNOWN RECURRENCE (flagged c6); pure refactor, behaviour-neutral.
- duplication LOW "isLocal predicate recomputed" and "shortSha formatting duplicated" — below threshold; opportunistic-only.
- standards — clean, no findings.
