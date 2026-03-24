---
phase: 1
phase_name: Constraint Parsing and Version Resolution
total: 7
---

## vc-1-1 | approved

### Task vc-1-1: Add semver dependency

**Problem**: The project has no semver parsing or matching capability. Version constraint resolution requires `semver.clean()`, `semver.valid()`, `semver.validRange()`, and `semver.maxSatisfying()` -- all provided by the `semver` npm package.

**Solution**: Add `semver` as a production dependency and `@types/semver` as a dev dependency. Verify the package installs and the TypeScript types are available.

**Outcome**: `semver` is importable from any source file with full TypeScript type support. No existing tests break.

**Do**:
- Run `pnpm add semver` to add the production dependency (alongside existing `commander` and `@clack/prompts`)
- Run `pnpm add -D @types/semver` to add TypeScript type declarations
- Verify the dependency appears in `package.json` under `dependencies` and `devDependencies` respectively
- Run `pnpm test` to confirm no existing tests break

**Acceptance Criteria**:
- [ ] `semver` appears in `package.json` `dependencies`
- [ ] `@types/semver` appears in `package.json` `devDependencies`
- [ ] `import * as semver from "semver"` compiles without error in a `.ts` file
- [ ] All existing tests pass (`pnpm test`)

**Tests**:
- `"semver is importable and clean() returns expected value"` -- a smoke test that imports semver and calls `semver.clean("v1.2.3")` expecting `"1.2.3"`
- `"semver maxSatisfying works with caret constraint"` -- calls `semver.maxSatisfying(["1.0.0", "1.1.0", "2.0.0"], "^1.0.0")` expecting `"1.1.0"`

**Edge Cases**: none

**Context**:
> The spec explicitly names `semver` as the production dependency (~50KB, zero dependencies) and `@types/semver` for TypeScript support. `semver.coerce()` will NOT be used -- only `clean()`, `valid()`, `validRange()`, and `maxSatisfying()`.

**Spec Reference**: `.workflows/version-constraints/specification/version-constraints/specification.md` -- "Version Resolution > Dependency" section

## vc-1-2 | approved

### Task vc-1-2: Extend ParsedSource types with constraint field

**Problem**: The existing `ParsedSource` union type and its constituent interfaces (`GitHubShorthandSource`, `HttpsUrlSource`, `SshUrlSource`, `DirectPathSource`, `LocalPathSource`) have no `constraint` field. The version constraints feature needs every parsed source to carry an optional constraint expression so downstream code can determine whether version resolution is needed.

**Solution**: Add a `constraint: string | null` field to the three remote source interfaces that support constraints (`GitHubShorthandSource`, `HttpsUrlSource`, `SshUrlSource`). Set `constraint: null` on `DirectPathSource` and `LocalPathSource` as a literal type (these types never carry constraints). Update all existing code paths that construct these objects to include `constraint: null` so the existing behavior is preserved.

**Outcome**: All `ParsedSource` variants include a `constraint` field. All existing tests pass unchanged -- every existing `toEqual` assertion still matches because `constraint: null` is included in the expected objects.

**Do**:
- In `src/source-parser.ts`, add `constraint: string | null` to `GitHubShorthandSource`, `HttpsUrlSource`, and `SshUrlSource` interfaces
- In `src/source-parser.ts`, add `constraint: null` (literal `null`) to `DirectPathSource` and `LocalPathSource` interfaces
- In `parseGitHubShorthand()`, add `constraint: null` to the returned object
- In `parseHttpsUrl()`, add `constraint: null` to the returned object
- In `parseSshUrl()`, add `constraint: null` to the returned object
- In `parseDirectPath()`, add `constraint: null` to the returned object
- In `parseLocalPath()`, add `constraint: null` to the returned object
- In `buildParsedSourceFromKey()`, add `constraint: null` to both return paths (github-shorthand and https-url)
- Update all existing test expectations in `tests/source-parser.test.ts` to include `constraint: null` in their `toEqual` objects -- this ensures existing tests pass and documents the default

**Acceptance Criteria**:
- [ ] `ParsedSource` type includes `constraint` on every variant
- [ ] `constraint` is typed as `string | null` on remote sources that support `@` suffix (github-shorthand, https-url, ssh-url)
- [ ] `constraint` is typed as literal `null` on direct-path and local-path (these never have constraints)
- [ ] All existing source-parser tests pass after adding `constraint: null` to their expected objects
- [ ] All other existing tests pass unchanged (`pnpm test`)

