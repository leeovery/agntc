# Phase 2: Discovery finds skills where Vercel's does — 14 tasks

## vercel-skills-compatibility-2-1

### Task vercel-skills-compatibility-2-1: Category-nested skills under skills/ are offered

**Problem**: The `add` menu reads membership one level into `skills/` only (`scanSkillsOnlyMembers` in `src/type-detection.ts`). A category-nested repo such as `mattpocock/skills` (`skills/<category>/<skill>/SKILL.md`) therefore finds no members and ends "Cancelled — no plugins selected" with exit 0 (§5.1). Vercel's discovery walks `skills/` three levels and offers every one of those skills (§5.2).

**Solution**: Discovery walks `skills/` three levels deep and offers every skill it reaches by its declared name. The walk is depth-first: a folder is checked for its own SKILL.md before the walk goes into it, and a folder's children are taken in name order. It never goes below a folder holding a SKILL.md. A picked skill installs flat in its declared-name folder under `owner/repo/<folder>`, and `update` reinstalls it from the folder it sits in.

**Outcome**: `add` on a category-nested repo offers every skill it holds. Each picked skill lands directly in the agent's skills directory, keyed by its install folder, and updates from where it sits in the source.

**Acceptance Criteria**:
- [ ] Given a skills-only repo holding `skills/engineering/tdd/SKILL.md` (declaring `tdd`) and `skills/writing/prose-style/SKILL.md` (declaring `prose`), when `add owner/repo` runs at a terminal, the menu offers `tdd` and `prose` and no category folder; picking both for Claude installs `.claude/skills/tdd/` and `.claude/skills/prose/` under keys `owner/repo/tdd` and `owner/repo/prose`, and no `engineering/` or `writing/` folder appears in `.claude/skills/` (§4.2, §4.3, §5.1, §5.2)
- [ ] Given `skills/lint/SKILL.md` beside the category-nested `skills/frontend/react/SKILL.md`, the menu offers both `lint` and `react` (§5.2)
- [ ] Given `skills/bar/SKILL.md`, `skills/a/x/foo/SKILL.md` (three folders below `skills/`) and `skills/a/b/c/deep/SKILL.md` (four folders below `skills/`), the menu offers `bar` and `foo` and not `deep` (§5.2)
- [ ] Given `skills/lint/SKILL.md` and `skills/tools/SKILL.md` (declaring `tools`) with `skills/tools/helper/SKILL.md` below it, the menu offers `lint` and `tools` and not `helper`; picking `tools` installs its whole folder, `helper/` inside it (§5.2, §5.3)
- [ ] Given `tdd` installed from `skills/engineering/tdd/`, when the skill changes upstream and `update` runs by its key or with no argument, it reinstalls the new content from `skills/engineering/tdd/` into `.claude/skills/tdd/` and its key stays `owner/repo/tdd` (§1.2, §4.3)
- [ ] Given the same category-nested repo as a local-path source, when `tdd` is picked and later updated by its key, the update reinstalls it from `skills/engineering/tdd/` into `.claude/skills/tdd/` (§1.2, §4.3)

**Do**:
- Walk `skills/` as Vercel v1.7.0's `discoverSkills` (`src/skills.ts`) walks it: three levels, depth-first with a folder checked for its own SKILL.md before the walk goes into it, a folder's children in name order as agntc's member scan takes them today (`names.sort()` in `src/type-detection.ts`), and never below a folder holding a SKILL.md (§5.2).
- Where the work lives: `classifyStructure` and `scanSkillsOnlyMembers` in `src/type-detection.ts` (cited by the spec); the menu pipeline `runCollectionPipeline` in `src/commands/add.ts` and the menu itself in `selectCollectionPlugins` (`src/collection-select.ts`). `update` finds a remote member's source through `resolveUpdateSourceDir` and `resolveGuardedSourceDir` (`src/source-parser.ts`), which prefer the entry's recorded `sourceSubpath`, and treats a local-path entry's key as its source directory (`prepareReinstall` in `src/clone-reinstall.ts`).

**Context**:
> - §5.1: "Today a category-nested repo such as `mattpocock/skills` finds no members, because membership is read one level into `skills/` only (`scanSkillsOnlyMembers` in `src/type-detection.ts`). It then ends 'Cancelled — no plugins selected' with exit 0."
> - §5.2: "The walks over the search roots never go below a skill they have found. A folder holding a `SKILL.md` stops them whether or not its skill is offered."
> - Depths count as Vercel v1.7.0's walks count them (§1.4, §5.2): a folder up to three below `skills/` is checked for its own SKILL.md, and the walk goes no deeper. A skill placed deeper is reached only by the fallback walk (task 2-5), which runs only when the search roots find nothing, so the fixtures above keep a skill within the walk's reach.
> - §6.1 walks a plugin's own `skills/` "as discovery walks `skills/`" (task 1-8), so the two walks behave alike.
> - Phase 1 supplies the declared name and its cleaning (tasks 1-1, 1-9), the sanitized install folder (task 1-2), and the menu label and key `owner/repo/<folder>` (task 1-3).
> - Later tasks extend the same walks: plugin members below the first level (2-2), the other search roots (2-3, 2-4), the fallback walk (2-5), internal skills (2-9, 2-10), same-named installables (2-11, 2-12), the source's own lock (2-13), and skipped folders and symlinks (2-14). A source where discovery finds nothing installable is refused in task 2-8.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §1.4, §4.2, §4.3, §5.1, §5.2, §5.3, §6.1

## vercel-skills-compatibility-2-2

### Task vercel-skills-compatibility-2-2: Plugin members anywhere the walks reach are offered whole

**Problem**: Plugin members are recognised only among the source root's children and the direct children of `skills/` (`scanQualifyingChildDirs` and `qualifiesAsMember` in `src/type-detection.ts`). A member nested in a category folder, such as `skills/review/pack/` holding `agents/`, is never offered. Nor is a skills-only repo's top-level member beside `skills/`, because a skills-only root scans `skills/` alone. Once the walks reach deeper (task 2-1), walking into a member would offer its inner skills as loose skills, splitting a unit whose skills, agents and hooks belong together (§1.4, §5.3).

**Solution**: Every folder a walk reaches is classified by §5.3. A non-hidden folder holding `skills/`, `agents/` or `hooks/` and no SKILL.md is a plugin member, and that includes a skill pack holding only `skills/`. So is a folder holding SKILL.md in one of §5.1's plugin shapes, read against the folder's own `agntc.json`. Each member is offered as one entry, keyed by its path, and installs whole. No walk enters a member, so nothing inside it is offered on its own. Hidden folders are never members.

**Outcome**: Wherever a walk reaches a plugin member, the menu offers it once and whole. Picking it installs its skills, agents and hooks as one entry keyed `owner/repo/<path>`, which updates from that path.

