# Research: Vercel Skills Compatibility

Explores what it takes for agntc to be a like-for-like replacement for Vercel's `skills` CLI — anything built for their skills library installs through `npx agntc add` with the same source formats, flags, and behaviour — while keeping agntc's own formats and its `--plugin` bundling intact. Prompted by three inbox ideas from the 2026-06-09 e2e-fixtures testing session (non-interactive install flags, Vercel CLI cross-compatibility, a richer post-clone `add` intro), pulled together in discovery as one feature.

## Starting Point

What we know so far:
- **Core intent:** install skills built for Vercel's skills library directly into Claude Code (and Codex/Cursor) through agntc, swapping the binary — `npx skills add owner/repo` → `npx agntc add owner/repo` — and getting an equivalent install.
- **Constraint — don't break agntc's own systems.** In particular `--plugin`, which bundles a skills-only source as one unit. Vercel's CLI has no equivalent; it is the reason agntc exists. The owner has used it to install a large set of skills by one author that are designed to be installed individually through Vercel's CLI.
- **Already shared with Vercel's model** (per the compatibility seed): tagless source → HEAD, directory-basename identity, skills-only root → member menu (Vercel's one-level-into-`skills/` discovery).
- **Unattended installs are in scope** as part of Vercel's `add` surface: `--agents` pre-answering agent selection (still intersected with a unit's declared agent ceiling), `--yes`/`-y` with a precise definition of what it answers at each prompt, and a way to select collection members without a prompt. Open in the seed: interaction with auto-select, conflict resolution under `--yes`, error behaviour when a flagged agent is outside a unit's ceiling.
- **Pre-install summary is in scope**, also as part of Vercel's `add` surface. Vercel shows a connected tree after clone — source URL, repository cloned, "Found N skills", unit names, and a per-skill description. The ASCII banner half shipped already (`abfe6c9`, `src/banner.ts`); the post-clone information is what remains. agntc deliberately does not parse `SKILL.md` frontmatter (identity = directory basename), so a description line would be a scoped, read-only, display-only frontmatter read. Keep it sized to agntc's three agents, not Vercel's ~71-agent list.
- **Two validation strands surface here** even though validation as a whole was left out of scope: Vercel rejects a skill whose frontmatter lacks `name` + `description`, so the compatibility contract has to take a position on repos Vercel would refuse; and unattended installs remove the last human look before hook scripts land.
- **A defect rides along:** when updating something installed with `--plugin`, the out-of-constraint re-add advice omits `--plugin`, so following it fails. The owner flagged the exact behaviour may be slightly different — to be verified. Treated as part of this work ("fix partially-done paths along the way"), not a separate bugfix.
- **Reshape cue:** if the audit of Vercel's CLI turns up whole capabilities agntc has no equivalent for — installing once for every project rather than per project, or searching their directory — the work becomes several connected pieces and should be re-shaped then. The owner may also roadmap some extra work for later rather than have it ride along.
- **Out of scope by discovery:** the broader validation bucket, and the member-select wording idea (stays in the inbox as quick-fix material).
- Starting point is technical: audit the Vercel surface first, then map it onto agntc.

---

## First read — agntc's `add` line against Vercel's (2026-10-05)

Prior ground: the configless-install research (2026-06-04) reverse-engineered `vercel-labs/skills` @ v1.5.10. Its source-string superset: `owner/repo`, `owner/repo@skill`, `owner/repo/subpath`, GitHub `tree/<branch>/<path>` URLs, GitLab incl. nested subgroups, `github:`/`gitlab:` prefixes, SSH, local paths, `#ref` and `#ref@skill` fragments, source aliases, fallback to a direct git URL. Its `add` flags: `--skill`, `-a/--agent`, `-g`, `--all`, `--full-depth`, `-y`. Whether v1.5.10 is still Vercel's current surface is unverified — the audit thread owns that.

Measured against agntc today:

