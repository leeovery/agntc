# Discussion: Vercel Skills Compatibility

## Context

agntc should be a like-for-like replacement for Vercel's `skills` CLI: anything built for their skills library installs through agntc by swapping the binary — `npx skills add owner/repo` → `npx agntc add owner/repo` — with the same source formats and flags, unattended installs, and a pre-install summary, producing an equivalent install. It must do this without breaking agntc's own formats and systems, in particular `--plugin`, which bundles a skills-only source as one unit. That bundling is something Vercel's CLI does not do and is the reason agntc exists; the owner has used it to install a large set of skills by one author that are designed to be installed individually through Vercel's CLI. Partially-done paths found along the way are fixed as part of this work.

### Inherited position (discovery, research)

Carried forward as working ground — soft, movable when this discussion surfaces something that contradicts it, never re-elicited:

- **One feature.** Three inbox ideas were pulled together: non-interactive install flags, Vercel CLI cross-compatibility, a richer post-clone `add` intro. Unattended flags and the post-clone summary are parts of Vercel's `add` surface, so they sit inside the compatibility surface rather than as separate deliverables.
- **Reshape cue.** If whole capabilities agntc has no equivalent for (installing once for every project rather than per project, searching Vercel's directory) are judged in scope, the work becomes several connected pieces and should be re-shaped. The owner may roadmap some extra work for later rather than have it ride along.
- **Out of scope by discovery:** the broader validation bucket, and the member-select wording idea (stays in the inbox as quick-fix material). Two validation strands surface here regardless: Vercel's frontmatter validity rule, and unattended installs removing the last human look before hook scripts land.
- **The owner's bar:** Vercel install lines work as expected. For each mismatch the paths are adapt agntc's rules, change them, or make both work. The configless-install spec's "no install-command flags for type or unit selection, except `--plugin`" decision (`.workflows/configless-install/specification/configless-install/specification.md:52`) is open to reopening — it was recorded as a deliberate reaction against Vercel's flag-heavy `add`, and the carrier's "same flags" meets it head-on.
- **`@` must get one meaning** (or a rule that reads it) — named by the owner.
- **The re-add defect rides along**, not as a separate bugfix.
- **agntc's reason to exist stands** (research, 2026-10-06): Vercel's model is "a repo is a bag of independent skills". On the owner's workflows repo (38 skills, 34 agents, `agntc.json` → `{"agents": ["claude"]}`) Vercel v1.7.0 would install 6 of 38 skills (32 lack a frontmatter `description`), none of the agents, no unit, ignoring the Claude-only restriction. agntc's distinct value: units (skills + agents + hooks, plus `--plugin` bundling), the author's agent ceiling, semver constraints with constrained update, a lenient validity posture (no frontmatter gate), and copy-safety (symlink-escape blocking). Most of Vercel's surface is additive for agntc; the points where it presses on agntc's guarantees are few and nameable — picking a skill out of a unit, the validity gate, the author's agent restriction vs Vercel's fan-out, unattended defaults, and (as grammar rather than guarantee) `@` and identity.

### Leans recorded in research (positions, not decisions)

- **`@` read by shape:** `^`/`~` ranges and semver-shaped tags stay versions; anything else selects a skill; `#` carries arbitrary refs. Gets the most real lines working in both directions for the smallest break; agntc's `@branch` moves to `#branch`; residual ambiguity is a skill whose name is version-shaped. Alternatives on record: Vercel grammar wholesale (every agntc line already written breaks), read against the repo (chicken-and-egg — the ref decides what is cloned), separate grammars behind a switch (fails paste-and-go unless automatic).
- **Agent-driven conflicts:** when an agent-driven install hits another install's files or untracked files in the way, stop and come back to the owner rather than replace silently — with an explicit override flag the owner then sees in the command they approve. Vercel never prompts on conflicts; it `rm -rf`s and replaces.

### Vercel's surface (v1.7.0, read from code — research deep-dive-001)

npm `skills@1.7.0` = commit `7407f389` (2026-09-17). Load-bearing facts:

- **Commands:** `add` (`a`/`i`/`install`), `use`, `remove`, `list`, `find`/`search`, `update`/`check`, `init`, `experimental_install`, `experimental_sync`.
- **`add` flags:** `-g/--global`; `-a/--agent <agents…>` (variadic, `'*'` = all 79, unknown → exit 1); `-s/--skill <skills…>` (`'*'` = all non-internal); `-l/--list`; `-y/--yes`; `--copy`; `--all` (= `--skill '*' --agent '*' -y`); `--full-depth`; `--json` (needs `-y`/`--all`); `--subagent`, `--metadata`. Unknown flags silently ignored.
- **Source grammar:** `owner/repo@X` — X is always a skill selector, never a version. Refs live in `#ref`/`#ref@skill`. `owner/repo/sub/path` shorthand accepted. Also `github:`/`gitlab:` prefixes, tree URLs, GitLab, Azure, SSH, `.git` URLs, hosted-artifact URLs, `notion`, skills.sh packs, well-known endpoints (any non-github/gitlab http(s) URL not ending `.git`). No semver, range, constraint, or latest-tag logic — `update` re-fetches the recorded ref; a bare add installs default-branch HEAD.
- **Selectors match the frontmatter `name` only** — case-insensitive, exact; the folder basename is not a match target. Real case: `vercel-labs/agent-skills/skills/composition-patterns/` declares `name: vercel-composition-patterns`, and skills.sh prints `--skill vercel-composition-patterns`. No match → exit 1; partial match installs the matched, drops the rest silently, exit 0.
- **Discovery:** a skill is a `SKILL.md` with string `name` + `description`; otherwise `⚠ Skipped` (exit 1 only if none valid). Root `SKILL.md` early-out; else root plus `skills/` and ~30 agent dirs, each walked 3 levels; plus `.claude-plugin/marketplace.json` and `plugin.json` (skill dirs only — no agents/hooks routed); dedup by frontmatter `name`.
- **Agents:** identifiers `claude-code`, `codex`, `cursor` (`--agent claude` rejected). Project paths: claude-code `.claude/skills/`; codex and cursor both `.agents/skills/` (agntc puts Cursor at `.cursor/skills/`, `src/drivers/cursor-driver.ts:8`). Choice order: `--agent` → inside an AI agent (forces `yes`, targets that agent plus all universal agents) → detection (0 detected + `-y` → all 79 agents).
- **Install:** directory = sanitized frontmatter `name`; default canonical copy in `.agents/skills/<name>` with relative symlinks from each non-universal agent's dir; symlinks in the source dereferenced with no containment check. Conflicts never prompted — listed as `overwrites:` and replaced. Two locks keyed by frontmatter name (global, and a committed project `./skills-lock.json`), recording neither target agents, install mode, nor a commit SHA. `update` re-runs `add … --skill <name> -y` with no `--agent`, re-detecting targets.
- **Non-TTY:** a reached prompt prints "Interactive prompt required but stdin is not a TTY. Nothing was installed." plus "Use --agent <name> (or --agent '*') and -y to run non-interactively.", exit 1. A deliberate TTY cancel exits 0.
- **Pre-install display:** `Source:`, "Repository cloned", `Found N skills` (+ skip warnings), then single-skill name + description / `Installing all N skills` / `Selected N skills: a, b` / picker with description pane; `Installing to:`; scope and method prompts; "Installation Summary"; advisory "Security Risk Assessments" table; "Proceed with installation?". `--list` shows names and descriptions grouped by plugin. No script/executable warning — the only gate is the proceed prompt, skipped by `-y` or agent detection.
- **Beyond project install from git/local:** global scope (prominent — interactive `add` asks scope), canonical store + symlink fan-out, `find`/skills.sh search, `use`, well-known endpoints, skills.sh packs, direct `SKILL.md`/archive URLs, Notion, skills.sh blob fast path for allowlisted owners, security-audit display, `--json`, Eve agent/subagents, `experimental_install`/`experimental_sync`, private repos/GHE/GitLab/Azure, auto mode inside an AI agent.

### agntc today, measured (research)

- **`add` takes one flag** — `grep -rn "\.option(" src/ | grep -v "\.test\.ts"` → one hit, `src/commands/add.ts:914`, `--plugin`.
- **`@` collision:** agntc reads `owner/repo@X` as a ref or semver constraint (`classifyRefOrConstraint`, `src/source-parser.ts`). A pasted Vercel `owner/repo@some-skill` is read as "clone at ref `some-skill`" — fails on the missing ref, or installs the wrong thing if a branch/tag of that name exists.
- **`owner/repo/subpath` shorthand refused** — `grep -n "too many slashes" src/source-parser.ts` → line 365.
- **Prompts on the `add` path:** collection member pick (`src/collection-select.ts:34`); agent pick, auto-skipped only when the author declared exactly one agent and it is detected (`src/agent-select.ts:39–47`, `:63`); collision with another managed install (`src/collision-resolve.ts:36`); unmanaged files in the way, double-confirmed (`src/unmanaged-resolve.ts:37`, `:57`). The last two are destructive.
- **Unattended today:** with no TTY the first prompt reads end-of-input as cancel and exits **0 with nothing installed and no message**; with stdin held open but silent it hangs. The exit-0 is by design for a human cancel (`throw new ExitSignal(0)`, e.g. `src/commands/add.ts:385`, `:703`), and reads as success to an agent caller.
- **Who runs it unattended (owner):** the owner at a terminal, or an AI agent (Claude or another) running `npx agntc add` mid-task. CI possible but not the picture. An agent caller can make choices but can't see a prompt; the human's last look moves to the agent's permission prompt, which shows the command line — a line that states its choices is reviewable there, a bare `-y` hides what it will do.
- **Re-add advice defects.** `grep -rn "npx agntc add" src/ | grep -v "\.test\.ts"` → four advice sites — `src/summary.ts:355` (caret out-of-constraint), `src/update-render.ts:80` (all-mode exact-pin newer tags), `src/commands/update.ts:173` (single-key exact-pin newer tags), `src/clone-reinstall.ts:270` (derive-before-delete abort). None carries `--plugin`. The manifest records `type: "plugin"` for both a structural plugin and a `--plugin` bundle, not why. Following bare advice for a `--plugin` bundle re-detects a skills-only source and takes the collection-menu path; members key as `owner/repo/<member>`, collide with the bundle's files, and the collision prompt offers removing the bundle — completing it converts the bundle into separate members (code read, not run end-to-end). A `--plugin` on a structure that already reads as a plugin is a redundant no-op under the configless spec, so advice carrying `--plugin` whenever the recorded type is `plugin` would not misfire on structural plugins. **Second defect:** the single-key newer-tags site and the abort message print the manifest key, which for a collection member is `owner/repo/<member>` — refused by agntc's own parser ("too many slashes"). The all-mode line uses bare `owner/repo`; the two surfaces disagree.

### Exploratory run — today's agntc against ten skills.sh leaderboard repos (research, 2026-10-06)

Exploratory sighting, n=10, one run each, Claude only:

- **A skill's own `agents/` folder breaks it.** `src/type-detection.ts:144–155` treats `SKILL.md` alongside an asset dir as a plugin and ignores the `SKILL.md`. Real skills carry `agents/` for OpenAI's `agents/openai.yaml` metadata convention (71 such files across the ten repos) and for skill-local helper prompts the skill reads (`skill-creator`'s `analyzer.md`/`grader.md`; `motion-graphics`'s `builder.md`/`director.md`). agntc drops the `SKILL.md` and copies those files into `.claude/agents/`. 61 of 258 skill dirs across the ten repos carry `agents/` (mattpocock 38/38, remotion 12/12, caveman 7/28, …). `remotion-dev/skills`: all 12 entries broken. Each run ended "Installed …", exit 0.
- **Category folders hide whole collections.** `mattpocock/skills` (2nd-largest leaderboard source) nests skills under `skills/<category>/<skill>`; agntc's one-level read finds no units, ends "Cancelled — no plugins selected", exit 0. Vercel walks 3 levels and installs 38.
- **A bare add installs a different version.** agntc resolves the latest semver tag (5 of 10 repos had one); Vercel always installs default-branch HEAD.
- **Repos that are plugins to agntc are bags of skills to Vercel.** `microsoft/azure-skills` (skills + hooks) and `juliusbrussee/caveman` (skills + agents) install as one unit under agntc; a pasted `--skill x` aimed at either is the pick-from-a-unit collision in the wild.
- **Name divergence is common.** `vercel-labs/agent-skills`: 4 of 9 install under folder names where Vercel uses declared names. `leonxlnx/taste-skill`: 10 of 13 differ (folder `taste-skill` vs declared `design-taste-frontend`, which is what the leaderboard lists).
- Lesser: Vercel's scan of root-level and agent-dir skills (`template/`, `.agents/skills`, `.claude/skills`) finds skills agntc doesn't.
- **Leaderboard shape:** `open.feishu.cn`, a well-known-endpoint site, holds roughly 26 of the top ~70 positions (approximate, from the fetched page's summary). A git-only installer cannot reach them.

Findings on `agents/` and category depth sit on ground the configless-install spec decided (structure → type; collection membership one level down).

### Open questions research left

Its open threads, carried as this discussion's starting material: the per-flag/format parity call; where Vercel's selection, discovery and defaults press on agntc's guarantees; `@`; frontmatter-name vs folder-name identity for matching and install-directory naming; coexistence with Vercel-installed skills (`.agents/skills`, symlinks, `skills-lock.json`); the unattended `add` design (agent preselection against the ceiling, what `--yes` answers, conflict resolution, member selection, auto-select interaction, out-of-ceiling errors); hook scripts under unattended installs; how an agent caller learns a repo's contents before choosing; post-clone summary content and a display-only description read; the position on skills Vercel would skip; which beyond-project capabilities like-for-like needs; how Vercel detects running inside an AI agent; a skill's own `agents/` vs a plugin's; container depth; tag vs HEAD on a bare add. Two measurements were left open: how often folder name differs from frontmatter name across skills.sh repos (and whether skills.sh ever prints a `--skill` value that isn't the frontmatter name), and which `npx skills add` forms appear in public READMEs and how often.

### References

- [Seed — non-interactive install flags](../seeds/2026-06-09-non-interactive-install-flags.md)
- [Seed — Vercel Skills CLI compatibility](../seeds/2026-06-09-vercel-skills-cli-compatibility.md)
- [Seed — richer `add` post-clone intro](../seeds/2026-06-09-add-post-clone-unit-info.md)
- [Discovery session log](../discovery/sessions/session-001.md)
- [Research — Vercel Skills Compatibility](../research/vercel-skills-compatibility.md)
- [configless-install specification](../../configless-install/specification/configless-install/specification.md) — the standing no-install-flags decision (line 52), structure → type, directory-basename identity, no frontmatter parsing

---

*Subtopics are documented below as they reach `decided` or accumulate enough exploration to capture. Not every subtopic needs its own section — minor items resolved in passing can be folded into their parent. The Discussion Map (which subtopics exist and their states) lives in the manifest, not this file.*

---

## Like-for-Like Scope

### Context

"Like-for-like replacement" could mean anything from "a pasted `add` line works" to "every Vercel command and source works". Two Vercel capabilities are large enough to decide whether this stays one feature — the reshape cue discovery left. Global scope (`-g`): Vercel asks "Installation scope" on every interactive `add` where a target supports it, so global installs are habitual for its users; for agntc it is not a flag but a second install location with its own record, and `update`/`list`/`remove` all needing to know which they act on. Well-known endpoints: a non-git source (an HTTP index) with no tags or commits for update and constraints to stand on — and `open.feishu.cn` alone holds roughly 26 of the top ~70 skills.sh leaderboard positions (research observation, approximate). The rest of Vercel's surface beyond install — `find`/search, `use`, skills.sh packs, Notion, direct archive/`SKILL.md` URLs — is separate commands or niche sources.

### Options Considered

**Keep one feature, project-scope install from git/local; roadmap global and website sources**
- Pros: covers the lines people actually paste; keeps the work a single feature; doesn't add a second install location or a source with no versioning
- Cons: a pasted `-g` line, and every feishu-style skill, still can't install through agntc

**Reshape now into several connected pieces including global scope and/or well-known endpoints**
- Pros: reaches the most-installed skills; matches Vercel's habitual global installs
- Cons: two new axes (install location, non-git source) touching manifest, update, list and remove; turns a feature into an epic

### Journey

Position put to the owner: one feature scoped to "a pasted `add` line installing from a git repo or local path into the project works", including the breakage the ten-repo run found (skills carrying their own `agents/` folder, category-nested repos) because that is the headline promise failing on popular directory repos today; global installs and well-known-endpoint sources roadmapped as their own pieces; a pasted line reaching for either stops with a message saying agntc doesn't support it yet rather than ignoring the flag and installing somewhere the user didn't ask for. What would have changed it: the owner installing globally, or compatibility being about reaching the most-installed (feishu-style) skills — either would make that capability the point rather than an extra.

The owner agreed, and widened the command surface beyond `add`: the work is about replicating Vercel's syntax for adding, updating and removing, and tracking what that syntax installs through agntc's records so it keeps working. Search, `use` and the rest were never anticipated. Global installs and website sources: leaning towards not needing them, but worth putting on the roadmap to decide later.

The owner also set a principle that reaches every grammar and flag subtopic: **agntc's own syntax may change to match Vercel's** — that is acceptable — **as long as agntc can still do what Vercel's library can't**; otherwise there is no point having agntc. This loosens the research-time lean on `@` (read-by-shape was chosen partly to avoid breaking agntc lines already written); taking Vercel's grammar wholesale and finding agntc's versions a new home is now on the table on equal footing.

### Decision

**One feature: Vercel syntax parity for `add`, `update` and `remove`, installing into the project from git repos and local paths, tracked through agntc's records.** In scope: the source grammar and flags of those commands; unattended behaviour; the pre-install summary; the structural breakage that stops Vercel-directory repos installing correctly today; whatever agntc must record so `update`/`remove` keep working on what the new syntax installs.

- **Roadmapped, not built here:** global installs (`-g`) and website (well-known-endpoint) sources — the owner leans towards not needing them and decides later.
- **Out:** `find`/search, `use`, skills.sh packs, Notion, direct archive/`SKILL.md` URLs, `init`/`experimental_*` parity.
- **A pasted line needing an out-of-scope capability fails loudly** — a message that agntc doesn't support it — never a silently ignored flag that installs somewhere else.
- **Principle — syntax follows Vercel, capabilities stay agntc's.** agntc's syntax may change to match Vercel's; every change must leave agntc's distinct capabilities reachable: units (skills + agents + hooks, and `--plugin` bundling of skills-only sources), the author's agent ceiling, semver constraints with constrained update, the lenient validity posture, copy-safety.

Confidence: high on the cut; the principle is the owner's own.

Sibling check: configless-install — its spec (`.workflows/configless-install/specification/configless-install/specification.md:52`) holds "no install-command flags for type or unit selection, except `--plugin`". This scope commits to Vercel's flag syntax, so that decision is reopened; the contradiction becomes concrete, and the correction is routed, where the flag set is decided (`install-flag-set`). version-constraints — its spec fixes `@` as ref-or-constraint; the principle above puts that on the table at `at-suffix-meaning`.

---

## Summary

### Key Insights
1. Syntax follows Vercel; capabilities stay agntc's. Every grammar or flag change is judged by whether units, the agent ceiling, semver constraints, lenient validity and copy-safety remain reachable.

### Open Threads
- Global installs and website (well-known-endpoint) sources — roadmap candidates, the owner to decide later.

### Current State
- Resolved: scope — `add`/`update`/`remove` syntax parity, project scope, git/local sources.
- Uncertain: everything below the scope line.