**Tests**:
- `"parseSource('owner/repo') returns constraint: null"` -- existing test updated to include `constraint: null`
- `"parseSource('owner/repo@v2.0') returns constraint: null for exact ref"` -- existing test updated
- `"parseSource('https://github.com/owner/repo') returns constraint: null"` -- existing test updated
- `"parseSource('git@github.com:owner/repo.git') returns constraint: null"` -- existing test updated
- `"parseSource for tree URL returns constraint: null"` -- existing test updated
- `"parseSource for local path returns constraint: null"` -- existing test updated
- `"buildParsedSourceFromKey returns constraint: null"` -- existing test updated

**Edge Cases**:
- Existing tests must pass unchanged with `constraint: null` default -- no behavior change, only a type extension

**Context**:
> The spec states: "ParsedSource will gain an optional constraint field." For non-constrained inputs the field is null. The parser only classifies user input -- it does not resolve tags or derive constraints. The bare-add default behavior (auto-applying `^X.Y.Z`) is the add command's responsibility, not the parser's.

**Spec Reference**: `.workflows/version-constraints/specification/version-constraints/specification.md` -- "Parser Output" section

## vc-1-3 | approved

### Task vc-1-3: Detect and extract constraint from source parser

**Problem**: The source parser currently treats everything after `@` as a literal git ref. It has no concept of constraint prefixes (`^`, `~`). When a user types `owner/repo@^1.0`, the parser should recognize `^1.0` as a constraint expression (not a git ref) and populate `constraint` instead of `ref`.

**Solution**: Modify the ref-extraction logic in `parseGitHubShorthand()`, `parseHttpsUrl()`, and `parseSshUrl()` to detect constraint prefixes. When the extracted `@` suffix starts with `^` or `~`, populate `constraint` with the full expression and set `ref` to `null`. When it does not start with `^` or `~`, keep existing behavior (`ref` = the suffix, `constraint` = null).

**Outcome**: `parseSource("owner/repo@^1.0")` returns `{ constraint: "^1.0", ref: null, ... }`. `parseSource("owner/repo@v1.0")` still returns `{ constraint: null, ref: "v1.0", ... }`. All three remote source types (github-shorthand, https-url, ssh-url) support constraint detection.

**Do**:
- Create a helper function `isConstraintPrefix(suffix: string): boolean` that returns `true` if the suffix starts with `^` or `~`
- In `parseGitHubShorthand()`: after extracting the ref from the `@` split, check `isConstraintPrefix(ref)`. If true, return `{ constraint: ref, ref: null, ... }` instead of `{ constraint: null, ref: ref, ... }`
- In `parseHttpsUrl()` (which uses `extractRef()`): after calling `extractRef()`, check the returned ref. If it starts with `^` or `~`, set `constraint` to the ref value and `ref` to null
- In `parseSshUrl()`: same logic -- after extracting ref from the `.git@suffix` or `path@suffix` pattern, check the prefix and route to `constraint` or `ref` accordingly
- Ensure the constraint string is stored verbatim as the user typed it (e.g., `"^1.0"`, `"~1.2.3"`, `"^1"`) -- no normalization at this stage
- Do NOT validate the constraint expression here -- that is task vc-1-4

**Acceptance Criteria**:
- [ ] `parseSource("owner/repo@^1.0")` returns `{ type: "github-shorthand", constraint: "^1.0", ref: null, ... }`
- [ ] `parseSource("owner/repo@~1.2.3")` returns `{ type: "github-shorthand", constraint: "~1.2.3", ref: null, ... }`
- [ ] `parseSource("owner/repo@v1.0")` still returns `{ constraint: null, ref: "v1.0", ... }`
- [ ] `parseSource("owner/repo@main")` still returns `{ constraint: null, ref: "main", ... }`
- [ ] `parseSource("owner/repo")` still returns `{ constraint: null, ref: null, ... }`
- [ ] `parseSource("https://github.com/owner/repo@^1.0")` returns `{ constraint: "^1.0", ref: null, ... }`
- [ ] `parseSource("https://github.com/owner/repo.git@^1.0")` returns `{ constraint: "^1.0", ref: null, ... }`
- [ ] `parseSource("git@github.com:owner/repo.git@^1.0")` returns `{ constraint: "^1.0", ref: null, ... }`
- [ ] `parseSource("git@github.com:owner/repo@~1.2")` returns `{ constraint: "~1.2", ref: null, ... }`
- [ ] All pre-existing tests still pass