**Acceptance Criteria**:
- [ ] Given a skills-only repo holding `skills/style/SKILL.md` and `skills/review/pack/`, which holds `agents/reviewer.md` and `skills/lint/SKILL.md` and no SKILL.md of its own, when `add owner/repo` runs, the menu offers `style` and the member at `skills/review/pack` as one entry, and does not offer `lint` on its own; picking the member for Claude installs it whole, `reviewer.md` in `.claude/agents/` and `lint` in its declared-name folder in `.claude/skills/`, under key `owner/repo/skills/review/pack` (§4.3, §5.2, §5.3)
- [ ] Given a skill pack `skills/bundles/pack/` holding only `skills/` with skills inside, beside `skills/style/SKILL.md`, the menu offers `style` and the pack as one entry keyed `owner/repo/skills/bundles/pack`, and none of the pack's inner skills on their own (§4.3, §5.3)
- [ ] Given a skills-only repo holding a top-level folder `foo/` with `agents/` and no SKILL.md beside `skills/style/SKILL.md`, the menu offers both `style` and the member `foo`, keyed `owner/repo/foo` (§4.3, §5.1, §5.2)
- [ ] Given a folder below the first level holding SKILL.md beside `skills/` and `agents/` (or `hooks/`), or SKILL.md beside `agents/`/`hooks/` or `skills/` alone whose own `agntc.json` declares `"type": "plugin"`, the menu offers it whole keyed by its path, picking it does not install its SKILL.md, and nothing inside it is offered on its own (§5.1, §5.3)
- [ ] Given a folder below the first level holding SKILL.md beside `agents/` with no `"type": "plugin"` declaration, the menu offers it as a skill by its declared name, and picking it installs the folder as a skill with `agents/` inside it and nothing in `.claude/agents/` (§5.3)
- [ ] Given a hidden folder `skills/.pack/` holding `agents/` and no SKILL.md, beside `skills/style/SKILL.md` and `skills/lint/SKILL.md`, the menu offers `style` and `lint` and no member for `.pack`; given a source carrying `.git/hooks/`, as a clone or a local git checkout does, nothing under `.git/` is ever offered (§5.3)
- [ ] Given `owner/repo/skills/review/pack` installed, when the member changes upstream and `update` runs by its key or with no argument, it reinstalls whole from `skills/review/pack/` under the same key (§1.2, §4.3)

**Do**:
- Classify each folder a walk reaches by §5.3, reading §5.1's plugin shapes against the folder's own `agntc.json`, as Phase 1 classifies member folders (tasks 1-5 to 1-7).
- Where the work lives: `qualifiesAsMember` and `scanQualifyingChildDirs` in `src/type-detection.ts`, which hold today's hidden-folder skip that keeps `.git` out of the menu. Member keys come from `memberKey` in `src/commands/add.ts`, and the menu from `selectCollectionPlugins` (`src/collection-select.ts`).

**Context**:
> - §5.3: "A non-hidden folder with `skills/`, `agents/` or `hooks/` (and no `SKILL.md`) is a plugin member, installed whole. This includes a skill pack that holds only `skills/`. Hidden folders are never plugin members, because a clone's `.git` holds `hooks/`." This diverges from Vercel to keep units (§1.4): Vercel sees such folders only as loose skills, or misses them.
> - §5.1 rule 3: a skills-only root is "a menu of the skills discovery finds (§5.2)". Discovery's first search root is the source root walked one level, which reaches a top-level member beside `skills/`.
> - §5.2: every walk "never enters a plugin member".
> - §4.3: a plugin member installed on its own has exactly one key, `owner/repo/<path>`, the same whether picked from the menu or selected by its path.
> - A member's own skills install flat in their declared-name folders (task 1-8). No name matches a plugin member; it is selected by its path (§7.1), which arrives in Phases 5 and 7.
> - Whether a member the search roots reach counts as found when deciding on the fallback walk is task 2-5. Where a member stands in priority order against a skill sharing its key is task 2-12. A member's content that lands on a path another installable takes is Phase 3 and Phase 8 (§6).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §1.4, §4.3, §5.1, §5.2, §5.3, §7.1

## vercel-skills-compatibility-2-3

### Task vercel-skills-compatibility-2-3: Skills under curated folders and agent directories are offered

**Problem**: Beyond `skills/`, Vercel's discovery searches `skills/.curated`, `skills/.experimental` and `skills/.system`, and 30 agent directories such as `.claude/skills` and `.agents/skills` (§5.2). agntc skips hidden folders when it scans for members (`scanQualifyingChildDirs` in `src/type-detection.ts`), so it offers nothing from any of them. A repo whose skills sit only in `skills/.curated/` ends "Cancelled — no plugins selected", and one whose skills sit only in `.claude/skills/` is refused as not an agntc source, though Vercel's CLI installs from both.

**Solution**: Discovery adds these folders as search roots, in §5.2's order: after the source root and `skills/` come the three curated folders, then the 30 agent directories. Each is walked three levels by the rules every walk follows. Every search root contributes to the menu; none stops the others.

**Outcome**: A skill sitting in any of these folders is offered beside the skills found elsewhere, installs flat in its declared-name folder, and updates from where it sits.

**Acceptance Criteria**:
- [ ] Given a repo whose only skills are `skills/.curated/a/SKILL.md` and `skills/.curated/b/SKILL.md`, when `add owner/repo` runs, the menu offers `a` and `b`, and a picked one installs flat into its declared-name folder keyed `owner/repo/<folder>`; the same holds for skills only under `skills/.experimental/` or only under `skills/.system/` (§4.3, §5.2)
- [ ] Given a repo whose only skills are two under `.claude/skills/`, or two under `.posit/assistant/skills/`, the menu offers both (§5.2)
- [ ] Given `.agents/skills/lint/SKILL.md` beside the category-nested `.agents/skills/frontend/react/SKILL.md`, the menu offers `lint` and `react` (§5.2)
- [ ] Given a repo holding `skills/lint/SKILL.md` and `.claude/skills/review/SKILL.md` (different declared names), the menu offers both (§5.2)
- [ ] Rule: each of the 30 agent directories §5.2 lists is a search root, so skills placed only in any one of them are offered (§5.2)
- [ ] Given a skill installed from the source's `.claude/skills/review/`, when it changes upstream and `update` runs, it reinstalls from `.claude/skills/review/` under the same key (§1.2, §4.3)

**Do**:
- The search roots after the source root and `skills/`, in order: `skills/.curated`, `skills/.experimental` and `skills/.system`, then `.agents/skills`, `.claude/skills`, `.cline/skills`, `.codebuddy/skills`, `.codex/skills`, `.commandcode/skills`, `.continue/skills`, `.factory/skills`, `.github/skills`, `.goose/skills`, `.grok/skills`, `.iflow/skills`, `.junie/skills`, `.kilo/skills`, `.kilocode/skills`, `.kimchi/skills`, `.kiro/skills`, `.minimax/skills`, `.mux/skills`, `.neovate/skills`, `.opencode/skills`, `.openhands/skills`, `.pi/skills`, `.posit/assistant/skills`, `.qoder/skills`, `.roo/skills`, `.trae/skills`, `.windsurf/skills`, `.zcode/skills`, `.zencoder/skills` (§5.2; measured in `vercel-labs/skills` at `v1.7.0`: `grep -c "^  '\." src/skills.ts` → 30).
- Walk each three levels, by the rules every walk follows (§5.2).
- Where the work lives: discovery in `src/type-detection.ts`, beside task 2-1's walk of `skills/`.

