# Phase 3: `--plugin` bundles everything discovery finds — 10 tasks

## vercel-skills-compatibility-3-1

### Task vercel-skills-compatibility-3-1: A bundle takes every skill discovery finds

**Problem**: `--plugin` bundles a skills-only source by taking what sits under its `skills/` folder. Today it copies each child of `skills/` as it stands (`copyAssetDir` in `src/copy-plugin-assets.ts`). Phase 1 lands those skills flat in their declared-name folders (task 1-8), but the bundle still takes only `skills/`. Skills in the other places discovery looks (§5.2) never join it: `skills/.curated`, the agent directories, the `.claude-plugin`-declared directories, and anything only the fallback walk reaches. A source whose skills sit in top-level folders is refused outright: "its structure is a collection of N members — cannot bundle" (`detectType` in `src/type-detection.ts`, §6.6). So a repo of skills published to be installed one by one through Vercel's CLI cannot be installed as one unit, which is the main capability agntc keeps (§1.1, §1.4).

**Solution**: Under `--plugin`, or `"type": "plugin"` in the `agntc.json` of what the source points at, the bundle holds every skill discovery finds in the source, wherever it sits. Internal skills are included. A bundle's discovery finds them, so they count as found when deciding whether the fallback walk runs. Skills the source's own `skills-lock.json` records stay out, as discovery leaves them out. Each skill installs flat in its declared-name folder. A skill that carries its own `agents/` keeps that folder inside the skill folder. The bundle is one manifest entry keyed `owner/repo`, recorded as a plugin, and it is installed and removed as one.

**Outcome**: `add owner/repo --plugin` on a Vercel-style repo installs every skill discovery finds as one entry. Each skill sits in its own declared-name folder, and no category folder appears in any agent's skills directory.

**Acceptance Criteria**:
- [ ] Given a skills-only repo holding `skills/engineering/tdd/SKILL.md` (declaring `tdd`), `skills/writing/prose-style/SKILL.md` (declaring `prose`) and `skills/lint/SKILL.md`, when `add owner/repo --plugin` runs for Claude, or `add owner/repo` runs with the repo's `agntc.json` declaring `"type": "plugin"`, no menu is shown, `.claude/skills/tdd/`, `.claude/skills/prose/` and `.claude/skills/lint/` are installed, no `engineering/` or `writing/` folder appears in `.claude/skills/`, and the manifest gains one entry, `owner/repo`, recorded as a plugin (§4.2, §4.3, §5.1, §6, §6.2, §14.1)
- [ ] Given a skills-only repo holding `skills/a/SKILL.md`, `skills/.curated/b/SKILL.md`, `.claude/skills/c/SKILL.md`, and `tools/d/SKILL.md` inside a directory `tools/` that `.claude-plugin/plugin.json` declares, when it is added with `--plugin`, `a`, `b`, `c` and `d` all install flat as one entry (§5.2, §6.2)
- [ ] Given a source whose search roots find nothing and whose skills are `guides/web/forms/validation/SKILL.md` and `docs/x/guide/SKILL.md`, when it is added with `--plugin`, `validation` and `guide` install flat as one entry (§5.2, §6.2)
- [ ] Given a source whose skills sit only in the top-level folders `a/SKILL.md` and `b/SKILL.md`, with no `skills/`, `agents/` or `hooks/` at its root, when it is added with `--plugin` or with `agntc.json` declaring `"type": "plugin"`, `a` and `b` install as one entry keyed `owner/repo`. Today the add is refused with "its structure is a collection of 2 members — cannot bundle" (§6.2, §6.6)
- [ ] Given a skills-only repo holding `skills/public/SKILL.md` and `skills/secret/SKILL.md`, whose frontmatter sets `metadata.internal: true`, when it is added with `--plugin`, both install. Given a source whose search roots hold only that internal `skills/secret/SKILL.md`, and which also holds `docs/x/guide/SKILL.md` that only the fallback walk reaches, `secret` installs and `guide` does not: the internal skill counts as found, so the fallback walk does not run (§5.2, §5.4, §6.2)
- [ ] Given a source whose own `skills-lock.json` records `foo`, whose `.claude/skills/foo/SKILL.md` declares `foo`, and which holds `skills/bar/SKILL.md`, when it is added with `--plugin`, `bar` installs and `foo` does not (§5.2)
- [ ] Given a bundled skills-only repo whose `skills/skill-creator/` holds SKILL.md beside `agents/analyzer.md`, when it is added for Claude, `agents/analyzer.md` lands inside that skill's declared-name folder in `.claude/skills/`, and nothing reaches `.claude/agents/` (§5.3)
- [ ] Given untracked files already in `.claude/skills/tdd/`, when the first repo's bundle is added for Claude at a terminal, the untracked-files prompt lists that folder (§10.1, §13)
- [ ] Given the first repo's bundle installed, when `remove owner/repo` runs, every bundled skill folder and the entry are removed (§6)

**Do**:
- Take the bundle's skills from discovery (§5.2), with internal skills found the way a bundle's discovery finds them (§5.4).
- Where the work lives:
  - `detectType` in `src/type-detection.ts`. Its skills-only override bundles `skills/` as an asset folder, and its members case raises today's "cannot bundle" `TypeConflictError`.
  - `copyAssetDir` in `src/copy-plugin-assets.ts`, which the spec cites.
  - `computePluginFiles` in `src/compute-incoming-files.ts`, which predicts the paths for the collision and untracked-files checks.
  - `runAdd` and `buildAddEntry` in `src/commands/add.ts`.

