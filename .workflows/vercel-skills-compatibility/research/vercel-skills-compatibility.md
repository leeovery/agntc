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
