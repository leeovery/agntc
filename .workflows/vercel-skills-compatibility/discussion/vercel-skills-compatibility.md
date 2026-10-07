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

A review of the first cut found three items from Vercel's beyond-project list that sat in none of the buckets. Each was sorted with the owner:

- **Other git hosts and private repos** — `gitlab:`/`github:` prefixes, GitLab nested groups, Azure Repos, GitHub Enterprise. They are git repos, so the "git repos" line already admits them; what they lack is grammar. Measured today: `grep -n "gitlab\|github:" src/source-parser.ts` → no prefix handling; the HTTPS branch keeps only the last two path segments as owner/repo (`src/source-parser.ts:297–299`), so a GitLab subgroup URL or an Azure `_git` URL clones the wrong path. Private repos work wherever the user's own git credentials work — agntc does not need Vercel's credential chain.
- **Vercel's install layout** — one canonical copy in `.agents/skills/` with each non-universal agent's directory symlinked to it. The only one of the three with a real choice in it: "producing an equivalent install" could mean the same files in the same places. Judged on behaviour instead: a skill behaves the same from a copy or a link, and matching the layout would have agntc tracking shared files and links rather than plain per-agent copies. The layout matters only when Vercel's own tools touch an agntc install, which is `vercel-install-coexistence` ground. The owner agreed with "behaves the same" as the bar.
- **The skills.sh blob fast path** — for allowlisted owners (`vercel`, `vercel-labs`, `heygen-com`, `remotion-dev`, `zapier/connectors`) Vercel downloads files from skills.sh rather than cloning. agntc clones; the files are the publisher's own repo either way.

### Decision

#### 2026-10-06 — revised
*Trigger: review finding: three items from Vercel's beyond-project list — other git hosts and private repos, the canonical-store-plus-symlinks layout, the skills.sh blob fast path — sat in none of the scope's buckets.*

The scope stands as recorded in the entries below — one feature, Vercel syntax parity for `add`/`update`/`remove`, project scope, git/local sources; global installs and website sources roadmapped; search/`use`/packs/Notion/archive URLs out; a pasted line needing an out-of-scope capability is a pre-flight refusal that exits non-zero and writes nothing; syntax follows Vercel while agntc's capabilities stay reachable. The three unsorted items are now sorted:

- **In — other git hosts and private repos.** `gitlab:`/`github:` prefixes, GitLab nested groups, Azure Repos, GitHub Enterprise are git repos; the grammar they need is decided with the other source forms (`fragment-and-subpath-forms`). Private repos work wherever the user's own git credentials work.
- **Out — the canonical `.agents/skills` store with symlink fan-out.** agntc keeps a real copy per agent. The bar for "equivalent install" is that the skill behaves the same, not that the files sit where Vercel would put them.
- **Out — the skills.sh blob fast path.** agntc installs from git; the content is the publisher's repo either way.

Confidence: high; the layout call rests on "behaves the same" as the bar, which the owner confirmed.

Sibling check: cursor-agent-driver — its spec has each agent own its directory (Claude `.claude/skills/`, Codex `.agents/skills/`, Cursor `.cursor/skills/`), accepting duplicated copies for clean ownership; keeping per-agent copies holds that.

#### 2026-10-06 — revised
*Trigger: review finding: the fail-loud rule named the message but not what the caller gets — an AI agent running `npx agntc add … -g` acts on the exit status, not the text.*

**Settled by derivation** — not discussed. Determined by this document's measured trap (exit 0 with nothing installed reads as success to an agent caller), the configless-install spec's pre-flight failure rule (nothing written, non-zero exit), and Vercel exiting 1 on an unknown `--agent` and on an unanswerable no-TTY prompt (review-001 F2).

The scope stands as recorded below — one feature, Vercel syntax parity for `add`/`update`/`remove`, project scope, git/local sources; global installs and website sources roadmapped; search/`use`/packs/Notion/archive URLs out; syntax follows Vercel while agntc's capabilities stay reachable. What changes: **a pasted line needing an out-of-scope capability is a pre-flight refusal — it exits non-zero and writes nothing** (no installed files, no manifest entry), with a message saying agntc doesn't support it. A loud failure that exited 0 would recreate the trap this feature removes.

Sibling check: configless-install — its pre-flight failures (spec line 459) write nothing and exit non-zero; this call takes the same shape.

#### 2026-10-06

**One feature: Vercel syntax parity for `add`, `update` and `remove`, installing into the project from git repos and local paths, tracked through agntc's records.** In scope: the source grammar and flags of those commands; unattended behaviour; the pre-install summary; the structural breakage that stops Vercel-directory repos installing correctly today; whatever agntc must record so `update`/`remove` keep working on what the new syntax installs.

- **Roadmapped, not built here:** global installs (`-g`) and website (well-known-endpoint) sources — the owner leans towards not needing them and decides later.
- **Out:** `find`/search, `use`, skills.sh packs, Notion, direct archive/`SKILL.md` URLs, `init`/`experimental_*` parity.
- **A pasted line needing an out-of-scope capability fails loudly** — a message that agntc doesn't support it — never a silently ignored flag that installs somewhere else.
- **Principle — syntax follows Vercel, capabilities stay agntc's.** agntc's syntax may change to match Vercel's; every change must leave agntc's distinct capabilities reachable: units (skills + agents + hooks, and `--plugin` bundling of skills-only sources), the author's agent ceiling, semver constraints with constrained update, the lenient validity posture, copy-safety.

Confidence: high on the cut; the principle is the owner's own.

Sibling check: configless-install — its spec (`.workflows/configless-install/specification/configless-install/specification.md:52`) holds "no install-command flags for type or unit selection, except `--plugin`". This scope commits to Vercel's flag syntax, so that decision is reopened; the contradiction becomes concrete, and the correction is routed, where the flag set is decided (`install-flag-set`). version-constraints — its spec fixes `@` as ref-or-constraint; the principle above puts that on the table at `at-suffix-meaning`.

*(Amended 2026-10-06 — the scope's in-scope structural breakage and the syntax-parity principle reopen three further configless-install decisions, each on the table where named: **Source selector grammar (canonical)** (spec line 152) — `@` is never a unit selector, no `owner/repo@unit` shorthand, the tree URL is the member selector → `at-suffix-meaning`, `fragment-and-subpath-forms`; **Structural Type Detection** (line 72) and **Collection Membership & Selection Flow** (line 304) — a `SKILL.md` beside an asset dir is a plugin, collection membership exactly one level down → `skill-local-agents-dir`, `container-depth`; **Identity & Naming** (line 170) — identity = directory basename, no frontmatter parsing → `skill-identity`. Corrections are routed where each is decided.)*

---

## Website vs Git URLs

### Context

The scope decision makes a pasted website-source line (a well-known-endpoint site such as `open.feishu.cn`) a pre-flight refusal: "agntc doesn't support this", non-zero exit, nothing written. To refuse it, agntc has to recognise it — and today it can't. agntc reads any `https://host/owner/repo` as a git repo and appends `.git` (`src/source-parser.ts:299`); a bare host fails "invalid HTTPS URL: no path segments". Vercel reads the same shapes the other way: any http(s) URL that is not GitHub or GitLab and does not end `.git` is a well-known endpoint, never cloned. So a feishu-style line currently ends in a generic clone failure after retries, not the decided refusal.

```text
https://git.acme.dev/team/tools      agntc today: git repo    Vercel: website
https://git.acme.dev/team/tools.git  agntc today: git repo    Vercel: git repo
```

Raised by the background review against the scope decision.

### Options Considered

**Adopt Vercel's reading**
- Pros: no line that works in Vercel is lost (Vercel would never clone the first URL either); the roadmapped website-sources item would read URLs the same way if built; a website line is refused by shape, instantly
- Cons: agntc users installing from a self-hosted git server by an https URL without `.git` must add `.git` (or use SSH)

**Probe before deciding** — try the clone, or look for a website index, then choose
- Pros: self-hosted URLs without `.git` keep working
- Cons: a network round-trip and a guess on every self-hosted URL

### Journey

The cost of adopting Vercel's reading falls only on agntc's own syntax — self-hosted `https` lines without `.git` — which the scope's principle (syntax follows Vercel, capabilities stay agntc's) allows: installing from a self-hosted git server stays reachable through `.git` or SSH. What would have flipped it: the owner, or a known user pattern, relying on `.git`-less self-hosted URLs. The owner agreed, and added that calls of this kind — agntc syntax given up for Vercel parity — are the session's to make.