**Context**:
> - §5.2's search roots in priority order: the source root, walked one level; `skills/` and the three curated folders, each walked three levels; the 30 agent directories, each walked three levels; directories declared in `.claude-plugin` manifests, walked one level (task 2-4). The fallback walk runs only when they find nothing (task 2-5).
> - Skills in the source's own agent directories that its `skills-lock.json` records are skipped in task 2-13. Same-named skills across roots are task 2-11.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §4.3, §5.2

## vercel-skills-compatibility-2-4

### Task vercel-skills-compatibility-2-4: Skill directories declared in .claude-plugin manifests are offered

**Problem**: Repos laid out as Claude Code plugins or marketplaces declare their skill directories in `.claude-plugin/marketplace.json` or `.claude-plugin/plugin.json`, and Vercel's discovery reads those declarations to find skills (§5.2). agntc reads neither, so skills in a declared directory that no other search root reaches are not offered. A marketplace's `plugins/<name>/` folders are plugins in their own right: reaching their skills through the manifest would offer them one by one and split each plugin (§1.4, §5.3).

**Solution**: Discovery reads the skill directories both manifests declare, as Vercel reads them, and walks each one level as the last search root, after the agent directories. A declared directory that lies inside a plugin member below the source root is not walked. The walk reaches that member there instead, at this root's place in the priority order, and offers it whole; the member is the outermost folder on the declared path that §5.3 reads as a plugin member. The manifests are read only to find skills, never as a type signal.

**Outcome**: Skills in manifest-declared directories are offered like any others, each marketplace plugin is offered as one member, and a source carrying these manifests still offers its loose skills one by one.

**Acceptance Criteria**:
- [ ] Given a repo whose `.claude-plugin/plugin.json` declares the skill directory `tools/`, holding `tools/a/SKILL.md`, `tools/b/SKILL.md` and `tools/cat/c/SKILL.md` and no other skill, when `add owner/repo` runs, the menu offers `a` and `b` and not `c`: the declared directory is walked one level, and with skills found the fallback walk does not run (§5.2)
- [ ] Given the same layout declared through `.claude-plugin/marketplace.json` instead, the menu offers `a` and `b` and not `c` (§5.2)
- [ ] Given a Claude Code marketplace whose `.claude-plugin/marketplace.json` lists plugins at `plugins/foo/`, holding `skills/x/SKILL.md` beside `agents/reviewer.md`, and `plugins/bar/`, holding only `skills/y/SKILL.md` and `skills/z/SKILL.md`, when `add owner/repo` runs, the menu offers `plugins/foo` and `plugins/bar` each as one member, keyed `owner/repo/plugins/foo` and `owner/repo/plugins/bar`, and none of `x`, `y` or `z` on its own; picking `plugins/foo` for Claude installs it whole, `reviewer.md` in `.claude/agents/` and `x` in its declared-name folder (§4.3, §5.2, §5.3)
- [ ] Given a repo carrying `.claude-plugin/plugin.json` whose skills sit under `skills/`, when `add owner/repo` runs, the menu offers each skill separately, and picking two installs two manifest entries; the manifest never makes the source install as one plugin (§5.2)
- [ ] Given a skill picked from a declared directory, it installs flat into its declared-name folder keyed `owner/repo/<folder>`, and `update` reinstalls it from that directory (§1.2, §4.3)
- [ ] Given a manifest declaring a directory that escapes the source (e.g. `../elsewhere`), nothing outside the source is installed (§1.4)

**Do**:
- Read which directories the manifests declare the way Vercel v1.7.0 reads them, and walk each one level by the rules every walk follows (§1.4, §5.2).
- Where the work lives: discovery in `src/type-detection.ts`. The manifests feed only the search roots: `detectType`'s decision (`src/type-detection.ts`) and `readConfig` (`src/config.ts`) take nothing from them (§5.2).

**Context**:
> - §5.2 root 4: "Skill directories declared in `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json`, walked one level. These manifests are read only to find skills, never as a type signal. A declared directory that lies inside a plugin member (§5.3) below the source root is not walked, since no walk enters a plugin member: the walk reaches that member there, at this root's place in the priority order, and offers it whole. The member is the outermost folder on the declared path that §5.3 reads as a plugin member. A Claude Code marketplace's `plugins/<name>/`, holding `skills/` beside `agents/` or `hooks/`, or `skills/` alone, is therefore offered as one plugin member, not as its skills one by one."
> - Structure stays the sole authority for type. Only `agntc.json`'s `"type": "plugin"` or `--plugin` bundles a skills-only source (§5.1).
> - Copy-safety is a capability every change keeps: path-traversal and symlink-escape guards run before any copy (§1.4).
> - Whether a member reached here counts as found when deciding on the fallback walk is task 2-5. Same-named skills across roots are task 2-11.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §1.4, §4.3, §5.1, §5.2, §5.3

## vercel-skills-compatibility-2-5

### Task vercel-skills-compatibility-2-5: The fallback walk finds skills the search roots miss

**Problem**: When the search roots find nothing, Vercel walks the whole source recursively, five levels deep (§5.2). agntc has no such walk. A repo that keeps its skills in its own folder layout, such as `guides/web/<skill>/SKILL.md`, is refused today as not an agntc source, though Vercel's CLI installs from it.

**Solution**: When the search roots find nothing, discovery walks the whole source five levels deep: depth-first, a folder checked for its own SKILL.md before its children, children in name order. Unlike the search-root walks, it keeps descending into a skill's folder and offers a skill nested inside another as a skill of its own. It never enters a plugin member, and offers each member it reaches whole. Whether the search roots found anything is judged as Vercel judges it. A plugin member they reach counts only when Vercel's walk of that root, entering the member, would reach a skill inside it within that root's depth; a member holding no such skill does not count, though it is still offered.

**Outcome**: A source whose skills sit outside the search roots offers every skill and plugin member up to five levels deep, and the fallback walk runs exactly when Vercel's would.