**Tests**:
- `"it extracts caret constraint from github shorthand"` -- `owner/repo@^1.2.3` -> constraint: `"^1.2.3"`, ref: null
- `"it extracts tilde constraint from github shorthand"` -- `owner/repo@~1.2.3` -> constraint: `"~1.2.3"`, ref: null
- `"it extracts partial caret constraint"` -- `owner/repo@^1` -> constraint: `"^1"`, ref: null
- `"it extracts partial tilde constraint"` -- `owner/repo@~1.2` -> constraint: `"~1.2"`, ref: null
- `"it preserves exact ref when no constraint prefix"` -- `owner/repo@v1.2.3` -> constraint: null, ref: `"v1.2.3"`
- `"it preserves branch ref when no constraint prefix"` -- `owner/repo@main` -> constraint: null, ref: `"main"`
- `"it extracts constraint from HTTPS URL"` -- `https://github.com/owner/repo@^1.0` -> constraint: `"^1.0"`, ref: null
- `"it extracts constraint from HTTPS URL with .git suffix"` -- `https://github.com/owner/repo.git@^2.0` -> constraint: `"^2.0"`, ref: null
- `"it extracts constraint from SSH URL with .git suffix"` -- `git@github.com:owner/repo.git@^1.0` -> constraint: `"^1.0"`, ref: null
- `"it extracts constraint from SSH URL without .git suffix"` -- `git@github.com:owner/repo@~1.2` -> constraint: `"~1.2"`, ref: null
- `"it handles empty constraint after caret (^) as empty ref error"` -- `owner/repo@^` -- note: this will be caught by validation in vc-1-4, but at this stage the raw string `"^"` is extracted as the constraint value
- `"it handles empty constraint after tilde (~) as empty ref error"` -- `owner/repo@~` -- same as above

**Edge Cases**:
- Partial versions (`^1`, `~1.2`): the parser stores these verbatim -- no zero-filling happens at parse time
- Constraint on SSH with `.git` suffix: `git@github.com:owner/repo.git@^1.0` -- the `.git` is part of the clone URL, `^1.0` is the constraint. The existing SSH parser already splits on `.git` then checks for `@` after it
- Constraint on HTTPS with `.git` suffix: `https://github.com/owner/repo.git@^1.0` -- the existing `extractRef()` splits on `@`, which appears after `.git`, so the constraint `^1.0` is correctly extracted
- Empty constraint after operator (`owner/repo@^` or `owner/repo@~`): at this task's scope, the string `"^"` or `"~"` is extracted as the constraint value. Validation (rejecting it) is task vc-1-4's responsibility

**Context**:
> The spec states: "Constraints are unambiguous -- no git ref starts with `^` or `~`. The source parser can distinguish constraints from literal refs by prefix." The parser output for `owner/repo@^1.0` should be `{ constraint: "^1.0", ref: null }`. The parser output for `owner/repo@v1.2.3` should be `{ constraint: null, ref: "v1.2.3" }`.

**Spec Reference**: `.workflows/version-constraints/specification/version-constraints/specification.md` -- "Parser Disambiguation" and "Parser Output" sections

## vc-1-4 | approved

### Task vc-1-4: Validate constraint expressions at parse time

**Problem**: After extracting a constraint from user input (task vc-1-3), the parser must verify the version portion is valid semver. Invalid inputs like `@^abc`, `@^`, `@~`, `@^1.2.3.4` should be rejected at parse time with a clear error message rather than propagating an invalid constraint downstream.

**Solution**: Add a validation step in `parseSource()` (or in each parse function after constraint extraction) that calls `semver.validRange()` on the constraint string. If `validRange()` returns `null`, throw an error with a descriptive message. This runs after constraint detection (vc-1-3) but before returning the parsed result. Valid partial versions like `^1` and `^1.2` will pass because `semver.validRange()` handles zero-filling internally.

**Outcome**: `parseSource("owner/repo@^abc")` throws. `parseSource("owner/repo@^1")` succeeds. `parseSource("owner/repo@^")` throws. All valid constraint forms pass through; all invalid forms are rejected at parse time.

**Do**:
- Import `validRange` from `semver` in `src/source-parser.ts`
- Create a function `validateConstraint(constraint: string): void` that calls `semver.validRange(constraint)` and throws if the result is `null`. Error message format: `"invalid version constraint: ${constraint}"`
- Call `validateConstraint()` in `parseGitHubShorthand()` when `constraint` is non-null (after the constraint detection logic from vc-1-3)
- Call `validateConstraint()` in `parseHttpsUrl()` when `constraint` is non-null
- Call `validateConstraint()` in `parseSshUrl()` when `constraint` is non-null
- Alternatively, call `validateConstraint()` once at the top of `parseSource()` after all parsing is complete, by checking `if (result.constraint !== null) validateConstraint(result.constraint)` -- this centralizes validation

