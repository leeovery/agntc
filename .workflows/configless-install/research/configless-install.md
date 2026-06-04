# Research: Configless Install

Exploring how agntc can install any skill or collection from an arbitrary GitHub repo without requiring an `agntc.json` — auto-detecting repo shape, using disambiguating flags for the harder cases, and treating `agntc.json` as optional (possibly superseded).

## Starting Point

What we know so far:

- **Prompted by:** The user built agntc as an ergonomics-preferring alternative to the Vercel skills system (`npx skills add ...`). Vercel treats an `agents/` directory as source of truth and symlinks skills into the Claude dir. The user works Claude-Code-only, doesn't want an `agents/` directory, and deleting it broke the Vercel skills lock file — leaving several already-installed skills un-updatable. They want agntc to install from the same arbitrary GitHub repos the Vercel package can (e.g. `https://github.com/referodesign/refero_skill`, a single skill in a repo) — but against repos as they already exist.
- **Core constraint:** Skill owners can't be expected to ship agntc-specific config. agntc must work against repos that have no `agntc.json`.
- **Shape cues from discovery:**
  - Auto-assume the simple case — a standalone skill in a repo → install it directly.
  - Use flags to disambiguate the harder cases — a skill nested in a subdirectory; a repo that is a *collection* where multiple skills need selecting/installing.
  - Keep `agntc.json` but make it optional — possibly superseding it entirely if enough can be auto-assumed. Explicitly flagged as open, needing proper thought (deferred to discussion).
- **Starting direction:** Technical feasibility of auto-detecting repo shape without config; the auto-assume vs. flags vs. optional-config trade-offs.
- **Out of scope:** Reinstalling the user's lost skills is a separate operational task, not part of building this capability.

---

## Finding 0 — agntc's ACTUAL current state (corrects the premise)

*Added after a review agent caught that the initial research studied only the Vercel comparator and never opened agntc's own source. Verified directly against the code. This reframes the feature.*

**Truly configless install does not exist today. Every installable unit still requires an `agntc.json`.** This is *consistent* with the v1 spec, not a divergence from it. v1 decided two complementary things: "every **installable unit** must have `agntc.json`" AND "a collection is just a container, not an installable unit — so it has no root config."

The `detectWithoutConfig` path (src/type-detection.ts:89) implements only the *second* rule — it is **not** a configless-install fallback (an earlier draft of this finding wrongly called it one):
- `readConfig` returns `null` (not an error) when no root `agntc.json` exists, and `add.ts:172` then runs `detectType(…, { hasConfig: false })`.
- That detect scans immediate child dirs for `agntc.json`. If any → `collection`. So a collection *container* can lack root config — **but every child you actually install still carries its own `agntc.json`.** The config didn't disappear; it moved down a level.
- Anything else — including a repo whose root is a bare `SKILL.md` with no config — returns `not-agntc`, and `add.ts:193` rejects it: *"Not an agntc source — no agntc.json found and no collection detected."*

So the feature is **net-new** for the only cases that count, and **surgical** in detection terms: extend `detectWithoutConfig` to recognize (a) a root bare `SKILL.md` repo, and (b) a collection whose children are identified by `SKILL.md` rather than `agntc.json`. The exact thing `referodesign/refero_skill` needs is that missing branch.

But that small detection change drags three non-trivial integration problems that the comparator study glossed (it assumed "agntc owns the hard parts"):

1. **Identity / naming.** `copyBareSkill` (src/copy-bare-skill.ts:20) sets the installed skill dir to `basename(sourceDir)` — the repo/dir name — and never reads `SKILL.md` frontmatter. agntc **does not parse SKILL.md frontmatter at all** (`detectType` only checks the file *exists*). Vercel's whole model keys on the frontmatter `name`. Adopting that = a new YAML-frontmatter parse + validation path (net-new dep/code), and a decision: dir-basename identity vs frontmatter-`name` identity. This affects manifest keys, dedup, and update-matching.
2. **Manifest keying & lifecycle.** The manifest keys on `owner/repo` (or `owner/repo/plugin`). What's the key for a configless single-skill repo? a configless nested skill? a SKILL.md-keyed collection (which produces no `plugins[]` under current code)? And since agntc's value over a one-shot copy is *lifecycle* — `update` (nuke-and-reinstall) and `remove` — re-running detection on a fresh clone could discover a *different* skill set than originally installed. The user's original pain was a **lifecycle** failure (un-updatable skills); configless lifecycle is the part that must not regress.
3. **Agent selection.** `selectAgents` (src/agent-select.ts:12) returns `[]` (install for nobody) when `declaredAgents` is empty, and builds its prompt options *from* `declaredAgents`. With no `agntc.json` there are no declared agents, so this isn't a clean swap to installer-side selection — it requires reworking `selectAgents` to seed from *detected* agents plus a default (Claude), and deciding behaviour when none is detected.

