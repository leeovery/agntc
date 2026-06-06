---
phase: 5
phase_name: Copy-safety hardening (path-traversal and symlink-escape guards)
total: 4
---

## configless-install-5-1 | approved

### Task configless-install-5-1: Path-traversal guard utility (subpath-within-clone containment)

**Problem**: The canonical unit/member selector is the GitHub tree-path URL whose `<subpath>` becomes `parsed.targetPlugin` (`src/source-parser.ts` `parseDirectPath` ~186, `targetPlugin = afterTreeSegments.slice(1).join("/")`). Phase 2 task 2-3 wired that subpath into the install by computing `unitDir = join(sourceDir, parsed.targetPlugin)` (the clone root being `tempDir` from `cloneSource`, `src/git-clone.ts` ~32), and it **explicitly deferred the within-clone containment check to Phase 5** (see phase-2-tasks.md task 2-3 "Subpath path-traversal guard is explicitly deferred to Phase 5"). With `agntc.json`-presence no longer a trust gate, the source string is now genuinely arbitrary third-party input: a crafted tree URL could carry a `<subpath>` like `../../etc` or `/etc/passwd` that, when joined to the clone root and copied from, reads *outside* the clone. Nothing today validates that `parsed.targetPlugin` resolves within the clone before `unitDir` is used as a copy source. This is the Phase 2-deferred guard now landing.

**Solution**: Add a pure, dependency-free containment predicate to a **new module `src/copy-safety.ts`** (which also hosts the symlink scan in task 5-2). The function validates that a source-supplied subpath, when resolved against the clone root, stays *within* (at or below) the clone root. It is a **no-op when there is no subpath** (whole-repo / bare-skill installs — the `refero_skill` case has no selector, so the guard simply has nothing to check). It mirrors Vercel's `isSubpathSafe`: normalise/resolve `join(cloneRoot, subpath)`, then assert the resolved path is the clone root itself or a descendant of it (boundary-correct prefix check using `path.relative`, not naive `startsWith`). On violation it throws a typed error naming the offending subpath; the caller (task 5-3) turns that into a pre-flight non-zero exit. This task delivers only the utility + its unit tests; wiring is 5-3.

**Outcome**: `src/copy-safety.ts` exports a `assertSubpathWithinClone(cloneRoot, subpath)` (name illustrative) that returns cleanly for a contained or empty subpath and throws a typed `PathTraversalError` (illustrative) for any subpath that resolves outside the clone root (`..`-escape, absolute path). Trailing slashes, `.` segments, and redundant separators are normalised before the check. The function performs no filesystem writes and does not depend on the symlink scan.

**Do**:
- Create `src/copy-safety.ts`. Export the path-traversal guard, e.g. `export function assertSubpathWithinClone(cloneRoot: string, subpath: string | null | undefined): void`.
- **No-op on empty/absent subpath**: if `subpath` is `null`, `undefined`, or the empty string, return immediately (whole-repo install — nothing to validate). This is the explicit no-op case the spec calls out for the bare-skill / no-selector path.
- **Resolve and compare**: compute `const resolved = resolve(cloneRoot, subpath)` and `const root = resolve(cloneRoot)` (both via `node:path` `resolve`, which normalises `.`/`..`/redundant separators/trailing slashes). Containment holds iff `resolved === root` **or** `resolved` is a strict descendant of `root`. Implement the descendant check boundary-correctly: `const rel = relative(root, resolved); const contained = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));`. Do **not** use a raw `resolved.startsWith(root)` test (it false-positives on sibling dirs like `/clone-evil` vs `/clone`).
- **Subpath equal to clone root is allowed** (`rel === ""` → contained); a nested-but-contained subpath (`path/to/unit`) is allowed; an absolute subpath (`/etc/passwd`) resolves to itself and is rejected (its `rel` starts with `..` or is absolute relative to the clone root); a `..`-escape above the clone root (`../../x`) is rejected.
- **Throw a typed error** on violation: define and export `class PathTraversalError extends Error` whose message names the offending subpath, e.g. `` `subpath "${subpath}" resolves outside the clone root` ``. The caller (5-3) prepends unit identity and maps it to a pre-flight non-zero exit; keep this module pure (throw, do not call `process.exit`, do not log).
- Keep the module free of side effects: no `node:fs` calls in this function (it operates on path strings only — real-path resolution of the *target* is the symlink scan's job in 5-2; for the subpath selector, lexical/normalised resolution against the clone root is the spec's "resolves within the clone" predicate). Note: the spec's Phase 5 acceptance phrases this as "resolves within the clone"; `resolve` performs lexical normalisation of `..`/`.`, which is the intended containment semantics for a selector string (a selector is not itself a symlink). Record this interpretation in the test comments.

**Acceptance Criteria**:
- [ ] `src/copy-safety.ts` exports `assertSubpathWithinClone` and `PathTraversalError`.
- [ ] An empty / `null` / `undefined` subpath is a no-op (returns without throwing) — the whole-repo/bare-skill case.
- [ ] A `..`-escape subpath that resolves above the clone root is rejected (throws `PathTraversalError`).
- [ ] An absolute subpath (e.g. `/etc/passwd`) is rejected.
- [ ] A subpath equal to the clone root is allowed.
- [ ] A nested-but-contained subpath (`path/to/unit`, single segment, or multi-segment) is allowed.
- [ ] Containment is computed boundary-correctly (a sibling dir whose name shares the clone-root prefix, e.g. clone root `/tmp/c` vs resolved `/tmp/c-evil`, is rejected — not a false positive).
- [ ] Trailing slashes, `.` segments, and redundant separators in the subpath are normalised before the check (e.g. `unit/./` is treated as `unit`).
- [ ] The function performs no filesystem writes and does not log or exit.