**Context**:
> - §6.2: "`--plugin` bundles a skills-only source as one unit. Vercel-style repos count. The bundle holds: every skill discovery finds (§5.2), including skills nested in category folders; internal skills (§5.4). The skills install flat, each in its own folder (§4.2)."
> - §5.4: "A bundle (`--plugin` or `"type": "plugin"`, §6.2) includes it: a bundle's discovery finds internal skills, so they count as found when deciding whether the fallback walk runs, and a source whose only skills are internal bundles them rather than being refused."
> - §5.1 rules 3 and 4: on a `skills/`-only source, and on any other shape, "`--plugin`, or `"type": "plugin"` in `agntc.json`," bundles what discovery finds instead of offering a menu. §6.6: "Any other source bundles whole (§6.2): skills wherever they sit, including folders at the repo's top level, and any plugin members."
> - §4.3: "A whole-source bundle keys `owner/repo`." §6: a unit is one manifest entry, "installed, updated, removed and version-pinned together". §14.1: "The manifest records `type: "plugin"` for a plugin and for a `--plugin` bundle alike, without recording which."
> - §5.3: a folder holding SKILL.md is a skill. "Everything in it, `agents/` included, is copied with it, and nothing in it is routed as a plugin asset."
> - Phase 2 builds discovery: its search roots, the fallback walk, priority order, the lock skip and the skip list (tasks 2-1 to 2-14). Phase 1 sets each skill's declared-name folder (tasks 1-1, 1-2, 1-9) and bundles a root SKILL.md beside `skills/` alone (task 1-7).
> - Other tasks in this phase cover the rest of the bundle:
>   - plugin members in a bundle: task 3-2;
>   - a path narrowing the bundle: task 3-3;
>   - what the bundle names as left out: task 3-4;
>   - its updates: tasks 3-5 and 3-8;
>   - its ceilings: task 3-6;
>   - the refusals: task 3-7;
>   - installables sharing a path: tasks 3-9 and 3-10.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.1, §1.4, §4.2, §4.3, §5.1, §5.2, §5.3, §5.4, §6, §6.2, §6.6, §10.1, §13, §14.1

## vercel-skills-compatibility-3-2

### Task vercel-skills-compatibility-3-2: Plugin members join a bundle with their agents and hooks routed

**Problem**: A source that holds plugin members (§5.3) cannot be bundled whole. When the members sit at its top level, `--plugin` is refused with "its structure is a collection of N members — cannot bundle" (`detectType` in `src/type-detection.ts`, §6.6). A member under `skills/` is copied as it stands (`copyAssetDir` in `src/copy-plugin-assets.ts`), so its agents land inside a skill folder, where no agent loads them (§6.2). A plugin member under a plugin's own `skills/` is copied the same way, so its agents and hooks never reach the agent either (§6.1).

**Solution**: Every plugin member that discovery reaches in a bundled source joins the bundle whole. Its parts are routed to their places:
- its skills install flat in their declared-name folders;
- its agents go to the agent's agents directory;
- its hooks go to the agent's hooks directory.

Each member is read by its §5.3 shape. A skill pack contributes its skills. A member holding SKILL.md in one of §5.1's plugin shapes contributes by that shape, and its SKILL.md is not installed. Hidden folders are never members. A plugin member found under a plugin's own `skills/`, or under a plugin member's own `skills/`, joins that unit the same way.

**Outcome**: A bundle that holds plugin members is a plugin. It is one entry, and its skills, agents and hooks each sit where the agent loads them.

**Acceptance Criteria**:
- [ ] Given a source whose top level holds two members, `review/` (holding `agents/reviewer.md` and `skills/lint/SKILL.md`) and `ops/` (holding `hooks/pre-commit.sh`), with no `skills/`, `agents/` or `hooks/` at its root, when it is added for Claude with `--plugin` or with `agntc.json` declaring `"type": "plugin"`, it installs as one entry keyed `owner/repo`. `reviewer.md` lands in `.claude/agents/`, `pre-commit.sh` in `.claude/hooks/`, and `lint` in `.claude/skills/lint/`. Today the add is refused with "cannot bundle" (§4.3, §6.2, §6.6)
- [ ] Given a skills-only repo holding `skills/style/SKILL.md` and the member `skills/review/pack/` (holding `agents/reviewer.md` and `skills/lint/SKILL.md`), when it is added with `--plugin` for Claude, `style` and `lint` land flat in `.claude/skills/`, `reviewer.md` lands in `.claude/agents/`, and no `review/` or `pack/` folder appears in `.claude/skills/` (§5.2, §6.2)
- [ ] Given a bundled source holding the skill pack `skills/bundles/pack/`, which holds only `skills/x/SKILL.md` and `skills/y/SKILL.md`, `x` and `y` install flat in their declared-name folders and no `pack/` folder appears in `.claude/skills/` (§5.3, §6.2)
- [ ] Given a bundled source holding a member folder in either of these shapes, the member's agents land in `.claude/agents/`, its skills land flat, and its SKILL.md is not installed (§5.1, §5.3):
  - SKILL.md beside `skills/` and `agents/`;
  - SKILL.md beside `agents/`, whose own `agntc.json` declares `"type": "plugin"`.
- [ ] Given a bundled source holding a member that holds SKILL.md beside `skills/` alone, whose own `agntc.json` declares `"type": "plugin"`, the skills under its `skills/` join the bundle and its SKILL.md is not installed (§5.1, §5.3)
- [ ] Given a bundled skills-only repo holding `skills/style/SKILL.md` beside the hidden folder `skills/.pack/`, which holds `agents/reviewer.md` and no SKILL.md, nothing reaches `.claude/agents/`. Given a bundled local-path source carrying `.git/hooks/`, nothing under `.git/` reaches `.claude/hooks/` or any agent's skills directory (§5.3)
- [ ] Given a plugin repo (`skills/` beside `agents/`) whose `skills/` holds the member `skills/pack/` (holding `hooks/check.sh` and `skills/x/SKILL.md`), when it is added for Claude, it is one entry: `check.sh` lands in `.claude/hooks/`, `x` lands in `.claude/skills/x/`, and no `pack/` folder appears in `.claude/skills/`. The same holds for a plugin member picked from the menu whose own `skills/` holds such a member (§6.1)

**Do**:
- Read each member by its §5.3 shape, with §5.1's plugin rules applied against the member's own `agntc.json`, as Phase 2 classifies members (task 2-2). Route its skills, agents and hooks to their places (§6.2).
- Where the work lives: the members case of `detectType` in `src/type-detection.ts`; `copyPluginAssets` and `copyAssetDir` in `src/copy-plugin-assets.ts`; `computePluginFiles` in `src/compute-incoming-files.ts`.