**Acceptance Criteria**:
- [ ] `parseSource("owner/repo@^abc")` throws with message containing `"invalid version constraint"`
- [ ] `parseSource("owner/repo@^1.2.3.4")` throws with message containing `"invalid version constraint"`
- [ ] `parseSource("owner/repo@^")` throws with message containing `"invalid version constraint"`
- [ ] `parseSource("owner/repo@~")` throws with message containing `"invalid version constraint"`
- [ ] `parseSource("owner/repo@^1")` succeeds with `constraint: "^1"`
- [ ] `parseSource("owner/repo@^1.2")` succeeds with `constraint: "^1.2"`
- [ ] `parseSource("owner/repo@~1")` succeeds with `constraint: "~1"`
- [ ] `parseSource("owner/repo@~1.2.3")` succeeds with `constraint: "~1.2.3"`
- [ ] `parseSource("owner/repo@^0.2.3")` succeeds (pre-1.0 is valid semver)
- [ ] Validation applies to all three remote source types (github-shorthand, https-url, ssh-url)
- [ ] All existing tests pass

**Tests**:
- `"it rejects constraint with non-semver version (^abc)"` -- expects throw matching `"invalid version constraint"`
- `"it rejects constraint with too many segments (^1.2.3.4)"` -- expects throw
- `"it rejects bare caret operator (^)"` -- expects throw
- `"it rejects bare tilde operator (~)"` -- expects throw
- `"it accepts valid partial caret constraint (^1)"` -- succeeds, constraint: `"^1"`
- `"it accepts valid partial caret constraint (^1.2)"` -- succeeds, constraint: `"^1.2"`
- `"it accepts valid full caret constraint (^1.2.3)"` -- succeeds, constraint: `"^1.2.3"`
- `"it accepts valid partial tilde constraint (~1)"` -- succeeds, constraint: `"~1"`
- `"it accepts valid partial tilde constraint (~1.2)"` -- succeeds, constraint: `"~1.2"`
- `"it accepts valid full tilde constraint (~1.2.3)"` -- succeeds, constraint: `"~1.2.3"`
- `"it accepts pre-1.0 caret constraint (^0.2.3)"` -- succeeds, constraint: `"^0.2.3"`
- `"it rejects constraint on HTTPS URL with invalid version"` -- `https://github.com/owner/repo@^abc` throws
- `"it rejects constraint on SSH URL with invalid version"` -- `git@github.com:owner/repo.git@^abc` throws

**Edge Cases**:
- Invalid semver after operator (`^abc`, `^1.2.3.4`): `semver.validRange()` returns `null` for these, triggering the error
- Valid partial versions (`^1`, `^1.2`): `semver.validRange("^1")` returns a valid range string, so these pass
- Tilde variants (`~1`, `~1.2.3`): all valid, `validRange()` handles them
- Bare operator (`^`, `~`): `semver.validRange("^")` returns `null`, correctly rejected

**Context**:
> The spec states: "The parser will validate the constraint expression after extracting it. If the version portion is not valid semver (as determined by `semver.validRange()`), reject at parse time with a clear error message. Examples of invalid input: `@^abc`, `@^`, `@~`, `@^1.2.3.4`."

**Spec Reference**: `.workflows/version-constraints/specification/version-constraints/specification.md` -- "Constraint Validation" section

## vc-1-5 | approved

### Task vc-1-5: Reject constraints on local-path and direct-path sources

**Problem**: Constraints (`^`, `~`) only make sense for remote sources where tags can be resolved via `ls-remote`. Local paths have no remote tags to resolve against, and tree URLs (direct-path) are already pinned to a specific commit/ref. The parser must reject constraint syntax on these source types with a clear error.

**Solution**: Add validation in the local-path and direct-path code paths to detect and reject constraint-like syntax. For local paths, the `@` character is not used (local paths are filesystem paths), but a user might try `./local@^1.0` which would be detected as a local path due to the `./` prefix. For direct-path (tree URLs), the existing code already rejects `@` in the path portion after the hostname -- but we should ensure the error message is clear when the `@` content looks like a constraint.