**Tests** (new `tests/copy-safety.test.ts`):
- `"a null/undefined/empty subpath is a no-op"` — assert no throw for each of `null`, `undefined`, `""`.
- `"a contained single-segment subpath is allowed"` — `assertSubpathWithinClone("/clone", "unit")` does not throw.
- `"a nested multi-segment subpath is allowed"` — `"/clone", "path/to/unit"` does not throw.
- `"a subpath equal to the clone root is allowed"` — `"/clone", "."` (and `""` separately) does not throw.
- `"a ..-escape above the clone root is rejected"` — `"/clone", "../../etc"` throws `PathTraversalError`; assert the message names the subpath.
- `"an absolute subpath is rejected"` — `"/clone", "/etc/passwd"` throws.
- `"a sibling dir sharing the clone-root prefix is rejected"` — `"/tmp/c", "../c-evil/x"` (resolves to `/tmp/c-evil/x`) throws (boundary correctness, not naive startsWith).
- `"trailing slash and dot segments are normalised"` — `"/clone", "unit/./"` does not throw and is treated as `unit`.
- `"the guard does not touch the filesystem"` — call against a non-existent clone root path; assert it still classifies purely lexically (no ENOENT thrown).

**Edge Cases**:
- Empty/no subpath → no-op (the whole-repo / bare-skill case; path-traversal "has nothing to check there").
- `..`-escape above clone root → reject.
- Absolute subpath → reject.
- Subpath equal to clone root → allow.
- Nested-but-contained subpath → allow.
- Sibling dir with shared prefix → reject (boundary-correct, not `startsWith`).
- Trailing-slash / `.` / redundant segments → normalised (via `path.resolve`).

**Context**:
> Spec — *Copy-Safety Hardening → In scope*: "**Path-traversal guard** — validate any source-supplied subpath (the tree-path URL's `<subpath>` — see *Source selector grammar*) resolves *within* the clone before copying. Mirrors Vercel's `isSubpathSafe`. Cheapest, highest value."
> Spec — *Copy-Safety Hardening → Guard scope (complementary)*: "**Path-traversal** protects **source resolution** (selectors/subpaths — where we copy *from*). It is a no-op for a no-selector whole-repo copy like the `refero_skill` bare-skill case."
> Spec — *Structural Type Detection → Source selector grammar*: "The **path-traversal guard** (see *Copy-Safety*) validates that a selector's `<subpath>` resolves *within* the clone before any copy."
> Spec — *Error & Abort Behaviour → Hard errors (detection-time, before any write)*: a "path-traversal/symlink-escape violation [is a] **pre-flight failure**: nothing is written, the command exits **non-zero**, and the message names the offending source/unit." (This task supplies the typed throw; identity-prefixing + exit is 5-3.)
> Grounding: clone root = `tempDir` from `cloneSource` (`src/git-clone.ts` ~32); the subpath is `parsed.targetPlugin` (`src/source-parser.ts` ~186); Phase 2 computes `unitDir = join(sourceDir, parsed.targetPlugin)` and **deferred** this containment check to Phase 5 (phase-2-tasks.md task 2-3).
> Scope: this is the Phase 2 task 2-3 deferred guard. Utility + unit tests only; wiring is 5-3. The symlink scan is task 5-2 in the same new module.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Copy-Safety Hardening* (In scope, Guard scope), *Structural Type Detection* (Source selector grammar), *Error & Abort Behaviour*.

---

## configless-install-5-2 | approved

### Task configless-install-5-2: Symlink-escape pre-flight scan utility (clone-root boundary)

**Problem**: Cloning does `git clone --depth 1` with no symlink handling (`src/git-clone.ts`), and every copy path uses `cp(..., { recursive: true })` (`src/copy-bare-skill.ts` ~32; `src/copy-plugin-assets.ts` ~73/77) which copies symlinks **verbatim** (Node `cp` defaults to `dereference: false`). With `agntc.json`-presence removed as the trust gate, a third-party repo can ship a symlink whose target points *outside* the clone (an absolute path like `/etc/...`, or a `..`-escape above the clone root). Copied verbatim into the destination, that symlink lets a repo reference content outside the directory it is meant to land in. Nothing today scans for escaping symlinks. The bare-skill headline case (`refero_skill`) is covered *only* by this guard (path-traversal has nothing to check for a no-selector install), so the scan must run on **every** install — bare skills included.

**Solution**: Add a recursive pre-flight scan to `src/copy-safety.ts` (alongside the 5-1 guard), parameterised by the **clone-root boundary** — *not* the unit dir. The scan walks the unit tree with `lstat` (so symlinks are detected, not followed), and for each symlink resolves its target and rejects any whose target resolves *outside the clone root*. The boundary is the cloned repository root because that is the true security boundary and a multi-dir plugin legitimately spans more than one dir inside the clone (a skill pointing at a shared script elsewhere in the repo is allowed). **Broken symlinks** (nonexistent target) are evaluated **lexically**: if the link's target path lexically escapes the clone root → reject; otherwise it is copied verbatim (not an escape). The walk must **not** infinite-loop on symlink-to-directory cycles (do not recurse *through* symlinked directories — a symlinked dir is validated as a link, not descended into). This task delivers the utility + unit tests; wiring into `add` (5-3) and `update` (5-4) is separate.

**Outcome**: `src/copy-safety.ts` exports an async `scanForEscapingSymlinks(unitDir, cloneRoot)` (name illustrative) that walks `unitDir`, and throws a typed `SymlinkEscapeError` naming the offending **relative path** the first time it finds a symlink whose target resolves (or lexically resolves, when broken) outside `cloneRoot`. A non-symlink tree is a clean no-op. Symlinks resolving anywhere inside the clone (including sibling dirs) are allowed. The walk terminates on symlink-to-dir cycles without stack/heap blow-up.