**Context**:
> - §6.2: "A source that holds plugin members (§5.3) also bundles whole, under `--plugin` or `"type": "plugin"`. Each member's skills, agents and hooks join the bundle and are routed to their places. A bundle that holds agents and hooks is simply a plugin." And: "Today such a member's folder is copied as it stands, so its agents land inside a skill folder, where no agent loads them."
> - §6.1: "a plugin member (§5.3) found under its `skills/` joins it as a bundle's members do (§6.2): the member's skills, agents and hooks are routed to their places". This holds "for a source that reads as a plugin, a plugin member (§5.3) and a source declaring `"type": "plugin"`, on `add` and on every update".
> - §5.3: hidden folders are never plugin members, "because a clone's `.git` holds `hooks/`".
> - A member's skills are the skills discovery finds under its own `skills/`, each flat in its declared-name folder (§6.1, task 1-8).
> - Other tasks handle the edges of a member's content:
>   - what a member's `skills/` holds that the bundle does not take: task 3-4;
>   - a member's skill on a folder another installable takes: task 3-9;
>   - a member's agent or hook on a taken path: task 3-10;
>   - the ceilings members carry: task 3-6.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §4.3, §5.1, §5.2, §5.3, §6.1, §6.2, §6.6

## vercel-skills-compatibility-3-3

### Task vercel-skills-compatibility-3-3: A path in the source narrows the bundle to that folder

**Problem**: An installer may want one folder of a repo's skills as a unit, such as one category. A GitHub tree URL to a category folder with `--plugin` is refused today. The folder's skill children read as collection members: "its structure is a collection of N members — cannot bundle" (`detectType` in `src/type-detection.ts`). Once a bundle takes every skill discovery finds (task 3-1), a bundle meant for one folder must not take the whole repo (§6.2).

**Solution**: A path in the source narrows the bundle to the folder it names. In this phase that path comes from a GitHub tree URL. Shape is read and discovery runs at that folder, and the bundle holds only what discovery finds there. The narrowed bundle keys `owner/repo/<path>`, the folder's path in the repository, as a tree-URL install keys today. A path at one skill together with `--plugin` is refused, as `--plugin` on any single skill is. The narrowed bundle updates from that folder and takes in a skill added there.

**Outcome**: A tree URL to a category folder, added with `--plugin`, installs that folder's skills as one entry keyed by the folder's path and nothing from elsewhere in the repo. It keeps doing so across updates.

**Acceptance Criteria**:
- [ ] Given a repo holding `skills/frontend/react/SKILL.md`, `skills/frontend/vue/SKILL.md` and `skills/backend/sql/SKILL.md`, when `https://github.com/owner/repo/tree/main/skills/frontend` is added for Claude with `--plugin`, the outcome is (§2.5, §4.3, §5.1, §6.2):
  - `react` and `vue` install flat from `main` as one entry keyed `owner/repo/skills/frontend`, with no constraint recorded;
  - `sql` is not installed, and no `frontend/` folder appears in `.claude/skills/`;
  - today the same add is refused with "cannot bundle".
- [ ] Given the folder the tree URL names holding the member `pack/` (holding `agents/reviewer.md`) beside `react/SKILL.md`, while the repo's `ops/` member outside that folder holds `hooks/pre-commit.sh`, the bundle installs `react` and `reviewer.md`, and nothing from `ops/` (§6.2)
- [ ] Given a tree URL naming a hidden folder `.pack/` that holds only `skills/a/SKILL.md` and `skills/b/SKILL.md`, when it is added with `--plugin`, `a` and `b` install as one entry keyed `owner/repo/.pack` (§4.3, §5.1, §6.2)
- [ ] Given a tree URL naming a single skill folder, `https://github.com/owner/repo/tree/main/skills/frontend/react`, which holds SKILL.md and no `skills/`, `agents/` or `hooks/`, when it is added with `--plugin`, the command exits non-zero and writes no file and no manifest entry. Its message names the refusal (§1.5, §6.5, §6.6)
- [ ] Given the first narrowed bundle installed from `main`, upstream then adds `skills/frontend/svelte/SKILL.md` and `skills/backend/go/SKILL.md`. When `update` runs with no argument, `svelte` joins the bundle, `go` is not installed, and the manifest still holds the one entry `owner/repo/skills/frontend` (§6.2)

**Do**:
- Read the shape and run discovery at the folder the path names (§5.1).
- Key the narrowed bundle by the folder's path, as `parseDirectPath` in `src/source-parser.ts` keys a tree-URL install today (§4.3).
- Where the work lives:
  - the unit folder `runAdd` derives for a direct-path source (`unitDir` in `src/commands/add.ts`), which `detectType` (`src/type-detection.ts`) reads;
  - `resolveUpdateSourceDir` and `resolveGuardedSourceDir` (`src/source-parser.ts`), through which update finds an entry's source folder.

**Context**:
> - §6.2: "A path in the source narrows the bundle to that folder." §6.6: "A path in the source is not a pick, and it works with `--plugin` (§6.2)."
> - §4.3: "A bundle narrowed by a path (§6.2) keys the same way, `owner/repo/<path>`, where `<path>` is the folder the path names: `--plugin` with a tree URL to `skills/frontend/` keys `owner/repo/skills/frontend`, as a tree-URL install keys today."
> - §5.1: "Shape is read at the root of what the source points at: the repo root, or the path the source names." Rule 3: a `skills/`-only folder is a menu by default, and `--plugin` bundles it. A path naming a non-hidden folder of that shape names a skill pack, a plugin member, and `--plugin` on it is redundant (task 2-7). A hidden folder of that shape is no member, so `--plugin` bundles it.
> - §6.5: "a path at one skill together with `--plugin` is refused, as `--plugin` on any single skill is (§6.6)". A refusal is pre-flight: non-zero exit, nothing written (§1.5).
> - §2.5: a tree URL's ref is read the way the same `#` fragment would be. A branch installs that branch with no constraint recorded.
> - Related work elsewhere:
>   - Phase 5: the `owner/repo/<path>` shorthand and the GitLab `/-/tree/` and Azure `?path=` forms narrow a bundle the same way once they are accepted.
>   - Phase 8: a path landing inside a unit without `--plugin`.
>   - Task 3-4: what a narrowed bundle names as left out.
>   - Task 3-8: the stop when the folder holds nothing the bundle takes.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.5, §2.5, §4.3, §5.1, §6.2, §6.5, §6.6

## vercel-skills-compatibility-3-4

### Task vercel-skills-compatibility-3-4: A bundle names what its bundled folder holds but does not take

