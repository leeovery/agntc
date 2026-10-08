# Review Tracking: Vercel Skills Compatibility - Claims Verification

## Findings

### 1. Vercel checks direct-download links before git sources

**Source**: Tree measurement — `vercel-labs/skills@v1.7.0 src/source-parser.ts:323–349, :398, :432, :455, :500`
**Category**: Source defect
**Move**: route
**Affects**: 2.2 Reading an https URL

**Problem**:
The specification says agntc reads an https URL "in Vercel's order", and lists git sources first, then direct-download links, then website sources. Vercel checks in a different order: hosted-artifact links come first, before any GitHub or GitLab matching. The order matters because every GitHub direct-download link is also a GitHub URL. Under git-first reading, the following are all cloned as `owner/repo` instead of refused:
- `github.com/<o>/<r>/raw/…/SKILL.md`;
- `…/archive/…`;
- `…/releases/download/…`;
- `codeload.github.com/<o>/<r>/…`.

So a user who pastes a raw `SKILL.md` link or a release-asset link gets the whole repository's menu. Under `-y` they get every skill in that repository installed. The intended result is a refusal that names direct links as unsupported. Vercel's download class also covers gitlab.com `/-/archive/` and `/-/raw/` paths. Under git-first reading those are sent to clone as gitlab.com repositories with a garbage path, and fail as a clone error rather than being refused by shape.

**Evidence**:
Spec: "An http(s) URL is read in Vercel's order: 1. **Git source.** Any of these is cloned: GitHub, including the `GH_HOST` host; gitlab.com; … 2. **Direct-download link, refused (§1.5).** These are GitHub's hosted-artifact links: raw.githubusercontent.com; codeload.github.com; objects.githubusercontent.com; github.com paths under `/archive/`, `/raw/`, `/releases/download/` and `/releases/latest/download/`. 3. **Website source, refused (§1.3).**"

`gh api "repos/vercel-labs/skills/contents/src/source-parser.ts?ref=v1.7.0" -H "Accept: application/vnd.github.raw"`:
- `:398` `if (isHostedArtifactUrl(input)) { return { type: 'download', url: input }; }` runs before the GitHub tree and repo matches at `:432` (`githubTreeWithPathMatch`) and `:455` (`githubRepoMatch = input.match(/github\.com\/([^/]+)\/([^/]+)/)`), and before gitlab.com at `:500`.
- `:323–349` `isHostedArtifactUrl` covers:
  - hosts `raw.githubusercontent.com`, `codeload.github.com` and `objects.githubusercontent.com`;
  - github.com `/^\/[^/]+\/[^/]+\/(?:archive\/|raw\/|releases\/(?:download\/|latest\/download\/))/`;
  - `if (host === 'gitlab.com') { return /\/-\/(?:archive|raw)\//.test(parsed.pathname); }`.

Checked the download links against Vercel's own git patterns with `node -e` (pure regex test):
```
https://github.com/o/r/archive/refs/heads/main.zip  | matches GitHub-repo pattern: true
https://github.com/o/r/raw/main/skills/x/SKILL.md   | matches GitHub-repo pattern: true
https://github.com/o/r/releases/download/v1/s.zip   | matches GitHub-repo pattern: true
https://codeload.github.com/o/r/zip/refs/heads/main | matches GitHub-repo pattern: true
https://gitlab.com/g/r/-/archive/main/r-main.zip    | matches gitlab.com pattern: true
```

Source carries it: discussion, "Website vs Git URLs", Decision (lines 180–186). It reads "**Adopt Vercel's reading of https URLs**, in Vercel's order: 1. Git sources … 2. Direct-download links … GitHub's hosted-artifact links … 3. Website sources". The amendment note there says the order was "corrected to Vercel's parse order", but git still comes first.

**Proposed Text**:

**Resolution**: Routed
**Notes**: Measured correction landed in the discussion, "Website vs Git URLs" Decision (order repaired in place, amendment note); §2.2 re-aligned.

---

### 2. Vercel's five-level fallback walk does descend into skills it has found

**Source**: Tree measurement — `vercel-labs/skills@v1.7.0 src/skills.ts:135–157, :296, :311–326`
**Category**: Source defect
**Move**: route
**Affects**: 5.2 Discovery walk; 9.1 The flag set (`--full-depth`)

**Problem**:
The specification makes two parity claims about discovery:
- agntc finds members wherever Vercel's discovery finds skills, at the same depth;
- the five-level recursive walk (on an empty result or under `--full-depth`) is "Vercel's fallback".

