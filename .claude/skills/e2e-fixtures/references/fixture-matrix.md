# Fixture Matrix

*Reference for the **e2e-fixtures** skill. Repos are created as `<owner>/agntc-fix-<suffix>` (private).*

Legend — **Run by**: 📍 = non-interactive (Claude can run & assert) · ⌨️ = interactive TTY (you run, Claude interprets).

## Standalone — bare skill

| Suffix | Shape | Config | Expected | Run by |
|---|---|---|---|---|
| `bare-skill` | root `SKILL.md` | none, untagged | bare skill; all-agents prompt; `ref:null` (HEAD tracking) | ⌨️ |
| `bare-skill-claude` | root `SKILL.md` | `{agents:[claude]}` | bare skill; Claude-only (auto-selects if Claude detected) | ⌨️ |
| `bare-skill-tagged` | root `SKILL.md` | none, tags `v1.0.0/v1.1.0/v2.0.0` | bare add → `v2.0.0` `^2.0.0`; `@^1.0` → `v1.1.0`; `@v1.0.0` → exact pin | ⌨️ |

## Standalone — plugin

| Suffix | Shape | Config | Expected | Run by |
|---|---|---|---|---|
| `plugin` | `skills/` + `agents/` + `hooks/` | none | plugin; all-agents prompt | ⌨️ |
| `plugin-claude` | `skills/` + `agents/` + `hooks/` | `{agents:[claude]}` | plugin; Claude-only (the `agentic-workflows` case) | ⌨️ |
| `plugin-assets-only` | `agents/` + `hooks/` (no `skills/`) | none | plugin (≥1 asset dir, not skills-only) | ⌨️ |

## Skills-only (the one ambiguous shape)

| Suffix | Shape | Config / flag | Expected | Run by |
|---|---|---|---|---|
| `skills-only` | root `skills/` (alpha, beta) | none | **collection menu** of inner skills (Vercel default) | ⌨️ |
| `skills-only` | same | `--plugin` flag | bundles whole repo as **one plugin** | ⌨️ |
| `skills-only-typeplugin` | root `skills/` | `{type:plugin}` | bundles as **one plugin** | ⌨️ |

## Collections

| Suffix | Shape | Expected | Run by |
|---|---|---|---|
| `collection` | members alpha, beta (skills), tool (plugin), no configs | configless collection; multiselect; per-member agents | ⌨️ |
| `collection-mixed` | alpha `{agents:[claude]}`, beta configless, tool configless | config + configless members coexist | ⌨️ |
| `collection-stray-root` | members + stray ROOT `agntc.json` (no type) | root config ignored; still a collection | ⌨️ |
| `collection-nested` | member `alpha` + member `sub/` (itself a collection) | `alpha` installable; `sub` skipped with a warning | ⌨️ |

## Errors / leniency

| Suffix | Shape | Expected | Run by |
|---|---|---|---|
| `err-typeplugin-bareskill` | root `SKILL.md` + `{type:plugin}` | hard error (type vs structure), exit ≠ 0, **before** prompt | 📍 |
| `err-typeplugin-collection` | members + root `{type:plugin}` | hard error, exit ≠ 0, **before** prompt | 📍 |
| `not-agntc` | only `README.md` | rejected as not-agntc, exit ≠ 0, **before** prompt | 📍 |
| `config-malformed` | `SKILL.md` + invalid JSON `agntc.json` | lenient → all-agents prompt (no error) | ⌨️ |
| `config-empty-agents` | `SKILL.md` + `{agents:[]}` | lenient → all-agents prompt | ⌨️ |

## Copy-safety

| Suffix | Shape | Expected | Run by |
|---|---|---|---|
| `symlink-escape` | `SKILL.md` + symlink → `/etc/passwd` | **blocked** before copy (after agent prompt), exit ≠ 0, nothing written | ⌨️ |

## Version pinning

| Suffix | Shape | Expected | Run by |
|---|---|---|---|
| `tagged-zerover` | tags `v0.1.0/v0.2.0` | `0.x` shown but needs explicit bump (no auto minor) | ⌨️ |

## Update lifecycle (untagged → HEAD-tracked; use `mutate.sh` between install & update)

| Suffix | Install shape | Mutation | Expected on update | Run by |
|---|---|---|---|---|
| `lifecycle-plugin` | `skills/` + `agents/` | add `hooks/` + new skill | type replayed `plugin`; benign additions picked up; success | ⌨️ install / 📍 mutate |
| `lifecycle-break` | bare skill | reshape → member-dirs collection | derive-before-delete **abort**; install left intact; exit ≠ 0 | ⌨️ install / 📍 mutate |
| `lifecycle-skills-only-member` | skills-only; install one member | add file under `skills/alpha` | member update succeeds via `sourceSubpath` relocation | ⌨️ install / 📍 mutate |

## Selector (no extra repo)

Tree-path member selector against `collection`:
`./agntc add https://github.com/<owner>/agntc-fix-collection/tree/main/alpha` → installs only `alpha`, keyed `<owner>/agntc-fix-collection/alpha`. ⌨️
