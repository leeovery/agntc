# Review Tracking: Vercel Skills Compatibility - Input Review

## Findings

### 1. Vercel's security-risk assessments are dropped without a scope call

**Source**: No source decides this. Checked: discussion "Vercel's surface (v1.7.0)" (the pre-install display ends with an advisory "Security Risk Assessments" table before "Proceed with installation?"; "security-audit display" is listed among Vercel's capabilities beyond project install); "Like-for-Like Scope" (all three Decision entries, including the 2026-10-06 revision that sorts the beyond-project items left in no bucket: other git hosts, the canonical store, the skills.sh blob fast path. Security-audit display is never sorted); "Pre-Install Summary" (Journey: "Follows Vercel's display"; Decision lists source and version, shape, names and descriptions, and target agents, and the 2026-10-07 revision adds "Proceed with installation?"); "Hook Scripts Gate" (Context calls the table advisory, and the Decision covers hooks only); "Install Flag Set" (`--json` with Vercel's meaning; no field contract)
**Category**: Unsourced decision
**Move**: route
**Affects**: 9.2 `--json`; 11.1 What `add` shows; 1.3 Out of scope

**Problem**:
The specification decides that agntc never has Vercel's security-audit data. The `--json` contract gives every installed entry "`security` (always `null`, as Vercel emits it where it holds no security-audit data)". The pre-install summary "follows Vercel's order" but lists no risk-assessment table. The out-of-scope list never names security audits, so the one place this is decided is a JSON field value.

The sources never make this call:
- The discussion records that Vercel's `add` shows an advisory "Security Risk Assessments" table before its proceed prompt. It lists security-audit display among Vercel's capabilities beyond project install.
- The scope decision sorts each of those capabilities into in scope, roadmapped or out, and one revision exists only to sort three that had been left out. Security-audit display was never sorted.
- The summary decision says it follows Vercel's display, then lists contents without the table.

What users would notice:
- Someone who switches binaries no longer sees the risk assessment Vercel showed before they confirmed a third-party install, and nothing tells them it is gone.
- A script or agent caller that reads `--json` `security` gets `null` on every install, which reads the same as "no audit exists for this skill".
- Building it the other way means agntc calls skills.sh's audit service on every add.

Whether agntc shows Vercel's security assessments is the owner's scope call. The answer belongs in the discussion's scope decision, and from there in the specification's out-of-scope list or its summary and `--json` sections.

**Proposed Text**:

**Resolution**: Pending
**Notes**:

---

## Observations

- `--list` shows what a bare add would install, which is the newest tag. A skill added after that tag never appears in the listing an agent caller uses to choose, even though a named `--skill` reaches it through the default-branch fallback.
- The specification follows the source in giving a skill with frontmatter but no `name` no description, even when the frontmatter holds a string `description`.