**Do**:
- In `src/copy-safety.ts`, add `export async function scanForEscapingSymlinks(unitDir: string, cloneRoot: string): Promise<void>`. `unitDir` is the tree to scan (the bare-skill dir, the plugin/unit dir, or a member subdir); `cloneRoot` is the boundary.
- **Walk with `lstat`/`readdir(..., { withFileTypes: true })`**, never `stat` on directories before classifying — use `dirent.isSymbolicLink()` to detect links and `dirent.isDirectory()` for real subdirs. Recurse into **real** subdirectories only. When an entry is a symbolic link, validate it (below) and **do not descend into it** even if it points at a directory — this is what prevents infinite loops on symlink-to-dir cycles.
- **Validate each symlink** against `cloneRoot`:
  1. Read the link target: `const target = await readlink(linkPath)`.
  2. Resolve the target relative to the link's containing dir: `const resolvedTarget = resolve(dirname(linkPath), target)` (handles both relative and absolute targets — an absolute target ignores the base and resolves to itself).
  3. **Containment predicate against the clone root** (reuse the same boundary-correct check as 5-1: `const rel = relative(resolve(cloneRoot), resolvedTarget); const inside = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));`). If `inside` is false → reject.
  4. **Broken-link handling is lexical and identical**: because the predicate above is purely lexical/`resolve`-based (it does not `stat` the target), a broken (nonexistent-target) symlink is evaluated by the *same* containment check — a broken link whose target lexically escapes the clone root → reject; a broken link whose target lexically stays inside → allowed (copied verbatim). Do **not** call `realpath`/`stat` on the target (that would throw on broken links and would also follow chains); lexical resolution via `resolve` is the spec's stated semantics for broken links and is safe (and consistent) for live links too. Record this "lexical against clone root" decision in a comment.
- **Reject by throwing** `class SymlinkEscapeError extends Error` (export it) whose message names the offending path **relative to the unit/clone** (e.g. `` `symlink "${relative(unitDir, linkPath)}" points outside the clone (target: ${target})` ``) — so the error is human-actionable. Throw on the **first** escaping symlink found (fail fast; pre-flight). Keep the module pure: throw, do not log or exit.
- **No filesystem writes**: the scan is read-only (`readdir`, `lstat` via dirents, `readlink`). It must run *before* any copy (the caller enforces ordering; the utility itself only reads).
- **Deeply-nested symlinks are found**: recursion through real subdirs reaches links at any depth.
- **Symlink-to-directory cycle safety**: because symlinked dirs are validated-not-descended, a cycle (`a -> b`, `b -> a`, or a link to an ancestor) is never traversed — the walk visits only the real directory tree, which is finite. Add a test that a symlink pointing at its own ancestor dir does not hang.

**Acceptance Criteria**:
- [ ] `src/copy-safety.ts` exports `scanForEscapingSymlinks` and `SymlinkEscapeError`.
- [ ] An absolute-target symlink (e.g. `-> /etc/passwd`) is rejected.
- [ ] A `..`-escape symlink whose target resolves above the clone root is rejected.
- [ ] A symlink resolving anywhere **inside** the clone is allowed (including a link to a sibling dir elsewhere in the clone — the multi-dir-plugin case).
- [ ] A broken (nonexistent-target) symlink whose target lexically stays inside the clone root is allowed (copied verbatim, not flagged).
- [ ] A broken symlink whose target lexically escapes the clone root is rejected.
- [ ] A deeply-nested escaping symlink is found (recursion reaches any depth of real subdirs).
- [ ] A symlink-to-directory cycle (link pointing at an ancestor) does **not** cause infinite recursion / stack overflow; the scan terminates.
- [ ] A tree with no symlinks is a clean no-op (returns without throwing, no false positives).
- [ ] The error names the offending relative path (and the target) for actionability.
- [ ] The scan performs no filesystem writes.

**Tests** (extend `tests/copy-safety.test.ts`; build real temp-dir fixtures with `mkdtemp` + `symlink`, mirroring `tests/copy-bare-skill.test.ts` fixture style):
- `"rejects an absolute-target symlink"` — create `unit/link -> /etc/passwd`; assert `SymlinkEscapeError`, message names `link`.
- `"rejects a ..-escape symlink above the clone root"` — clone root = the temp dir, `unit/link -> ../../outside`; assert reject.
- `"allows a symlink resolving inside the clone"` — `clone/unit/link -> ../shared/script.sh` where `clone/shared/` exists; assert no throw.
- `"allows a symlink to a sibling dir inside the clone (multi-dir plugin)"` — link in `clone/skills/` pointing at `clone/agents/x`; assert no throw.
- `"allows a broken symlink lexically inside the clone"` — `clone/unit/link -> ./does-not-exist` (target missing but lexically inside); assert no throw (copied verbatim).
- `"rejects a broken symlink lexically escaping the clone root"` — `clone/unit/link -> ../../nope` (target missing, lexically escapes); assert reject.
- `"finds a deeply-nested escaping symlink"` — `unit/a/b/c/link -> /etc`; assert reject.
- `"does not infinite-loop on a symlink-to-directory cycle"` — `unit/loop -> ..` (link to ancestor); assert the scan completes (no hang/stack overflow) and treats the link by the containment predicate (here `-> ..` of `unit` resolves to the clone root-or-inside → allowed; assert it returns rather than recursing).
- `"a tree with no symlinks is a clean no-op"` — plain files/dirs only; assert no throw.
- `"validates symlinked dirs without descending into them"` — a symlinked directory whose *contents* (if followed) would include an escaping link: assert the symlinked dir is validated as a link and its (real) target's interior is not walked through the link (no false positive/negative from following it).