- **`add` takes one flag.** `grep -rn "\.option(" src/ | grep -v test` → one hit, `src/commands/add.ts:914`, `--plugin`. No agent, skill-selection, yes, global, or list flags.
- **The `@` suffix means opposite things.** In agntc, `owner/repo@X` is a ref or a semver constraint (`^`/`~` → constraint, anything else → ref; `classifyRefOrConstraint`, `src/source-parser.ts`). In Vercel, `owner/repo@X` selects the skill named X, and a ref goes in a `#ref` fragment. A Vercel line `npx skills add owner/repo@some-skill` swapped to `agntc` is not refused — it is read as "clone at ref `some-skill`", which fails on the missing ref or, if a branch or tag of that name exists, installs the wrong thing. A collision, not a gap.
- **`owner/repo/subpath` shorthand is refused.** `grep -n "too many slashes" src/source-parser.ts` → line 365, error "too many slashes in source … — expected owner/repo". Vercel accepts it. (agntc reaches a subpath only through a `tree/<branch>/<path>` URL.)
- **A standing spec decision sits in the way of flag parity.** `grep -n "No install-command flags" .workflows/configless-install/specification/configless-install/specification.md` → line 52: "No install-command flags for type or unit selection, except the single narrow `--plugin` installer override … Unit selection from a collection is via interactive prompt or a source-string selector." The configless-install research recorded this as a deliberate reaction against Vercel's flag-heavy `add` (`--skill`, `-a`, `-g`, `--all`, `--full-depth`, `-y`). The carrier's "same source formats and flags" meets it head-on — a high-confidence decision of another work unit, not reopened here; the tension is the material.
- An earlier investigation (update-check-fails-on-branch-ref, 2026-07-02) parked "`npx skills add nuxt/ui` resolving to the right subpath" as this idea's ground.

## Owner's framing — the method and what's open (2026-10-05)

- **The no-install-flags decision is open to reopening.** The owner is not attached to it: the bar is that Vercel install lines work as expected. For each mismatch the paths are adapt agntc's rules, change them, or make both work.
- **Method:** work through everything Vercel's system can do, line it up against what agntc has built, and see what's left. The residue is the discussion agenda.
- **`@` has to be given one meaning** (or a rule that reads it) — it is on that agenda by name.

### `@` — the shape of the problem (preliminary, ahead of the Vercel audit)

What each tool puts after `@` today: Vercel (v1.5.10) — a skill name, with the ref in a `#ref` fragment and `#ref@skill` composing both. agntc — a semver constraint (`^`/`~`), an exact tag (`v2.0.0`), or any other ref such as a branch. agntc's own surfaces also emit `@`: the out-of-constraint footer's re-add advice prints `npx agntc add <repo>@<newest>` for an exact-pin user, so whatever `@` comes to mean reaches that advice too (and the `plugin-readd-defect` thread sits on the same line).

Option landscape as it stands (not exhaustive, pending what the audit finds):