**Outcome**: `parseSource("./local-plugin@^1.0")` is handled correctly (the `@^1.0` is part of the filesystem path, not a constraint). Tree URLs with constraint-like `@` suffixes in the path continue to be rejected by the existing "tree URLs cannot have @ref suffix" error. No new error paths needed for direct-path since the existing check covers it.

**Do**:
- Review `parseLocalPath()` in `src/source-parser.ts`: local path detection happens via `isLocalPath()` which checks for `./`, `../`, `/`, `~` prefixes. When a path like `./my-plugin@^1.0` is passed, `isLocalPath()` returns true and the entire string (including `@^1.0`) is treated as a filesystem path. The `@` is NOT split -- it's part of the path. This means `stat()` will be called on the full path including `@^1.0`, and if it doesn't exist, the error "does not exist or is not a directory" is thrown. This is the correct behavior -- no code change needed for local paths
- Review `parseDirectPath()` in `src/source-parser.ts`: the existing check `if (rawPath.includes("@"))` already rejects tree URLs with any `@` in the path portion. The error message "tree URLs cannot have @ref suffix" is already thrown. This covers `https://github.com/owner/repo/tree/main/plugin@^1.0`. No code change needed
- Add tests to document these behaviors explicitly
- Ensure `DirectPathSource` type still has `constraint: null` (literal type from vc-1-2), making it a compile-time guarantee that direct-path sources never carry constraints
- Ensure `LocalPathSource` type still has `constraint: null` (literal type from vc-1-2), same compile-time guarantee

**Acceptance Criteria**:
- [ ] `parseSource("./my-plugin@^1.0")` throws a filesystem error (path does not exist) -- the `@^1.0` is part of the path, not parsed as a constraint
- [ ] `parseSource("https://github.com/owner/repo/tree/main/plugin@^1.0")` throws "tree URLs cannot have @ref suffix"
- [ ] `LocalPathSource.constraint` is typed as literal `null` (compile-time guarantee)
- [ ] `DirectPathSource.constraint` is typed as literal `null` (compile-time guarantee)
- [ ] All existing tests pass

**Tests**:
- `"it treats @^ in local path as part of filesystem path, not constraint"` -- `./my-plugin@^1.0` throws filesystem error (not a constraint error). Create a temp dir, verify the error is about path not existing
- `"it rejects tree URL with constraint-like suffix in path"` -- `https://github.com/owner/repo/tree/main/plugin@^1.0` throws "tree URLs cannot have @ref suffix"
- `"it rejects tree URL with tilde constraint-like suffix"` -- `https://github.com/owner/repo/tree/main/plugin@~1.0` throws same error
- `"local path with tilde prefix is filesystem tilde expansion, not constraint"` -- `~/my-plugin` is treated as a local path with home directory expansion, not a constraint. The `~` prefix triggers `isLocalPath()`, not constraint detection

**Edge Cases**:
- Local path with `@^` prefix looks like local path not constraint: `./my-plugin@^1.0` -- the `./` prefix triggers local path detection before any `@` splitting. The entire string is a filesystem path. If a directory literally named `my-plugin@^1.0` exists, it would be installed as a local path
- Tree URL with constraint in path portion: `https://github.com/owner/repo/tree/main/plugin@^1.0` -- the existing rawPath `@` check catches this. The error message already says "tree URLs cannot have @ref suffix" which is accurate enough

**Context**:
> The spec states: "Constraints are not supported on: Local paths -- no remote tags to resolve against. Tree URLs (direct path to a specific commit) -- already pinned to a specific ref." The parser's existing structure already handles these cases correctly due to the order of detection (local paths checked first, tree URLs reject `@` in path portion). This task is primarily about documenting and testing the existing behavior.

**Spec Reference**: `.workflows/version-constraints/specification/version-constraints/specification.md` -- "Source Type Support" section

## vc-1-6 | approved

### Task vc-1-6: Tag normalization pipeline

**Problem**: Git tags come in varied formats (`v1.2.3`, `1.2.3`, `release-1.0`, `latest`, tags with whitespace). The version resolver needs a clean pipeline that: (1) filters to semver-valid tags only, (2) normalizes format differences (`v1.2.3` -> `1.2.3`), (3) maps cleaned versions back to original tag names for use as git refs, and (4) handles duplicates where both `v1.2.3` and `1.2.3` exist.

**Solution**: Create a new module `src/version-resolve.ts` with a `normalizeTags()` function that implements the tag normalization pipeline described in the spec. The function takes an array of raw tag strings (as returned from `git ls-remote --tags`) and returns a `NormalizedTag[]` array where each entry pairs the original tag name with its cleaned semver version. This array is the input for `resolveVersion()` and `resolveLatestVersion()` in the next task.

