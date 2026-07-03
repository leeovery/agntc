TASK: 1.2 — Replace isTagRef dispatch with remote-truth classification in checkForUpdate (internal ID update-check-fails-on-branch-ref-1-2)

ACCEPTANCE CRITERIA (spec AC 1–7 + task assertions):
1. ref="v4", remote has refs/heads/v4, no refs/tags/v4 → branch; up-to-date/update-available; never "Tag 'v4' not found".
2. ref="v4.9.0" tag+newer → tag; newer-tags/up-to-date.
3. ref="release-1.0" tag → tag path, never "Branch 'release-1.0' not found".
4. ref="main" → branch.
5. both branch+tag → tag (tiebreak).
6. neither → unified check-failed "Ref '…' not found on remote as a branch or tag"; terminal.
7. probe error → check-failed carrying underlying message.
Plus: isTagRef removed (no caller); per-type not-found strings gone; untouched paths (constrained→checkConstrained, ref===null→checkHead, ref&&commit both null→local) issue no probe; probe uses { timeout: 15_000 }; branch reuses probed head sha with NO second refs/heads lookup.

STATUS: Complete

SPEC CONTEXT: A branch whose name lexically resembles a semver tag (e.g. v4) was misrouted by the lexical isTagRef (/^v?\d/) to checkTag, which does an exact tag-existence lookup, yielding a permanent "Tag 'v4' not found on remote" across update/list. The fix determines ref type from remote truth (a single ls-remote refs/heads/{ref} refs/tags/{ref} probe) parsed by Task 1.1's parseRefProbe, routing tag-first (tiebreak), then branch (sha reuse), then a terminal unified check-failed. Dispatch steps 1–3 (local/constrained/HEAD) untouched; UpdateCheckResult union unchanged; no manifest/add-side change.

IMPLEMENTATION:
- Status: Implemented — matches the plan and spec precisely.
- Location: src/update-check.ts:96–150.
  - checkForUpdate (96–115): steps 1–3 intact (local 100–102; checkConstrained 106–108; checkHead 110–112); step 4–5 replaced by `return classifyAndCheck(url, entry.ref, entry.commit!)` (114).
  - classifyAndCheck (121–150): probe `execGit(["ls-remote", url, refs/heads/${ref}, refs/tags/${ref}], { timeout: 15_000 })` (128–131); try/catch → check-failed with (err as Error).message (132–134); parseRefProbe (136); tagSha!==null → checkTag (138–140, covers only-tags AND tiebreak); else headSha!==null → compareResolvedSha(headSha, installedCommit) reusing probed sha, no second lookup (142–144); else → terminal unified check-failed (146–149).
  - checkTag (177–192): only live paths retained (newer-tags / up-to-date / catch→check-failed); the "Tag … not found" guard removed; comment documents why it is unreachable. Still issues its own ls-remote --tags via fetchRemoteTagRefs (does not reuse probe tagSha).
  - compareResolvedSha (86–94): shared up-to-date/update-available rule used by the branch arm and checkHead (DRY; extracted in sibling task 2.1).
- Removals verified via grep across src/ and tests/: isTagRef — 0 occurrences; checkBranch — 0 occurrences; "Branch '…' not found" / "Tag '…' not found" production strings — 0 in src (only remaining hits are the unified reason at src/update-check.ts:148 and test titles/assertions).
- Out-of-scope untouched confirmed: isVersionTag gate at src/commands/list-detail.ts:133 unchanged; isTagRef was NOT swapped for isVersionTag; ManifestEntry has no refType.
- Notes: entry.commit! non-null assertion at :114 mirrors the pre-existing checkBranch(...entry.commit!) contract; commit is unused on the tag arm, so a hypothetical ref!=null && commit==null state is harmless (pre-existing edge, not introduced here).

TESTS:
- Status: Adequate — every AC covered; balanced (not over-tested).
- Coverage (tests/update-check.test.ts):
  - AC1: :164 update-available (tip != commit); :178 up-to-date (tip == commit); :189 regression guard asserts status !== "check-failed".
  - AC2: :235 newer-tags; :252 up-to-date at latest.
  - AC3: :266 release-1.0 → tag path (newer-tags), not a missing-branch.
  - AC4: :200 main → branch (update-available).
  - AC5: :333 both → newer-tags (tag path, explicitly NOT the branch-tip comparison); :353 asserts the --tags call is issued on the tiebreak.
  - AC6: :372 unified reason; :384 terminal (no installed-commit fallback).
  - AC7: :396 check-failed carrying underlying message.
  - Timeout: :408 asserts opts.timeout === 15_000.
  - Sha reuse: :214 asserts execFile called exactly once with the combined probe args (no second refs/heads lookup) for the branch case.
  - Probe-then-tags sequence: :283 asserts exactly 2 calls with exact probe then `["ls-remote","--tags",url]` args.
  - Untouched paths still present/passing: local (:52), HEAD tracking (:124), clone-URL derivation (:70), HEAD-path failure/timeout (:422), HEAD-path parsing (:455). Constrained/unconstrained bypass covered in tests/update-check-unconstrained-regression.test.ts — re-verified it still passes under the probe: the fixed-payload mocks coincide with the probe shape (tag payload → tagSha set → checkTag; refs/heads payload → headSha set → branch arm), and the branch-case arg assertions (contains refs/heads/develop, not --tags) still hold.
  - Old-heuristic tests retired: the "ref type detection" describe block is gone, replaced by the three "remote-truth ref classification" blocks; per-type not-found assertions replaced by the unified reason.
- git-mocks.ts: mockLsRemote routes per invocation on args.includes("--tags") (spec mock-harness note satisfied); buildRefProbeOutput added mirroring buildTagsOutput, emitting realistic refs/heads / refs/tags / peeled ^{} payloads.
- Notes: no over-testing of concern. The two tiebreak tests (:333 result-equality and :353 --tags-call-made) assert distinct things (result shape vs. that the tag path executed); acceptable one-assertion-per-test granularity, not redundant.

CODE QUALITY:
- Project conventions: Followed. Error handling ((err as Error).message), 15s timeout, ls-remote arg shape, and exported pure parser all consistent with sibling functions (checkHead/checkTag/checkConstrained, parseTagRefs).
- SOLID: Good. classifyAndCheck has a single responsibility (classify + route); compareResolvedSha isolates the compare rule shared with checkHead.
- Complexity: Low. Linear tag→branch→neither routing; tiebreak falls out of tag-first ordering for free.
- Modern idioms: Yes. Destructured probe result, typed union preserved, async/await.
- Readability: Good. Comments explain the tiebreak rationale (117–120) and why checkTag's not-found branch is omitted (173–176).
- Security/Performance: No concerns. Branch case = 1 round-trip (sha reused); tag case = probe + --tags = 2; matches the spec's network-cost target.
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- [do-now] tests/update-check-unconstrained-regression.test.ts:107–124 — the branch-case test asserts args contains "refs/heads/develop" and not "--tags"; under the new combined probe the args also include "refs/tags/develop". Optionally add `expect(args).toContain("refs/tags/develop")` so the regression test faithfully documents the combined-probe shape rather than reading as a single-ref lookup. Zero logic risk; assertion-only. (Outside task 1.2's rewrite scope — the task only required this file to keep passing, which it does.)