It also says every walk stops at a member it has found. Vercel's fallback walk does not stop. It records a folder holding `SKILL.md` and keeps going into that folder's subfolders, listing any nested `SKILL.md` folder as a separate skill. Only Vercel's container walks stop below a found skill. `--full-depth` exists for exactly this case: "Search all subdirectories even when a root SKILL.md exists".

The user-facing effect appears when a skill sits inside another skill's folder:
- A Vercel line using `--full-depth` lists and installs the nested skill. A repository where only the fallback walk finds anything does the same.
- Under agntc the nested skill is never offered. It is copied inside its parent, and a pasted `--skill <nested>` is refused as matching nothing.

None of this is marked as a divergence, because the source records Vercel's walks as "never below a found skill" throughout.

**Evidence**:
Spec: "agntc discovers members where Vercel's discovery finds skills (v1.7.0 `discoverSkills`, `src/skills.ts`), and as deep." / "When those roots find nothing, or when `--full-depth` is given, the whole source is walked recursively, five levels deep. That is Vercel's fallback." / "Every walk follows these rules: It never descends into a member it has found (§5.3)."

`gh api "repos/vercel-labs/skills/contents/src/skills.ts?ref=v1.7.0" -H "Accept: application/vnd.github.raw"`:
- `:135` `async function findSkillDirs(dir: string, depth = 0, maxDepth = 5)`.
- `:144` `const currentDir = hasSkill ? [dir] : [];` is followed by recursion into every non-`SKIP_DIRS` subdirectory whether or not `hasSkill` is set. It ends at `:153` `return [...currentDir, ...subDirResults.flat()];`.
- `:311–326`: `if (skills.length === 0 || options?.fullDepth) { const allSkillDirs = await findSkillDirs(searchPath); for (const skillDir of allSkillDirs) { … skills.push(skill) … } }`. Every collected folder, nested or not, is added.
- By contrast, the container walk at `:296` stops below a found skill: `if (foundAtChild || depth >= maxDepth || SKIP_DIRS.includes(entry.name)) continue;`.

Source carries it: discussion, "Container Depth and Discovery Roots":
- line 355 lists Vercel's discovery as "… walked 1 level — never below a found skill, skipping `node_modules`/… ; when that finds nothing, or with `--full-depth`, a full recursive walk 5 levels deep";
- line 363 decides "**agntc discovers skills where and as deep as Vercel does:** … — never below a found skill, …; and when that finds nothing, Vercel's full recursive walk five levels deep."

**Proposed Text**:

**Resolution**: Routed
**Notes**: Measured correction landed in the discussion as a dated revision of "Container Depth and Discovery Roots" (and the Units Among Discovered Skills wording); §5.2 re-aligned.

---

### 3. Refusing `--plugin` on a single skill is not today's behaviour for most root-`SKILL.md` shapes

**Source**: Tree measurement — `src/type-detection.ts:84–115, :138–167`
**Category**: Enhancement to existing topic
**Move**: settled
**Affects**: 6.6 What `--plugin` refuses

**Problem**:
The specification says `--plugin` on a single skill is refused "as today", which tells the reader that nothing changes for users. In fact today agntc refuses only a root `SKILL.md` that has nothing beside it. It accepts three other shapes:
- **A root `SKILL.md` beside `skills/` alone:** `agntc add owner/repo --plugin` bundles the repository today, leaving the `SKILL.md` out.
- **A root `SKILL.md` beside `agents/` or `hooks/`:** it installs as a plugin and the flag changes nothing.
- **A `skills/`-only repository:** it bundles whatever the inner folders hold.

Under the specification's shape rules, the first two now read as single skills and are refused. Users who bundle such repositories today will find the same line exits non-zero after the change, and the specification gives them no warning.

There is a knock-on for existing installs. A bundle already made from a root-`SKILL.md`-plus-`skills/` repository is recorded as a plugin. The update repair does not touch it, because the repair requires no `skills/` folder. The printed re-add advice carries `--plugin` for every plugin entry, so for these bundles it would print a command that agntc then refuses. The printed-commands rule's "never misfires" reasoning does not account for this case.

**Proposal**:
The staged text corrected the "as today" wording but left the knock-on open, and that knock-on is a printed command agntc refuses. Two parts:

1. **Except the one legacy shape: `--plugin` on a root `SKILL.md` beside `skills/` alone keeps bundling the skills under `skills/`, leaving the root `SKILL.md` out, as today.** This is the session's call; the record never decided it. What leaned:
   - Without the flag, the root reads as a single skill (Vercel's early-out). The flag is the installer's explicit request for the bundle, the same role it plays in the skills-only case.
   - Vercel has no `--plugin`, so keeping the bundle costs no parity.
   - Existing lines keep working, and so do the bundles already made from this shape.

   The alternatives that also fit:
   - Refuse, as the configless rule for a bare skill reads. That breaks today's line, and it breaks the printed re-add for those bundles.
   - Refuse, and print a path-form re-add (`owner/repo/skills --plugin`). That re-adds under a different key and meets the existing bundle as a clash.
2. **A recorded plugin that the update repair turns into a skill (§5.5) prints as a skill, with no `--plugin`.** Its source now reads as a single skill, which `--plugin` refuses, and the skill form is the install the repair produces. The printed-commands rule (§14.1) and the repair together determine this.

**Evidence**:
Spec: "**`--plugin` on a single skill (a root `SKILL.md`), or on a source whose members include a plugin member, is refused (§1.5)**, as today (`TypeConflictError` in `detectType`, `src/type-detection.ts`)."

`src/type-detection.ts`:
- `:145–146` `const skillsOnly = foundAssetDirs.length === 1 && foundAssetDirs[0] === "skills";`
- `:149–156` `if (foundAssetDirs.length > 0 && !skillsOnly) { if (hasSkillMd) { onWarn?.("SKILL.md found alongside asset dirs — treating as plugin, SKILL.md will be ignored"); } return { kind: "plugin", assetDirs: foundAssetDirs }; }`. A root `SKILL.md` beside `agents/` or `hooks/` is a plugin.
- `:161–163` `if (skillsOnly) { return { kind: "skills-only", members: await scanSkillsOnlyMembers(dir) }; }`. This runs before the `SKILL.md` check, so a root `SKILL.md` beside `skills/` alone is skills-only.
- `:165–167` `if (hasSkillMd) { return { kind: "bare-skill" }; }`. Only reached with no asset folder present.
- `:85–87` `case "plugin": return { type: "plugin", assetDirs: structure.assetDirs };`. The override is ignored, with no error.
- `:88–93` `case "bare-skill": if (wantsPlugin) { throw new TypeConflictError("the source is a bare skill — cannot bundle"); }`. This is the only single-skill refusal.
- `:95–104` `case "skills-only": return wantsPlugin ? { type: "plugin", assetDirs: ["skills"] } : …`. This bundles regardless of the members it holds.
- `src/manifest.ts:18` `type?: "skill" | "plugin";`. A bundle is recorded as `plugin`.

**Current**:
- **`--plugin` on a single skill (a root `SKILL.md`), or on a source whose members include a plugin member, is refused (§1.5)**, as today (`TypeConflictError` in `detectType`, `src/type-detection.ts`).

**Proposed Text**:
(§6.6, replacing the Current bullet)
- **`--plugin` on a single skill (a root `SKILL.md`), or on a source whose members include a plugin member, is refused (§1.5).**
  - **One shape is excepted:** `--plugin` on a root `SKILL.md` beside `skills/` alone bundles the skills under `skills/` and leaves the root `SKILL.md` out, as it does today. Without the flag that root reads as a single skill (§5.1). The flag is the installer's explicit request for the bundle, so lines written today and the bundles already made from that shape keep working.
  - **What `detectType` does today** (`src/type-detection.ts`):
    - it refuses a single skill (`TypeConflictError`) only when its root `SKILL.md` has no `skills/`, `agents/` or `hooks/` beside it;
    - it bundles a root `SKILL.md` beside `skills/` alone;
    - it installs a root `SKILL.md` beside `agents/` or `hooks/` as a plugin, and the flag changes nothing;
    - it bundles a `skills/`-only source whatever its inner folders hold, plugin members included.
  - **Two cases change and are now refused:** `--plugin` on a root `SKILL.md` beside `agents/` or `hooks/` that declares no `"type": "plugin"`, and `--plugin` on a `skills/`-only source that holds a plugin member.

(§14.1, appended after its closing paragraph)
A recorded plugin that the update repair turns into a skill (§5.5) prints as a skill, with no `--plugin`. Its source now reads as a single skill, which `--plugin` refuses (§6.6).

**Resolution**: Routed
**Notes**: The --plugin exception for a root SKILL.md beside skills/ alone landed in the discussion as a new section, "`--plugin` on a Root Skill Beside `skills/`"; §6.6 and §14.1 re-aligned to it. The configless-install --plugin scope rule owes a correction for the excepted shape.

---

### 4. Vercel's `remove` and `update` exit 0 on a name that matches nothing

**Source**: Tree measurement — `vercel-labs/skills@v1.7.0 src/remove.ts:183–188, src/update.ts:1025–1036, src/cli.ts:419, src/add.ts:1516–1522`
**Category**: Enhancement to existing topic
**Move**: settled
**Affects**: 7.2 A name that matches nothing

**Problem**:
After saying that a name matching nothing is refused on `add`, `remove` and `update`, the specification says "Vercel behaves the same way", meaning an error plus the available list and exit 1. That is true only for `add`:
- Vercel's `remove` prints the error with no list and exits 0.
- Vercel's `update` prints "No installed skills found matching: X" and exits 0.

On `remove` and `update`, agntc's refusal is therefore a divergence from Vercel. The specification presents it as parity and does not mark it, although its own rule says every divergence is marked and names what it guards. A user who swaps the binary in a cleanup script (`npx skills remove old-skill -y` under `set -e`) has relied on exit 0 for an already-removed skill. Under agntc that script stops with exit 1.

**Proposal**:
Limit the parity sentence to `add`. State Vercel's measured `remove` and `update` behaviour, and mark agntc's refusal there as a divergence under never-silently-ignore. The specification's own refusal rule already gives the reason: an exit 0 reads as success to an agent caller.

**Evidence**:
Spec: "A name that matches nothing is refused (§1.5). The message names the unmatched name and lists the alternatives: on `add`, the skills the source offers; on `remove` and `update`, the installs. Vercel behaves the same way ("No matching skills found for: X" plus the available list, exit 1)."

`gh api "repos/vercel-labs/skills/contents/<file>?ref=v1.7.0" -H "Accept: application/vnd.github.raw"`:
- `src/add.ts:1516–1522`: `p.log.error(\`No matching skills found for: …\`); p.log.info('Available skills:'); … emitJsonAndExit(1, …)`. On `add` the claim holds.
- `src/remove.ts:183–188`: `if (selectedSkills.length === 0) { p.log.error(\`No matching skills found for: ${skillNames.join(', ')}\`); return; }`. There is no list and no exit code set.
- `src/update.ts:1025–1026`: `if (options.skills && totalFound === 0) { console.log(\`${DIM}No installed skills found matching: …\`); }`. `process.exitCode = 1` is set only at `:1033–1035`, when `totalFail > 0`.
- `src/cli.ts:419`: `main().finally(() => flushTelemetry().then(() => process.exit(process.exitCode ?? 0)));`. Both commands therefore exit 0.

The source does not carry the remove/update parity. Discussion, "At-Suffix Meaning", line 524, cites Vercel's no-match behaviour only for a `--skill` or `@` name on `add`.

**Current**:
Vercel behaves the same way ("No matching skills found for: X" plus the available list, exit 1). The version-shaped `@` refusal (§2.3) is a special case of this one, with its pointer to `#`.

**Proposed Text**:
On `add`, Vercel behaves the same way ("No matching skills found for: X" plus the available list, exit 1). On `remove` and `update` it does not refuse: `remove` prints "No matching skills found for: X" with no list, `update` prints "No installed skills found matching: X", and both exit 0. **On `remove` and `update` this diverges from Vercel, under never-silently-ignore (§1.5):** an exit 0 reads as success to an agent caller, which acts on the exit status rather than the text. The version-shaped `@` refusal (§2.3) is a special case of this one, with its pointer to `#`.

**Resolution**: Approved
**Notes**: 

---

### 5. Vercel's `--json` entries carry more fields than the specification lists

**Source**: Tree measurement — `vercel-labs/skills@v1.7.0 src/add.ts:583–602, :1160–1166, :1503–1512, :2176–2197`
**Category**: Enhancement to existing topic
**Move**: settled
**Affects**: 9.2 `--json`

**Problem**:
The specification says `--json` follows Vercel's contract and lists "Vercel's fields" from Vercel's own `AddJsonResult` type. The list is incomplete:
- Vercel's installed entries also carry `hash` (the skill folder's content hash) and `security`.
- Skipped entries carry `reason`.
- Failed entries carry `error`.