**Edge Cases**:
- Absolute-target symlink → reject.
- `..`-escape above clone root → reject.
- Symlink inside clone (incl. sibling dir) → allow (boundary is the *clone*, not the unit dir).
- Broken symlink lexically inside → allow (verbatim).
- Broken symlink lexically escaping → reject.
- Deeply-nested symlink → found.
- Symlink-to-dir cycle / link to ancestor → no infinite loop (links validated, not descended).
- No-symlink tree → clean no-op.

**Context**:
> Spec — *Copy-Safety Hardening → In scope*: "**Symlink-escape guard** — repo symlinks otherwise land verbatim (`cp` with `dereference: false`); reject any symlink that doesn't resolve inside the clone (the cloned repository root)."
> Spec — *Copy-Safety Hardening → Symlink guard: boundary, broken links, and update coverage*: "**Boundary = the cloned repository root.** A symlink is rejected only if its target resolves *outside the clone* (e.g. absolute paths like `/etc/...` or `..`-escapes above the clone root). Symlinks resolving anywhere *inside* the clone are allowed — this avoids rejecting a skill that legitimately points at a shared script elsewhere in the repo. ('Inside the unit's own directory' from the discussion is widened to 'inside the clone' because the true security boundary is the untrusted clone, and a multi-dir plugin spans more than one dir.)" "**Broken symlinks** (target nonexistent) are evaluated **lexically**: if the link's target path lexically escapes the clone root → reject; otherwise it is copied verbatim (it is not an escape)."
> Spec — *Copy-Safety Hardening → Guard scope (complementary)*: "**Symlink-escape** protects **copied content** (what lands on disk) and runs on *every* install, bare skills included. So the headline bare-skill case is covered by the symlink guard; path-traversal simply has nothing to check there."
> Spec — *Copy-Safety Hardening → Guard timing (pre-flight, before any copy)*: "Walk the tree, validate selectors resolve within the clone and no symlink escapes the unit dir. On violation, **error before writing anything**. … Pre-flight (not post-copy scan-and-remove) leaves no on-disk window where escaping symlinks exist."
> Grounding: `cp(..., { recursive: true })` copies symlinks verbatim (`src/copy-bare-skill.ts` ~32, `src/copy-plugin-assets.ts` ~73/77); clone root = `tempDir` (`src/git-clone.ts` ~32). The boundary parameter is the clone root, **not** the unit dir — so this utility takes `(unitDir, cloneRoot)` distinctly.
> Scope: utility + unit tests only. Wiring into `add` pre-flight is 5-3; into `update` re-copy pre-flight is 5-4.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Copy-Safety Hardening* (In scope, Guard scope, Guard timing, Symlink guard boundary/broken links/update coverage).

---

## configless-install-5-3 | approved

### Task configless-install-5-3: Wire path-traversal + symlink guards as the add copy pre-flight

**Problem**: The two guard utilities (5-1 path-traversal, 5-2 symlink-escape) exist but nothing in the `add` flow calls them, so an arbitrary configless repo still copies untrusted content with no escape check. The `add` install paths — the standalone copy invocation in `runAdd` (`src/commands/add.ts`, the `copyPluginAssets`/`copyBareSkill` calls at ~268/277 in the pre-Phase-2 source, within the post-Phase-2 standalone branch) and the per-member copy in `runCollectionPipeline` (~563/579) — must each run a **pre-flight scan of the unit tree before any copy**: validate the selector subpath resolves within the clone (path-traversal, a no-op when there is no selector) and that no symlink escapes the clone root (symlink scan, always). On violation, the command must error *before writing anything*, exit non-zero, and name the offending unit/path — leaving no on-disk window for escaping content and no manifest write.

**Solution**: Insert a shared pre-flight call — `assertSubpathWithinClone(cloneRoot, parsed.targetPlugin)` then `await scanForEscapingSymlinks(unitDir, cloneRoot)` — immediately before each copy in `add`. The **clone root** is `tempDir` (the `cloneSource` result already captured as `sourceDir`/`tempDir` in `runAdd`; for `local-path` sources `sourceDir` is the resolved local path and serves as the boundary). The **path-traversal guard** runs only when a selector exists (`parsed.type === "direct-path"` → `parsed.targetPlugin`; otherwise the subpath is absent → no-op), and validates against the clone root. The **symlink scan** runs on every install over the **unit dir** (`unitDir` for the standalone path — equal to `sourceDir` for whole-repo, or the subpath dir for a selector; `pluginDir` for each collection member) with the boundary set to the clone root. Each collection member is scanned independently right before its own copy. A violation (`PathTraversalError` or `SymlinkEscapeError`) is caught, prefixed with unit identity, surfaced via `p.cancel`, and turned into `ExitSignal(1)` — pre-flight, before `nukeManifestFiles`/copy/manifest write.

**Outcome**: `agntc add referodesign/refero_skill` (whole-repo bare skill, no selector) runs the symlink scan over the clone (path-traversal is a no-op) and installs only if clean. A tree-path source whose `<subpath>` escapes the clone errors pre-flight (non-zero, named) before any copy. A valid subpath that nonetheless contains an escaping symlink errors pre-flight. In a collection, each selected member's tree is scanned independently before its copy; a member with an escaping symlink errors/aborts without a copy or manifest entry for it. No copy runs and no manifest is written when a violation fires.