**Problem**: Today `--plugin` copies every child of `skills/` as it stands, loose files included (`copyAssetDir` in `src/copy-plugin-assets.ts`). A bundle now installs only what discovery finds (task 3-1), so a loose file or a folder holding no skill in the bundled folder is no longer installed. If nothing said so, an author's README or asset folder that used to land in the skills directory would vanish silently (§6.2). Naming a repository root's README, licence and package files on every add and update would be no better: they were never installed, so naming them tells the installer nothing.

**Solution**: A bundle names what its bundled folder holds but does not take, as a plugin names what its `skills/` leaves out (§6.1). The bundled folder is the `skills/` folder of what the source points at. Where a path names a folder holding no `skills/`, the bundled folder is that folder itself. A repository root holding no `skills/` names nothing at its top level. A plugin member the bundle takes names what its own `skills/` leaves out. An update names the same things the add did.

**Outcome**: On add and on every update, the installer sees each loose file and skill-less folder in the bundled folder that the bundle did not install, and nothing outside that folder.

**Acceptance Criteria**:
- [ ] Given a skills-only repo whose `skills/` holds `lint/SKILL.md`, a loose `README.md` and a folder `assets/` holding no skill, beside a root `README.md` and `LICENSE`, when it is added with `--plugin`, the outcome is (§6.2):
  - `lint` installs, and neither the `README.md` nor `assets/` from `skills/` reaches `.claude/skills/`;
  - the output names the `README.md` and `assets/` in `skills/` as left out;
  - the output names neither the root `README.md` nor `LICENSE`.
- [ ] Given a source whose skills sit in the top-level folders `a/` and `b/`, with no `skills/`, beside a root `README.md`, `LICENSE` and `package.json`, when it is added with `--plugin`, `a` and `b` install and the output names none of the root's files as left out (§6.2)
- [ ] Given `https://github.com/owner/repo/tree/main/skills/frontend` added with `--plugin`, where `skills/frontend/` holds `react/SKILL.md`, a loose `NOTES.md` and a folder `img/` holding no skill, and holds no `skills/`, the output names `NOTES.md` and `img/` as left out (§6.2)
- [ ] Given a bundled source holding the member `pack/` (holding `agents/reviewer.md`), whose own `skills/` holds `x/SKILL.md` and a loose `README.md`, that `README.md` is not installed and the output names it as left out (§6.1)
- [ ] Given such a bundle installed, when `update` runs with those files still in the source, none of them is installed and the update's output names the same files and folders as left out again (§6.2, §14.1)

**Do**:
- Name what is left out as a plugin names what its `skills/` leaves out (§6.1, task 1-8).
- Where the work lives: add's output from `renderAddSummary` (`src/summary.ts`); update's output in `src/commands/update.ts` and `src/update-render.ts`.

**Context**:
> - §6.2: "Anything in the bundled folder that the bundle does not take, a loose file or a folder holding no skill, is not installed, and the output names it, as for a plugin (§6.1). The bundled folder is the `skills/` folder of what the source points at, as a plugin's is its `skills/`; where a path into the repository names a folder holding no `skills/`, it is that folder. A repository root holding no `skills/` names nothing at its top level: its README, licence and package files were never installed, and naming them on every add and update would tell the installer nothing. The manifest records a plugin and a bundle alike (§14.1), so `add` and `update` name the same things."
> - §6.1: a plugin member's `skills/` leaves out loose files and folders holding no skill, and the output names them.
> - Other things a bundle leaves out are named in other tasks: a skill whose folder another skill takes in task 3-9, and a member's agent or hook on a taken path in task 3-10.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §6.1, §6.2, §14.1

## vercel-skills-compatibility-3-5

### Task vercel-skills-compatibility-3-5: Updating a bundle works out its contents again

**Problem**: Update replays a recorded plugin by copying whichever of `skills/`, `agents/` and `hooks/` sit at its root. When none does, it stops the entry with "recorded as plugin but no asset dir (skills/agents/hooks) remains in the source" (`replayRecordedPlugin` in `src/nuke-reinstall-pipeline.ts`). A bundle made from top-level skill folders or plugin members has no such folder at its root, so every update of it would stop. A bundle holding skills outside its source's `skills/`, such as in `.claude/skills/` or within the fallback walk's reach, would lose them on update. The manifest records a plugin and a bundle alike (§14.1), so the entry itself cannot tell update which one it is.

**Solution**: Each update works out the bundle's contents from the source as it now stands, the way the add did: every skill and plugin member discovery finds, internal skills included. Whether the source still supports the bundle is judged by whether discovery finds anything the bundle takes, not by whether an asset folder sits at its root. A skill, agent or hook the author adds joins the bundle. One the author removes leaves it, and its installed files are gone. A bundle made from a root SKILL.md beside `skills/` alone stays that bundle, with the root SKILL.md still left out.

**Outcome**: A bundle tracks its source across updates as one entry, whatever shape the source has. It gains what the author adds and drops what the author removes.

**Acceptance Criteria**:
- [ ] Given a category-nested skills-only repo installed with `--plugin`, upstream then adds `skills/writing/edit/SKILL.md` and removes `skills/engineering/tdd/`. When `update` runs by the entry's key or with no argument, `.claude/skills/edit/` is installed, `.claude/skills/tdd/` is gone, and the manifest still holds one entry (§6.2)
- [ ] Given a bundle made from the top-level skill folders `a/` and `b/`, with no `skills/`, `agents/` or `hooks/` at the source's root, when `update` runs, `a` and `b` reinstall as one entry and the update does not stop (§6.2)
- [ ] Given a bundle holding the top-level member `review/` with `agents/reviewer.md`, upstream then adds `review/agents/triage.md` and `review/hooks/check.sh` and removes `reviewer.md`. After `update`, `.claude/agents/triage.md` and `.claude/hooks/check.sh` are installed and `.claude/agents/reviewer.md` is gone (§6.2)
- [ ] Given a bundle holding `skills/a/` and `.claude/skills/c/` from its source, when `update` runs, both are still installed (§5.2, §6.2)
- [ ] Given a bundle holding the internal `skills/secret/`, when `update` runs, `secret` is still installed (§5.4, §6.2)
- [ ] Given a `--plugin` bundle made from a root SKILL.md beside `skills/` alone, upstream then adds a skill under `skills/`. When `update` runs, the new skill joins the bundle and the root SKILL.md is still not installed (§6.6)
- [ ] Given a category-nested local-path source bundled with `--plugin`, a skill is then added to it. When `update` runs by the entry's key, the new skill joins the bundle (§1.2, §6.2)