**Outcome**: `normalizeTags(["v1.2.3", "1.0.0", "release-candidate", "latest"])` returns `[{ original: "v1.2.3", cleaned: "1.2.3" }, { original: "1.0.0", cleaned: "1.0.0" }]`. Non-semver tags are excluded. Duplicate versions prefer the `v`-prefixed form.

**Do**:
- Create `src/version-resolve.ts`
- Import `clean` from `semver`
- Define `export interface NormalizedTag { original: string; cleaned: string }` in `src/version-resolve.ts`
- Implement `normalizeTags(tags: string[]): NormalizedTag[]` with this algorithm:
  1. Create an empty `Map<string, NormalizedTag>` (cleaned version -> NormalizedTag) as an intermediate deduplication structure
  2. For each tag in the input array:
     a. Call `semver.clean(tag)` -- this strips `v` prefix and whitespace (e.g., `v1.2.3` -> `"1.2.3"`, `" v1.2.3 "` -> `"1.2.3"`)
     b. If `clean()` returns `null`, skip this tag (not valid semver)
     c. If the cleaned version is already in the map, apply the preference rule: prefer `v`-prefixed tags over non-prefixed. Specifically, if the new tag starts with `v` and the existing mapped tag does not, overwrite with `{ original: tag, cleaned }`. Otherwise, keep the existing entry
     d. If the cleaned version is not in the map, add `{ original: tag, cleaned }`
  3. Return `Array.from(map.values())`
- Export `normalizeTags` and `NormalizedTag` for use in the resolver (task vc-1-7) and for direct testing
- Create `tests/version-resolve.test.ts` for unit tests

**Acceptance Criteria**:
- [ ] `normalizeTags(["v1.2.3"])` returns `[{ original: "v1.2.3", cleaned: "1.2.3" }]`
- [ ] `normalizeTags(["1.0.0"])` returns `[{ original: "1.0.0", cleaned: "1.0.0" }]`
- [ ] `normalizeTags(["v1.2.3", "1.2.3"])` returns one entry with `original: "v1.2.3"` (v-prefix preferred)
- [ ] `normalizeTags(["1.2.3", "v1.2.3"])` returns one entry with `original: "v1.2.3"` (v-prefix preferred regardless of order)
- [ ] `normalizeTags(["release-candidate", "latest", "nope"])` returns empty array
- [ ] `normalizeTags([])` returns empty array
- [ ] `normalizeTags(["v1.0.0", "v2.0.0", "latest"])` returns 2 entries (semver tags only)
- [ ] Non-semver tags like `release-candidate`, `latest`, `nope` are excluded
- [ ] Tags with extra whitespace are cleaned (e.g., `" v1.2.3 "` -> cleaned: `"1.2.3"`)

**Tests**:
- `"it normalizes v-prefixed tag to clean semver"` -- `["v1.2.3"]` -> `[{ original: "v1.2.3", cleaned: "1.2.3" }]`
- `"it keeps bare semver tag as-is"` -- `["1.0.0"]` -> `[{ original: "1.0.0", cleaned: "1.0.0" }]`
- `"it prefers v-prefixed tag when duplicate versions exist"` -- `["v1.2.3", "1.2.3"]` -> one entry with original `"v1.2.3"`
- `"it prefers v-prefixed tag regardless of input order"` -- `["1.2.3", "v1.2.3"]` -> one entry with original `"v1.2.3"`
- `"it excludes non-semver tags"` -- `["release-candidate", "latest", "nope"]` -> empty array
- `"it handles empty tag list"` -- `[]` -> empty array
- `"it filters mixed semver and non-semver tags"` -- `["v1.0.0", "v2.0.0", "latest", "release-candidate"]` -> 2 entries only
- `"it handles no semver tags at all"` -- `["alpha", "beta", "rc1"]` -> empty array
- `"it strips whitespace from tags via clean()"` -- `[" v1.2.3 ", " 1.0.0 "]` -> entries with cleaned `"1.2.3"` and `"1.0.0"`
- `"it handles pre-release tags"` -- `["v1.0.0-beta.1", "v1.0.0"]` -> both valid semver, both appear as entries with their own cleaned versions

**Edge Cases**:
- Duplicate versions (`v1.2.3` and `1.2.3` both exist): prefer the `v`-prefixed form as the original tag name, since it's the dominant tagging convention
- No semver tags at all: returns empty array -- caller must handle this case
- Tags with extra whitespace: `semver.clean()` strips leading/trailing whitespace as part of its normalization
- Non-semver tags mixed in (`release-candidate`, `latest`): `semver.clean()` returns `null` for these, so they are naturally excluded