**Do**:
- **Depends on tasks 5-1 and 5-2.** Import `assertSubpathWithinClone`, `scanForEscapingSymlinks`, `PathTraversalError`, `SymlinkEscapeError` from `../copy-safety.js` into `src/commands/add.ts`.
- **Identify the clone root** in `runAdd`. After the clone/local-path resolution (Phase 2 step 2, ~149–165), `sourceDir` is `tempDir` for remote sources and the resolved local path for `local-path`. Capture a `cloneRoot` = that value (the clone/source root — *not* the per-unit `unitDir`). For the standalone path, `unitDir` is `sourceDir` for whole-repo or `join(sourceDir, parsed.targetPlugin)` for a selector (Phase 2 task 2-3 already computes `unitDir`); `cloneRoot` stays `sourceDir`/`tempDir`.
- **Standalone pre-flight** (before the standalone copy at ~261–288 of the post-Phase-2 flow, and specifically before `nukeManifestFiles`/`runConflictChecks`/copy): add a single pre-flight step:
  - `assertSubpathWithinClone(cloneRoot, parsed.type === "direct-path" ? parsed.targetPlugin : undefined);` (no-op for non-selector sources).
  - `await scanForEscapingSymlinks(unitDir, cloneRoot);`
  - Place this **before** any file mutation: ideally right after detection/agent selection but **before** `nukeManifestFiles` (~238 area) and before `computeIncomingFiles`/copy — the spec requires "error before writing anything," and `nukeManifestFiles` is a write. (Simplest correct placement: immediately before the manifest read + nuke block, so a violation aborts before any destructive step.)