Plus two more the review flagged, both real:
- **Version constraints on untagged repos.** `add` auto-resolves the latest semver tag and stores `^x.y.z`. A single-skill repo like `refero_skill` plausibly has *no tags*. What ref/constraint does a configless install pin to (commit? branch?), and how does `update` behave with none?
- **Security of recursive copy.** `copyBareSkill` does `cp(sourceDir, destDir, { recursive: true })` of an entire arbitrary clone, then deletes `agntc.json`. Configless removes even the config gate. Path-traversal, symlinks, hook/executable files, huge trees — currently unguarded. Vercel's YAML-only-frontmatter (no `---js` eval) and `isSubpathSafe` are the floor to match.

**Net:** detection is a small extension to existing code; the feature's weight is in identity, manifest/lifecycle, agent-selection rework, version pinning, and copy-safety. The discussion-phase model choice (below) still stands, but its real cost lives in items 1–3, not in detection mechanics.

---

## Finding 1 — How Vercel `skills` installs configless (source reverse-engineered)

Cloned `vercel-labs/skills` @ v1.5.10 (single runtime dep: `yaml`; bin `skills`/`add-skill`). The whole tool runs against arbitrary repos with **no per-skill config file** — and the inspected installed skills (`typescript-pro` et al.) confirm it: a skill is just a directory with a `SKILL.md`.

**The installable contract is `SKILL.md` + YAML frontmatter.** `parseSkillMd` (src/skills.ts) reads the frontmatter and returns a skill *only if* both `name` and `description` are present and are strings — otherwise `null`. That null is the entire "is this really a skill?" gate. There is no `agntc.json` equivalent; the skill's own frontmatter *is* the manifest. (`metadata` is a freeform sub-object; `metadata.internal === true` hides a skill from default discovery.)

Frontmatter parsing (src/frontmatter.ts) is deliberately YAML-only — they stripped gray-matter's `---js` engine to avoid eval-based RCE when parsing untrusted repos. Security-relevant precedent for us: **we'll be parsing files from repos we don't control.**

**Discovery algorithm** (`discoverSkills`, src/skills.ts) — how it figures out repo shape with zero config:
1. **Root `SKILL.md`?** → it's a standalone skill; return just that (early-out) unless `--full-depth`.
2. Else scan **priority dirs**: repo root (depth 1), `skills/`, `skills/.curated|.experimental|.system`, and ~23 agent dirs (`.claude/skills`, `.codex/skills`, `.cursor/skills`, `.windsurf/skills`, …). Container dirs are walked one level deeper so `skills/<category>/<skill>/SKILL.md` is found without a flag.
3. Plus skill paths declared by any plugin manifest.
4. **Fallback: full recursive walk** (maxDepth 5, skipping `node_modules/.git/dist/build/__pycache__`) if nothing found, or always under `--full-depth`.
5. Dedup by skill `name`; path-traversal guard on any user-supplied subpath (`isSubpathSafe`).

So "standalone skill / nested skill / collection of many skills" is **not three declared types** — it's one recursive scan for `SKILL.md` files, with sensible priority ordering. This maps almost exactly onto agntc's discovery problem.

## Finding 2 — The agent-routing fork (the real architectural implication)

This is the crux tension with agntc v1, made concrete.

- **agntc v1**: the *author* declares which agents a plugin targets — `agntc.json: {"agents": ["claude"]}`. The v1 spec made this **mandatory** ("`agntc.json` means I am installable; no convention fallback"). Routing follows the author's declaration.
- **Vercel**: the author declares *nothing* about agents. A skill is agent-agnostic — just a `SKILL.md`. The **installer** decides target agent dirs at install time, from `-a/--agent` flags (`-a claude-code -a opencode`, or `--agent '*'`) and/or detected agents. 23 agent destinations supported.

