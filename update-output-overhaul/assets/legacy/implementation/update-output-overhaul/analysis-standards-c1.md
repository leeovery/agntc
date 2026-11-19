AGENT: standards
FINDINGS:
- FINDING: Version-move arrow renders ASCII "->" while separators/spec use unicode "→"
  SEVERITY: low
  FILES: src/version-resolve.ts:59,62, src/update-render.ts:151,154,223, src/summary.ts:243,291
  DESCRIPTION: `formatVersionMove` emits `<old> -> <new>` with an ASCII arrow (the
    comment calls it "verbatim"), but the member/agent separator in
    `formatMemberLine` uses a unicode `→` (`${name} → ${agents}`), and
    `formatGroupHeader` interpolates the ASCII move into an otherwise unicode line.
    A single divergent-old member line therefore mixes both glyphs —
    `macos → claude  (v1.2.0 -> v1.3.0)` — whereas every illustrative shape in the
    spec (lines 144, 148, 161, 220) renders the move with `→`
    (`v1.2.0 → v1.3.0`). The core Part-2 decision (tags-vs-hashes; both refs semver
    tags AND ref moved) is implemented correctly; this is purely the arrow glyph.
    Note this is plausibly an intentional preservation of the pre-existing ASCII
    arrow (Overview line 9 shows the old `6500f65 -> f395397`), and the spec itself
    is inconsistent (uses "from…to", "→", and "->"), so the arrow char is not a
    ratified decision — hence low. The genuine defect is the within-line mixed-arrow
    inconsistency, not the char choice per se.
  RECOMMENDATION: Pick one arrow glyph for user-facing moves. Either switch
    `formatVersionMove` to `→` to match the separator and the spec's shown output,
    or (if ASCII is the deliberate house style) accept the mismatch knowingly. If
    changed, update the version-resolve doc comment that currently pins " -> " as
    "verbatim".

- FINDING: Group-of-one no-agents skip loses the specified ⚠ glyph in the collapsed stop-frame
  SEVERITY: low
  FILES: src/commands/update.ts:730-732,779-780
  DESCRIPTION: Spec line 175 states a group-of-one "collapses its single member's
    outcome into the header line, carrying the same ✓/✗/⚠ per its result," and line
    173 specifies `no-agents` renders as `⚠ member: skipped …` (`p.log.warn`). In
    `streamGroupWork`, a single-updating-member group emits its outcome as the
    spinner stop-frame via `spin.stop(line.text, line.level === "error" ? 2 : 0)`.
    clack's `spinner.stop` has only success (0) and error (2) codes — no warn — so a
    group-of-one whose reinstall returns `no-agents` (a warn) stops with code 0 and
    renders the neutral ◇ glyph instead of the ⚠ the spec calls for. The text still
    carries "skipped — no longer supports installed agents", so the signal is not
    lost, and the code comment already acknowledges the tradeoff. The multi-member
    path renders ⚠ correctly (`p.log.warn`); only the group-of-one collapse of a
    no-agents result deviates. (aborted/blocked → error → ✗ map fine; only the warn
    level has no stop code.)
  RECOMMENDATION: If exact glyph parity with spec line 175 matters, render a
    group-of-one no-agents skip as a separate `p.log.warn` line (stopping the
    spinner on the bare header or nothing) rather than as the stop-frame, so the ⚠
    is preserved. Otherwise treat as an accepted clack-API limitation and note it in
    the spec's working notes.
SUMMARY: The implementation conforms to the specification's substantive decisions —
  grouping key `(resolvedCloneUrl, constraint ?? ref)` with ref excluded for
  constrained groups, one clone + one check per group, per-member categorization
  against the shared target, genuine-state splits, clone-failure fan-out to N failed
  outcomes with grouped rendering, per-member reinstall isolation, per-group manifest
  persistence, per-group trailing collapse, tags-vs-hashes wording (both refs semver
  tags AND ref moved) on both surfaces, the actionable mode-matched out-of-constraint
  footer (post-bump current, per-group collapse, bare re-add), the all-mode
  newer-tags add-command consistency fix, and the ratified exit posture (single-key 1
  vs all-mode 0 for check-failed/constrained-no-match; only aborted/blocked/failed/
  copy-failed trip non-zero). Only two low-severity presentation deviations found,
  both around glyph/arrow rendering rather than logic or missing validation.