**Do**:
- Judge whether the source still supports the bundle by whether discovery finds anything the bundle takes, not by whether a `skills/`, `agents/` or `hooks/` folder sits at its root (§6.2).
- Where the work lives: `replayRecordedPlugin` in `src/nuke-reinstall-pipeline.ts` (the spec cites this file), gated today by `findPresentAssetDirs` (`src/type-detection.ts`). Single-key update, all-mode update (`src/update-groups.ts`) and `list`'s update actions all reach it through `src/clone-reinstall.ts`.

**Context**:
> - §6.2: "The bundle is reinstalled from the source on every update. A skill the author adds joins it, and a skill the author removes leaves it. Whether the source still supports the bundle is whether discovery finds anything the bundle takes, not whether a `skills/`, `agents/` or `hooks/` folder sits at its root."
> - §6.1: a plugin's skills are found the same way "on `add` and on every update" (task 1-8). §6.6: `--plugin` on a source that already reads as a plugin is redundant and changes nothing.
> - §6.6: "`--plugin` on a root `SKILL.md` beside `skills/` alone bundles the skills under `skills/` and leaves the root `SKILL.md` out, as it does today. ... The flag is the installer's explicit request for the bundle, so lines written today and the bundles already made from that shape keep working" (task 1-7).
> - §12.5: update replays the agents recorded at install.
> - Related work elsewhere:
>   - Task 3-8: an update that finds nothing the bundle takes stops the entry.
>   - Phase 4 (§12.6): a gained skill, agent or hook whose target is already occupied.
>   - Phase 4 (§5.5): an entry recorded as a plugin whose source now holds a SKILL.md at its unit root, no `skills/` there and no `"type": "plugin"` is repaired into a skill.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.2, §5.2, §5.4, §5.5, §6.1, §6.2, §6.6, §12.5, §12.6, §14.1

## vercel-skills-compatibility-3-6

### Task vercel-skills-compatibility-3-6: A bundle or plugin installs within every ceiling it holds

**Problem**: An author restricts which agents a unit installs for with an `agntc.json` `agents` list, a capability agntc keeps (§1.4). `add` reads only the `agntc.json` at the root of what the source points at (`readConfig` in `runAdd`, `src/commands/add.ts`), and update reads the same one (`executeNukeAndReinstall` in `src/nuke-reinstall-pipeline.ts`). A bundle or plugin that takes in a skill or member restricted to Claude would therefore also install it for Cursor. That widens the ceiling its author set, which holds when it installs on its own (§6, §6.2).

**Solution**: A bundle installs within every agent ceiling it holds: the source's own `agntc.json`, and that of each skill and plugin member it takes. A plugin, or a plugin member, installs within its own ceiling and those of the skills and members it takes from its `skills/`. The unit's ceiling is the set of agents all of them allow. The agent prompt offers only those agents, and is skipped when that set is exactly one agent and that agent is detected. Ceilings that together allow no agent refuse the add. An update installs within the ceilings the unit holds at that time.

**Outcome**: Bundling or nesting a restricted skill or member never installs it for an agent its author excluded. The whole unit narrows to what every ceiling in it allows.

**Acceptance Criteria**:
- [ ] Given a bundled source whose member `review/` has its own `agntc.json` with `agents: ["claude"]`, when it is added with `--plugin` at a terminal with Claude detected, no agent prompt is shown and the whole bundle installs for Claude only. With Claude not detected, the agent prompt offers Claude alone (§6.2, §8.2, §10.1)
- [ ] Given a bundled skill `skills/lint/` whose own `agntc.json` restricts to Claude, when the bundle is added, it installs for Claude only, and nothing of the bundle lands in `.agents/skills/` or `.cursor/skills/` (§6, §6.2)
- [ ] Given a bundle whose root `agntc.json` allows Claude and Codex and whose member allows Codex and Cursor, when it is added with Codex detected, it installs for Codex alone with no agent prompt (§8.2, §10.1)
- [ ] Given a plugin repo (`skills/` beside `agents/`) whose `skills/x/` has its own `agntc.json` restricting to Claude, or whose `skills/` holds a plugin member restricted to Claude, when it is added, the plugin installs for Claude only. The same holds for a plugin member named by a tree URL whose own `skills/` holds such a skill (§6.1, §8.2)
- [ ] Given a bundle holding a member restricted to Claude and a skill restricted to Cursor, when it is added with `--plugin`, the command exits non-zero and writes no file and no manifest entry. Its message names the source and says its agent restrictions leave no agent to install for (§1.5, §8.2)
- [ ] Given a bundle installed for Claude and Cursor, a bundled skill's own `agntc.json` upstream then restricts to Claude. When `update` runs, the bundle reinstalls for Claude only, Cursor's copies are gone, and the output names Cursor as no longer supported, as an update does today when a unit's own `agntc.json` narrows (§6.2, §12.5)

**Do**:
- Offer only the combined ceiling's agents in the agent prompt. `selectAgents` (`src/agent-select.ts`, which the spec cites) does this today for the declared agents, and auto-selects a single detected one (§8.2, §10.1).
- Where the work lives: `runAdd` in `src/commands/add.ts`, which passes the root's `config?.agents` to `selectAgents`; `readConfig` in `src/config.ts`; update's `resolveAgents` and `onAgentsDropped` in `src/nuke-reinstall-pipeline.ts`.

**Context**:
> - §6.2: "The bundle installs within every agent ceiling it holds: the source's own `agntc.json`, and that of each skill and each plugin member it takes. A skill's own `agntc.json` is its ceiling when it installs on its own (§6), and bundling it does not widen that. So a member restricted to Claude narrows the whole bundle to Claude."
> - §6.1: "the plugin installs within the ceilings of the skills and members it takes from its `skills/`, as a bundle does (§6.2)". This holds for a source that reads as a plugin, a plugin member and a source declaring `"type": "plugin"`, on `add` and on every update.
> - §8.2: "A unit's ceiling is every ceiling it holds (§6.1, §6.2): the agents all of them allow. The agent prompt offers only those agents, as it offers only the declared agents today (`selectAgents` in `src/agent-select.ts`), so a bundle holding a Claude-only member offers Claude alone." And: "A single-unit run where the ceiling excludes every named agent is refused (§1.5)." Ceilings that together allow no agent exclude every agent.
> - §10.1: the agent prompt "offers the agents within the unit's ceiling (§8.2), and is skipped when that ceiling is exactly one agent and that agent is detected".
> - An `agntc.json` with no usable `agents` list sets no ceiling, as today (`readConfig`, `src/config.ts`).
> - Related work elsewhere: naming agents with `-a` against these ceilings is Phase 9, and `-y` is Phase 11. In Phase 8, a pick from inside a unit installs within the unit's ceiling.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.4, §1.5, §6, §6.1, §6.2, §8.2, §10.1, §12.5