**Acceptance Criteria**:
- [ ] Given a source whose only skills are `guides/web/forms/validation/SKILL.md` (four folders deep), `a/b/c/d/e/SKILL.md` (five deep) and `p/q/r/s/t/u/SKILL.md` (six deep), each declaring its folder's name, when `add owner/repo` runs, the menu offers `validation` and `e` and not `u` (§5.2)
- [ ] Given `validation` picked from that menu for Claude, it installs flat into `.claude/skills/validation/` keyed `owner/repo/validation`, and `update` reinstalls it from `guides/web/forms/validation/` (§1.2, §4.3)
- [ ] Given a source holding `lint/SKILL.md` and `review/SKILL.md`, which the source-root walk reaches, and `docs/x/deep/SKILL.md`, which only the fallback walk would reach, the menu offers `lint` and `review` and not `deep` (§5.2)
- [ ] Given a source whose only skills are `x/outer/SKILL.md` and `x/outer/inner/SKILL.md`, the menu offers `outer` and `inner` as separate skills (§5.2)
- [ ] Given a source whose only content is `x/pack/`, holding `agents/reviewer.md` and `skills/s/SKILL.md`, and `docs/guide/SKILL.md`, the menu offers `guide` and the member `x/pack` as one entry keyed `owner/repo/x/pack`, and does not offer `s` on its own (§4.3, §5.2, §5.3)
- [ ] Given a skills-only repo whose `skills/` holds only the member `skills/pack/` with `agents/reviewer.md` and no skill, and which holds `docs/x/guide/SKILL.md`, the menu offers the member and `guide`; given a source whose top-level member `pack/` holds `agents/` and `skills/s/SKILL.md`, deeper than the source-root walk's one level reaches, beside `docs/x/guide/SKILL.md`, the menu likewise offers `pack` and `guide`: neither member counts as found, so the fallback walk runs (§5.2)
- [ ] Given a skills-only repo whose `skills/` holds only the members `skills/pack/`, holding `agents/` and `skills/s/SKILL.md`, and `skills/tools/`, holding only `hooks/`, and which holds `docs/x/guide/SKILL.md`, the menu offers both members and not `guide`: the walk of `skills/` would reach `s` inside `skills/pack/` within its three levels, so the fallback walk does not run (§5.2)

**Do**:
- Walk as Vercel v1.7.0's fallback walk does (`findSkillDirs`, `src/skills.ts:135–153`): from the root of what the source points at, five levels deep, depth-first with a folder checked for its own SKILL.md before the walk goes into it, children in name order (§5.2).
- Judge whether the search roots found anything by whether Vercel's walks of those roots would find a skill: a plugin member counts when such a walk, entering it as Vercel's walks do, would reach a skill inside it within that root's depth (§5.2).
- Where the work lives: discovery in `src/type-detection.ts`, after the search roots of tasks 2-1 to 2-4.

**Context**:
> - §5.2: "When those roots find nothing, or when `--full-depth` is given, the whole source is walked recursively, five levels deep. That is Vercel's fallback. Whether the roots found anything is judged as Vercel judges it: by whether its walks of those roots would find a skill. A plugin member the roots reach counts as found when such a walk, entering it as Vercel's walks do, would reach a skill inside it within that root's depth. A member in which that walk would reach none, such as one holding only `agents/` or `hooks/`, does not count, though it is still offered."
> - §5.2: "The fallback walk, as Vercel's does (`findSkillDirs`, Vercel's `src/skills.ts:135–153`), keeps descending into a skill's folder, and lists any skill nested inside it as a skill of its own." Every walk "never enters a plugin member".
> - The source-root walk goes one level, so it checks a top-level member's own folder for a SKILL.md and nothing inside it; the walks of `skills/` and the other three-level roots reach three levels below their root (§5.2).
> - Skills count as §5.4 and the source's `skills-lock.json` rule decide (§5.2): an internal skill (task 2-9) and a skill the source's lock records (task 2-13) do not count as found.
> - Shape is read at the root of what the source points at (§5.1), so for a tree URL the fallback walks from the folder the URL names (task 2-7).
> - The fallback walk skips `node_modules`, `.git`, `dist`, `build` and `__pycache__` outright and follows no symlinked directory (task 2-14). `--full-depth` runs it even when the search roots found skills (task 2-6). A skill it reaches whose name the search roots already took is task 2-11.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §4.3, §5.1, §5.2, §5.3, §5.4

## vercel-skills-compatibility-2-6

### Task vercel-skills-compatibility-2-6: --full-depth walks the whole source

**Problem**: A repo with a root SKILL.md installs as one skill (the root early-out, §5.1), so the skills nested below it can never be picked. Once the search roots find anything, skills only the fallback walk reaches are never offered, a skill nested inside another skill's folder included. Vercel's `--full-depth` turns the early-out off and walks the whole source, but `add` takes no flag besides `--plugin` today (§9).

**Solution**: `add` accepts `--full-depth`. It turns off the root early-out, so a root SKILL.md no longer installs the source as a single skill: it is offered in the menu as a skill of its own, keyed `owner/repo`, beside the skills found below it. It also runs the fallback walk even when the search roots found skills.

**Outcome**: `add owner/repo --full-depth` offers every skill the search roots and the five-level walk reach, the root skill included, and each picked skill installs under its usual key.

**Acceptance Criteria**:
- [ ] Given a repo whose root SKILL.md declares `root-skill` and whose `skills/a/` and `skills/b/` hold skills, when `add owner/repo --full-depth` runs at a terminal, the menu offers `root-skill`, `a` and `b`; picking `root-skill` and `a` for Claude installs `.claude/skills/root-skill/` under key `owner/repo` and `.claude/skills/a/` under key `owner/repo/a` (§4.3, §5.1, §5.2)
- [ ] Given the same repo without the flag, `add owner/repo` installs the root as a single skill with no menu, as Phase 1 installs it (§5.1)
- [ ] Given `skills/lint/SKILL.md` and `skills/tools/SKILL.md` with `skills/tools/helper/SKILL.md` below it, `--full-depth` offers `lint`, `tools` and `helper`, while without the flag `helper` is not offered (§5.2)
- [ ] Given `skills/a/SKILL.md`, `skills/b/SKILL.md` and `docs/x/guide/SKILL.md`, `--full-depth` offers `a`, `b` and `guide`, while without the flag `guide` is not offered (§5.2)
- [ ] Given `root-skill` and `a` installed with `--full-depth`, when `update` runs with no argument, each reinstalls into its own folder under its own key (§1.2, §4.3)

**Do**:
- Declare `--full-depth` on `add` beside `--plugin` (`src/commands/add.ts`) (§9.1).
- Offer the root SKILL.md as Vercel v1.7.0 offers it under `fullDepth` (`src/skills.ts:236–250`) (§5.2).
- Where the work lives: the root early-out is `classifyStructure`'s bare-skill case in `src/type-detection.ts`; the fallback walk is task 2-5's.

**Context**:
> - §5.1 rule 1: "A single skill. The folder holds a `SKILL.md`. This is Vercel's root early-out, and `--full-depth` turns it off (§5.2)."
> - §5.2: "When those roots find nothing, or when `--full-depth` is given, the whole source is walked recursively, five levels deep." And: "Under `--full-depth`, a root `SKILL.md` is offered as a skill of its own (keyed `owner/repo`, §4.3) beside the skills found below it, as Vercel offers it (v1.7.0 `src/skills.ts:236–250`)."
> - §9.1 defines `--full-depth` as "Turn off the root early-out and walk the whole source". Phase 12 completes `add`'s flag set and refuses unrecognised flags.
> - An internal root SKILL.md is not offered under `--full-depth` (task 2-10). Same-named skills across the search roots and the fallback walk are task 2-11.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §4.3, §5.1, §5.2, §9.1