For configless install to work, agntc effectively has to adopt the Vercel side of this fork: **drop author-declared agents** (arbitrary repos won't carry `agntc.json`) and move agent selection to **install-time, installer-side** (flag or interactive prompt, defaulting to the user's agent — Claude). That's the single biggest design consequence, and it directly contradicts a high-confidence v1 decision. Surfacing only — the decision belongs to the discussion phase.

Open question this raises: if `agntc.json`'s sole real payload was the `agents` array, and that moves install-side, **does `agntc.json` have any remaining reason to exist?** (The discovery seed already floated "optional, possibly superseded entirely.")

## Finding 3 — Source parsing is a solved superset

`parseSource` (src/source-parser.ts) handles: `owner/repo`, `owner/repo@skill`, `owner/repo/subpath`, GitHub `tree/<branch>/<path>` URLs, GitLab (incl. nested subgroups via `/-/tree/`), `github:`/`gitlab:` prefixes, `git@…:….git` SSH, `ssh://`, local paths, `#ref` / `#ref@skill` fragments, source aliases, and a fallback to "treat as direct git URL." agntc already has its own `source-parser.ts` — this is a reference superset to measure ours against (the `@skill` and `#ref@skill` selector syntax is the notable add for picking one skill out of a collection without flags).

## Finding 4 — Beyond git: well-known endpoints + a hosted registry

Two configless-discovery mechanisms beyond raw git clone:
- **`.well-known/agent-skills/index.json`** (RFC 8615; legacy fallback `.well-known/skills/index.json`) — any *website* can publish an index of installable skills (`type: 'skill-md' | 'archive'`), no git involved. There's a v0.2.0 index schema and a legacy one. This is an emerging *standard* for configless skill distribution worth tracking.
- **Hosted registry at `skills.sh`** — `find`/`search` hit `https://skills.sh/api/search?q=…`, returning `owner/repo@skill` + install counts. Providers abstraction (src/providers/) also references `mintlify`/`huggingface` source types. So Vercel layers a discoverability/registry tier on top of git.