### Decision

**Adopt Vercel's reading of https URLs**, in Vercel's order:

1. **Git sources:** GitHub (including the host named by `GH_HOST`), gitlab.com and a `/-/tree/` URL on any host, Azure Repos `_git` URLs, and any URL ending `.git`.
2. **Direct-download links, refused like the other direct links:** GitHub's hosted-artifact links — raw.githubusercontent.com, codeload.github.com, objects.githubusercontent.com, and github.com `/archive/`, `/raw/` and `/releases/(latest/)download/` paths.
3. **Website sources:** every other http(s) URL — refused as out of scope (non-zero exit, nothing written, message naming website sources as unsupported).

*(Amended 2026-10-07 — this read "A GitHub or GitLab URL, or any URL ending `.git`, is a git source; any other http(s) URL is a website source", which refused Azure `_git`, `GH_HOST` and self-hosted `/-/tree/` URLs the scope put in and treated GitHub download links as repos; corrected to Vercel's parse order, which the decision adopts.)* Self-hosted git servers are reached with `.git` or an SSH address. The other out-of-scope source forms — skills.sh pack links, Notion, direct links to a single `SKILL.md` or an archive — are recognised by shape and refused the same way.

Confidence: high.

Sibling check: v1/core-system — its spec's source table (`.workflows/v1/specification/core-system/specification.md:277`) lists "HTTPS URL — Any git host"; this narrows https to GitHub/GitLab or `.git`-suffixed URLs. A correction is owed; it is routed with the other source-grammar corrections once that grammar is settled.

---

## Selection From a Unit

### Context

The owner's stated concern for the whole feature: agntc's syntax may go, but installing several skills as one unit must survive — including on a Vercel-style repository of skills, which is exactly how `--plugin` has been used (a large set by one author, published to be installed one by one through Vercel's CLI). Vercel's selection syntax (`--skill x`, `@x`, `--skill '*'`, `--all`, `-y`) has no notion of a unit, so it meets agntc's units in two places: a bundle built from a skills-only repo, and a pick aimed at a repo agntc reads as a unit. The ten-repo run found the second in the wild: `juliusbrussee/caveman` (skills + 12 agents) and `microsoft/azure-skills` (skills + hooks) install as one plugin under agntc, while skills.sh lists — and prints install lines for — their individual skills.

### Options Considered

For the one open fork — `--skill x` aimed at a repo agntc reads as a unit:

**Install the picked skill alone, with a warning; refuse only when the author declared the repo a plugin**
- Pros: the pasted line works as it does in Vercel; the whole unit stays one plain `add` away; an author whose skills break when split has a one-line way to say so
- Cons: a repo whose skills depend on its agents or hooks can be installed partially unless its author declares it; the declaration widens what `type: "plugin"` means

**Refuse every pick from a unit, pointing at installing the whole unit**
- Pros: units stay whole by default, no partial installs ever
- Cons: pasted lines for plugin-shaped repos fail

### Journey

Most of the shape follows from the scope principle without a choice: a plain add of a repo that is skills plus agents or hooks keeps installing the whole unit (Vercel would install only the skills); `--plugin` stays as agntc's own flag and applies to any Vercel-style repo; without `--plugin`, Vercel's "all skills" forms install each skill separately exactly as Vercel does. Two pieces needed stating: `--plugin` today copies each child of `skills/` as-is (`src/copy-plugin-assets.ts:68–73`), so on a repo nesting skills in category folders it would land category folders where skills belong — the bundle has to take the skills discovery finds, wherever they sit; and `--plugin` together with `--skill` has no coherent reading once a bundle means "the whole source", so it is refused (a subset bundle was not pursued — nothing asked for it, and refusing now leaves it addable later).

The pick-from-a-unit fork is where Vercel's syntax and agntc's guarantee collide head-on. The lean put to the owner rested on the principle: refusing a pick adds no capability, and honouring it removes none — the unit is still one plain `add` away. The risk is a repo whose skills only work together; the owner's own workflows repo is one (its skills call its agents). Reusing the author's existing `type: "plugin"` declaration as "keep this whole" gives such an author a one-line guard without new config. The owner agreed.

### Decision

#### 2026-10-07 — revised
*Trigger: review finding: `--skill '*'` and `--all` aimed at a unit fit two readings — "install the unit", or "a pick of every skill from it" (each alone, agents and hooks left out, refused when the author declared `"type": "plugin"`).*

Put to the owner with a call; the owner agreed. The decision stands as recorded below. Added: **`--skill '*'` and `--all` on a repo agntc reads as a unit — a structural plugin, or a repo declaring `"type": "plugin"` — install the whole unit**, agents and hooks included; "everything" is never read as picking every skill one by one. On a skills-only repo without `--plugin` they keep installing each skill separately.

#### 2026-10-06

**Units survive Vercel syntax:**

- **A plain add installs a unit whole.** A repo agntc reads as a plugin (skills plus agents and/or hooks) installs as one unit, as today.
- **`--plugin` bundles any skills-only source, Vercel-style repos included.** Every skill discovery finds — category folders included, installed flat as skills — becomes one entry, updated, removed and version-pinned together. A subpath in the source narrows what is bundled.
- **Without `--plugin`, "all skills" installs skills separately.** `-y`, `--skill '*'` and `--all` on a skills-only repo install each skill as its own entry, as Vercel does.
- **`--plugin` with `--skill` (or `@skill`) is refused** — a bundle is the whole source.
- **A pick aimed at a unit installs that skill alone, with a warning naming what it leaves out** (the unit's agents, hooks and other skills). **Exception: when the repo's `agntc.json` declares `"type": "plugin"`, the pick is refused** (pre-flight, non-zero exit, nothing written), naming the whole-unit install. For a structural plugin the declaration now means "keep this whole"; for a skills-only repo it keeps its existing meaning (bundle by default) and the same refusal applies. The owner's workflows repo would add `"type": "plugin"` to keep its skills together.

Confidence: high on the shape; medium that the warning is enough for repos whose authors never declare.

Sibling check: configless-install — its spec reserves `type: "plugin"` "strictly for a pure skills-only repo" and makes it a no-op on a structural plugin, and defines selector + `--plugin` as orthogonal (a path selector picks the unit, `--plugin` resolves its ambiguity). This widens `type: "plugin"` to "keep whole" on structural plugins, and keeps path + `--plugin` orthogonal while refusing skill-pick + `--plugin`. A correction is owed; it is routed with the other configless-install corrections.

---

## Update and Remove Surface

### Context

The scope commits to Vercel syntax parity for `update` and `remove`, not only `add`, but only `add`'s surface had been mapped. Vercel's `remove [skills…]` (aliases `rm`, `r`; `-g`, `-a`, `-s`, `-y`, `--all`) matches sanitized install-folder names and lock keys — i.e. skill names — and without `--agent` deletes from every agent's path. Vercel's `update` (alias `upgrade`, plus `check`, an undocumented alias that runs the full update; `-g`, `-p`, `-y`) re-runs `add … --skill <name> -y` with no `--agent`, re-detecting targets. agntc's `remove [key]` and `update [key]` take one manifest key — `owner/repo` or `owner/repo/<member>` (`src/commands/remove.ts:167`, `src/commands/update.ts:1035`) — so a Vercel-style `npx agntc remove vercel-composition-patterns` fails today. Raised by the background review, which also tied it to the unit decision: removing one skill that sits inside a unit.

### Journey

Presented as a single defensible shape — every piece follows from the scope principle (syntax follows Vercel) or from decisions already made — and the owner accepted it as stated. The two places agntc keeps its own behaviour, each for a stated reason:

- **Removing a skill inside a unit is refused** — the remove-side mirror of the unit decision: units go in whole and come out whole. Vercel never meets this, since it has no units.
- **Update replays the agents recorded at install** rather than re-detecting. Re-detection means adding Cursor to a project later quietly widens every subsequent update; in agntc an update means "the same thing, newer", and changing targets stays an explicit `add` or `remove -a`.
- **`check` is not adopted.** In Vercel it is undocumented and runs a full update — a footgun; README lines will not carry it. A pasted `check` fails as an unknown command rather than changing anything.

### Decision

#### 2026-10-07 — revised
*Trigger: review finding: two decisions make `update` write into folders it never owned — the move to declared-name folders and keys, and the repair of broken `agents/` installs — and the folder may be occupied (a Vercel copy, the user's own copy, another entry's same-named skill); the update path has no conflict check (`grep -n "unmanaged\|collision" src/clone-reinstall.ts src/nuke-reinstall-pipeline.ts src/update-groups.ts src/commands/update.ts` → nothing) and no `--overwrite`.*

Put to the owner with a call; the owner agreed. The surface stands as recorded in the entries below. Added: **`update` meets an occupied target folder the way `add` does** — without `--overwrite` it stops that entry, leaves the existing install intact, says why, and exits non-zero (partial success across entries, as today); with `--overwrite` it replaces what is in the way. **`update` gains `--overwrite`**, single-key and all-mode.

#### 2026-10-07 — revised
*Trigger: review finding: removing a skill that sits inside a unit was refused, but updating one by name had no stated outcome.*

**Settled by derivation** — not discussed. Determined by a unit being one entry (Selection From a Unit: "updated, removed and version-pinned together") — update has nothing to split, so a refusal would only send the user to the same update under another name (review-002 F8).

The surface stands as recorded in the entries below, with `remove`'s flag edges. Added: **`update <skill>` where the skill sits inside a unit (structural plugin or `--plugin` bundle) updates the whole unit**, and the output names the unit.

#### 2026-10-07 — revised
*Trigger: review finding: `remove`'s flags were listed without their edges — which names `-a` takes, removing an entry's last agent, and whether `--all` or `-s '*'` confirm.*

**Settled by derivation** — not discussed. Determined by Agent Targeting's rule for `-a` on `add`, and the owner's rule applied to Vercel's `remove` (`--all` implies `-y` and takes no names; `-s '*'` selects everything but does not imply `-y`; `--agent` deletes only those agents' paths, the record going once no agent uses it) (review-002 F7).

The surface stands as recorded below. Added, `remove`'s flag edges:
- **`-a` takes the agent names `add` takes** (`claude-code`, `codex`, `cursor`, agntc's `claude`) and refuses an agent agntc doesn't drive, listing the three it does.
- **Removing an entry from every agent it is installed for removes the entry.**
- **`--all` implies `-y` and cannot be combined with names; `-s '*'` selects every install but still confirms.**

#### 2026-10-06

- **Positional arguments name skills or keys.** `remove` and `update` accept one or more skill names — the skill's declared name or its folder name — as well as agntc keys. A name matching installs from two different repos is refused, listing both keys.
- **A skill inside a unit (structural plugin or `--plugin` bundle) cannot be removed alone** — refused, naming the unit to remove.
- **`remove` flags:** `-s <skills…>` (same as positional names), `-y` (skip the confirmation), `--all` (remove every install), `-a <agents…>` (remove from those agents only; the entry keeps its other agents). `-g` is refused as out of scope. Aliases `rm`, `r`.
- **`update` flags:** alias `upgrade`; `-y` accepted; `-p` accepted as a no-op (project is the only scope); `-g` refused. `check` is not registered.
- **Update keeps the agents chosen at install.**

Confidence: high.

Sibling check: v1/core-system — its spec gives `remove` and `update` a single plugin-key argument; this keeps keys working and adds skill names and multiple arguments — an extension, not a contradiction. Update's recorded-agent replay is unchanged from the update strategy in this repo's `CLAUDE.md` (nuke-and-reinstall for the same agents).

---

## Frontmatter Reading

### Context

Vercel selects skills by the `name` declared in `SKILL.md` frontmatter, never by folder — `leonxlnx/taste-skill`'s folder `taste-skill` declares `name: design-taste-frontend`, which is what skills.sh lists and prints in `--skill` lines. Parity therefore means agntc reads frontmatter for the first time; configless-install decided it never would ("no frontmatter parsing, no validation") and parked untrusted-frontmatter parsing safety in the validation inbox. Three calls lean on the read — selection by declared name, descriptions in the pre-install summary, and the internal-skill rule — so the edges of reading third-party headers are shared ground: a `SKILL.md` with no frontmatter, frontmatter with no `name`, YAML that fails to parse, a fence that is not YAML, and descriptions carrying terminal escape sequences that would repaint the screen when printed (Vercel strips these). Raised by the background review as ground no single subtopic owned.

### Journey

Presented as a single defensible shape, derived from the lenient validity posture (a capability the scope principle protects — the owner's own workflows repo has 32 of 38 skills without a `description`) and from Vercel's own display safety. The owner agreed. Left open deliberately: whether the installed folder and agntc's key use the declared name — that is `skill-identity`, taken with the review's key question.

### Decision

- **agntc reads a skill's declared `name` and `description`, for selecting and displaying skills only.** Frontmatter never decides type or validity.
- **Fallback is the folder.** No frontmatter, no `name`, unparseable YAML, or a non-YAML fence → the skill goes by its folder name, has no description, and installs normally, with no warning — today's behaviour.
- **Displayed text is stripped** of control characters and terminal escape sequences.
- **Frontmatter is parsed as plain data** — no formats that execute code on parse.

Confidence: high.

Sibling check: configless-install — its Identity & Naming decision holds "no frontmatter parsing"; this reads frontmatter for selection and display. A correction is owed; it is routed with the other configless-install corrections.

---

## Skill Identity

### Context

Vercel names a skill by its declared frontmatter `name` everywhere: selection, the install folder (sanitized — see Decision), and its lock keys. agntc names it by folder basename (configless-install: "Identity = directory basename, throughout"). The ten-repo run measured how often the two differ: `vercel-labs/agent-skills` 4 of 9, `leonxlnx/taste-skill` 10 of 13. With selection by declared name already decided (frontmatter reading), what remained was the installed folder and agntc's key. The background review added the key problem: one skill already gets two keys depending on route — the menu keys a member by basename (`owner/repo/composition-patterns`), a tree URL by its full subpath (`owner/repo/skills/composition-patterns`, configless spec "Source selector grammar") — and once Vercel's `owner/repo/<path>` shorthand is adopted, a basename key also reads as a path, pointing at a folder that does not exist.

### Options Considered

**Declared name for folder and key (Vercel's)**
- Pros: one name everywhere — typed, used by the agent, shown in `list`/`remove`, and the folder Vercel creates; a skill installed by both tools lands on one folder (a visible clash through the untracked-files path) instead of appearing twice to the agent
- Cons: existing installs move folders on their next update

**Folder name, as today**
- Pros: nothing existing moves
- Cons: a skill installed by both tools appears twice; `list`/`remove` show a name the user never typed

### Journey

Put to the owner as a question because it reverses a configless-install decision and existing installs move. The owner's answer set the rule for the rest of the session: Vercel's way is the answer by default; the owner wants to be asked only where Vercel's way clashes with what agntc must keep and there is no obvious call — edge cases like this one are not that.

### Decision

**A skill's identity is its declared name, Vercel's way, falling back to its folder name when none is declared.**

- **The install folder is the declared name, sanitized as Vercel sanitizes it:** lowercase; runs of characters outside `[a-z0-9._]` become `-`; leading and trailing `.` and `-` are stripped; the result is capped at 255 characters; `unnamed-skill` when nothing remains. Applied to the declared name, or the folder name when none is declared. *(Amended 2026-10-07 — the rule was paraphrased without the strip, cap and fallback, under which a declared `name: ..` would install into `.claude/` itself.)*
- **One key per skill, however it was selected** (menu, `@name`, `--skill`, subpath, tree URL) — built from the declared name, so every route lands on the same entry.
- **A path in a source string is always a path** into the repo; nothing agntc prints offers a key as an install source (the re-add advice prints a selector).
- **Existing installs move to the declared-name folder and key on their next update.**

Confidence: high — follows the owner's rule.

Sibling check: configless-install — its Identity & Naming ("Identity = directory basename, throughout … No frontmatter-derived keys") and Manifest Keying ("keys are unchanged from today") are reversed here. A correction is owed; it is routed with the other configless-install corrections.

---

## Container Depth and Discovery Roots

### Context

agntc reads a skills-only repo one level into `skills/`; `mattpocock/skills` (second-largest source on the skills.sh leaderboard) nests every skill under `skills/<category>/<skill>`, so agntc finds no units and ends "Cancelled — no plugins selected", exit 0, where Vercel installs 38. Vercel's discovery: root `SKILL.md` early-out (unless `--full-depth`); otherwise the root plus `skills/`, `skills/.curated|.experimental|.system` and ~30 agent directories (`.claude/skills`, `.agents/skills`, …), each walked 3 levels, never below a found skill, skipping `node_modules`/`.git`/`dist`/`build`/`__pycache__`, symlinked directories not followed; plus skill paths declared in `.claude-plugin/marketplace.json` and `plugin.json`; dedup by declared name, first in priority order wins. The background review added the edges deeper discovery brings: same-name skills in different categories, `--plugin` on a category-nested repo (settled at `selection-from-a-unit`: bundles install flat), and the extra roots (`template/`, the source's own `.claude/skills`/`.agents/skills`), which `claude-plugin-manifests` shares.

### Journey

Settled by the owner's rule — Vercel's way unless it clashes with what agntc keeps. Nothing here does: deeper and wider discovery only finds more of what Vercel finds. Same-name dedup follows Vercel (first found wins) rather than refusing.

### Decision

**agntc discovers skills where and as deep as Vercel does:** the same roots (repo root, `skills/` and its curated/experimental/system variants, the agent directories Vercel scans), three levels deep, never below a found skill, the same skip list, symlinked directories not followed, plus skill directories declared in `.claude-plugin/marketplace.json` / `plugin.json` (read only to find skills — never a type signal). `--full-depth` has Vercel's meaning. Two skills declaring the same name: the first in Vercel's priority order is kept.

Confidence: high — follows the owner's rule.

Sibling check: configless-install — its Collection Membership holds "exactly one level down", nested collections unsupported; this reverses it. A correction is owed; it is routed with the other configless-install corrections.

---

## Skill-Local Agents Folders

### Context

`src/type-detection.ts:144–155` treats a directory holding `SKILL.md` alongside an asset dir as a plugin ("SKILL.md found alongside asset dirs — treating as plugin, SKILL.md will be ignored"). Real skills carry `agents/` folders for two unrelated reasons — OpenAI's `agents/openai.yaml` skill-metadata convention (71 such files across the ten-repo run) and skill-local helper prompts the skill itself reads (`skill-creator`'s `analyzer.md`/`grader.md`, `motion-graphics`'s `builder.md`/`director.md`). agntc drops the `SKILL.md` and copies those files into `.claude/agents/` as subagents: 61 of 258 skill dirs across the ten repos carry `agents/` (mattpocock 38/38, remotion 12/12, caveman 7/28), and every run ended "Installed …", exit 0. Vercel's rule: a directory with `SKILL.md` is a skill; a root `SKILL.md` ends discovery. The background review added that fixing detection would not repair installs already made: update replays the recorded `plugin` type (`src/nuke-reinstall-pipeline.ts:128–133`), and `agents/` is still present, so the broken shape persists while a fresh `add` of the same source installs differently.

### Journey

Settled by the owner's rule — Vercel's reading, and nothing agntc keeps is lost: a real plugin (skills plus `agents/`/`hooks/` at the root, no root `SKILL.md`) is untouched. The repair condition is unambiguous because a recorded plugin with a `SKILL.md` at its unit root can only have come from the old rule — neither a structural plugin nor a `--plugin` bundle has one.

### Decision

#### 2026-10-07 — revised
*Trigger: review finding: a real plugin whose author added a root `SKILL.md` beside `skills/` and `agents/`/`hooks/` would become a single skill under "a directory containing `SKILL.md` is a skill" (the root early-out) — its agents and hooks never routed, its inner skills nested where agents won't load them — and the repair's condition matched its existing installs too. Units are a kept capability, so this was put to the owner.*

Put to the owner with a call; the owner agreed. The distinguishing signal is a `skills/` directory: the broken shapes the fix targets are skill folders carrying `agents/` (helper prompts, `agents/openai.yaml`) with no `skills/` of their own.

- **A directory containing `SKILL.md` is a skill** — everything in it, `agents/` included, is copied with it — **unless it also has a `skills/` directory beside `agents/` and/or `hooks/`: that is a plugin**, and its root `SKILL.md` is ignored, as today. A repo declaring `"type": "plugin"` in `agntc.json` is also kept whole.
- **The update repair applies only to an entry recorded as a plugin whose source has a `SKILL.md` at its unit root and no `skills/` directory**; it is reinstalled as a skill, and the update says so. Real plugins are untouched.
- Diverges from Vercel, whose root `SKILL.md` early-out would install such a repo as one skill — guarded by units being a kept capability.

#### 2026-10-06

- **A directory containing `SKILL.md` is a skill.** Everything in it, `agents/` included, is copied with it; nothing in it is routed as a plugin asset.
- **Existing broken installs are repaired on their next update:** an entry recorded as a plugin whose source has a `SKILL.md` at its unit root is reinstalled as a skill, and the update says so.

Confidence: high — follows the owner's rule.

Sibling check: configless-install — its Structural Type Detection (`SKILL.md` alongside asset dirs → plugin, `SKILL.md` ignored) is reversed, and its update strategy (replay the recorded type, never re-detect) gains this one repair. A correction is owed; it is routed with the other configless-install corrections.

---

## Agent Targeting

### Context

Vercel drives 79 agents; agntc drives three. Vercel's identifiers are `claude-code`, `codex`, `cursor` (`--agent claude` is rejected); `-a/--agent` is variadic and repeatable; `'*'` means all 79; an unknown name → "Invalid agents", exit 1; `--all` = `--skill '*' --agent '*' -y`; with `-y` and no agent detected Vercel installs to all 79. Vercel has no author agent ceiling. Project paths differ for Cursor: Vercel `.agents/skills/`, agntc `.cursor/skills/` (`src/drivers/cursor-driver.ts:8`). The background review asked where the line falls between "an agent agntc doesn't drive" and the decided fail-loud rule for out-of-scope capabilities, and what `'*'`/`--all` mean against the author's ceiling.

### Journey

Settled by the owner's rule. Vercel's names and `'*'` are adopted; an agent agntc does not drive is refused exactly as Vercel refuses a name it does not know, which is also the fail-loud rule. The author's agent ceiling is a capability agntc keeps, so flagged agents intersect with it per unit. Cursor's path stays: the skill behaves the same from `.cursor/skills/` (the "behaves the same" bar from the scope decision).

### Decision

#### 2026-10-07 — revised
*Trigger: review finding: two runs end with no agent the author allows and had no stated outcome — `-y` where agents are detected but none is inside the ceiling, and a multi-unit run with `-a` where one unit's ceiling excludes every named agent ("refused" read as pre-flight would also stop its siblings; today the collection path skips that member and exits 0, `src/commands/add.ts:730`, `:906`).*

Put to the owner with a call; the owner agreed. The targeting stands as recorded in the entries below, with re-adds adding agents. Added:
- **`-y` where every detected agent is outside the unit's ceiling counts as none detected** — the unit installs for every agent within its ceiling.
- **In a run installing several units, a unit whose ceiling excludes every named agent is skipped with a message; the others install, and the command exits non-zero** so a calling agent sees the partial result — the same partial-success reporting `update` uses. A single-unit run in that position is refused pre-flight, as recorded below.

#### 2026-10-07 — revised
*Trigger: review finding: re-adding an installed entry deletes its files and reinstalls for the chosen agents only (`src/commands/add.ts:413–415`, `:775–779` for collection members), so `add … -a cursor` on a Claude install silently deletes Claude's copy — likewise a `-y` re-add (detected agents now) and a version-only re-add; Vercel's `add -a cursor` adds Cursor and leaves Claude alone.*

Put to the owner with a call; the owner agreed. The targeting stands as recorded below. Added: **a re-add of an installed entry adds the agents it names and never drops the agents already recorded**; a version-only re-add (`#v2.0.0`) reinstalls for every recorded agent; a `-y` re-add keeps the recorded agents and adds any detected within the ceiling. Taking an agent away is `remove -a`.

#### 2026-10-06

- **`-a/--agent` accepts Vercel's identifiers** (`claude-code`, `codex`, `cursor`) and agntc's `claude`; variadic and repeatable, as Vercel.
- **`'*'` means every agent agntc supports.**
- **Naming an agent agntc doesn't drive is refused** (pre-flight, non-zero exit, nothing written), listing the three it does.
- **The author's ceiling applies per unit:** a unit installs to the named agents within its ceiling and the output names those left out; a unit whose ceiling excludes every named agent is refused.
- **Cursor stays at `.cursor/skills/`.**

Confidence: high — follows the owner's rule.

Sibling check: cursor-agent-driver — its spec puts Cursor skills in `.cursor/skills/`; unchanged. configless-install — its Agent Selection makes a valid declared `agents` list a hard ceiling; held.

---

## Install Flag Set

### Context

`add` takes one flag today — `grep -rn "\.option(" src/ | grep -v "\.test\.ts"` → one hit, `src/commands/add.ts:914`, `--plugin` — and the configless-install spec decided against install flags for unit selection. Vercel's `add` flags: `-g/--global`, `-a/--agent <agents…>`, `-s/--skill <skills…>`, `-l/--list`, `-y/--yes`, `--copy`, `--all`, `--full-depth`, `--json` (requires `-y`/`--all`), `--subagent`, `--metadata`; aliases `a`, `i`, `install`; unknown flags silently ignored. The background review noted the flags with no unattended role (`--copy`, `--full-depth`, `--json`, `--subagent`, `--metadata`, `-l`), the aliases, and unknown-flag handling had no owner, and that `-l` is the research's open question of how an agent caller sees a repo's contents before choosing.

### Journey

Settled by the owner's rule, with one deliberate difference grounded in the scope decision: Vercel silently ignores flags it doesn't know; the scope decided a pasted line is never met by a silently ignored flag, so agntc refuses an unrecognised flag. `-l/--list` answers the agent-preview question — the agent lists, then chooses with `--skill`/`-a`.

### Decision

- **Vercel's `add` flags with Vercel's meanings:** `-a/--agent`, `-s/--skill`, `-y/--yes`, `--all`, `--full-depth`, `--json` (with `-y` or `--all`, as Vercel requires), and `-l/--list` (names and descriptions, installs nothing, exit 0).
- **`--copy` is accepted as a no-op** — agntc always copies.
- **Aliases `a`, `i`, `install`.**
- **agntc's own flags stay:** `--plugin`, `--overwrite`.
- **Refused:** `-g` (roadmapped), `--subagent` and `--metadata` (Vercel-internal), and any flag agntc does not recognise.

Confidence: high.

Sibling check: configless-install — its spec (line 52) holds "no install-command flags for type or unit selection, except `--plugin`", with unit selection only by prompt or tree URL; this adopts Vercel's selection flags. A correction is owed; it is routed with the other configless-install corrections.

---

## At-Suffix Meaning

### Context

`@` means opposite things in the two tools. agntc: `owner/repo@X` is a ref or a semver constraint (`^`/`~` → constraint, anything else → ref; `classifyRefOrConstraint`, `src/source-parser.ts`). Vercel: `owner/repo@X` always selects the skill whose declared name is X — `owner/repo@v1.2.0` selects a skill named "v1.2.0" — and the ref lives in a `#ref` fragment, with `#ref@skill` composing both. A pasted Vercel `owner/repo@some-skill` swapped to agntc today is read as "clone at ref `some-skill`": it fails on the missing ref, or installs the wrong thing if a branch or tag of that name exists. agntc's own surfaces also print `@` (the re-add advice's `npx agntc add <repo>@<newest>`).

### Options Considered

From research: (1) Vercel's grammar wholesale — `@` selects, `#` carries ref/constraint; (2) read the suffix by shape — ranges and semver-shaped tags stay versions, anything else selects; (3) read the suffix against the repo after a default-branch probe; (4) separate grammars behind a compatibility switch.

### Journey

Research leaned to (2) because it broke the fewest agntc lines already written. The owner's scope principle — agntc's syntax may change to match Vercel's, as long as agntc's capabilities stay reachable — removed that constraint, leaving (1) the only option under which every pasted Vercel line reads exactly as Vercel reads it, with no residual ambiguity for a version-shaped skill name. The capability `@` carried in agntc — semver constraints — keeps a home in the fragment, the same place Vercel puts refs.

### Decision

#### 2026-10-07 — revised
*Trigger: review finding: with several names given and only some matching (`add --skill a b` where `a` doesn't exist, `remove a b` where only `b` is installed), Vercel installs or removes the matches and drops the rest silently (exit 0; `--json` reports `skipped` and exits 1) — no outcome was stated here, against the scope's rule that a pasted line is never met by a silently ignored part.*

Put to the owner with a call; the owner agreed. The grammar stands as recorded in the entries below, with an unmatched name refused. Added: **when some named skills match and some don't, on `add`, `remove` or `update`, the whole command is refused** — nothing written or removed, the unmatched names listed with what is available, non-zero exit. Diverges from Vercel's silent drop, under the scope's never-silently-ignore rule.

#### 2026-10-07 — revised
*Trigger: review finding: only the version-shaped `@` miss had a stated outcome; a `--skill` or `@` name that matches nothing (a typo, a skill the repo doesn't have) had none.*

**Settled by derivation** — not discussed. Determined by Vercel's own no-match behaviour ("No matching skills found for: X" plus the available list, exit 1), every refusal in this document taking the pre-flight non-zero shape, and `remove`/`update` already exiting 1 on an unknown name (`src/resolve-target-keys.ts:14–17`) (review-002 F4).

The grammar stands as recorded below — `@` selects a skill, versions and refs go after `#`. Added: **a `--skill` or `@` name that matches no skill in the source is refused** pre-flight (non-zero exit, nothing written), naming the unmatched name and listing the skills the source offers. The version-shaped `@` refusal below is the special case of this, with its pointer to `#`.

#### 2026-10-06

**Settled by derivation** — not discussed. Determined by the scope principle (syntax follows Vercel, capabilities stay agntc's) and semver constraints being a capability agntc keeps.

- **`@` selects a skill** by declared name (folder name as fallback), Vercel's grammar: `owner/repo@skill`.
- **Versions and refs go in the `#` fragment:** `#^1.0`, `#~1.2` (constraints), `#v2.0.0` (exact tag), `#main` (branch); `#ref@skill` composes a ref with a selection.
- **An `@` value that looks like a version and matches no skill** is refused with an error pointing at the `#` form — the migration path for lines written in agntc's old grammar.

Sibling check: version-constraints — its spec classifies `@^`/`@~` as constraints and any other `@` suffix as a ref in the parser output; configless-install — its canonical selector grammar holds "`@` is never a unit selector"; v1/core-system — its source table gives every format an `@ref` suffix. All three are reversed; corrections are owed, routed together.

---

## Fragment and Subpath Forms

### Context

Beyond `@` and `#`, Vercel's source grammar accepts forms agntc refuses or mis-reads: `owner/repo/sub/path` subpath shorthand (agntc: "too many slashes", `src/source-parser.ts:365`); `github:`/`gitlab:` prefixes (agntc: none — `grep -n "gitlab\|github:" src/source-parser.ts` → no prefix handling); GitLab nested subgroups and `/-/tree/` URLs and Azure Repos `_git` URLs with `?path=`/`?version=` (agntc keeps only the last two https path segments as owner/repo, `src/source-parser.ts:297–299`, so these clone the wrong path); a GitHub Enterprise host named by `GH_HOST` read as GitHub. The scope decision put other git hosts in.

### Journey

No choice in it once the scope principle and the other-git-hosts call stand. The shape-collision the subpath shorthand creates with member keys is settled at `skill-identity` (one key per skill; a path in a source is always a path; nothing printed offers a key as a source).

### Decision

**Settled by derivation** — not discussed. Determined by the scope principle and the scope call that other git hosts and private repos are in.

**Adopt Vercel's source forms:** `owner/repo/path` subpaths (a path into the repo; `..` refused by copy-safety), `github:`/`gitlab:` prefixes, GitLab nested groups and `/-/tree/` URLs, Azure Repos `_git` URLs with `?path=`/`?version=`, and a `GH_HOST` Enterprise host read as GitHub.

Sibling check: configless-install — its canonical selector grammar makes the tree URL the only member selector and the parser refuses `owner/repo/subpath`; this adds the shorthand. A correction is owed, routed with the other configless-install corrections.

---

## Bare Add Version

### Context

A pasted bare line installs different content in the two tools. agntc resolves the newest semver tag and records a `^X.Y.Z` constraint (version-constraints spec: bare-add default); Vercel has no version concept and always installs the default branch HEAD. In the ten-repo run 5 of 10 repos had semver tags (`vercel-labs/skills` installed at `v1.7.0`, `heygen-com/hyperframes` at `v0.8.137`, …), so for those a pasted bare line gives a different install wherever the default branch has moved past the last tag.

### Journey

This is the one place where matching Vercel's behaviour would remove an agntc capability rather than change syntax: semver constraints with constrained update are on the scope principle's capability list, and bare add is where most installs acquire one. A tag is the publisher's own statement of what a release is. The default branch stays one explicit fragment away.

### Decision

#### 2026-10-07 — revised
*Trigger: review finding: a pasted pick for a skill added after the repo's newest semver tag fails as a no-match under the tag default, where the publisher's listing and Vercel's install read the default branch; and a repo whose tags predate its skills resolves to a tree with no skills — a different install becomes a failed one.*

Put to the owner with a call; the owner agreed. The semver default stands as recorded below — newest semver tag with a caret constraint; default branch when untagged; `#main` asks for a branch. Added: **when the newest tag lacks a skill the line names, or holds no skills at all, the bare add installs from the default branch instead, says so, and records no constraint.** Every other bare add keeps the semver default.

#### 2026-10-06

**Settled by derivation** — not discussed. Determined by semver constraints with constrained update being a capability the scope principle keeps.

**Diverges from Vercel: a bare add keeps agntc's default** — the newest semver tag, recorded with a caret constraint so updates stay within its major; the default branch when the repo has no tags; `#main` (or any branch) asks for the branch explicitly.

Sibling check: version-constraints — its bare-add default (resolve latest semver tag, apply `^X.Y.Z`) is held unchanged.

---

## Validity Position

### Context

Vercel skips, with a visible `⚠ Skipped` warning, any skill whose `SKILL.md` lacks a string `name` and `description`, failing only when no skill is valid; and a skill marked `metadata.internal: true` is hidden from `'*'` and the picker unless requested by name. agntc installs every skill regardless of frontmatter. Applied to the owner's own workflows repo, Vercel's rule would drop 32 of 38 skills (`for f in skills/*/SKILL.md; do head -20 "$f" | grep -q '^name:' && head -20 "$f" | grep -q '^description:' || echo "$f"; done` in `~/Code/agentic-workflows` → 32 lines, measured in research).

### Journey

Lenient validity is on the scope principle's capability list, so the skip rule is not adopted; the frontmatter-reading decision already gives a nameless skill its folder name. Hiding internal skills from the default sets is adopted: it loses nothing, since naming an internal skill still installs it, and a `--plugin` bundle takes the whole source.

### Decision

**Settled by derivation** — not discussed. Determined by lenient validity being a capability the scope principle keeps, and the frontmatter-reading fallback.

- **Diverges from Vercel: a skill without a `name` or `description` still installs**, named by its folder, with no warning.
- **Skills marked internal follow Vercel:** left out of "all" (`'*'`, `--all`, `-y`) and the menu, installed when named; a `--plugin` bundle includes them.

Sibling check: configless-install — its "no frontmatter parsing, no validation" posture is held for validity (no gate); the internal-skill read is part of the frontmatter-reading correction already owed.

---

## Yes and Destructive Prompts

### Context

An unattended `add` has to answer four prompts (research): the collection member pick, the agent pick, a collision with another managed install ("Remove <key> and continue", `src/collision-resolve.ts:36`), and untracked files in the way ("Overwrite all", double-confirmed, `src/unmanaged-resolve.ts:37`, `:57`). The last two are the only prompts whose "yes" deletes something. Vercel's `-y` answers everything — all skills; detected agents plus universal agents (all 79 when none detected); and conflicts are never prompted: existing directories are listed as `overwrites:` and replaced. The owner's recorded lean (research): when an agent-driven install hits another install's files or untracked files, stop and come back rather than replace silently, with an explicit override the owner sees in the command they approve.

### Journey

The only part of `-y` that clashes with something agntc keeps is the silent replacement — the owner's own lean decides it. The agent answer follows the agent-targeting decision (the author's ceiling applies).

### Decision

**Settled by derivation** — not discussed. Determined by the owner's recorded stop-and-come-back lean and the agent-targeting decision.

- **`-y` answers every prompt that deletes nothing:** every skill is picked, agents are the detected ones within the author's ceiling (every supported agent within it when none is detected), nothing is confirmed.
- **Diverges from Vercel: replacing anything in the way needs `--overwrite`.** Under `-y` without it, a clash with another install or with untracked files stops that unit (non-zero exit) with a message naming `--overwrite`.

---

## No-TTY Behaviour

### Context

Measured in research: an unattended `add` from a non-terminal shell reads end-of-input at the first prompt as a cancel and exits **0 with nothing installed and no message**; with stdin held open but silent it hangs until killed. The exit-0 is by design for a human cancel (`throw new ExitSignal(0)`, e.g. `src/commands/add.ts:385`, `:703`) and reads as success to an agent caller. Vercel, when a prompt is reached without a TTY, prints "Interactive prompt required but stdin is not a TTY. Nothing was installed." and "Use --agent <name> (or --agent '*') and -y to run non-interactively.", exiting 1; a deliberate cancel on a TTY exits 0.

### Journey

No choice: Vercel's behaviour is also the shape this discussion already gave every refusal (non-zero, nothing written, a message naming the way through).

### Decision

#### 2026-10-07 — revised
*Trigger: review finding: the no-terminal rule was phrased for `add` only, while `remove` without a terminal reads end-of-input as a cancel, prints "Cancelled" and exits 0 with nothing removed (`src/commands/remove.ts:134–136`; the no-argument picker at `:99–101`).*

**Settled by derivation** — not discussed. Determined by this decision's own grounds (the measured exit-0 trap, the refusal shape), `remove` being in parity scope, and `remove -y` only meaning something if an unanswerable confirmation is not a silent cancel (review-002 F5).

**A prompt that cannot be shown stops the command — `add`, `remove`, and any prompt `update` comes to show:** non-zero exit, nothing written or removed, a message naming what answers it (`-y` for a confirmation; skill names, keys or `--all` for `remove`'s picker; the flags for `add`'s choices). Decided from the terminal itself, so a run never waits on silent input. A deliberate cancel at a terminal keeps exiting 0.

#### 2026-10-06

**Settled by derivation** — not discussed. Determined by the measured trap, Vercel's identical behaviour, and the decided shape of a refusal.

**A prompt that cannot be shown stops the install:** non-zero exit, nothing written, a message naming the flag that answers the prompt. Whether a prompt can be shown is decided from the terminal itself, so a run never waits on silent input. A deliberate cancel at a terminal keeps exiting 0.

---

## Agent Caller Detection

### Context

The owner's picture of unattended callers is an AI agent (Claude or another) running `npx agntc add` mid-task. Vercel detects that it is running inside an AI agent (via `@vercel/detect-agent`), replaces its banner with "Agent detected — installing non-interactively", and forces `yes`: with no selector every skill in the source installs, to the detected agent plus every universal agent. Research had leaned the other way — let the no-terminal rule stop the run so the agent re-runs with explicit choices visible in the owner's permission prompt — as synthesis, not an owner position.

### Journey

Queued first as "no detection" on the research reasoning; reversed before the screen under the owner's rule that Vercel's way is the default unless it clashes with what agntc keeps. It does not clash: detection only implies `-y`, and agntc's `-y` already keeps the owner's stop-and-come-back lean for files in the way and the author's agent ceiling.

### Decision

#### 2026-10-07 — revised
*Trigger: review finding: detection was decided for `add` only; Vercel's `remove` also detects an agent caller and forces yes, so an agent's plain `remove` would meet the no-terminal refusal where Vercel's needs no re-run.*

**Settled by derivation** — not discussed. Determined by the owner's rule (Vercel's way by default), this decision's own reasoning (detection only implies `-y`), and nothing agntc keeps riding on `remove`'s confirmation — the stop-and-come-back lean is about files in an install's way, and the approved command line names what is removed (review-002 F6).

**Run inside an AI agent, detected as Vercel detects it, `add` and `remove` behave as if `-y` was given** — for `add`, agntc's `-y` (every skill, detected agents within the author's ceiling, anything in the way still stops the unit unless `--overwrite`); for `remove`, no confirmation. `update` is unchanged: Vercel's `update` does not detect agents, and agntc's update shows no prompt.

#### 2026-10-06

**Settled by derivation** — not discussed. Determined by the owner's rule (Vercel's way by default) and the decided meaning of `-y`.

**Run inside an AI agent, detected as Vercel detects it, `add` behaves as if `-y` was given** — agntc's `-y`: every skill, detected agents within the author's ceiling, and anything in the way still stops the unit unless `--overwrite` is given. A detected agent caller therefore never meets the no-terminal refusal for the choices `-y` answers.

---

## Hook Scripts Gate

### Context

Discovery flagged that unattended installs remove the last human look before hook scripts land. Vercel installs no hooks, and its only gate — "Proceed with installation?" — is skipped by `-y` and by agent detection; its security-risk table is advisory. agntc installs a plugin's `hooks/` for Claude. With an agent caller, the human's look is the permission prompt on the command line the agent runs.

### Journey

No clash with anything agntc keeps, and nothing in Vercel to match; hooks delete nothing, so `-y` answers them like any other install. The pre-install summary names them, so the output says what landed.

### Decision

**Settled by derivation** — not discussed. Determined by the owner's caller picture (the owner approves the command line), the decided `-y` meaning, and Vercel having no hook gate.

**No extra gate for hooks on unattended installs.** A unit carrying hooks installs under `-y` like any other; the pre-install summary lists the hooks it lands.

---

## Pre-Install Summary

### Context

Seed: after cloning, `add` jumps to the agent prompt with little context; Vercel shows `Source:`, "Repository cloned", `Found N skills`, then names and descriptions (single skill, picker description pane, `--list`), `Installing to:`, an "Installation Summary" and a proceed prompt. The ASCII banner half shipped already (`abfe6c9`, `src/banner.ts`). The description line needed a frontmatter read, now decided (frontmatter reading: display only, escapes stripped). The seed also asked to keep it sized for agntc's three agents rather than mimic Vercel's 79-agent list.

### Journey

Follows Vercel's display; the one agntc-specific addition is the detected shape, since agntc installs units Vercel has no notion of.

### Decision

#### 2026-10-07 — revised
*Trigger: review finding: the summary's list stopped at the target agents without saying whether a confirmation follows — and at a terminal a single skill, or a plugin whose one declared agent is detected (`src/agent-select.ts:39–47`), installs with no prompt at all, so the summary would scroll past mid-install; Vercel's display ends with "Proceed with installation?".*

Put to the owner with a call; the owner agreed. The summary stands as recorded below. Added: **an attended `add` ends its summary with "Proceed with installation?"**; `-y` and agent detection answer it.

#### 2026-10-06

**Settled by derivation** — not discussed. Determined by the seed, Vercel's display, and the frontmatter-reading decision.

**After cloning, `add` shows:** the source and version; the detected shape (single skill / plugin with its skills, agents and hooks / N skills); each skill's name and one-line description from `SKILL.md`; and the target agents. Sized for three agents. `-l/--list` shows the same skill list and installs nothing.

---

## Vercel Install Coexistence

### Context

A project may already hold skills installed by Vercel's CLI: a canonical copy in `.agents/skills/<name>`, relative symlinks from non-universal agents' directories (`.claude/skills/<name>` → `.agents/skills/<name>`), and a committed `./skills-lock.json` keyed by declared name. agntc installs Codex skills into `.agents/skills/` too, and — with identity now the declared name — lands on the same folder names Vercel uses. Writing into a `.claude/skills/<name>` that is a symlink would write through into Vercel's canonical copy.

### Journey

No clash: Vercel's files are, to agntc, files it does not manage, and the existing untracked-files path (prompt; `--overwrite` unattended) already handles them. Copy-safety's boundary rules out writing through a link.

### Decision

**Settled by derivation** — not discussed. Determined by copy-safety's boundary, the per-agent copy layout, and the decided `-y`/`--overwrite` meaning.

- **Skills installed by Vercel are files agntc does not manage:** they take the untracked-files path (prompt, or `--overwrite` unattended).
- **`skills-lock.json` is neither read nor written.**
- **A target that is a symlink is replaced as a link, never written through.**

---

## Re-Add Advice Defects

### Context

`grep -rn "npx agntc add" src/ | grep -v "\.test\.ts"` → four advice sites: `src/summary.ts:355` (caret out-of-constraint: `npx agntc add <owner/repo>`), `src/update-render.ts:80` (all-mode exact-pin newer tags: `npx agntc add <owner/repo>@<newest>`), `src/commands/update.ts:173` (single-key exact-pin newer tags: `npx agntc add <key>@<newest>`), `src/clone-reinstall.ts:270` (derive-before-delete abort: `npx agntc remove <key> then npx agntc add <key>`). Two confirmed defects: none carries `--plugin`, so following the advice for a `--plugin` bundle re-detects a skills-only source and takes the collection path — its members collide with the bundle's files and the collision prompt offers removing the bundle, converting it into separate members (code read); and the single-key and abort sites print a collection member's manifest key `owner/repo/<member>`, which agntc's own parser refuses ("too many slashes"). The owner's original report ("following it fails") was close: it doesn't error, it silently changes the install's shape or stops at a collision prompt.

### Journey

The fix follows from decisions made in this discussion: versions now live after `#` (at-suffix-meaning); a single skill is named by a selector, never by a key (skill-identity); and a `--plugin` on a structure that already reads as a plugin is a redundant no-op (configless-install), so carrying it whenever the recorded type is `plugin` never misfires on structural plugins.

### Decision

**Settled by derivation** — not discussed. Determined by the two confirmed defects, the `@`/`#` and skill-identity decisions, and the configless rule that a redundant `--plugin` is a no-op.

**Every command agntc prints is one it accepts and that reproduces the install:** printed `add` commands carry `--plugin` whenever the entry is a plugin, name a single skill the way a user selects it rather than by manifest key, and put versions after `#`; printed `remove` commands name the entry the way `remove` accepts it (its key or skill name) and carry no `--plugin`. *(Amended 2026-10-07 — this read "re-add and remove advice carries `--plugin`"; `remove` accepts no `--plugin`, so the printed remove would fail.)*

---

## Summary

### Key Insights
1. Syntax follows Vercel; capabilities stay agntc's. Every grammar or flag change is judged by whether units, the agent ceiling, semver constraints, lenient validity and copy-safety remain reachable.
2. Vercel's way is the default answer. A point goes to the owner only where Vercel's way clashes with what agntc must keep and no call is obvious — edge cases follow Vercel.
3. The deliberate divergences from Vercel are few and each guards a kept capability or an owner position: bare add installs the newest release tag (semver); skills without name/description still install (lenient validity); `-y` never replaces files in the way without `--overwrite` (stop and come back); a pick from a unit warns, and is refused when the author declared the repo a plugin (units); unrecognised flags are refused (never silently ignore); Cursor stays at `.cursor/skills/` (behaves the same).
4. Several of agntc's earlier decisions are reversed by parity: `@` as a version, folder-name identity with no frontmatter reading, `SKILL.md` beside `agents/` read as a plugin, one-level collection membership, no install flags for selection.

### Open Threads
- Global installs — parked on the roadmap as `global-skill-installs` (horizon: later); the owner decides later whether it is wanted.
- Website (well-known-endpoint) sources — parked on the roadmap as `website-skill-sources` (horizon: later); the owner decides later whether it is wanted.

### Current State
- Resolved: scope (Vercel syntax parity for `add`/`update`/`remove`, project scope, git/local sources, out-of-scope lines refused non-zero); source grammar (`@` selects, `#` versions, Vercel's forms, https read Vercel's way, bare add keeps semver); identity (declared name for selection, folder and key; one key per skill); frontmatter read for selection and display only; discovery (Vercel's roots and depth, skill-local `agents/` stays inside the skill, broken installs repaired on update); units under Vercel selection syntax; agent targeting; the `add`/`update`/`remove` flag surface; unattended behaviour (`-y`, `--overwrite`, no-terminal refusal, agent callers as `-y`, no hook gate); pre-install summary; coexistence with Vercel-installed skills; printed advice.
- Uncertain: whether a warning is enough when a pick splits a plugin-shaped repo whose author never declares `"type": "plugin"` (medium confidence).