## vercel-skills-compatibility-3-7

### Task vercel-skills-compatibility-3-7: --plugin is refused only on a single skill or a source with nothing to bundle

**Problem**: `--plugin` refuses shapes it should bundle, and reports success when it installs nothing. A source with member folders at its top level is refused with "its structure is a collection of N members — cannot bundle" (`detectType` in `src/type-detection.ts`, §6.6). A skills-only source whose `skills/` is empty warns "No files to install" and exits 0 (`runAdd`, `src/commands/add.ts`), which an AI agent caller reads as success (§1.5). Once `add` takes `--full-depth` (task 2-6), `--plugin --full-depth` would build a bundle from the full walk. No update could rebuild that bundle, because the manifest records nothing that would let an update repeat the walk (§6.6). §6.6 sets which shapes `--plugin` refuses, bundles or leaves unchanged, and each case must hold under the bundle this phase builds.

**Solution**: `--plugin` and `"type": "plugin"` bundle every source except these:
- **A single skill.** `--plugin` on a root SKILL.md is refused, and that includes a root SKILL.md beside `agents/` or `hooks/` that declares no `"type": "plugin"`. The one excepted shape is a root SKILL.md beside `skills/` alone, which bundles the skills under `skills/` and leaves the SKILL.md out.
- **Nothing to bundle.** A source in which discovery finds nothing the bundle takes is refused, as an add finding nothing installable is. A source whose only skills are internal is not such a source: it bundles them.
- **`--full-depth`.** `--plugin` together with `--full-depth` is refused, and so is `--full-depth` on a source whose `agntc.json` declares `"type": "plugin"`. The message names the two as not combining.

`--plugin` on a plugin changes nothing. Every refusal is pre-flight.

**Outcome**: An add with `--plugin`, or of a source declaring `"type": "plugin"`, either installs a bundle or exits non-zero with nothing written. When it refuses, the message names what was refused.

**Acceptance Criteria**:
- [ ] Given a repo whose only content is a root SKILL.md, when it is added with `--plugin`, the command exits non-zero and writes no file and no manifest entry. Its message names the refusal (§1.5, §6.6)
- [ ] Given a root SKILL.md beside `agents/` (or `hooks/`) with no `"type": "plugin"`, when it is added with `--plugin`, it is refused the same way. Given the same root whose `agntc.json` declares `"type": "plugin"`, adding it with `--plugin` installs it as a plugin, exactly as it installs without the flag (§5.1, §6.6)
- [ ] Given a root SKILL.md beside `skills/` alone, when it is added with `--plugin`, the skills under `skills/` install flat as one entry, category-nested ones included, and the root SKILL.md is not installed (§6.6)
- [ ] Given a plugin repo (`skills/` beside `agents/`), when it is added with `--plugin`, it installs exactly as without the flag (§6.6)
- [ ] Given a skills-only repo whose `skills/` is empty, or holds only `README.md`, when it is added with `--plugin` or with `agntc.json` declaring `"type": "plugin"`, the command exits non-zero, writes no file and no manifest entry, and says nothing installable was found. Today the empty case warns "No files to install" and exits 0, and the `README.md` case copies the README into the agent's skills directory (§1.5, §5.1)
- [ ] Given a skills-only repo whose only skills, `skills/a/` and `skills/b/`, set `metadata.internal: true`, when it is added with `--plugin`, both install as one entry (§5.4)
- [ ] Given `add owner/repo --plugin --full-depth`, or `add owner/repo --full-depth` on a repo whose `agntc.json` declares `"type": "plugin"`, the command exits non-zero and writes no file and no manifest entry. Its message names `--full-depth` and the `--plugin` flag (or the `"type": "plugin"` declaration) as not combining (§6.6, §9.1)
- [ ] Given a project with existing installs, when an add with `--plugin` is refused, the manifest and every agent's skills, agents and hooks directories are unchanged (§1.5)

**Do**:
- Where the work lives:
  - `detectType` in `src/type-detection.ts`, which raises today's `TypeConflictError` for a bare skill and for a members-shaped source;
  - `runAdd` in `src/commands/add.ts`, which turns that error into a refusal, and which warns "No files to install" and exits 0 for a plugin that copies nothing;
  - the nothing-installable refusal task 2-8 adds, and the `--full-depth` option task 2-6 declares on `add` (`src/commands/add.ts`).

**Context**:
> - §6.6: "`--plugin` on a plugin is redundant and changes nothing, as today." "`--plugin` on a single skill (a root `SKILL.md`) is refused (§1.5)", with one shape excepted: "`--plugin` on a root `SKILL.md` beside `skills/` alone bundles the skills under `skills/` and leaves the root `SKILL.md` out, as it does today." "One case changes and is now refused: `--plugin` on a root `SKILL.md` beside `agents/` or `hooks/` that declares no `"type": "plugin"`." "Any other source bundles whole (§6.2): skills wherever they sit, including folders at the repo's top level, and any plugin members."
> - §6.6: "`--plugin` together with `--full-depth` is refused (§1.5), and so is `--full-depth` on a source whose `agntc.json` declares `"type": "plugin"`. A bundle holds what normal discovery finds (§5.2), so every update rebuilds exactly what was installed; the manifest records nothing that would let an update repeat the full walk. The message names the two as not combining." §9.1 lists the same refusal among `add`'s refused flags.
> - §5.1: "A source where discovery finds nothing installable is refused (§1.5)." §5.4: "a source whose only skills are internal bundles them rather than being refused."
> - §1.5: a refusal exits non-zero, writes nothing and removes nothing, and its message names what was refused, and the way through where one exists.
> - Phase 1 brought in the refusal on a root SKILL.md beside `agents/` or `hooks/` (task 1-6) and the bundle of a root SKILL.md beside `skills/` alone (task 1-7). This task makes them hold under the bundle this phase builds.
> - Related work elsewhere:
>   - Tasks 3-1 and 3-2: sources with top-level skill folders or members bundle.
>   - Task 3-3: a tree URL to one skill with `--plugin` is refused.
>   - Phase 8: `--plugin` together with a named skill is refused (§6.6).
>   - Phase 12: the rest of `add`'s flag set and the unknown-flag refusal.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.5, §5.1, §5.4, §6.2, §6.6, §9.1