These are almost certainly out of scope for the agntc feature (git + local is the user's stated need), but they're the direction the ecosystem is moving — candidates to log as separate ideas, not fold in.

## Finding 5 — Lock model (connects to the user's original pain)

Two locks: a **global** lock at `$XDG_STATE_HOME/skills/.skill-lock.json` or fallback `~/.agents/.skill-lock.json`, plus a **project-local** lock (`local-lock.ts`, read during discovery so already-installed project skills aren't re-surfaced as installable sources). Note the global fallback now lives under `~/.agents/` — i.e. current versions moved the lock *out* of the project tree, which would have mitigated the exact breakage the user hit (deleting a project `agents/` dir nuking the lock). agntc keeps its manifest at `.agntc/manifest.json` — already immune to that failure mode. Mostly context, not a scope driver.

## Expanded command surface (idea candidates, not this feature)

`skills` now dispatches: `add`, `remove`, `list`, `update`, `find`/`search`, `use`, `init`, `check`. Versus agntc's `init/add/remove/update/list`. Genuinely new verbs worth logging as ideas:
- **`use`** — run/inject a skill *without* installing it (`skills use owner/repo@skill | claude`); ephemeral, pipe-to-agent.
- **`find`/`search`** — registry-backed discovery (depends on the skills.sh tier).
- **`check`** — (unconfirmed) likely a staleness/health check.

---

## Synthesis so far (options, not decisions)

The feature is clearly **technically feasible** — Vercel is an existence proof, and agntc already ships a partial no-config path (Finding 0). Detection is a *small* extension (`detectWithoutConfig` gains a bare-`SKILL.md` branch). The real work is **integration**, not detection: identity/naming (dir-basename vs frontmatter `name`, requiring a new frontmatter parser), manifest keying, configless lifecycle (`update`/`remove` must not regress — that was the user's actual pain), agent-selection rework, version pinning for untagged repos, and copy-safety. *(Earlier draft overstated "agntc owns the hard parts" — Finding 0 corrects it.)*

Sitting above that integration work is a **model decision** the discovery seed anticipated:

1. **Keep `agntc.json`, add a configless fallback** — repos with config behave as today; repos without fall back to `SKILL.md`-frontmatter detection. Agent selection: declared when config exists, install-side when it doesn't. *Two code paths, backward compatible, but two mental models.*
2. **Make `agntc.json` optional-everywhere** — always detect from structure; `agntc.json`, when present, only *overrides* (e.g. pins agents). *One path, config is pure override.*
3. **Supersede `agntc.json` entirely** — drop it; structure + frontmatter + install-time agent selection is the whole model (full Vercel parity). *Simplest mental model, but walks back the v1 decision wholesale and loses author-declared agent targeting.*

Cross-cutting sub-decisions feeding all three: where agent selection lives (author vs installer), whether to mirror the `@skill` selector syntax, and what the security posture is for parsing untrusted repos (Vercel's YAML-only stance is a floor).

These trade-offs are the discussion-phase agenda. Research's job is to have surfaced them, not pick.

## User's leading direction (captured — convergence, for discussion phase)

The user articulated a clear preferred model (this is a *decision*, parked for discussion, not picked in research):

- **Config optional, and when present it only *constrains*.** No `agntc.json` → the skill is installable for everything; at install agntc shows its supported-agents list and the user picks which to install for. Config present → the author has restricted target agents; agntc honours that list. (This is synthesis option 2 — "optional-override".)
- **`agntc.json` should arguably have been optional from the start.**

### Hard principle: NO install-command flags

Confirmed against the knowledge base — the `init` spec states *"No arguments. No flags. All configuration happens through interactive prompts."* and `add` today takes only `<source>`. Flagless, prompt-driven install is a documented design principle, and a direct reaction against Vercel's flag-heavy UX (`--skill`, `-a`, `-g`, `--all`, `--full-depth`, `-y`).

**Tension to resolve in discussion:** the discovery seed for *this* feature says "use flags to disambiguate the harder cases" — which collides with the no-flags principle. Proposed resolution (keeps Vercel's disambiguation power without flags):
- **Interactive prompts** for "which skill(s) from this collection?" (agntc already does this via `selectCollectionPlugins`).
- **Selector encoded in the source string, not a flag** — `owner/repo`, `owner/repo@skill`, or `tree/<branch>/<path>` URLs (agntc's `parseSource` already turns tree-URLs into a target). So "install a nested skill" need not be a flag.

### Version tracking — agntc already has its own "skill lock"

No need for Vercel's `.skill-lock.json`. agntc's `.agntc/manifest.json` (`ManifestEntry`) records per install: `ref` (tag), `commit` (SHA), `constraint` (semver range, e.g. `^1.2.0`), `agents`, `files` (for precise remove/update), `cloneUrl`. Resolution uses the `semver` package (`maxSatisfying` over `ls-remote` tags). Richer than Vercel's (semver constraints, not just pins). **Remaining sub-decision:** an untagged configless repo (no semver tags) gets a `commit` but no meaningful `constraint` — `update` semantics for that case need defining (pin to branch HEAD? to commit?).

## Open questions (carried forward)

Surfaced by the review agent (set 001), not yet explored in conversation:

- **Identity:** does configless install key on `SKILL.md` frontmatter `name` (Vercel model, needs a parser) or keep dir-basename? Impacts dedup, manifest key, update-matching.
- **Manifest keying:** what key for a single-skill repo / nested skill / SKILL.md-keyed collection (no per-child `agntc.json` to enumerate)?
- **Lifecycle:** how does `update` (nuke-and-reinstall) re-resolve a configless install without re-discovering a *different* skill set? How does `remove` target it? (This is the user's original pain — must not regress.)
- **Nested-skill selection:** is the "skill in a subdir" case already covered by agntc's existing `tree/<branch>/<path>` → `direct-path`/`targetPlugin` parsing, or does it need a Vercel-style `@skill` selector or a new flag? How does `targetPlugin` behave pointed at a bare `SKILL.md` dir?
- **Version constraints:** what ref/constraint for an untagged repo? Pin to commit/branch? How does constrained `update` behave with no semver tags?
- **Backward-compat / migration:** what happens to existing `agntc.json` installs, the `init` scaffolder that emits `agntc.json`, and the collection pipeline that depends on child `agntc.json`, under each synthesis option?
- **Disambiguation UX:** concrete flag surface — agntc's `add` is currently flagless and prompt-driven (`selectCollectionPlugins`, `selectAgents`). How do new flags name/interact, vs Vercel's `@skill` selector + `--full-depth`?
- **Copy safety:** assess agntc's actual exposure (recursive `cp` of an untrusted clone) — path traversal, symlinks, hooks/executables, tree size — against Vercel's floor (YAML-only frontmatter, `isSubpathSafe`).