## vercel-skills-compatibility-2-7

### Task vercel-skills-compatibility-2-7: A tree URL is read by the shape of the folder it names

**Problem**: A tree URL is treated as a selector for one member. When the folder it names reads as a menu, the add fails unless the URL's own path is one of that menu's members ("Plugin … not found in collection", the direct-path branch of `runCollectionPipeline` in `src/commands/add.ts`). A tree URL to a skills-only pack, or to a category folder of skills, therefore fails with a non-zero exit instead of installing the pack or offering the folder's skills (§5.1).

**Solution**: Shape is read at the folder the URL names (§5.1). A non-hidden folder holding only `skills/` is a skill pack, a plugin member: it installs whole with no menu, keyed `owner/repo/<path>` as a menu pick is, and `--plugin` on it changes nothing. A hidden folder holding only `skills/` is not a member, and it offers the menu of skills discovery finds there. A folder of any other shape, such as a category folder, runs discovery from that folder and offers what it finds: each skill keyed `owner/repo/<folder>`, each plugin member keyed by its path in the repository.

**Outcome**: A tree URL to a pack installs the pack, and a tree URL to a folder of skills offers those skills. Either way the install comes from the URL's ref, under the key a whole-repo add would give it.

**Acceptance Criteria**:
- [ ] Given `https://github.com/owner/repo/tree/main/skills/pack`, where `skills/pack/` holds only `skills/` with skills inside, when it is added for Claude, no menu is shown and the pack installs from `main` as one entry keyed `owner/repo/skills/pack`, its skills flat in their declared-name folders (§4.3, §5.1, §5.3)
- [ ] Given that pack installed from the menu of `add owner/repo`, when it is re-added through the tree URL, the manifest still holds one entry for it, under `owner/repo/skills/pack`; adding by tree URL first and then from the menu gives the same result (§4.3)
- [ ] Given the same tree URL with `--plugin`, it installs exactly as without the flag (§5.1, §6.6)
- [ ] Given a tree URL to `.pack/`, a hidden folder holding only `skills/a/SKILL.md` and `skills/b/SKILL.md`, the menu offers `a` and `b` (§5.1, §5.3)
- [ ] Given `https://github.com/owner/repo/tree/main/skills/frontend`, a category folder holding `react/SKILL.md`, `vue/SKILL.md` and a member `pack/` holding `agents/`, the menu offers `react`, `vue` and the member, keyed `owner/repo/skills/frontend/pack`; picking `react` installs it from `main` into `.claude/skills/react/` keyed `owner/repo/react`, never `owner/repo/skills/frontend/react`, and `update` reinstalls it from `skills/frontend/react/` at the recorded ref (§1.2, §2.5, §4.3, §5.1)

**Do**:
- Where the work lives: `runAdd`'s unit-folder handling for a direct-path source and the direct-path branch of `runCollectionPipeline` in `src/commands/add.ts`, which requires the URL's path to be a menu member today; `parseDirectPath` in `src/source-parser.ts` builds the direct-path key.

**Context**:
> - §5.1 rule 3: "A path into the repository that names a non-hidden folder of this shape names a skill pack, a plugin member (§5.3), and not a menu. It installs that member whole under its member key (§4.3), as picking it from the menu does, and `--plugin` on it is redundant (§6.6)." This diverges from Vercel to keep units (§1.4).
> - §5.1: "Shape is read at the root of what the source points at: the repo root, or the path the source names."
> - §4.3: a plugin member's key is `owner/repo/<path>`, "where `<path>` is its folder's path in the repository".
> - A tree URL's ref is read the way the same `#` fragment would be (§2.5): a branch installs that branch with no constraint recorded.
> - Already in place from Phase 1: a tree URL to a single skill (task 1-4) and to a plugin member holding `agents/`, `hooks/` or a SKILL.md (tasks 1-5 to 1-7). The `owner/repo/<path>` form and a tree URL with no path arrive in Phase 5. `--plugin` on a category folder narrows a bundle to it (Phase 3). A path landing inside a unit is Phase 8. A tree URL to a folder holding nothing installable is refused in task 2-8.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §1.4, §2.5, §4.3, §5.1, §5.3, §6.6

## vercel-skills-compatibility-2-8

### Task vercel-skills-compatibility-2-8: A source with nothing installable is refused

**Problem**: A source whose shape reads as a menu but in which nothing installable is found reaches an empty menu and ends "Cancelled — no plugins selected" with exit 0; a skills-only repo whose `skills/` holds no skill is one (§5.1). An AI agent caller acts on the exit status, so it reads an install that did nothing as a success (§1.5). Vercel exits 1 when it finds no skills.

**Solution**: When discovery finds nothing installable, no skill and no plugin member, `add` refuses pre-flight: it exits non-zero, writes nothing, and its message names the source and says nothing installable was found in it. Whole-repo sources and tree URLs are refused alike. A deliberate cancel at a menu that does offer something still exits 0.

**Outcome**: An `add` that cannot install anything because the source holds nothing installable fails loudly and leaves the project as it was.

**Acceptance Criteria**:
- [ ] Given a skills-only repo whose `skills/` holds only `README.md` and a folder `notes/`, and which holds no SKILL.md and no plugin member anywhere, when `add owner/repo` runs, no menu is shown, the command exits non-zero, its message names `owner/repo` and says nothing installable was found in it, and no file or manifest entry is written (§1.5, §5.1)
- [ ] Given a repo with no SKILL.md, no `skills/`, `agents/` or `hooks/` folder and no plugin member anywhere, when `add owner/repo` runs, it is refused the same way (§5.1)
- [ ] Given a tree URL naming a folder that holds nothing installable, when it is added, it is refused the same way (§5.1)
- [ ] Given a project with existing installs, when an `add` is refused for finding nothing installable, the manifest and every agent's skills, agents and hooks directories are unchanged (§1.5)
- [ ] Given a source whose menu offers skills, when the menu is cancelled at a terminal, the command exits 0 and writes nothing (§10.4)

**Do**:
- Where the work lives: `runAdd`'s `not-agntc` branch in `src/commands/add.ts`, which exits 1 with "Not an agntc source" today, and the empty-menu path through `runCollectionPipeline` (`src/commands/add.ts`) and `selectCollectionPlugins` (`src/collection-select.ts`), which ends "Cancelled — no plugins selected" with exit 0.

**Context**:
> - §5.1: "A source where discovery finds nothing installable is refused (§1.5). Vercel likewise exits 1 when it finds no skills."
> - §1.5: a refusal is pre-flight. The command exits non-zero, writes nothing and removes nothing, and its message names what was refused. "A refusal that exited 0 would read as success to an AI agent caller, which acts on the exit status rather than the text."
> - §10.4: "A deliberate cancel at a terminal still exits 0."
> - A source whose only skills are internal is refused the same way (tasks 2-9, 2-10). Refusing a prompt that cannot be shown is Phase 11.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.5, §5.1, §10.4

## vercel-skills-compatibility-2-9