An implementer who follows the list emits none of these, so a script or AI agent built against Vercel's output breaks after the binary swap:
- reading `hash` to detect content changes gets nothing;
- reading `reason` to learn why an entry was skipped gets nothing.

`reason` matters more under agntc, because agntc adds its own skip case: a unit outside every named agent's ceiling.

**Proposal**:
List Vercel's full `AddJsonResult` field set as measured. The specification makes Vercel the default at every point of parity, and none of its three divergence grounds covers dropping output fields.
- **`hash`:** computed as Vercel computes it.
- **`security`:** always `null`. That is what Vercel emits when it holds no security-audit data, and audit fetching is not among agntc's in-scope capabilities.
- **`reason` and `error`:** carried on skipped and failed entries as Vercel carries them.

**Evidence**:
Spec: "The array holds one entry per skill, with Vercel's fields (`AddJsonResult` in Vercel's `src/add.ts`): `name`; `status`, one of `installed`, `skipped` or `failed`; for installed skills, where the install came from and went to: `source`, `ref`, `path`, `scope` (always `project`), `agents` and `mode` (always `copy`)."

`gh api "repos/vercel-labs/skills/contents/src/add.ts?ref=v1.7.0" -H "Accept: application/vnd.github.raw"`:
- `:583–602`: `interface AddJsonResult { name?; status: 'installed' | 'skipped' | 'failed'; source?; ref?; hash?: string | null; path?; scope?; agents?; mode?; security?: {…} | null; reason?: string; error?: string; }`
- `:2185–2196` (installed): `{ name, status: 'installed', source: jsonSource, ref: parsed.ref ?? null, hash: installedSkillHashes.get(name) ?? null, path: …, scope: …, agents: …, mode: …, security: buildJsonSecurity(auditDataForJson, name, ownerRepoForAudit) }`
- `:605–611`: `buildJsonSecurity` returns `null` when `!data || Object.keys(data).length === 0`.
- `:1506–1511` (skipped): `{ name: requested, status: 'skipped', reason: 'No matching skill found in source' }`
- `:1164` and `:2178–2182` (failed): `{ status: 'failed', error: … }`
- `:2066–2079`: `hash` comes from `computeSkillFolderHash(skill.path)`.