**Context**:
> The spec defines the Tag Normalization Pipeline: "1. Collect all tag names from ls-remote. 2. For each tag, attempt semver.clean(tag). 3. Discard tags where clean() returns null. 4. Pass cleaned versions to semver.maxSatisfying(). 5. Map the matched clean version back to the original tag name. 6. Store the original tag name in ref." Also: "If multiple tags clean to the same semver version, prefer the v-prefixed form." And: "semver.coerce() will not be used -- it's too aggressive."

**Spec Reference**: `.workflows/version-constraints/specification/version-constraints/specification.md` -- "Tag Normalization Pipeline" section

## vc-1-7 | approved

### Task vc-1-7: Version resolver with constraint matching

**Problem**: Given a constraint expression (e.g., `^1.0`) and a list of remote tags, we need to find the best matching tag. This is the core resolution logic that connects tag normalization (vc-1-6) to the actual version selection. The resolver must handle cases where no tags match, where pre-1.0 caret semantics apply, and where partial constraints must match against full version tags.

**Solution**: Add a `resolveVersion()` function to `src/version-resolve.ts` that takes pre-normalized tags (from `normalizeTags()`) and a constraint string, calls `semver.maxSatisfying()` with the cleaned versions and constraint, and maps the result back to the original tag name. Callers normalize once and pass the result to both `resolveVersion` and `resolveLatestVersion`. Return a structured result indicating success or failure (no match).

**Outcome**: `resolveVersion(normalizeTags(["v1.0.0", "v1.1.0", "v2.0.0"]), "^1.0")` returns `{ original: "v1.1.0", cleaned: "1.1.0" }`. `resolveVersion(normalizeTags(["v1.0.0", "v2.0.0"]), "^3.0")` returns `null` (no match). Pre-1.0 caret semantics work correctly via `semver.maxSatisfying()`.

**Do**:
- In `src/version-resolve.ts`, define a result type: `interface ResolvedVersion { original: string; cleaned: string }` where `original` is the original git tag name (for use as a ref in clone) and `cleaned` is the cleaned semver string
- Implement `resolveVersion(normalizedTags: NormalizedTag[], constraint: string): ResolvedVersion | null` with this algorithm:
  1. Extract the cleaned versions as an array: `normalizedTags.map(t => t.cleaned)`
  2. Call `semver.maxSatisfying(cleanedVersions, constraint)` -- this returns the highest version that satisfies the constraint, or `null`
  3. If `maxSatisfying` returns `null`, return `null` (no match)
  4. Find the normalized tag whose `cleaned` matches the result
  5. Return `{ original: tag.original, cleaned: matchedVersion }`
- Also implement `resolveLatestVersion(normalizedTags: NormalizedTag[]): ResolvedVersion | null` for the bare-add case (Phase 2 will use it, but it belongs in this module):
  1. Call `semver.maxSatisfying(normalizedTags.map(t => t.cleaned), "*")` -- `*` matches all stable versions, excluding pre-release
  2. If null, return null
  3. Find the normalized tag whose `cleaned` matches and return `{ original, cleaned }`
- Export both functions and the `ResolvedVersion` and `NormalizedTag` types
- Add tests to `tests/version-resolve.test.ts`

**Acceptance Criteria**:
- [ ] `resolveVersion(normalizeTags(["v1.0.0", "v1.1.0", "v2.0.0"]), "^1.0")` returns `{ original: "v1.1.0", cleaned: "1.1.0" }`
- [ ] `resolveVersion(normalizeTags(["v1.0.0", "v1.0.5", "v1.1.0"]), "~1.0.0")` returns `{ original: "v1.0.5", cleaned: "1.0.5" }`
- [ ] `resolveVersion(normalizeTags(["v1.0.0", "v2.0.0"]), "^3.0")` returns `null`
- [ ] `resolveVersion(normalizeTags(["v0.2.3", "v0.2.5", "v0.3.0"]), "^0.2.3")` returns `{ original: "v0.2.5", cleaned: "0.2.5" }` (pre-1.0 caret)
- [ ] `resolveVersion(normalizeTags(["v0.0.3", "v0.0.4", "v0.1.0"]), "^0.0.3")` returns `{ original: "v0.0.3", cleaned: "0.0.3" }` (pre-1.0 caret patch-bounded)
- [ ] `resolveVersion(normalizeTags(["v1.0.0", "v1.5.0", "v2.0.0"]), "^1")` returns `{ original: "v1.5.0", cleaned: "1.5.0" }` (partial constraint)
- [ ] `resolveLatestVersion(normalizeTags(["v1.0.0", "v2.0.0", "v2.0.0-beta.1"]))` returns `{ original: "v2.0.0", cleaned: "2.0.0" }` (pre-release excluded)
- [ ] `resolveLatestVersion(normalizeTags(["alpha", "beta"]))` returns `null` (no semver tags -- normalizeTags returns empty)
- [ ] Pre-release tags are excluded by `maxSatisfying` for non-pre-release constraints
- [ ] The returned `original` is the original git ref name (e.g., `"v1.1.0"`, not `"1.1.0"`)