### Task vercel-skills-compatibility-2-9: Internal skills are not found when no skill is named

**Problem**: Authors mark a skill as not for direct installation by setting `metadata.internal: true` in its frontmatter, and Vercel's discovery does not find such a skill unless it is named (§5.4). agntc reads only `name` (Phase 1), so internal skills would be offered in the menu like any other, and a source holding only internal skills would offer them instead of finding nothing installable.

**Solution**: Discovery reads `metadata.internal` from each SKILL.md's frontmatter, as plain data. When no skill is named, which in this phase is every add, an internal skill is not found at all. It is absent from the menu whichever root or walk reached it, and it does not count as found when deciding whether the fallback walk runs, inside a plugin member included. A source whose only skills are internal therefore finds nothing installable and is refused. An internal skill's folder still stops the search-root walks, as every folder holding a SKILL.md does.

**Outcome**: No internal skill appears in the menu, and what discovery offers around internal skills is what Vercel's discovery finds.

**Acceptance Criteria**:
- [ ] Given a skills-only repo holding `skills/public/SKILL.md`, `skills/other/SKILL.md` and `skills/secret/SKILL.md`, whose frontmatter sets `metadata.internal: true`, when `add owner/repo` runs, the menu offers `public` and `other` and not `secret` (§5.4)
- [ ] Given an internal skill in `.claude/skills/`, one in a manifest-declared directory, and one only the fallback walk reaches, each beside two non-internal skills the same walk reaches, none of the internal skills is offered (§5.4)
- [ ] Given a source whose search roots hold only the internal `skills/secret/SKILL.md`, and which holds `docs/x/guide/SKILL.md` and `docs/y/tips/SKILL.md` that only the fallback walk reaches, the menu offers `guide` and `tips`: the internal skill does not count as found, so the fallback walk runs (§5.2, §5.4)
- [ ] Given a skills-only repo whose `skills/` holds only the member `skills/pack/`, holding `agents/` and the internal `skills/secret/SKILL.md`, and which holds `docs/x/guide/SKILL.md`, the menu offers the member and `guide`: a member whose only reachable skill is internal does not count as found (§5.2, §5.4)
- [ ] Given a source whose only skills are internal, when `add owner/repo` runs, it exits non-zero, writes nothing, and says nothing installable was found (§5.1, §5.4)
- [ ] Given `skills/tools/SKILL.md` marked internal with `skills/tools/helper/SKILL.md` below it, beside `skills/other/SKILL.md` and `skills/more/SKILL.md`, the menu offers `other` and `more` and neither `tools` nor `helper` (§5.2)
- [ ] Given `skills/broken/SKILL.md` whose YAML fails to parse beside `skills/other/SKILL.md`, the menu offers both, the first under its folder name `broken` (§3.2)

**Do**:
- Parse the frontmatter as plain data, with no YAML feature that executes code or constructs objects (§3.3), as task 1-1's read does.
- Leave an internal skill unfound as Vercel v1.7.0 does when no skill is named (`src/skills.ts:117–122`) (§5.4).
- Where the work lives: the frontmatter read task 1-1 adds, and discovery in `src/type-detection.ts`.

**Context**:
> - §3.1: agntc reads three frontmatter fields, and `metadata.internal` marks a skill as internal. Frontmatter never decides a source's type or whether a skill is valid.
> - §5.4: "A skill whose frontmatter sets `metadata.internal: true` is left out of 'all' (`'*'`, `--all`, `-y`) and out of the menu. It still installs when named. A `--plugin` bundle includes it." When no skill is named, discovery does not find it, as Vercel's does not (v1.7.0 `src/skills.ts:117–122`); it does not count as found when deciding whether the fallback walk runs; and a source whose only skills are internal finds nothing installable and is refused, as Vercel exits 1 finding no skills.
> - §5.2: a folder holding a SKILL.md stops the search-root walks whether or not its skill is offered; "an internal skill when no skill is named" is one of the cases named. Whether the roots found anything is judged by whether Vercel's walks would find a skill, and "Skills count as §5.4 … decide[s]".
> - §3.2: YAML that fails to parse falls back to the folder name, with no warning, and the skill installs normally.
> - Naming an internal skill to install it arrives in Phase 7; `--plugin` bundles include internal skills in Phase 3; `-y` and `--all` leave them out in Phases 11 and 12. An internal root SKILL.md is task 2-10. The nothing-installable refusal is task 2-8's.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §3.1, §3.2, §3.3, §5.1, §5.2, §5.4

## vercel-skills-compatibility-2-10

### Task vercel-skills-compatibility-2-10: An internal root SKILL.md does not end discovery

**Problem**: A SKILL.md at the root of what the source points at ends discovery: the source installs as that single skill (the root early-out, §5.1). When that root skill is internal, Vercel does not install it on an add that names no skill, and carries on into the search roots (§5.4). Without the same rule, agntc would install a skill its author marked internal and never offer the skills the source holds below it.

**Solution**: On an add that names no skill, an internal root SKILL.md does not trigger the early-out. It is not installed, and discovery carries on into the search roots and, when they find nothing, the fallback walk, as it would for a root holding no SKILL.md. A source whose only skill is that internal root finds nothing installable and is refused. Under `--full-depth`, the internal root is not offered beside the nested skills.

**Outcome**: An internal root skill never installs on an add that names no skill, and the source's other skills are offered as Vercel offers them.

**Acceptance Criteria**:
- [ ] Given a repo whose root SKILL.md sets `metadata.internal: true` and whose `skills/a/` and `skills/b/` hold skills, when `add owner/repo` runs at a terminal, the menu offers `a` and `b` and not the root skill, and no entry is written under key `owner/repo` (§5.4)
- [ ] Given a repo whose root SKILL.md is internal and whose other skills are `docs/x/guide/SKILL.md` and `docs/y/tips/SKILL.md`, which only the fallback walk reaches, the menu offers `guide` and `tips` (§5.2, §5.4)
- [ ] Given a repo whose only skill is an internal root SKILL.md, when `add owner/repo` runs, it exits non-zero, writes nothing, and says nothing installable was found (§5.1, §5.4)
- [ ] Given a tree URL naming the folder of an internal skill that holds no other skill, when it is added, it is refused the same way (§5.1, §5.4)
- [ ] Given the first repo added with `--full-depth`, the menu offers `a` and `b` and not the root skill (§5.2, §5.4)

**Do**:
- Carry on past an internal root SKILL.md as Vercel v1.7.0 does (`src/skills.ts:236–250`) (§5.4).
- Where the work lives: the root early-out in `classifyStructure` (`src/type-detection.ts`), reading the internal flag task 2-9 adds.

