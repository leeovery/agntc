TASK: 2.5 — Collapse the trailing summary to one line per group per non-actioned category (update-output-overhaul-2-5)

ACCEPTANCE CRITERIA:
1. A group with 7 up-to-date members collapses to one `owner/repo: 7 up to date` line (not 7), keyed by the group.
2. An exact-pinned collection with newer tags collapses to one newer-tags line per group, including `npx agntc add <label>@<newest>` (repo-level command).
3. A check-failed group collapses to one `owner/repo: check failed — <reason>` line (shared probe reason, count-collapse); all-mode exit stays 0.
4. A constrained-no-match group collapses to one `owner/repo: no tags satisfy <constraint> — left untouched` line (shared constraint).
5. Two distinct-intent groups of one repo each render their own `@intent`-disambiguated trailing line.
6. In a split group, up-to-date members appear only as the collapsed count (behind members stream, not counted here).

STATUS: Complete

SPEC CONTEXT:
Per-Unit Progress Output / Partial collections & counts: trailing lines collapse to one line per group, keyed by the grouping key `(resolvedCloneUrl, versionIntent)` — not the bare repo — across all trailing categories (up-to-date, newer-tags, check-failed, constrained-no-match). check-failed / constrained-no-match are group-level (one shared probe / constraint) so they count-collapse rather than enumerate. Collapsed formats: `owner/repo: 7 up to date`; newer-tags = pinned-ref notice + repo-level `add` command; `owner/repo: check failed — <reason>`; `owner/repo: no tags satisfy <constraint> — left untouched`. Safe-vs-Major / 0.x-line + exact-pin: the all-mode newer-tags line historically omitted the `agntc add` command the single-key path includes (acceptance 9) — align it, at repo granularity. Genuine-state split: behind members update inline; already-current members are up-to-date in the trailing summary.

IMPLEMENTATION:
- Status: Implemented
- Location:
  - src/update-render.ts:52-103 — pure formatters `formatUpToDateLine`, `formatNewerTagsLine`, `formatCheckFailedLine`, `formatConstrainedNoMatchLine`.
  - src/commands/update.ts:972-1001 — `emitCollapsedGroupSummary` dispatches one collapsed line per group by `target.kind` (check-failed / constrained-no-match / tag-with-newer / up-to-date fallback).
  - src/commands/update.ts:359-363, 494-499 — `NonActionedGroup` model; a group is collected once with its shared target + non-actioned member outcomes.
  - src/commands/update.ts:430-433 — trailing loop iterates `nonActionedGroups` in manifest order, emitting one collapsed line each; outcomes still folded into `outcomes[]` for exit accounting.
  - src/commands/update.ts:415-421 — "All plugins are up to date." short-circuit preserved.
- Notes:
  - Dispatch on `target.kind` is sound: group-first guarantees a group's non-actioned members are category-uniform (the only intra-group split is updating-vs-up-to-date, and updating members are routed to `updating[]` before this point), so a single `target.kind` switch correctly picks the one collapsed line. Verified against `categorizeMember` (update-check.ts:173-204) for every arm.
  - `formatNewerTagsLine` intentionally diverges from the plan's authored 3-arg signature by adding a separate `commandTarget` param (fed `repoOf(group)` at update.ts:990) so the emitted command is bare `owner/repo@<newest>` even when the display prefix is `@intent`-disambiguated. This is a correctness fix over the literal task text (which reused `label` for both, producing a double-`@` command like `owner/repo@v2.0.0@v3.0` for a multi-group repo) and matches the spec's repo-level command mandate. Mirrors the out-of-constraint footer's bare `repo` field. Tested (update-render.test.ts:408).
  - `newestTag(target.newerTags)` (last of the ascending list) matches the task's reverse-newest expectation; robust and consistent with the single-key path.
  - `group.versionIntent!` non-null assertions in the newer-tags and constrained-no-match branches are provably safe: a `tag` target only arises from a non-null ref, and `constrained-no-match` only from a constrained entry.
  - Exit accounting untouched: none of the non-actioned statuses feed `hasFailedOutcome` (update.ts:1015-1023); the check-failed test asserts exit 0.

TESTS:
- Status: Adequate
- Coverage:
  - Pure formatters — tests/update-render.test.ts:379-431 cover all four (`formatUpToDateLine` incl. count=1 and `@intent` label; `formatNewerTagsLine` incl. the bare-repo-command-vs-@intent-label separation; `formatCheckFailedLine`; `formatConstrainedNoMatchLine`).
  - Integration — tests/commands/update.test.ts:1945-2170 ("trailing non-actioned collapse (task 2-5)") covers every acceptance criterion:
    * AC1 up-to-date count-collapse (7→1), with a `.toHaveLength(1)` guard that the feature can't regress to per-member enumeration (2167).
    * AC2 newer-tags one line per group + repo-level command, `mockCloneSource not called` (2000); plus a downstream regression-lock (2027) asserting no member-scoped `owner/repo/<member>@` command leaks.
    * AC3 check-failed collapse + explicit exit-0 assertion (`err` undefined).
    * AC4 constrained-no-match collapse with shared constraint.
    * AC5 two distinct-intent groups of one repo → separate `@intent` lines (warn + message).
    * AC6 split-group: behind member streams `Updated`, up-to-date siblings collapse to `owner/repo: 2 up to date` and never surface as per-member lines.
  - Each collapse test asserts BOTH the exact line AND a `.filter(...).toHaveLength(1)` (or no-clone / no-leak) negative — so a regression to enumeration or a wrong command would fail. Tests verify behaviour (emitted log lines), not implementation details.
- Notes:
  - Mild overlap between the two newer-tags integration tests (2000 and 2027), but 2027 is a deliberate cross-phase (task 4-2) regression lock adding a unique "no member-scoped command leak" assertion — justified, not redundant.

CODE QUALITY:
- Project conventions: Followed. Pure formatters isolated in the Phase-2 rendering module (update-render.ts); dispatch/plumbing in update.ts. `@link`-rich TSDoc consistent with the codebase (TypeScript resolves project-symbol links by name, so cross-module links are valid).
- SOLID principles: Good. Single-responsibility formatters (each returns one string); `emitCollapsedGroupSummary` owns only display dispatch; the shared `groupLabel` / `repoOf` / `newestTag` are reused rather than re-derived.
- Complexity: Low. One linear switch on `target.kind` with early returns; no nesting beyond the count filter.
- Modern idioms: Yes. Discriminated `GroupTarget`/`PluginOutcome` unions, exhaustive switches, `??`/`!` used precisely.
- Readability: Good. Intent-heavy comments explain the count-collapse rationale, the genuine-state split, and the bare-repo-command vs @intent-label distinction.
- Issues: None.

BLOCKING ISSUES:
- None.

NON-BLOCKING NOTES:
- None.