## vercel-skills-compatibility-3-8

### Task vercel-skills-compatibility-3-8: An update that finds nothing a bundle takes stops with the install intact

**Problem**: Once a bundle's support is judged by what discovery finds (task 3-5), its source can stop holding anything the bundle takes. Every skill may be removed upstream, or the folder a path narrowed the bundle to may be emptied. Removing the bundle's files then would leave the user with nothing installed. Reporting the update as a success would mislead an AI agent caller, which acts on the exit status rather than the text (§1.5).

**Solution**: When an update finds nothing the bundle takes, that entry stops before anything is removed. Its files and manifest entry stay as they were, the output says why, and the command exits non-zero. The update never removes the entry: removing it is the user's call. Other entries in the same update proceed. A source whose only skills are now internal still supports the bundle, since a bundle's discovery finds internal skills.

**Outcome**: A bundle whose source has emptied stays installed and is reported. The run's other entries still update, and the exit status shows the partial result.

**Acceptance Criteria**:
- [ ] Given a bundle installed from a skills-only repo, upstream then removes every skill, leaving only `skills/README.md`. When `update` runs by the entry's key, the bundle's files and manifest entry are unchanged, the output names the entry and says its source no longer holds anything the bundle takes, and the command exits non-zero (§6.2)
- [ ] Given that bundle and another entry with a newer version upstream, when `update` runs with no argument, the other entry updates and the bundle stops as above with its entry still in the manifest. The command exits non-zero (§6.2)
- [ ] Given a bundle whose source's only remaining skills set `metadata.internal: true`, when `update` runs, the bundle reinstalls holding those skills, the skills removed upstream are gone, and the command exits 0 (§5.4, §6.2)
- [ ] Given a bundle narrowed by `https://github.com/owner/repo/tree/main/skills/frontend`, upstream then removes every skill in `skills/frontend/`, or the folder itself, while skills elsewhere in the repo remain. `update` stops that entry the same way, with its files and manifest entry unchanged (§6.2)

**Do**:
- Stop the entry before any file is removed, with its install left intact, as `update` does today when a re-cloned source no longer supports what an entry recorded (`src/nuke-reinstall-pipeline.ts`, which the spec cites) (§6.2).
- Where the work lives:
  - `replayRecordedPlugin` in `src/nuke-reinstall-pipeline.ts`, which returns today's `aborted` outcome;
  - the abort report, `buildAbortMessage` in `src/clone-reinstall.ts`, which `failureMessage` there also uses for `list`'s update action;
  - the partial-success exit accounting, `hasFailedOutcome` in `src/commands/update.ts`.

**Context**:
> - §6.2: "An update that finds nothing the bundle takes stops that entry with its install intact, says why and exits non-zero, as `update` does today when a re-cloned source no longer supports what an entry recorded (`src/nuke-reinstall-pipeline.ts`); removing the entry is the user's call."
> - §5.4: a bundle's discovery finds internal skills, and they count as found.
> - §1.5: an exit 0 reads as success to an AI agent caller, which acts on the exit status rather than the text.
> - Today's derive-before-delete abort ends with "To migrate: npx agntc remove <key> then npx agntc add <key>" (`buildAbortMessage`, listed in §14.2). Phase 15 makes any command printed here one agntc accepts, acting on the entry as advised.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §1.5, §5.4, §6.2, §14.2

## vercel-skills-compatibility-3-9

### Task vercel-skills-compatibility-3-9: Skills in one unit sharing an install folder: the first installs

**Problem**: A bundle or plugin takes skills from many places, and two of them can land on one install folder. Two skills may declare the same name. Two names may collide only once sanitized (`Foo Bar` and `foo-bar`). A loose skill and a member's own skill may both install into `x`. Copying both would have one overwrite the other in the agent's skills directory, and which one survived would depend on copy order (§5.2, §6).

**Solution**: Within one unit, two skills never write the same install folder. Of skills that would take the same folder, the first in priority order installs and the others are left out. The output names each one left out, and for a member's skill, the member it came from. Priority order is §5.2's:
- the search roots in the order listed, then the fallback walk;
- depth-first within one walk, with a folder before its children;
- a folder's children in name order;
- a plugin member at the place the walk reaches it.

The same holds for a plugin's own skills. An update keeps the same skill and names the other again.

**Outcome**: A unit with colliding skills installs one copy per folder, always the same one, and tells the installer which ones it left out.

**Acceptance Criteria**:
- [ ] Given a bundled source holding `skills/a/x/foo/SKILL.md` and `skills/b/foo/SKILL.md`, both declaring `foo`, beside `skills/c/SKILL.md`, when it is added with `--plugin` for Claude, `.claude/skills/foo/` holds the content of `skills/a/x/foo/`, whatever order the filesystem lists `a` and `b` in. The output names the `foo` from `skills/b/` as left out (§5.2, §6)
- [ ] Given a bundled source holding the top-level `shared/SKILL.md` and `skills/other/SKILL.md`, both declaring `shared`, `.claude/skills/shared/` holds the content of the top-level `shared/`, which the source-root walk reaches first. The output names the other as left out (§5.2)
- [ ] Given a bundled source holding `skills/a/SKILL.md` declaring `Foo Bar` and `skills/b/SKILL.md` declaring `foo-bar`, `.claude/skills/foo-bar/` holds the content of `skills/a/` and the output names the one from `skills/b/` as left out (§4.2, §5.2)
- [ ] Given a bundled skills-only repo holding `skills/x/SKILL.md` (declaring `x`) and the member `skills/zpack/`, which holds `agents/helper.md` and its own `skills/x/SKILL.md` declaring `x`, the outcome is (§5.2, §6):
  - `.claude/skills/x/` holds the loose skill's content;
  - `helper.md` still installs;
  - the output names `x` as left out and `skills/zpack` as the member it came from.
