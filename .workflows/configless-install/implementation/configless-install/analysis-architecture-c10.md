AGENT: architecture
CYCLE: 10
STATUS: findings
FINDINGS_COUNT: 2

FINDINGS:
- FINDING: Direct-path-into-collection branch reconstructs member source location inconsistently with how it keys/installs
  SEVERITY: low
  FILES: src/commands/add.ts:517-523, src/commands/add.ts:556-560, src/commands/add.ts:594, src/commands/add.ts:664, src/commands/add.ts:784-795, src/source-parser.ts:443-450
  DESCRIPTION: The sourceSubpath round-trip is sound for every entry point that matters — the no-selector skills-only member (segment "skills/<name>" keyed by basename, sourceSubpath recorded and preferred on re-clone at clone-reinstall.ts:362), the standalone tree-URL unit (full subpath lives in the key, so getSourceDirFromKey recovers it), root-child members (segment === basename, key-derived fallback), and preservation of sourceSubpath through update/change-version. Source-dir reconstruction is centralised in a single resolver (clone-reinstall.ts:362-364) shared by all four update entry points — correct seam design. The one corner that does NOT compose is the direct-path branch of runCollectionPipeline: when a tree URL's subpath itself re-detects as a collection, the pipeline keys the entry parsed.manifestKey (member name omitted) while sourceSubpath is computed from the member segment alone (knows nothing about the targetPlugin prefix). On update, getSourceDirFromKey would derive the wrong dir and no sourceSubpath corrects it. The geometry that reaches this branch is contrived and near-unreachable (a tree URL pointing at an installable unit resolves to bare-skill/plugin and takes the standalone tail, which round-trips correctly), so this is a latent inconsistency rather than an active bug.
  RECOMMENDATION: Either make the direct-path collection branch consistent (record sourceSubpath = join(targetPlugin, memberSegment) and key per-member) or, if genuinely unreachable, collapse the branch (treat a direct-path subpath that re-detects as a collection as not-agntc/error), removing the dead branch and latent miskeying together.
- FINDING: Three parallel implementations of the GitHub clone-URL fallback (missed composition)
  SEVERITY: low
  FILES: src/source-parser.ts:387, src/source-parser.ts:419, src/source-parser.ts:440
  DESCRIPTION: The "no stored cloneUrl → reconstruct https://github.com/<owner>/<repo>.git" fallback is authored three times: parseGitHubShorthand (387), buildParsedSourceFromKey (419), and deriveCloneUrlFromKey (440). buildParsedSourceFromKey and deriveCloneUrlFromKey are logically the same query (key + cloneUrl → clone URL) yet each re-derives the owner/repo split and the github.com template; they can drift. Low impact (string is stable) but a "derived should compose from existing" case.
  RECOMMENDATION: Have buildParsedSourceFromKey call deriveCloneUrlFromKey(key, cloneUrl) for its cloneUrl field so the fallback lives in one place.

SUMMARY: The member-source-location decoupling round-trips correctly through install → update → re-update and through list update-check / change-version for every realistic entry point, with source-dir reconstruction correctly centralised in a single shared resolver. The only architectural snags are a contrived, near-unreachable direct-path-into-collection branch that miskeys/mis-locates its member and a minor triplicated clone-URL fallback. Both low severity.
