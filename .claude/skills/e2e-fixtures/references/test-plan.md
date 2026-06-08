# Test Plan — Walkthrough

*Reference for the **e2e-fixtures** skill. The orchestrator presents these one at a time, substituting `<owner>` with the real GitHub login, and reads back what you observed.*

Conventions:
- All `./agntc …` commands run **from the sandbox** (`cd "$SANDBOX"`).
- **Reset between every install** so each test starts from a blank project: run `scripts/reset-sandbox.sh`.
- 📍 = Claude runs it non-interactively and asserts. ⌨️ = you run it in your terminal (it needs a real TTY); Claude tells you what to expect and checks your result.
- To see detected-agent pre-ticking, optionally `mkdir .claude` in the sandbox before an install; otherwise no agents are pre-ticked.

---

## Group 1 — Bare skill

### 1.1 `bare-skill` — configless bare skill ⌨️
```
cd "$SANDBOX" && ./agntc add <owner>/agntc-fix-bare-skill
```
Expect: detected as a **bare skill**; an agent multiselect offering claude/codex/cursor (none pre-ticked unless detected). Pick one or more → installs to each agent's skill dir (e.g. `.claude/skills/agntc-fix-bare-skill/SKILL.md` + `references/cheatsheet.md`). No `agntc.json` on disk in the destination. Manifest entry has `ref: null`, `type: "skill"`, no `constraint`.

### 1.2 `bare-skill-claude` — Claude-restricted ⌨️
```
./agntc add <owner>/agntc-fix-bare-skill-claude
```
Expect: only **claude** offered (codex/cursor excluded). If `.claude/` exists (detected), install auto-proceeds with no prompt. Manifest `agents:["claude"]`, `type:"skill"`.

### 1.3 `bare-skill-tagged` — version constraints ⌨️
```
./agntc add <owner>/agntc-fix-bare-skill-tagged           # bare → latest v2.0.0, constraint ^2.0.0
# reset, then:
./agntc add <owner>/agntc-fix-bare-skill-tagged@^1.0      # best-in-range → v1.1.0, constraint ^1.0
# reset, then:
./agntc add <owner>/agntc-fix-bare-skill-tagged@v1.0.0    # exact pin, no constraint
```
Expect: ref/constraint as noted. After the `@^1.0` install, `list` shows `v2.0.0` as an out-of-constraint / newer tag.

---

## Group 2 — Plugin

### 2.1 `plugin` — configless multi-asset ⌨️
```
./agntc add <owner>/agntc-fix-plugin
```
Expect: detected **plugin**; all agents offered. Installs `skills/planning`, `skills/review` to the skills dir; `agents/executor.md` and `hooks/pre-commit.sh` only for Claude (codex/cursor have no agents/hooks routing). Manifest `type:"plugin"`.

### 2.2 `plugin-claude` — Claude-only plugin ⌨️
```
./agntc add <owner>/agntc-fix-plugin-claude
```
Expect: only claude offered (the `agentic-workflows` shape). All asset types land under `.claude/`.

### 2.3 `plugin-assets-only` — no skills/ ⌨️
```
./agntc add <owner>/agntc-fix-plugin-assets-only
```
Expect: detected **plugin** (has `agents/` + `hooks/`, ≥1 asset dir, not skills-only). For Claude installs agents+hooks; for codex/cursor nothing to route.

---

## Group 3 — Skills-only (ambiguous)

### 3.1 `skills-only` default → collection menu ⌨️
```
./agntc add <owner>/agntc-fix-skills-only
```
Expect: **multiselect menu** of inner skills (`alpha`, `beta`) — the Vercel default. Selected members install as **bare skills** keyed `<owner>/agntc-fix-skills-only/alpha` (basename, NOT `…/skills/alpha`).

### 3.2 `skills-only --plugin` → single bundle ⌨️
```
./agntc add <owner>/agntc-fix-skills-only --plugin
```
Expect: NO menu; whole repo bundles as **one plugin** keyed `<owner>/agntc-fix-skills-only`, `type:"plugin"`.

### 3.3 `skills-only-typeplugin` → bundle via config ⌨️
```
./agntc add <owner>/agntc-fix-skills-only-typeplugin
```
Expect: bundles as one plugin (config `type:plugin`), no menu.

---

## Group 4 — Collections

### 4.1 `collection` — configless members ⌨️
```
./agntc add <owner>/agntc-fix-collection
```
Expect: member multiselect (`alpha`, `beta` = bare-skill members; `tool` = plugin member). Each selected installs under its own key `<owner>/agntc-fix-collection/<name>`; per-member agent prompts (all-agents since configless).

### 4.2 `collection-mixed` — config + configless members ⌨️
```
./agntc add <owner>/agntc-fix-collection-mixed
```
Expect: `alpha` constrained to claude (its config), `beta`/`tool` offer all agents.

