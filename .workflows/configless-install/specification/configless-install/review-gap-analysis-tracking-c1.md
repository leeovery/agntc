---
status: in-progress
created: 2026-06-06
cycle: 1
phase: Gap Analysis
topic: configless-install
---

# Review Tracking: configless-install - Gap Analysis

## Findings

### 1. Legacy backfill heuristic cannot distinguish a single-skill bundled plugin from a bare skill

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Manifest Keying & Lifecycle → *Legacy backfill (pre-`type` manifest entries)* (lines 181–189)

**Details**:
The backfill rule encodes type from the recorded `files`: an entry that wrote to `agents/`/`hooks/` targets, or holds *multiple* skill dirs under one key → `plugin`; a *single* `.claude/skills/<name>/` → bare skill. But a skills-only repo that was originally bundled as a plugin via `type: plugin` or `--plugin` and that contained exactly **one** skill produces the identical on-disk footprint as a bare skill (one `.claude/skills/<name>/`, no `agents/`/`hooks/`). The heuristic will backfill it as `skill`, not `plugin`. On the next `update`, replaying type `skill` instead of `plugin` could re-derive the wrong unit if the author has since added an `agents/` dir (the spec's own "benign addition" scenario at line 175). The spec presents the `files`→type mapping as exhaustive but this boundary case is unaddressed: an implementer cannot decide what to record. Either the case must be declared acceptable collateral (and why), or a tiebreaker defined.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:

---

### 2. Inconsistent definition of which asset-dir combinations constitute a plugin

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Structural Type Detection → *The four structural shapes* table (line 68) vs *Single structural detection path* step 2 (line 89); Collection Membership *Membership* (line 251)

**Details**:
The shapes table defines a (non-ambiguous) plugin as `skills/` **+** (`agents/` or `hooks/`) — i.e. `skills/` is required. But the detection-path prose (step 2) says "root **asset-kind dirs** (`skills/` / `agents/` / `hooks/`) recognised as plugin parts → **plugin**", with the only stated exception being `skills/`-only. The collection membership rule (line 251) likewise says "child has asset-kind dirs (`skills/` / `agents/` / `hooks/`) → plugin member." These three statements disagree on a repo that has `agents/` and/or `hooks/` but **no** `skills/`:
- Table: not a listed plugin shape (would seem to fall through to collection or reject).
- Detection prose: a plugin (it has asset-kind dirs, and it's not skills-only).
An implementer cannot tell whether `agents/`-only or `hooks/`-only (or `agents/`+`hooks/`, no `skills/`) is a plugin, a non-member to skip, or a reject. This is a real configless input given `agentic-workflows`-style repos. The three sections must agree on a single rule.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:

---

### 3. Source-string selector grammar is referenced in three incompatible forms but never defined

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Config Model (line 52); Structural Type Detection *Selector/`--plugin` orthogonality* (line 113); Collection Membership *Selection UX* (line 265); Copy-Safety *In scope* item 1 (line 310)

**Details**:
The "source-string selector" is load-bearing (it's the flag-free way to pick a collection member and to target a unit for `--plugin`), but it appears in mutually inconsistent notations that are never reconciled into a grammar:
- `owner/repo@unit` (lines 52, 113, 265)
- `tree/<branch>/<path>` URL / `tree path` (lines 113, 265)
- `#ref@skill` (line 310, in the copy-safety guard list)
The relationship between `@unit`, `@tag`/`#ref` (version pinning, line 294: "Explicit `#ref` / `@tag`"), and the existing source-parser forms is unspecified. Does `@` mean "unit" or "tag"? How do `#ref`, `@tag`, and `@unit` compose in a single source string? An implementer building the parser and the path-traversal guard (which must validate "any source-supplied subpath/selector") has no defined syntax to parse or validate against. At minimum the spec needs one canonical selector grammar listing each form and what it selects.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:

---

### 4. `--plugin` target is undefined when installing a collection (multiple units, no selector)

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Structural Type Detection *Detection precedence* (line 81), *Selector/`--plugin` orthogonality* (line 113), *Type-vs-structure conflict* (line 107)

**Details**:
`--plugin` "force[s] the *selected* source to install as one atomic bundle." The orthogonality section frames `--plugin` as resolving "*the selected unit's* skills-only ambiguity," pairing it with a selector (`@unit --plugin`). But the spec also allows installing a collection via the interactive prompt (select one/some/all) **without** a selector. What does `--plugin` mean then — does it apply to each selected member, to the whole collection (which is explicitly never bundleable → error per line 107), or is `--plugin` simply rejected/ignored at the collection level? The spec says `--plugin` on a non-bundleable structure is a hard error, which would make `--plugin` + a multi-member collection always an error — but that is never stated, and "select-all is not `--plugin`" (line 266) only addresses the inverse confusion. The behaviour of `--plugin` in the no-selector collection path needs an explicit rule.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:

---

### 5. `type` field added to `ManifestEntry` but interaction with backfill on read is unspecified

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Manifest Keying & Lifecycle *Decision* (line 174) and *Legacy backfill* (lines 181–189)

**Details**:
The spec says to "Add a `type` field to `ManifestEntry`" and that legacy entries "backfill `type` from the recorded `files`" at "the first `update`." Two completeness gaps for an implementer:
(a) Is `type` required or optional on the `ManifestEntry` interface? It must be optional to read legacy manifests, but then every reader must handle absence — the spec doesn't state the field's optionality or default.
(b) The existing `readManifest` already does inline backfill (e.g. `cloneUrl`). The spec scopes `type` backfill to "the first `update`" specifically — but does not say whether `type` is backfilled lazily on read (like `cloneUrl`) or only inside the `update` command. These produce different behaviours for `list`/`remove`, which also read the manifest and may want to display/act on type. The trigger point and persistence moment for backfill need to be pinned down.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:

---

### 6. "Derive-before-delete" validation criteria for `update` abort are not concretely defined

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Manifest Keying & Lifecycle *Decision* (lines 176–178)

**Details**:
The lifecycle rule is "validate the unit can still be reinstalled as its recorded type *before* removing any existing files" and abort if "the tree no longer supports the recorded type (unit/path gone, structure incompatible)." The principle is clear but the concrete pass/fail predicate is not. For recorded type `plugin`, what exactly must the re-cloned tree present to "support" it — the same asset dirs? at least one asset dir? the same skill set? The spec earlier says benign additions are picked up (line 175), implying the check is permissive, but it also says "was a bare skill, now a collection" aborts. For a recorded `skill`, must root `SKILL.md` still exist? For a member entry, only "vanished member subdir trips the abort path" (line 178) — so a member whose subdir changed *shape* (skill→plugin) is apparently fine? That seems to contradict the root-level "structure incompatible → abort" rule. An implementer needs an explicit per-type validation predicate, especially the member case which is stated only as "vanished subdir."

**Proposed Addition**:

**Resolution**: Pending
**Notes**:

---

### 7. No acceptance criteria / observable behaviour for the hard-error and abort cases

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Structural Type Detection *Type-vs-structure conflict* (lines 100–109); Manifest Keying *Irreconcilable change* (line 177); Agent Selection (line 230); Backward-Compat *stray root config* (line 363)

**Details**:
The spec repeatedly prescribes "hard error" / "loud error" / "loud alert" / "abort + loud alert" but never defines what an implementer must produce: exit code, message content, where it surfaces (per-unit vs whole command), and whether the command continues with other units after one errors. For collections specifically, "per-member abort granularity" (line 179) says siblings advance while one aborts and "each aborted entry is reported loudly" — but the overall command's exit status when some members succeed and some abort is unspecified. Without at least the shape of these outcomes (exit non-zero? partial success reporting?), the error paths can't be tested or implemented consistently, and these are the spec's *primary* behavioural contract (the governing posture). Acceptance criteria for the loud paths are implicit only.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:

---

### 8. Symlink-escape guard: behaviour and traversal boundary underspecified

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Copy-Safety Hardening *In scope* item 2 (line 311), *Guard timing* (lines 321–327)

**Details**:
The symlink guard must "reject any symlink that doesn't resolve inside the unit's own directory" and runs as a pre-flight walk. Open points an implementer must otherwise guess:
(a) "the unit's own directory" — for a plugin spanning `skills/`+`agents/`+`hooks/`, is the boundary the repo/clone root, or each asset dir? A skill legitimately symlinking to a shared script elsewhere in the repo would be rejected if the boundary is per-skill-dir. The spec says "inside the unit's own directory" (singular) but a plugin is multi-dir.
(b) Relative symlinks pointing *within* the boundary but to a path that itself doesn't exist (broken symlink) — reject, skip, or copy?
(c) The guard "runs on *every* install" — does it also run on `update`'s re-copy (which re-clones arbitrary current content)? Pre-flight is described in the install context; `update` reuses copy but the spec doesn't explicitly route `update` through the guard.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:

---

### 9. Whitespace/`type` value validation and the "contradictory type" detection are not connected to config-reading leniency

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Config Model (lines 41–51); Agent Selection *No valid constraint* (lines 222–230); Structural Type Detection *conflict* (line 100)

**Details**:
There is a tension between two leniency rules that an implementer must reconcile. Agent Selection says config reading "treats parse failures as 'no usable config' and falls back to the default" and there are "**No hard errors for config problems**" (line 230). But Structural Type Detection mandates a **hard error** when config `type` contradicts an unambiguous structure (line 100). So a config is simultaneously (a) parsed leniently (malformed → ignored, no error) and (b) a source of hard errors (a valid `type: plugin` on a collection). The boundary is: malformed/unparseable → lenient; well-formed-but-contradictory `type` → loud error. This is derivable but never stated as a single rule, and the edge cases are undefined: what about `type` present with an unrecognised value (e.g. `type: "collection"` — the config shape at line 41 only documents `type?: "plugin"`)? Is `type: "collection"` malformed-and-ignored, or a recognised value that can produce the line-107 "`type: collection` on a multi-asset plugin → error"? Line 106 treats `type: collection` as a real, error-producing value, but line 41 says the only allowed `type` value is `"plugin"`. Contradiction.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:

---

### 10. `agntc.json` deletion-after-copy behaviour and its scope across unit types unstated

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Copy-Safety Hardening (line 304); Identity & Naming *Consequences* (line 146)

**Details**:
Line 304 notes the current bare-skill copy "does a recursive `cp` of the whole clone, then deletes `agntc.json`." The spec keeps "recursive copy of the unit's directory ... keep everything" (line 146) but never states whether the post-copy `agntc.json` deletion is retained, dropped, or extended to plugins/collection members under configless. Since config is now optional and demoted, an installed skill may or may not have shipped a config; the rule for whether installed units retain their `agntc.json` on disk is unspecified. This matters for `update` replay and for what lands in the agent's skills dir. An explicit statement (delete on copy for all unit types / keep / N/A) is needed.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:

---

### 11. "Pre-tick detected agents" relies on agent detection that is referenced but not specified for the configless default path

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Agent Selection *Decision* (lines 219–220), *No valid constraint* (lines 222–234)

**Details**:
The configless default "offer all `KNOWN_AGENTS` (claude / codex / cursor), pre-tick detected agents, user picks." Two gaps: (a) "detected agents" — detected how? (presence of `.claude/`, `.codex/`, `.cursor/` in the project? something else?) The detection signal is assumed but not defined here, and it now drives the default selection UX for the common configless path. (b) "Auto-select when a single declared agent is detected" (line 207) is a constraint-model rule; does the equivalent auto-select apply in the no-constraint default when exactly one agent is *detected*, or does the no-constraint path always prompt? Line 220 says "user picks" unconditionally, which may contradict the auto-select convenience. The interaction between auto-select and the configless default needs a clear rule.

**Proposed Addition**:

**Resolution**: Pending
**Notes**:

---