- [ ] Given a bundled skills-only repo holding the top-level member `pack/`, which holds `agents/helper.md` and its own `skills/x/SKILL.md` declaring `x`, beside `skills/x/SKILL.md` declaring `x`, `.claude/skills/x/` holds the member's `x`, which the source-root walk reaches first. The output names the `x` from `skills/x/` as left out (§5.2, §6)
- [ ] Given a plugin repo (`skills/` beside `agents/`) whose `skills/a/SKILL.md` and `skills/b/SKILL.md` both declare `dup`, when it is added, `.claude/skills/dup/` holds the content of `skills/a/` and the output names the other as left out (§6.1)
- [ ] Given any of these units installed, when `update` runs with the same skills upstream, the same skill installs into the folder and the output names the other again (§6.2)

**Do**:
- Decide "first" by §5.2's priority order, as discovery decides it (tasks 2-11, 2-12). A folder's children are taken in name order, as agntc's member scan takes them today (`names.sort()` in `src/type-detection.ts`).
- Where the work lives:
  - the bundle's copy in `src/copy-plugin-assets.ts`, and the paths `computePluginFiles` (`src/compute-incoming-files.ts`) predicts;
  - update's re-copy in `replayRecordedPlugin` (`src/nuke-reinstall-pipeline.ts`);
  - add's output in `src/summary.ts`, and update's in `src/commands/update.ts` and `src/update-render.ts`.

**Context**:
> - §5.2: "When two skills declare the same name, the first in priority order is kept. Two installables from one source that would take the same install folder or the same key count as the same name, and the first in priority order is kept." "A plugin member's place in that order is where the walk reaches it."
> - §6: "Within one run, two of the source's installables never write the same path. This applies to every run: inside a `--plugin` bundle (§6.2), and across the entries a run installs ... A plugin member's skill, agent or hook can land on a path that a skill or member earlier in priority order (§5.2) already takes. Examples are ... a member's `skills/x/` beside a loose skill installing into `x`. In that case the earlier one is kept. The output names what was left out and the member it came from".
> - §6.1: a plugin's skills are found "as a bundle's are", by the same walk and the same rules.
> - The name compared is the declared name as Phase 1 reads it, or the folder name for a skill that declares none (§3.2, §4.1). The install folder is its §4.2 sanitized form (task 1-2).
> - Related work elsewhere: a member's agent or hook on a taken path is task 3-10. Phase 8 applies the same rule across the separate entries of one run.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §3.2, §4.1, §4.2, §5.2, §6, §6.1, §6.2

## vercel-skills-compatibility-3-10

### Task vercel-skills-compatibility-3-10: A member's agent or hook on a path already taken is left out and named

**Problem**: Plugin members that join one unit route their agents into one `.claude/agents/` and their hooks into one `.claude/hooks/`. Two members can each ship `agents/reviewer.md`. A plugin's own `agents/reviewer.md` can meet the same file from a member nested in its `skills/`. Either way both would write the same path, and the later copy would silently replace the earlier one (§6).

**Solution**: When a member's agent or hook lands on a path that something earlier in priority order already takes, the earlier copy is kept and the member's copy is left out. The output names the file and the member it came from. A unit's own agents and hooks, at its root, come before anything found below it, so a plugin's own file is kept over a nested member's. The rest of that member still installs. An update leaves out the same paths and names them again.

**Outcome**: Each agent and hook path in a unit is written once, by the installable first in priority order, and the installer is told which member's copy was left out.

**Acceptance Criteria**:
- [ ] Given a bundled skills-only repo holding the top-level member `review/` and the member `skills/qa/`, each shipping `agents/reviewer.md`, when it is added with `--plugin` for Claude, `.claude/agents/reviewer.md` holds `review/`'s copy. The output names `reviewer.md` as left out and `skills/qa` as the member it came from (§5.2, §6)
- [ ] Given those two members each shipping `hooks/pre-commit.sh` instead, `.claude/hooks/pre-commit.sh` holds `review/`'s copy, and the output names `pre-commit.sh` and `skills/qa` the same way (§6)
- [ ] Given `skills/qa/` also shipping `agents/tester.md`, `hooks/lint.sh` and `skills/check/SKILL.md`, none of which anything else in the bundle takes, all three install beside the left-out `reviewer.md` (§6)
- [ ] Given a plugin repo shipping `agents/reviewer.md`, whose `skills/` holds the member `skills/pack/` that also ships `agents/reviewer.md`, when it is added for Claude, `.claude/agents/reviewer.md` holds the plugin's own copy. The output names `reviewer.md` as left out and `skills/pack` as the member it came from. The same holds for a file in the plugin's own `hooks/` (§6, §6.1)
- [ ] Given any of these units installed, when `update` runs with both copies still in the source, the same copy installs and the output names the member's copy as left out again (§6.2)

**Do**:
- Order a unit's own agents and hooks, at its root, before anything found below it, as a folder comes before its children in §5.2's priority order (§6).
- Where the work lives:
  - `copyPluginAssets` and `copyAssetDir` in `src/copy-plugin-assets.ts`, and the paths `computePluginFiles` (`src/compute-incoming-files.ts`) predicts;
  - update's re-copy in `replayRecordedPlugin` (`src/nuke-reinstall-pipeline.ts`);
  - add's output in `src/summary.ts`, and update's in `src/commands/update.ts` and `src/update-render.ts`.

**Context**:
> - §6: "A plugin member's skill, agent or hook can land on a path that a skill or member earlier in priority order (§5.2) already takes. Examples are two members that each ship `agents/reviewer.md`, ... In that case the earlier one is kept. The output names what was left out and the member it came from, as a pick from a unit names what it leaves out (§6.5). A unit's own agents and hooks, at its root, come before anything found below it, as a folder comes before its children (§5.2). So a member nested in a plugin's `skills/` (§6.1) never displaces the plugin's own file: the member's copy is left out and named. This is the one case where a plugin member installs less than whole."
> - §5.2: a plugin member's place in priority order is where the walk reaches it. The source-root walk comes before the walk of `skills/`.
> - A bundle is worked out again on every update (task 3-5), so the same collisions leave out the same paths.
> - Related work elsewhere: Phase 8 applies the same rule across the separate entries of one run, and covers a later update of a member left less than whole because another entry holds the path.

**Spec Reference**: `.workflows/vercel-skills-compatibility/specification/vercel-skills-compatibility/specification.md` — §5.2, §6, §6.1, §6.2, §6.5