### 4.3 `collection-stray-root` — stray root config ignored ⌨️
```
./agntc add <owner>/agntc-fix-collection-stray-root
```
Expect: still a **collection** (root `agntc.json` with no `type` is ignored, not treated as a plugin). Menu of `alpha`, `beta`.

### 4.4 `collection-nested` — nested collection skipped ⌨️
```
./agntc add <owner>/agntc-fix-collection-nested
```
Expect: `alpha` offered; `sub` (itself a collection) **skipped with a warning** — membership is one level only.

### 4.5 Tree-path selector (against `collection`) ⌨️
```
./agntc add https://github.com/<owner>/agntc-fix-collection/tree/main/alpha
```
Expect: installs ONLY `alpha`, no menu, keyed `<owner>/agntc-fix-collection/alpha`.

---

## Group 5 — Errors & leniency

### 5.1 `err-typeplugin-bareskill` — type vs structure 📍
```
./agntc add <owner>/agntc-fix-err-typeplugin-bareskill
```
Expect: **hard error before any prompt**, exit ≠ 0; message names the conflict (`type: plugin` on a bare skill). Nothing written.

### 5.2 `err-typeplugin-collection` — type vs structure 📍
```
./agntc add <owner>/agntc-fix-err-typeplugin-collection
```
Expect: hard error before any prompt, exit ≠ 0 (cannot bundle a member-dirs collection as a plugin).

### 5.3 `not-agntc` — nothing installable 📍
```
./agntc add <owner>/agntc-fix-not-agntc
```
Expect: rejected as not-agntc, exit ≠ 0, before any prompt.

### 5.4 `config-malformed` — lenient ⌨️
```
./agntc add <owner>/agntc-fix-config-malformed
```
Expect: NO error from the bad JSON — config is treated as "no usable config" → all-agents prompt; installs as a bare skill.

### 5.5 `config-empty-agents` — lenient ⌨️
```
./agntc add <owner>/agntc-fix-config-empty-agents
```
Expect: empty `agents:[]` → lenient → all-agents prompt (not "install for nobody").

---

## Group 6 — Copy-safety

### 6.1 `symlink-escape` — blocked before copy ⌨️
```
./agntc add <owner>/agntc-fix-symlink-escape
```
Expect: detected bare skill, agent prompt appears; after selecting agents it is **blocked** with a symlink-escape message and exits ≠ 0. Nothing is written to the project (no `.claude/skills/...`). (The escaping symlink targets `/etc/passwd`.)

---

## Group 7 — Update lifecycle

> Each: install (⌨️), then Claude pushes the mutation (📍 `scripts/mutate.sh …`), then update.

### 7.1 `lifecycle-plugin` — benign addition / type replay
1. ⌨️ `./agntc add <owner>/agntc-fix-lifecycle-plugin` (installs plugin: `skills/core` + `agents/`).
2. 📍 `scripts/mutate.sh lifecycle-plugin` (adds `hooks/` + `skills/extra`, pushes).
3. ⌨️ `./agntc update <owner>/agntc-fix-lifecycle-plugin`
   Expect: succeeds; type replayed as **plugin**; new `hooks/` + `skills/extra` picked up; `list` shows it up to date afterwards.

### 7.2 `lifecycle-break` — derive-before-delete abort
1. ⌨️ `./agntc add <owner>/agntc-fix-lifecycle-break` (bare skill, untagged → HEAD).
2. 📍 `scripts/mutate.sh lifecycle-break` (reshapes to a member-dirs collection, pushes).
3. ⌨️ `./agntc update <owner>/agntc-fix-lifecycle-break`
   Expect: **abort** — recorded type `skill` no longer supported (root `SKILL.md` gone); existing install **left intact** (files still present, manifest unchanged); clear message + non-zero exit; remedy is manual remove+add.

### 7.3 `lifecycle-skills-only-member` — sourceSubpath relocation
1. ⌨️ `./agntc add <owner>/agntc-fix-lifecycle-skills-only-member` → pick member `alpha` from the menu (installs keyed `…/alpha`).
2. 📍 `scripts/mutate.sh lifecycle-skills-only-member` (adds `skills/alpha/added-reference.md`, pushes).
3. ⌨️ `./agntc update <owner>/agntc-fix-lifecycle-skills-only-member/alpha`
   Expect: update **succeeds** — source relocated to the clone's `skills/alpha`, derive-before-delete passes, `added-reference.md` now present at the install destination, manifest entry intact (basename identity preserved).

---

## Group 8 — list / remove (interactive dashboard) ⌨️

After a few installs (skip a reset so several entries exist):
```
./agntc list
```
Expect: dashboard with status indicators (up to date / update available / newer tags / constrained / check failed). Enter a plugin → detail view with Update / Remove / Change version / Back. "Change version" lets you pick any tag and strips the constraint (pins exact). Verify Remove deletes the files and the manifest entry.

---

## Wrap up

When done: `scripts/teardown.sh` (deletes all `agntc-fix-*` repos + the sandbox). Confirm at the prompt, or `scripts/teardown.sh -y`.