The source does not carry the field list. The discussion names `--json` and its `-y`/`--all` requirement (lines 29, 480, 488) but never enumerates the fields.

**Current**:
- The array holds one entry per skill, with Vercel's fields (`AddJsonResult` in Vercel's `src/add.ts`):
  - `name`;
  - `status`, one of `installed`, `skipped` or `failed`;
  - for installed skills, where the install came from and went to: `source`, `ref`, `path`, `scope` (always `project`), `agents` and `mode` (always `copy`).

**Proposed Text**:
- The array holds one entry per skill, with Vercel's fields (`AddJsonResult` in Vercel's `src/add.ts`):
  - `name`;
  - `status`, one of `installed`, `skipped` or `failed`;
  - for installed skills, where the install came from and went to: `source`, `ref`, `hash` (the skill folder's content hash, as Vercel computes it), `path`, `scope` (always `project`), `agents`, `mode` (always `copy`) and `security` (always `null`, as Vercel emits it where it holds no security-audit data);
  - for skipped skills, `reason`;
  - for failed skills, `error`.

**Resolution**: Approved
**Notes**: 

---

## Observations

- §5.3's "Today a `SKILL.md` beside any asset folder is read as a plugin" is too broad. A root `SKILL.md` beside `skills/` alone is read today as a `skills/`-only menu, with the `SKILL.md` silently ignored (`src/type-detection.ts:145–163`). The claim holds for `agents/` and `hooks/`, which is the case the section is about. The source carries the same wording (discussion, "Skill-Local Agents Folders", line 375).
- §5.3's "61 of 258 skill folders carried `agents/`" can't be re-run as written, because the specification does not name the ten repositories. The substance holds:
  - `gh api "repos/mattpocock/skills/git/trees/HEAD?recursive=1"` → 38 skills, 38 `agents/` folders;
  - `anthropics/skills` `skills/skill-creator/agents/` holds `analyzer.md` and `grader.md`.
- §10.3 says Vercel "lists the existing folders as `overwrites:`". It actually lists, per skill, the agents whose copy will be overwritten (`src/add.ts:920–926`). The substance (no prompt; replaced) holds.
- §9.2's "A refusal still emits the array, holding one failed entry" holds inside Vercel's `runAdd`. Vercel's parse-time refusals (a bad `--metadata`) emit `[]` instead (`src/cli.ts`), but agntc refuses `--metadata` outright anyway.