**Context**:
> - §5.4: "A root `SKILL.md` marked internal is not installed by an add that names no skill. Discovery carries on past it into the search roots, as Vercel's does (`src/skills.ts:236–250`)." An internal skill does not count as found when deciding whether the fallback walk runs.
> - §5.1: "Shape is read at the root of what the source points at: the repo root, or the path the source names." A tree URL's folder is that root.
> - A source whose only skills are internal is refused as finding nothing installable (§5.4, task 2-8's refusal).
> - In Phase 7, `add owner/repo@<its name>` or `--skill <its name>` installs an internal root SKILL.md as the single skill keyed `owner/repo` (§5.4, §7.1).

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §5.1, §5.2, §5.4, §7.1

## vercel-skills-compatibility-2-11

### Task vercel-skills-compatibility-2-11: Skills sharing a name: the first the walks reach is offered

**Problem**: Once discovery searches many roots and walks several levels, two skills in one source can declare the same name, and both would install into one folder under one key. Vercel keeps the first it reaches (§5.2). If agntc's choice depended on the order the filesystem happens to list folders in, the same source could offer a different skill from one machine to the next.

**Solution**: Discovery reaches folders in one fixed priority order, and of skills declaring the same name it offers only the first. The order is the order the walks reach things: the search roots in §5.2's listed order, then the fallback walk; within one walk, depth-first, with a folder checked for its own SKILL.md before the walk goes into it; a folder's children in name order. A folder whose skill is dropped as a duplicate still stops the search-root walk below it.

**Outcome**: A source holding same-named skills always offers the same one, the one Vercel's walks reach first, whatever filesystem it sits on.

**Acceptance Criteria**:
- [ ] Given `skills/foo/SKILL.md` and `.claude/skills/foo/SKILL.md`, both declaring `foo`, beside `skills/bar/SKILL.md`, when `add owner/repo` runs, the menu offers one `foo` and `bar`, and picking `foo` installs the content of `skills/foo/` (§5.2)
- [ ] Given a top-level `shared/SKILL.md` and `skills/other/SKILL.md`, both declaring `shared`, beside `skills/bar/SKILL.md`, the menu offers one `shared` and `bar`, and picking `shared` installs the content of the top-level `shared/`, which the source-root walk reaches first (§5.2)
- [ ] Given `skills/a/x/foo/SKILL.md` and `skills/b/foo/SKILL.md`, both declaring `foo`, beside `skills/c/SKILL.md`, the menu offers one `foo` and `c`, and picking `foo` installs the content of `skills/a/x/foo/`, whatever order the filesystem lists `a` and `b` in (§5.2)
- [ ] Given `--full-depth` on a source holding `skills/foo/SKILL.md` and `skills/bar/SKILL.md`, and `docs/x/foo-copy/SKILL.md` declaring `foo`, the menu offers one `foo` and `bar`, and picking `foo` installs the content of `skills/foo/` (§5.2)
- [ ] Given `skills/a/SKILL.md` and `skills/b/SKILL.md`, both declaring `dup`, with `skills/b/helper/SKILL.md` below `b`, beside `skills/c/SKILL.md`, the menu offers `dup` from `skills/a/` and `c`, and not `helper` (§5.2)

**Do**:
- Priority order, as §5.2 sets it: the search roots in the order listed, then the fallback walk; depth-first within one walk, a folder checked for its own SKILL.md before the walk goes into it, as Vercel v1.7.0's `walkSkillDirs` and `findSkillDirs` do (`src/skills.ts`); a folder's children in name order, as agntc's member scan takes them today (`names.sort()` in `src/type-detection.ts`).
- Where the work lives: discovery in `src/type-detection.ts`, across the walks of tasks 2-1 to 2-6.

**Context**:
> - §5.2: "When two skills declare the same name, the first in priority order is kept." "Priority order is the order the walks reach things." "A folder's children are taken in name order, as agntc's member scan takes them today (`names.sort()` in `src/type-detection.ts`), so 'first' never depends on the order the filesystem lists folders in."
> - §5.2: the search-root walks stop at any folder holding a SKILL.md "whether or not its skill is offered"; "a name already taken" is one of the cases named.
> - The name compared is the declared name as Phase 1 reads it, cleaned of escapes, line breaks and surrounding whitespace (task 1-9), or the folder name for a skill that declares none (§3.2, §4.1).
> - Names that collide only once sanitized, and a skill and a plugin member sharing a key, are task 2-12.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §3.2, §4.1, §5.2

## vercel-skills-compatibility-2-12

### Task vercel-skills-compatibility-2-12: Installables sharing an install folder or key are offered once

**Problem**: Two different declared names can still land on one install folder once sanitized: `Foo Bar` and `foo-bar` both install into `foo-bar` (§4.2). A skill can also share a key with a plugin member: a skill declaring `foo` and a member at path `foo` are both `owner/repo/foo` (§4.3). Offering both would put two installables into one folder or under one manifest key.

**Solution**: Two installables from one source that would take the same install folder or the same key count as the same name, and only the first in priority order is offered. A plugin member takes its place in that order where the walk reaches it, so whichever of a skill and a member the walks reach first is the one offered.

**Outcome**: No two things the menu offers from one source install into the same folder or under the same key, and the one kept is always the one the walks reach first.

**Acceptance Criteria**:
- [ ] Given `skills/a/SKILL.md` declaring `Foo Bar`, `skills/b/SKILL.md` declaring `foo-bar` and `skills/c/SKILL.md` declaring `other`, when `add owner/repo` runs, the menu offers the skill from `skills/a/` and `other`, and not the one from `skills/b/`; picking the first installs the content of `skills/a/` into `.claude/skills/foo-bar/` (§4.2, §5.2)
- [ ] Given a skills-only repo holding a top-level member `foo/` (holding `agents/` and no SKILL.md), `skills/bar/SKILL.md` declaring `foo` and `skills/baz/SKILL.md`, where the member and the skill declaring `foo` would both key `owner/repo/foo`, the menu offers the member and `baz`, and not the skill declaring `foo`; picking the member installs it whole under `owner/repo/foo` (§4.3, §5.2)
- [ ] Given a source holding a top-level skill folder `a/` whose SKILL.md declares `zeta`, a top-level member `zeta/` holding `agents/`, and `b/SKILL.md` declaring `beta`, where the skill and the member would both key `owner/repo/zeta`, the menu offers the skill from `a/`, which the source-root walk reaches first in name order, and `beta`, and not the member (§4.3, §5.2)

**Do**:
- Count two installables as the same name when they would take the same install folder (§4.2's sanitizing, task 1-2) or the same key (§4.3), and keep the first in task 2-11's priority order (§5.2).
- Where the work lives: discovery in `src/type-detection.ts`, beside task 2-11's same-name check.

**Context**:
> - §5.2: "Two installables from one source that would take the same install folder or the same key count as the same name, and the first in priority order is kept. This covers: names that collide only once sanitized: `Foo Bar` and `foo-bar` both install into `foo-bar` (§4.2); a skill and a plugin member that would share a key: a skill declaring `foo` and a member at path `foo` are both `owner/repo/foo` (§4.3). A plugin member's place in that order is where the walk reaches it."
> - When a member's own skills, agents or hooks land on a path another installable in the same run takes, that content is left out and named. That is §6's same-path rule, applied in Phase 3 and Phase 8, not this task.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.2, §4.3, §5.2, §6

## vercel-skills-compatibility-2-13

### Task vercel-skills-compatibility-2-13: Skills the source's own skills-lock.json records are not offered

**Problem**: A source repo whose author uses Vercel's CLI in it carries skills that author pulled in, installed in the repo's own agent directories (e.g. `.claude/skills/`) and recorded in its committed `skills-lock.json`. Those are skills the author pulled in, not wrote. Vercel's discovery skips them (§5.2), but the agent-directory search roots (task 2-3) would offer them as the source's own skills.

**Solution**: Discovery reads the source's own `skills-lock.json` and skips any skill in the source's agent directories that the lock records as installed. The skip applies in every walk, and a skipped skill does not count as found when deciding whether the fallback walk runs. A skill anywhere else, such as under `skills/`, is offered even when the lock records its name. A skipped skill's folder still stops the search-root walk below it. The project's own `skills-lock.json` is never read and never affects what is offered.

**Outcome**: The menu offers the skills a source's author wrote and leaves out those its lock records as pulled in, as Vercel's does.

**Acceptance Criteria**:
- [ ] Given a source whose own `skills-lock.json` records `foo` and `bar`, whose `.claude/skills/foo/SKILL.md` declares `foo`, and which holds `skills/bar/SKILL.md` and `skills/baz/SKILL.md`, when `add owner/repo` runs, the menu offers `bar` and `baz` and not `foo`: only skills in the source's agent directories are skipped (§5.2)
- [ ] Given a source whose lock records `foo`, whose `.claude/skills/foo/` holds `helper/SKILL.md` below its own SKILL.md, and which holds `skills/bar/SKILL.md` and `skills/baz/SKILL.md`, the menu offers `bar` and `baz` and neither `foo` nor `helper` (§5.2)
- [ ] Given the first source added with `--full-depth`, `foo` is still not offered (§5.2)
- [ ] Given a source whose search roots hold only `.claude/skills/foo/`, which its lock records, and which holds `docs/x/guide/SKILL.md` and `docs/y/tips/SKILL.md`, the menu offers `guide` and `tips` and not `foo`: the recorded skill does not count as found, so the fallback walk runs, and it skips `foo` too (§5.2)
- [ ] Given a project whose own `skills-lock.json` records `foo`, and a source with no lock of its own whose `.claude/skills/foo/SKILL.md` declares `foo` beside `skills/bar/SKILL.md`, the menu offers `foo` and `bar` (§13)

**Do**:
- Read the source's lock, keyed by declared name (§13), the way Vercel v1.7.0 reads it to skip a source's own installed skills (§1.4, §5.2).
- Where the work lives: discovery in `src/type-detection.ts`.

**Context**:
> - §5.2: "Skills in the source's own agent directories are skipped when the source's own `skills-lock.json` records them as installed. These are skills the author pulled in, not wrote, and Vercel skips them the same way. This is the only time agntc reads a `skills-lock.json` (§13)." The rule is listed among those "every walk follows".
> - §5.2: the search-root walks stop at any folder holding a SKILL.md "whether or not its skill is offered"; "a skill the source's own `skills-lock.json` records" is one of the cases named. Whether the roots found anything is judged by whether Vercel's walks would find a skill, with skills counted as "the source's `skills-lock.json` rule" decides.
> - The source's agent directories are §5.2's 30 agent-directory search roots (task 2-3).
> - §13: "The project's `skills-lock.json` is neither read nor written. agntc's own manifest is its record." Phase 14 checks the project's lock is left byte-for-byte unchanged.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.4, §5.2, §13

## vercel-skills-compatibility-2-14

### Task vercel-skills-compatibility-2-14: Discovery never descends into dependencies, build output or symlinked folders

**Problem**: Walking deeper means walking into folders that hold no skills of the source's own. `node_modules` can carry vendored skills from dependencies, `dist`, `build` and `__pycache__` hold generated copies, and `.git` holds the repository's internals. A symlinked directory can point anywhere, outside the source included. Vercel's walks skip all of these (§5.2); agntc's would otherwise offer what they hold as the source's skills.

**Solution**: No walk descends through `node_modules`, `.git`, `dist`, `build` or `__pycache__`. The search-root walks still check a folder of one of those names for a SKILL.md of its own, so `skills/build/SKILL.md` is a skill, but go no further into it. The fallback walk skips those folders outright, their own SKILL.md included. No walk follows a symlinked directory.

**Outcome**: The menu offers only skills that sit in the source's own folders, reached without passing through a dependency, build-output or VCS folder or a symlinked directory.

**Acceptance Criteria**:
- [ ] Given a skills-only repo holding `skills/build/SKILL.md` (declaring `build`), `skills/real/SKILL.md`, `skills/node_modules/pkg/SKILL.md`, `skills/dist/out/SKILL.md` and `skills/__pycache__/cached/SKILL.md`, when `add owner/repo` runs, the menu offers `build` and `real` and nothing else (§5.2)
- [ ] Given a source whose skills sit only at `x/real/SKILL.md`, `x/other/SKILL.md`, `x/build/SKILL.md`, `x/node_modules/pkg/SKILL.md` and `.git/info/skills/foo/SKILL.md`, all outside the search roots, the menu offers `real` and `other` only: the fallback walk skips `build/`, `node_modules/` and `.git/` outright (§5.2)
- [ ] Given `skills/linked`, a symlink to a skill folder outside the source, beside `skills/real/SKILL.md` and `skills/other/SKILL.md`, the menu offers `real` and `other` and not the linked skill; the same holds under `--full-depth` (§5.2)
- [ ] Given `skills/alias`, a symlink to `vendor/foo/` (a skill folder inside the source that no search root reaches), beside `skills/real/SKILL.md` and `skills/other/SKILL.md`, the menu offers `real` and `other` and not `foo` (§5.2)

**Do**:
- Apply Vercel v1.7.0's skip list as its walks apply it (§5.2; measured in `vercel-labs/skills` at `v1.7.0`: `grep -n "SKIP_DIRS" src/skills.ts` → `10`, the list; `149`, the fallback walk's filter before it enters a folder; `296`, the container walks' test after `tryAddSkillAt(childDir)` at `292` has checked the folder's own SKILL.md).
- Where the work lives: the discovery walks in `src/type-detection.ts`.

**Context**:
> - §5.2: "It never descends through `node_modules`, `.git`, `dist`, `build` or `__pycache__`. The walks over the search roots still check a folder of one of those names for a `SKILL.md` of its own, so `skills/build/SKILL.md` is a skill. The fallback walk skips those folders outright. This is how Vercel's walks apply the same list." And: "It never follows a symlinked directory."
> - Copy-safety is separate and unchanged (§1.4): path-traversal and symlink-escape guards still run before anything picked is copied.
> - Hidden folders are never plugin members (§5.3, task 2-2), which keeps `.git/hooks/` from ever being offered as a member.
> - Task 1-8's walk of a plugin's own `skills/` applies the same skip list and symlink rule, since §6.1 walks it "as discovery walks `skills/`".

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.4, §5.2, §5.3, §6.1