1. **Vercel grammar wholesale** — `@` selects a skill, `#` carries ref/constraint (`owner/repo#^1.0`, `#v2.0.0`, `#main`). Every pasted Vercel line works; every agntc line already written (docs, READMEs, the footer's advice, habit) breaks or needs a deprecation path.
2. **Read the suffix by shape** — `^`/`~` ranges and semver-shaped tags stay versions; anything else selects a skill; `#` carries arbitrary refs. Common lines from both tools work. Cost: agntc's `@branch` form moves to `#branch`; the residual ambiguity is a skill whose name is version-shaped.
3. **Read the suffix against the repo** — clone, then treat `@X` as a skill if one named X exists, else as a ref. Chicken-and-egg: the ref decides what is cloned, so this means a default-branch probe first; and a repo with both a branch and a skill named X stays ambiguous.
4. **Separate grammars by entry point** — agntc's grammar by default, Vercel's under some compatibility switch. Fails paste-and-go unless the switch is automatic.

Lean at this point: (2) gets the most real lines working in both directions for the smallest break, but it hangs on facts the audit has to supply — notably what Vercel's `@skill` matches against. Vercel dedups skills by frontmatter `name`; agntc's identity is the directory basename. If Vercel's selector matches the frontmatter name, a selector that works in Vercel can miss in agntc even with `@` settled.

## agntc's own printed re-add advice — the `--plugin` defect, and a second one (2026-10-05)

`grep -rn "npx agntc add" src/ | grep -v test` → four advice sites (plus `list`'s empty-state hint). None carries `--plugin`:

| Site | When it prints | Command printed |
|---|---|---|
| `src/summary.ts:355` (`renderOutOfConstraintSection`) | `update`, newer major outside a caret constraint | `npx agntc add <owner/repo>` |
| `src/update-render.ts` (`formatNewerTagsLine`) | all-mode `update`, exact-pinned group with newer tags | `npx agntc add <owner/repo>@<newest>` |
| `src/commands/update.ts:173` | single-key `update <key>`, exact pin with newer tags | `npx agntc add <key>@<newest>` |
| `src/clone-reinstall.ts:270` (`buildAbortMessage`) | derive-before-delete abort | `npx agntc remove <key> then npx agntc add <key>` |

- **The `--plugin` drop is confirmed, at every site.** The manifest records `type: "skill" | "plugin"` (`src/manifest.ts:18`) but not *why* — a structural plugin (`skills/` + `agents/`/`hooks/`) and a skills-only source bundled by `--plugin` both record `plugin`. Following the bare advice for a `--plugin` bundle re-detects the source as skills-only and takes the default collection-menu path. Code read (not run end-to-end): members key as `owner/repo/<member>`, distinct from the bundle's `owner/repo` key, so their files collide with the bundle's and the collision prompt offers "Remove owner/repo and continue" — following the advice to completion converts the bundle into separate members rather than upgrading it. The owner's recollection ("following it fails") is close: it doesn't error, it silently changes the install's shape or stops at a collision prompt.
- Observation: because a `--plugin` on a structure that already reads as a plugin is a redundant no-op under the configless-install spec (type agrees → no-op), advice carrying `--plugin` whenever the recorded type is `plugin` would not misfire on structural plugins. Material, not a fix decision.
- **Second defect — member-scoped advice is refused by agntc's own parser.** The single-key newer-tags site and the abort message print the manifest key, which for a collection member is `owner/repo/<member>`. Run against the parser: `npx tsx -e '…parseSource("owner/repo/member@v2.0.0")…'` → `ERROR: too many slashes in source "owner/repo/member" — expected owner/repo`; same for `owner/repo/member` bare. So for any collection member, those two printed commands cannot be run as printed. (The all-mode newer-tags line already uses the bare `owner/repo` — its doc comment notes it mirrors the single-key path "at group granularity" — so the two surfaces disagree.) This connects to the Vercel audit: accepting `owner/repo/subpath` shorthand, which Vercel does, would make these lines parse.

## Prompts `add` can show today (2026-10-05)

`grep -rnE "(select|multiselect|confirm|text)\(\{" src | grep -v "\.test\.ts"` plus the clack imports → the prompts on the `add` path:

1. **Collection member pick** — multiselect, nothing required (`src/collection-select.ts:34`). Shown for any collection, including the skills-only default.
2. **Agent pick** — multiselect over the author's declared agents or, with none declared, all known agents; detected agents pre-ticked; an empty pick is a deliberate "none" (`src/agent-select.ts:63`). Auto-skipped only when the author declared exactly one agent and it is detected (`src/agent-select.ts:39–47`).
3. **Collision with another managed install** — per colliding key: "Remove <key> and continue" / "Cancel installation" (`src/collision-resolve.ts:36`). Reinstalling the *same* key never asks — its files are nuked and replaced (`src/commands/add.ts:413–415`, `:775–778`).
4. **Unmanaged files in the way** — "Overwrite all" / "Cancel this plugin's install", then a second "Are you sure? These files will be permanently replaced." (`src/unmanaged-resolve.ts:37`, `:57`).

An unattended `add` has to answer all four; (3) and (4) are destructive — the only prompts whose "yes" deletes something.