- **Collection member pre-flight** (in `runCollectionPipeline`, before each member copy at ~553–601, and before the member's `nukeManifestFiles` at ~493): for each `pluginDir`/member about to be installed, run `await scanForEscapingSymlinks(pluginDir, cloneRoot)` **before** that member's nuke/copy. (Path-traversal for a member selected via the prompt has no source-supplied subpath, so it is a no-op; a direct-path member's subpath was already validated at the standalone-style entry — but if the collection pipeline is the path that consumes `parsed.targetPlugin`, run `assertSubpathWithinClone(cloneRoot, parsed.targetPlugin)` once for the direct-path case there too. Members enumerated by the prompt have no per-member subpath selector.) Each member is scanned **independently** right before its own copy so one member's violation does not silently taint others.
- **Catch + identity-prefix + exit**: wrap the standalone pre-flight in a `try/catch` for `PathTraversalError | SymlinkEscapeError`. On catch, build a message prepending the unit identity (`parsed.manifestKey` / `owner/repo[/subpath]`) to the guard's message, e.g. `` `${parsed.manifestKey}: ${err.message}` ``, call `p.cancel(message)`, and `throw new ExitSignal(1)`. This mirrors task 2-2's `TypeConflictError` handling (pre-flight, non-zero, identity-named) — reuse the same shape.
- **Collection member violation handling**: a member-level guard violation should be reported per-member loudly (consistent with Phase 3/4 per-member granularity) — treat it like the existing per-member failure path (`results.push({ pluginName, status: "failed", ..., errorMessage })`) so siblings still proceed and the command exits non-zero overall (the partial-success exit is Phase 4 task 4-7 territory; here, ensure the member is reported failed and not copied). Do **not** let one member's escaping symlink abort the whole collection install; do **not** copy or write a manifest entry for the violating member.
- **Ordering is load-bearing**: the scan must complete cleanly *before* `nukeManifestFiles`, `copyBareSkill`/`copyPluginAssets`, and `writeManifest`. On violation, none of those run for the affected unit. Verify no on-disk window (no partial copy, no nuke) exists.
- **Do not change the copy mechanism**: `copyBareSkill`/`copyPluginAssets` and the post-copy `agntc.json` deletion are unchanged (spec: "The single recursive `cp` then runs only on a verified-clean tree"). This task adds only the pre-flight gate.

**Acceptance Criteria**:
- [ ] A whole-repo bare-skill install (`refero_skill` shape, no selector) runs `scanForEscapingSymlinks` over the unit dir and the path-traversal guard is a no-op; install proceeds when clean.
- [ ] A tree-path selector whose `<subpath>` escapes the clone errors pre-flight (`PathTraversalError` caught), exits non-zero (`ExitSignal(1)`), names the offending unit/path, and runs **no** copy/nuke/manifest write.
- [ ] A valid subpath whose unit tree contains an escaping symlink errors pre-flight (`SymlinkEscapeError` caught), non-zero, named, no copy/write.
- [ ] The standalone symlink scan boundary is the clone root (`tempDir` / resolved local path), not the unit dir, so a within-clone symlink in a multi-dir plugin is allowed.
- [ ] Each collection member is scanned independently before its own copy; a violating member is reported failed and not copied, while sibling members still install.
- [ ] The pre-flight runs **before** `nukeManifestFiles` and before any copy — no on-disk window, no manifest write on violation.
- [ ] The copy mechanism (recursive copy, keep everything, post-copy `agntc.json` deletion) is unchanged.

**Tests** (extend `tests/commands/add.test.ts`; add a `copy-safety pre-flight` describe block — `copy-safety` functions can be spied/mocked, and real-fixture variants can drive the actual scan):
- `"whole-repo bare skill runs the symlink scan and a no-op traversal guard"` — no selector; assert `scanForEscapingSymlinks` called with `unitDir === sourceDir` and `cloneRoot === sourceDir`, and `assertSubpathWithinClone` called with an empty/undefined subpath (no-op); install completes.
- `"a selector subpath escaping the clone errors pre-flight before any copy"` — `assertSubpathWithinClone` throws `PathTraversalError`; assert `ExitSignal(1)`, `p.cancel` message contains the manifest key and the guard message, and `copyBareSkill`/`copyPluginAssets`/`nukeManifestFiles`/`writeManifest` are **not** called.
- `"a valid subpath but escaping symlink errors pre-flight"` — `assertSubpathWithinClone` ok, `scanForEscapingSymlinks` throws `SymlinkEscapeError`; assert non-zero exit, named message, no copy/write.
- `"each collection member is scanned independently before its copy"` — two members; assert `scanForEscapingSymlinks` called once per member with that member's `pluginDir` and the shared `cloneRoot`, before each member copy.
- `"a member with an escaping symlink is reported failed while siblings install"` — member-a scan throws, member-b clean; assert member-a `status: "failed"` with the error message, member-b installed, and no manifest entry for member-a.
- `"a configless plugin tree is scanned"` — multi-asset plugin, null config; assert the scan runs over the plugin unit dir with the clone-root boundary.
- `"no manifest write or copy occurs on a standalone violation"` — assert `writeManifest`/`addEntry` not called when the scan throws.
- Real-fixture integration variant (optional, in an integration-style test): build a temp clone dir with an escaping symlink and assert `runAdd` exits non-zero without copying (covers the wiring end-to-end against the real `copy-safety` utility).

**Edge Cases**:
- Whole-repo / bare skill → traversal no-op, symlink scan runs (the `refero_skill` headline case is covered by the symlink scan).
- Selector subpath escaping clone → `PathTraversalError` pre-flight.
- Valid subpath + escaping symlink → `SymlinkEscapeError` pre-flight.
- Multi-dir plugin with a within-clone symlink → allowed (boundary = clone root).
- Collection members → scanned independently; a violating member fails without aborting siblings, no entry written for it.
- Violation → no `nukeManifestFiles`, no copy, no `writeManifest`.

**Context**:
> Spec — *Copy-Safety Hardening → Guard timing (pre-flight, before any copy)*: "Both guards run as a **pre-flight scan of the unit tree *before* any copy**: Walk the tree, validate selectors resolve within the clone and no symlink escapes the unit dir. On violation, **error before writing anything**. The single recursive `cp` then runs only on a verified-clean tree. Pre-flight (not post-copy scan-and-remove) leaves no on-disk window where escaping symlinks exist, and matches the derive-before-delete principle: validate before you mutate."
> Spec — *Copy-Safety Hardening → Guard scope (complementary)*: "Path-traversal protects source resolution … It is a no-op for a no-selector whole-repo copy like the `refero_skill` bare-skill case. Symlink-escape … runs on *every* install, bare skills included. So the headline bare-skill case is covered by the symlink guard; path-traversal simply has nothing to check there."
> Spec — *Error & Abort Behaviour → Hard errors (detection-time, before any write)*: "a path-traversal/symlink-escape violation [is a] **pre-flight failure**: nothing is written, the command exits **non-zero**, and the message names the offending source/unit … These fire before any clone content is copied."
> Spec — *Copy-Safety Hardening → Installed units never carry `agntc.json`* / *Identity & Naming*: the copy mechanism (recursive `cp`, keep everything, post-copy `agntc.json` deletion) is unchanged — this task only adds the pre-flight gate.
> Grounding: standalone copy invocations at `src/commands/add.ts` ~268 (`copyPluginAssets`) / ~277 (`copyBareSkill`); collection member copies at ~563/579; `unitDir`/clone-root resolved in Phase 2 (`tempDir` from `cloneSource`, `unitDir = join(sourceDir, parsed.targetPlugin)` for a selector). Identity-prefixed pre-flight error mirrors task 2-2's `TypeConflictError` handling.
> Scope: wiring only — no change to the guard utilities (5-1/5-2) or the copy mechanism. `update`'s re-copy pre-flight is task 5-4.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Copy-Safety Hardening* (Guard timing, Guard scope), *Error & Abort Behaviour*, *Identity & Naming*.

---

## configless-install-5-4 | approved

### Task configless-install-5-4: Wire the symlink-escape guard into update's re-copy pre-flight

**Problem**: `update` re-clones the *current* (arbitrary) remote and re-copies it through `executeNukeAndReinstall` (`src/nuke-reinstall-pipeline.ts`), which today nukes (`nukeManifestFiles` ~101) then copies with the same verbatim-symlink `cp`. The spec requires the symlink-escape guard to run "on every copy that ingests cloned content — both `add` and `update`'s re-copy," routed through the identical pre-flight before nuking/replacing files. But the guard needs the **clone-root boundary**, and `executeNukeAndReinstall` receives only `sourceDir` (the unit dir — for a member, `getSourceDirFromKey(tempDir, key)` resolves to the member *subdir*, `src/source-parser.ts` ~443) and **not** the clone root (`tempDir`). The clone root is known only in `cloneAndReinstall` (`src/clone-reinstall.ts` ~151, `tempDir = cloneResult.tempDir`) and is currently dropped before `runPipeline`. So the one piece of new plumbing this phase requires is threading the clone root from `cloneAndReinstall` → `runPipeline` → `executeNukeAndReinstall`, then running the symlink scan **before** `nukeManifestFiles`, surfacing a violation as a pre-flight failure (via the existing failure-mapping seam) that exits non-zero and leaves the install intact. The path-traversal guard is **not** re-run on update (update replays a recorded manifest key, not a fresh source-supplied selector), so update's pre-flight is the symlink scan only.

**Solution**: Thread a `cloneRoot` through the update pipeline. In `cloneAndReinstall`, pass `tempDir` (clone mode) or the provided `sourceDir` (local-path mode, where `sourceDir` is the unit/local root and serves as the boundary) into `runPipeline`, and from there into `executeNukeAndReinstall` as a new `cloneRoot` option. In `executeNukeAndReinstall`, run `await scanForEscapingSymlinks(sourceDir, cloneRoot)` **before** the `nukeManifestFiles` call (and before the derive-before-delete validation is fine, but it must precede the nuke either way — pre-flight). On `SymlinkEscapeError`, return a structured pre-flight failure (reuse the abort/failure-mapping seam Phase 4 established) that `clone-reinstall.ts` maps to a non-zero, install-intact failure. For a member entry, `sourceDir` is its own subdir and `cloneRoot` is still the clone root (so within-clone cross-dir links are allowed; only true clone escapes are rejected). No path-traversal guard is added to update.

**Outcome**: `agntc update <key>` re-clones, then **before** removing any installed files, scans the re-cloned unit tree for escaping symlinks against the clone root. A clean tree updates normally. An escaping symlink aborts the update **before `nukeManifestFiles`** — the existing install is left fully intact, the failure is surfaced (named) and the command exits non-zero. In clone mode the boundary is `tempDir`; in local-path mode it is the provided `sourceDir`. A member subdir is scanned against the clone root (its own escapes rejected; legitimate within-clone links allowed). No copy or nuke runs on violation.

**Do**:
- **Depends on task 5-2** (`scanForEscapingSymlinks`, `SymlinkEscapeError`). Import from `./copy-safety.js` into `src/nuke-reinstall-pipeline.ts` (and reference types in `clone-reinstall.ts`).
- **Thread the clone root** (the one new piece of plumbing):
  - `src/nuke-reinstall-pipeline.ts`: add `cloneRoot: string` to `NukeReinstallOptions` (~12–21) and destructure it in `executeNukeAndReinstall`.
  - `src/clone-reinstall.ts` `PipelineInput` (~192–199): add `cloneRoot: string`; in `runPipeline` (~201) forward it into the `executeNukeAndReinstall({ … cloneRoot })` call (~208).
  - `cloneAndReinstall`: in **clone mode** (~151–162), pass `cloneRoot: tempDir` into `runPipeline` (note `sourceDir = getSourceDirFromKey(tempDir, key)` may be a subdir; `cloneRoot` stays `tempDir`). In **local-path mode** (~114–123), pass `cloneRoot: options.sourceDir` (the provided local root is the boundary; for a local install the unit dir *is* the boundary — there is no separate clone root, so `cloneRoot === sourceDir`).
- **Run the symlink scan before the nuke** in `executeNukeAndReinstall`: insert `await scanForEscapingSymlinks(sourceDir, cloneRoot);` **before** `nukeManifestFiles` (~101) — and, to honour derive-before-delete, it is fine to run it alongside/just after the recorded-type validation gate (Phase 4 tasks 4-4/4-5) but strictly **before** any file removal. Simplest: run the symlink scan first thing once `sourceDir`/`cloneRoot` are in scope, so a violation aborts before *any* mutation.
- **Map the violation to a pre-flight failure via the existing seam**: catch `SymlinkEscapeError` (or let it surface as a dedicated result). Reuse the Phase 4 abort/failure-mapping seam in `clone-reinstall.ts` — either:
  - return a new `NukeReinstall` result variant (e.g. `{ status: "symlink-escape", message }`) that `runPipeline` maps to a `CloneReinstallFailed` with a new `failureReason` (e.g. `"copy-unsafe"`/`"symlink-escape"`), added to `CloneFailureHandlers`/`mapCloneFailure`/`buildFailureMessage` (~44–91), **or**
  - reuse the Phase 4 `"aborted"` failure reason if its semantics (install-intact, non-zero, named) fit — preferred if Phase 4 landed an `aborted` reason, since a symlink-escape pre-flight failure is exactly "install left intact, exit non-zero, named." Choose the abort-style mapping so the install-intact guarantee and non-zero exit are inherited; ensure the message names the offending symlink/unit.
  - **Crucially**, the violation must **not** route through `handleCopyFailedRemoval` (~175–190) — that removes the manifest entry for `copy-failed`. A pre-flight symlink violation leaves the install intact, so the entry must **not** be removed (mirror the Phase 4 abort path, which also avoids entry removal).
- **No `nukeManifestFiles`, no copy on violation**: because the scan runs before the nuke and throws/returns-failure, the existing `nukeManifestFiles`/`copyBareSkill`/`copyPluginAssets` are never reached for a violating unit. Verify ordering with a spy.
- **No path-traversal guard on update**: do **not** call `assertSubpathWithinClone` in the update path. Update replays a recorded manifest key (`getSourceDirFromKey` derives the subdir from the key, not from a fresh source-supplied selector), so there is no untrusted selector to validate — the symlink scan is the whole of update's pre-flight. Note this in a comment.
- **Member coverage**: the member's `sourceDir` (its subdir) is scanned, but the boundary is the clone root (`tempDir`), so a member symlink pointing at a sibling member's dir *inside the clone* is allowed; only true clone escapes are rejected. A vanished member subdir is already handled by Phase 4's derive-before-delete (the scan of a nonexistent dir should be a no-op/clean — `scanForEscapingSymlinks` reads via `readdir` which the 5-2 util tolerates; the abort comes from the Phase 4 predicate, not the scan).
- **Do not change the copy mechanism** (recursive copy, keep everything) — only add the pre-flight gate, exactly as `add` does in 5-3.

**Acceptance Criteria**:
- [ ] `NukeReinstallOptions` carries a `cloneRoot`, threaded from `cloneAndReinstall` (clone mode → `tempDir`; local-path mode → the provided `sourceDir`) through `runPipeline` into `executeNukeAndReinstall`.
- [ ] `executeNukeAndReinstall` runs `scanForEscapingSymlinks(sourceDir, cloneRoot)` **before** `nukeManifestFiles`.
- [ ] An escaping symlink in the re-cloned tree aborts the update before any file removal: `nukeManifestFiles` is **not** called, no copy occurs, the existing install (files + manifest entry) is left intact.
- [ ] The violation is surfaced as a pre-flight failure through the existing failure-mapping seam, the command exits **non-zero**, and the message names the offending symlink/unit.
- [ ] The violation does **not** route through `handleCopyFailedRemoval` — the manifest entry is not removed (distinct from `copy-failed`).
- [ ] In clone mode the boundary is `tempDir`; in local-path mode it is the provided `sourceDir`; a member subdir is scanned against the clone root (within-clone cross-dir links allowed).
- [ ] No path-traversal guard is added to the update path (update replays a recorded key, not a fresh selector).
- [ ] The copy mechanism is otherwise unchanged.

**Tests** (extend `tests/nuke-reinstall-pipeline.test.ts` and `tests/clone-reinstall.test.ts`):
- `"clone-mode update scans against the tempDir clone root"` — assert `executeNukeAndReinstall` receives `cloneRoot === tempDir` and `scanForEscapingSymlinks` is called with `(sourceDir, tempDir)`.
- `"local-path update scans against the provided sourceDir root"` — local mode (`options.sourceDir` set); assert `cloneRoot === options.sourceDir` passed to the scan.
- `"an escaping symlink aborts before nukeManifestFiles"` — `scanForEscapingSymlinks` throws `SymlinkEscapeError`; assert `nukeManifestFiles` **not** called, no copy, and a pre-flight failure result is returned (install intact).
- `"the symlink violation does not remove the manifest entry"` — assert `handleCopyFailedRemoval` does not remove the entry for a symlink-escape failure (no `writeManifest` removal).
- `"a member subdir is scanned against its own clone root"` — member key, `sourceDir = getSourceDirFromKey(tempDir, key)`; assert the scan is called with the member subdir and `cloneRoot === tempDir` (so within-clone links allowed).
- `"the violation surfaces as a non-zero pre-flight failure"` — through `cloneAndReinstall`/`mapCloneFailure`, assert the failure reason maps to a non-zero exit and a message naming the symlink/unit (single-key update path).
- `"no nuke or copy runs on violation"` — spy ordering: the scan resolves/throws before `nukeManifestFiles`; on throw, nuke and copy call counts are 0.
- `"update does not invoke the path-traversal guard"` — assert `assertSubpathWithinClone` is **not** called in the update path.
- `"a clean re-cloned tree updates normally"` — scan returns cleanly; assert the existing derive-before-delete + copy flow proceeds unchanged.

**Edge Cases**:
- Clone mode → boundary `tempDir`; member `sourceDir` is a subdir but boundary stays the clone root.
- Local-path mode → boundary = provided `sourceDir` (no separate clone root).
- Escaping symlink → abort before nuke, install intact, non-zero, named; entry **not** removed (unlike `copy-failed`).
- Within-clone cross-member symlink → allowed (boundary = clone root).
- Vanished member subdir → Phase 4 derive-before-delete aborts; the scan over a nonexistent dir is a clean no-op (not the abort trigger).
- No path-traversal guard on update (recorded key, not a fresh selector).

**Context**:
> Spec — *Copy-Safety Hardening → Symlink guard: boundary, broken links, and update coverage*: "**The guard runs on every copy that ingests cloned content — both `add` and `update`'s re-copy.** Since `update` re-clones the current (arbitrary) remote, its copy path is routed through the identical pre-flight guard before nuking/replacing files."
> Spec — *Copy-Safety Hardening → Guard timing (pre-flight, before any copy)*: "On violation, **error before writing anything**. … matches the derive-before-delete principle: validate before you mutate." (`nukeManifestFiles` is a write; the scan must precede it.)
> Spec — *Copy-Safety Hardening → Symlink guard: boundary*: "**Boundary = the cloned repository root.**" — so the boundary for a member is the clone root (`tempDir`), not the member subdir; within-clone cross-dir links are allowed.
> Spec — *Error & Abort Behaviour → Hard errors*: a symlink-escape violation is a pre-flight failure — "nothing is written, the command exits **non-zero**, and the message names the offending source/unit." Combined with the update-abort posture (install left intact), the entry is **not** removed.
> Grounding: `executeNukeAndReinstall` receives `sourceDir` but **not** the clone root; `nukeManifestFiles` at `src/nuke-reinstall-pipeline.ts` ~101. Clone root = `tempDir = cloneResult.tempDir` (`src/clone-reinstall.ts` ~151); `sourceDir = getSourceDirFromKey(tempDir, key)` (~153) is the member subdir; local-path mode passes `options.sourceDir` (`src/commands/update.ts` ~208, `sourceDir: key`). The failure-mapping seam (`CloneReinstallFailed`/`mapCloneFailure`/`buildFailureMessage`, ~32–91; `handleCopyFailedRemoval` ~175–190) is reused; Phase 4 task 4-6 established the abort-style, install-intact, non-zero mapping this task piggybacks on.
> Scope: the **only** new plumbing this phase requires is threading the clone root through `runPipeline → executeNukeAndReinstall`. Update's pre-flight is the symlink scan only — no path-traversal guard (recorded key, not a fresh source selector). The copy mechanism is unchanged.

**Spec Reference**: `.workflows/configless-install/specification/configless-install/specification.md` — *Copy-Safety Hardening* (Symlink guard boundary/update coverage, Guard timing), *Error & Abort Behaviour*, *Manifest Keying & Lifecycle* (derive-before-delete posture).