**Tests**:
- `"it resolves highest version within caret constraint"` -- `^1.0` against `[v1.0.0, v1.1.0, v2.0.0]` -> `v1.1.0`
- `"it resolves highest version within tilde constraint"` -- `~1.0.0` against `[v1.0.0, v1.0.5, v1.1.0]` -> `v1.0.5`
- `"it returns null when no tags satisfy constraint"` -- `^3.0` against `[v1.0.0, v2.0.0]` -> null
- `"it excludes pre-release tags from matching"` -- `^1.0` against `[v1.0.0, v2.0.0-beta.1]` -> `v1.0.0` (beta excluded)
- `"it handles pre-1.0 caret semantics (^0.2.3 is minor-bounded)"` -- `^0.2.3` against `[v0.2.3, v0.2.5, v0.3.0]` -> `v0.2.5`
- `"it handles pre-1.0 caret semantics (^0.0.3 is patch-bounded)"` -- `^0.0.3` against `[v0.0.3, v0.0.4, v0.1.0]` -> `v0.0.3`
- `"it resolves partial constraint (^1) against full version tags"` -- `^1` against `[v1.0.0, v1.5.0, v2.0.0]` -> `v1.5.0`
- `"it resolves partial constraint (~1.2) against full tags"` -- `~1.2` against `[v1.2.0, v1.2.5, v1.3.0]` -> `v1.2.5`
- `"it returns original v-prefixed tag name, not cleaned version"` -- verify `original` field is `"v1.1.0"` not `"1.1.0"`
- `"it returns null for empty tag list"` -- `^1.0` against `[]` -> null
- `"resolveLatestVersion finds highest stable version"` -- `[v1.0.0, v2.0.0, v3.0.0-rc.1]` -> `{ original: "v2.0.0", cleaned: "2.0.0" }`
- `"resolveLatestVersion returns null when no semver tags exist"` -- `["alpha", "latest"]` -> null
- `"resolveLatestVersion excludes pre-release from latest"` -- `[v1.0.0-beta.1]` -> null (only pre-release, no stable)
- `"it handles mixed v-prefixed and bare tags"` -- `^1.0` against `["v1.0.0", "1.1.0"]` -> returns the matched tag (whichever `normalizeTags` mapped)

**Edge Cases**:
- No tags satisfy constraint: returns `null` -- caller reports error to user
- Pre-release tags excluded by `maxSatisfying`: `semver.maxSatisfying(versions, "^1.0")` does not match pre-release versions unless the constraint itself includes a pre-release identifier. This is default semver behavior
- Pre-1.0 caret semantics (`^0.2.3`): `semver.maxSatisfying` handles this automatically -- `^0.2.3` means `>=0.2.3 <0.3.0`
- Partial constraint (`^1`) against full tags: `semver.maxSatisfying` handles `^1` as `^1.0.0` which means `>=1.0.0 <2.0.0`
- Empty tag list: `normalizeTags([])` returns empty array, `maxSatisfying([], constraint)` returns `null`

**Context**:
> The spec's Resolution Algorithm: "1. Fetch all refs via ls-remote. 2. Filter to semver-valid tags using semver.valid(). 3. Use semver.clean() for normalizing tag formats. 4. Pass filtered tags and the constraint to semver.maxSatisfying(tags, constraint) to select the best match." And: "semver.maxSatisfying handles all pre-1.0 special casing (^0.x, ^0.0.x) automatically -- no custom logic needed." The "No Match" section: "If maxSatisfying returns null, report this to the user."

**Spec Reference**: `.workflows/version-constraints/specification/version-constraints/specification.md` -- "Resolution Algorithm", "Tag Normalization Pipeline", "No Match", and "Pre-1.0 Handling" sections
