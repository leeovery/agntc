---
status: in-progress
created: 2026-06-06
cycle: 2
phase: Gap Analysis
topic: configless-install
---

# Review Tracking: configless-install - Gap Analysis

## Findings

### 1. `type: collection` listed as a hard error in the conflict list, but Config Model says it is unrecognised/ignored

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: *Structural Type Detection* → "Type-vs-structure conflict → hard error" (line 136); contradicts *Config Model* → "Recognised `type` values and the leniency-vs-error boundary" (line 64) and *Backward-Compat / Config schema* (lines 433-438)

**Details**:
The Config Model section is explicit and authoritative: "The only recognised `type` value is `"plugin"`." and "Any other `type` value — including `"collection"` — is unrecognised and ignored (lenient, like any unknown key)." It then states directly: "This supersedes the discussion's incidental `type: collection` on a multi-asset plugin → error example — that value simply isn't honoured."

But the conflict list in *Structural Type Detection* still carries that exact superseded example as a live hard-error case:
> - `type: collection` on a multi-asset plugin → error.

These two statements are in direct contradiction. An implementer building the type-conflict error path would either (a) add an error branch for `type: collection` that the Config Model says must never exist, or (b) treat `type: collection` as ignored and be unsure why the conflict list disagrees. Because conflict detection runs before any write and determines exit status, the ambiguity is behaviourally load-bearing (error-and-exit-nonzero vs. silently-ignore are opposite observable outcomes for the same input).

The fix is to remove the `type: collection` line from the conflict list so it aligns with the Config Model's "unrecognised → ignored" rule. (The realizability/conflict rule then applies only to `type: "plugin"`, exactly as line 64 says.)

**Current**:
> ### Type-vs-structure conflict → hard error
>
> `type`/`--plugin` resolve **only** the skills-only case. A declared type (or flag) that contradicts an *unambiguous* structure is **unrealizable → hard error**, not a forced interpretation:
>
> - `type: plugin` on a member-dirs collection → error.
> - `type: plugin` on a bare skill → error.
> - `type: collection` on a multi-asset plugin → error.
> - `--plugin` on a member-dirs collection (or any non-bundleable structure) → error, exactly as `type: plugin` would. The flag's *only* extra power is winning the tie in the ambiguous case — it cannot realize an impossible structure.

**Proposed Addition**:
{leave blank until discussed}

**Resolution**: Pending
**Notes**:

---

### 2. `--plugin` on a bare skill: "agrees (redundant, no-op)" contradicts "behaves exactly as `type: plugin`" (which errors on a bare skill)

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: *Structural Type Detection* → "`--plugin` scope" (line 121) and "Selector / `--plugin` orthogonality" (line 148); vs. "Type-vs-structure conflict → hard error" (lines 135, 137)

**Details**:
The `--plugin` scope bullet says:
> Source resolves to an unambiguous **bare skill** or multi-asset plugin → `--plugin` agrees (redundant, no-op) or contradicts (hard error), per the conflict rule.

This lumps "bare skill" and "multi-asset plugin" together as cases where `--plugin` may "agree (redundant, no-op)." But the conflict rule itself states the opposite for a bare skill:
> - `type: plugin` on a bare skill → error.
> - `--plugin` ... → error, exactly as `type: plugin` would.

A bare skill resolves to type `skill`, not `plugin`, so `--plugin` ("bundle as a plugin") does **not** agree with it — it contradicts it and must be a hard error per lines 135/137. The "redundant, no-op" path is only correct for an already-multi-asset plugin. As written, line 121 tells an implementer that `--plugin` on a bare skill *might* be a no-op, which directly conflicts with the conflict-rule section that mandates an error. The two sections must agree on a single observable outcome for `--plugin` + bare skill.

Suggested reconciliation: split the bullet so that `--plugin` on a multi-asset plugin → redundant no-op (it already is a plugin), and `--plugin` on a bare skill → hard error (consistent with `type: plugin` on a bare skill).

**Current**:
> - Source resolves to an unambiguous bare skill or multi-asset plugin → `--plugin` agrees (redundant, no-op) or contradicts (hard error), per the conflict rule.

**Proposed Addition**:
{leave blank until discussed}

**Resolution**: Pending
**Notes**:

---

### 3. Symlink guard boundary stated two ways: "inside the unit's own directory" (line 375) vs the cycle-1 authoritative "inside the clone" (line 395)

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: *Copy-Safety Hardening* → "In scope" item 2 (line 375); contradicts "Symlink guard: boundary, broken links, and update coverage" (line 395)

**Details**:
The cycle-1 addition explicitly redefines the symlink boundary and says it supersedes the older wording:
> **Boundary = the cloned repository root.** ... ("Inside the unit's own directory" from the discussion is widened to "inside the clone" because the true security boundary is the untrusted clone, and a multi-dir plugin spans more than one dir.)

But the in-scope summary bullet still uses the narrower, now-superseded phrasing verbatim:
> 2. **Symlink-escape guard** — ... reject any symlink that doesn't resolve inside **the unit's own directory**.

These are materially different predicates: "inside the unit's own directory" would reject a legitimate plugin symlink pointing at a shared script in a sibling dir of the same clone — which line 395 explicitly says must be *allowed*. An implementer reading the in-scope list first (it appears earlier) could build the stricter, wrong guard. The summary bullet should be updated to "inside the clone (the cloned repository root)" to match the authoritative subsection.

**Current**:
> 2. **Symlink-escape guard** — repo symlinks otherwise land verbatim (`cp` with `dereference: false`); reject any symlink that doesn't resolve inside the unit's own directory.

**Proposed Addition**:
{leave blank until discussed}

**Resolution**: Pending
**Notes**:

---

### 4. Residual `@unit` / `#ref@skill` selector references after the grammar section killed that syntax

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: *Structural Type Detection* → "Selector / `--plugin` orthogonality" (line 143); *Copy-Safety Hardening* → "In scope" item 1 (line 374); (also the inline phrasing at *Collection Membership* line 329 is fine, but the selector examples above are stale)

**Details**:
The cycle-1 *Source selector grammar (canonical)* section is unambiguous: "`@` is **never** a unit selector," "No `owner/repo@unit` shorthand is introduced," and member/unit selection is *only* the GitHub tree-path URL. It establishes `@<ref>` as exclusively a version ref/constraint.

Two earlier references still describe the killed `@unit` form as if it exists:
- Line 143: "A source selector (`owner/repo@unit`, tree path) and `--plugin` are orthogonal axes" — names `owner/repo@unit` as a selector.
- Line 374 (Copy-Safety, path-traversal guard): "validate any source-supplied subpath/selector (`@unit`, tree path, `#ref@skill`) resolves within the clone" — instructs the implementer to validate `@unit` and `#ref@skill` selector forms that the grammar says do not exist.

Line 374 is the more concrete problem: it tells the person building the path-traversal guard which selector shapes to parse and validate, and two of the three listed (`@unit`, `#ref@skill`) are non-existent per the canonical grammar, while the real one (tree-path `<subpath>`) is under-specified there. This forces the implementer to either build dead validation paths or cross-reference and guess. Replace the stale examples with the canonical "tree-path URL `<subpath>`" form.

**Current**:
> A source selector (`owner/repo@unit`, tree path) and `--plugin` are orthogonal axes:

and

> 1. **Path-traversal guard** — validate any source-supplied subpath/selector (`@unit`, tree path, `#ref@skill`) resolves *within* the clone before copying. Mirrors Vercel's `isSubpathSafe`. Cheapest, highest value.

**Proposed Addition**:
{leave blank until discussed}

**Resolution**: Pending
**Notes**:

---
