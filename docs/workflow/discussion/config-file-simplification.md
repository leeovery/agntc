---
topic: config-file-simplification
status: concluded
date: 2026-02-09
---

# Discussion: Config File Simplification — Rethinking agntc.json

## Context

After completing most discussions, revisiting `agntc.json` with fresh eyes. The file was established across core-architecture (boundary marker: plugin vs collection) and multi-agent-support (metadata carrier: agent compatibility). Two optional fields, both serving different purposes — and that dual purpose felt like a code smell.

The original design also had a convention fallback (no `agntc.json` → scan for asset dirs), making the file sometimes-present, sometimes-not. From a plugin author's perspective: "Do I need this file or not?" shouldn't require reading edge case documentation.

### References

- [Discussion: core-architecture.md](core-architecture.md) — original `agntc.json` as boundary marker + type declaration
- [Discussion: multi-agent-support.md](multi-agent-support.md) — `agents` field added, optional, default-to-all
- [Discussion: plugin-init-scaffolding.md](plugin-init-scaffolding.md) — init scaffolds `agntc.json`

## Questions

- [x] Should `agntc.json` always be required, or is the convention fallback worth keeping?
- [x] Should we split to three types (skill, plugin, collection) instead of two?
- [x] Should `agents` be required and explicit instead of optional with default-to-all?
- [x] Should collection-level agent config be dropped (no inheritance)?
- [x] Does collection need to be a type at all?
- [x] Can `type` be inferred from structure, eliminating it as a field?
- [x] What ripple effects does this have on other concluded discussions?

---

## Should `agntc.json` always be required?

### Context

Original design: `agntc.json` optional, convention fallback scans for asset dirs. This created two detection paths and "do I need this file?" ambiguity for plugin authors.

### Journey

The convention fallback was justified as backwards compatibility for repos that haven't adopted agntc. But agntc is a new tool — there's no installed base. The fallback solves a problem that doesn't exist, and in exchange creates documentation complexity and two code paths.

From the plugin author perspective, "always include `agntc.json`" is one rule. "Include it if you want, but if you don't we'll try to figure it out" is a paragraph of edge cases.

### Decision

**Always require `agntc.json` for installable units.** No convention fallback.

- Eliminates two-path detection logic
- Documentation becomes: "Step 1: add `agntc.json`"
- Author intent is always explicit
- No "do I need this?" ambiguity

Confidence: High.

---

## Should we split to three types (skill, plugin, collection)?

### Context

Original design had two types: `plugin` (default) and `collection`. But "plugin" covered two structurally different things — a bare skill (SKILL.md at root) and a multi-asset package (skills/, agents/, hooks/ dirs). The tool papered over this with bare-skill fallback logic.

### Journey

The bare-skill fallback was implicit behaviour: "if no asset dirs found, check for SKILL.md." The author had to know this without being told. Initially considered making skill a first-class type alongside plugin and collection — three explicit types mapping to three installation behaviours.

This was a useful stepping stone but ultimately superseded. Collection was dropped as a type (see "Does collection need to be a type?" below), and then `type` itself was dropped as a field (see "Can type be inferred from structure?" below). The skill/plugin distinction is real but structural, not declared.

### Decision

**Skill and plugin are distinct concepts with distinct installation behaviours, but they don't need a `type` field.** The distinction is inferred from directory structure. Collection was dropped as a type entirely. See subsequent questions for the full resolution.

Confidence: High.

---

## Should `agents` be required and explicit?

### Context

Original design: `agents` field optional, omitting it meant "compatible with all detected agents." This was framed as low-friction for authors.

### Journey

The default-to-all approach is a time bomb. Today "all" means Claude + Codex. When a third agent is added, every existing plugin without an `agents` field silently becomes "compatible" with the new agent — without the author testing or consenting to that.

Requiring explicit declaration is opt-in consent. The author says "I built and tested this for Claude" — and that declaration stays accurate regardless of what agents are added later.

It also removes an entire class of questions: "what does omitting agents mean?", "does empty array mean none or all?", "how does the default interact with detection?"

### Decision

**`agents` field required. Always explicit.**

- No default-to-all
- Author declares exactly which agents they've built for
- Declaration remains accurate as the agent ecosystem grows
- Removes ambiguity around missing/empty values

Confidence: High.

---

## Should collection-level agent config be dropped?

### Context

Original design: collection root `agntc.json` declares `agents` which all children inherit unless they override with their own `agntc.json`. This was framed as reducing repetition — 20 skills all targeting Claude only need the root to say `["claude"]`.

### Journey

Inheritance sounds elegant but creates "where did this value come from?" debugging. Looking at a child plugin's `agntc.json` and seeing no `agents` field — does that mean "all agents" (the old default), or "inherited from parent" (the new rule)? You have to trace up the tree.

With every installable unit declaring its own agents, you look at one file and know everything. No tracing. No inheritance rules to document or implement.

The repetition concern (20 skills each declaring `"agents": ["claude"]`) is real but trivial — it's one line per file. The clarity benefit far outweighs the duplication cost.

### Decision

**No recursive/inherited agent config. Every installable unit declares its own agents.**

- One file = complete picture, no tracing
- Removes inheritance logic from the tool
- Removes "override" concept from documentation
- Trivial repetition accepted for major clarity gain

Confidence: High.

---

## Does collection need to be a type at all?

### Context

With recursive agent config removed, collection-level `agntc.json` would only contain `{"type": "collection"}` — a file whose sole purpose is "I'm not a plugin, look at my children." Does this still need to exist?

### Journey

The reframe: **`agntc.json` means "I am installable."** A collection is not installable — you install children FROM it. It's just a container, not an entity.

If every installable thing must have `agntc.json`, and a collection is not installable, then the collection doesn't need a config file. Its existence is a structural observation: "root has no `agntc.json`, but subdirs do."

This means `type` drops to two values: `skill` and `plugin`. Collection isn't declared — it's detected.

Detection rules:
1. Root has `agntc.json` → standalone installable, read type
2. Root has no `agntc.json` → scan immediate subdirs for `agntc.json` → those are selectable installables
3. Nothing → not an agntc repo

This doesn't contradict "always require config" — the rule is "every installable thing has `agntc.json`." The collection isn't an installable thing.

### Decision

**Collection is not a type. It's a structural observation.**

- `type` field: `"skill"` or `"plugin"` only (subsequently dropped — see next question)
- Collection detected by: no root config + subdirs with configs
- Collection has no metadata to declare (no agents, no type that affects installation)
- Removes a type value and its associated documentation

Confidence: High.

---

## Can `type` be inferred from structure, eliminating it as a field?

### Context

With collection dropped as a type, `type` only had two values: `skill` and `plugin`. But these map directly to structural patterns that are already mutually exclusive — SKILL.md at root vs asset dirs. If the structure already tells you, does the author need to declare it?

### Journey

Followed the thread from collection inference. If a collection doesn't need to declare itself because the structure says so, the same logic applies to skill vs plugin:

- `SKILL.md` present at directory root → it's a skill. Copy the directory as a skill.
- Asset dirs present (`skills/`, `agents/`, `hooks/`) → it's a plugin. Scan and route.
- These patterns are mutually exclusive — no ambiguity.

This means `type` is redundant with structure. The author would be restating what their directory layout already shows.

Removing `type` reduces `agntc.json` to a single field:

```json
{
  "agents": ["claude"]
}
```

One field. One purpose: "these are the agents I work with." Everything else — whether it's a skill or plugin, whether the repo is a collection — is inferred from structure.

The file's *presence* still does useful work: it marks "I am installable" (critical for collection detection — scan subdirs for `agntc.json`). But the file itself carries only one piece of information that genuinely cannot be inferred: agent compatibility. That's domain knowledge in the author's head.

### Detection rules (final)

1. Root has `agntc.json` → standalone installable
   - Has `SKILL.md` at root → skill (copy directory as a skill)
   - Has asset dirs (`skills/`, `agents/`, `hooks/`) → plugin (scan and route)
   - Neither → warn (config exists but nothing to install)
2. Root has no `agntc.json` → scan immediate subdirs for `agntc.json` → those are selectable installables (collection)
3. Nothing → not an agntc repo

### Structural examples

**Bare skill (repo root):**
```
my-skill/
  agntc.json       ← {"agents": ["claude"]}
  SKILL.md
  reference.md
```

**Multi-asset plugin (repo root):**
```
my-plugin/
  agntc.json       ← {"agents": ["claude"]}
  skills/
    planning/SKILL.md
    review/SKILL.md
  agents/
    executor.md
  hooks/
    pre-commit.sh
```

**Collection (no root config, children have configs):**
```
my-collection/
  README.md
  go/
    agntc.json     ← {"agents": ["claude", "codex"]}
    SKILL.md
  python/
    agntc.json     ← {"agents": ["claude"]}
    SKILL.md
  complex-tool/
    agntc.json     ← {"agents": ["claude"]}
    skills/
    agents/
    hooks/
```

### Decision

**`type` field eliminated. Skill vs plugin inferred from directory structure.**

`agntc.json` is now:
```json
{
  "agents": ["claude"]
}
```

- One required field: `agents`
- File presence = "I am installable"
- Skill vs plugin = structural (SKILL.md vs asset dirs)
- Collection = structural (no root config, subdirs have configs)
- Agent compatibility = the one irreducible piece of author metadata

Confidence: High.

---

## What ripple effects does this have on other concluded discussions?

### Context

This discussion changes several decisions made in prior discussions. Cataloguing the impacts so the specification phase can reconcile them.

### Ripple effects

**Core architecture (core-architecture.md):**
- Convention fallback (case 7: no `agntc.json` → scan for asset dirs) → **removed**. No root config now means collection, not fallback.
- Bare skill detection fallback → **removed**. Replaced by structural inference (SKILL.md present = skill).
- The seven validated permutations need re-validation against new detection rules.
- `agntc.json` as "boundary marker + metadata carrier" → **simplified** to metadata only. Boundary is structural.

**Multi-agent support (multi-agent-support.md):**
- `agntc.json` schema: `type` + `agents` both optional → **`agents` only, required**.
- Default-to-all when `agents` omitted → **removed**. Explicit declaration always.
- "Warn don't block" on mismatch → **still applies**. User selects agent not in plugin's list → warn, don't block.
- Recursive agent inheritance in collections → **removed**.

**CLI commands (cli-commands-ux.md):**
- `add` mode detection: read `agntc.json` type field → **infer from structure** (SKILL.md vs asset dirs).
- `add` collection detection: read root `type: "collection"` → **no root config + subdirs with configs**.
- Agent selection pre-selection: "compatible with all" default influenced pre-selection → **no default**. Pre-select based on detection ∩ plugin's explicit `agents` list.

**Plugin init scaffolding (plugin-init-scaffolding.md):**
- Init still offers three choices (skill, plugin, collection) — these are scaffolding paths, not type values.
- Collection init: no root `agntc.json` created, just example subdir with its config.
- `agents` multiselect is mandatory — result always written to config.
- No `type` field written to `agntc.json` — structure communicates type.

### Decision

**All ripple effects catalogued. Resolution deferred to specification phase** — each spec will reconcile these changes against its source discussions.

---

## Summary

### Key Insights

1. The code smell was real — dual purpose (`agntc.json` as boundary marker AND metadata carrier) masked that most of what the file did could be inferred from structure.
2. Stripping away everything inferrable left one irreducible piece: agent compatibility. That's author domain knowledge no structural convention can express.
3. "Always require config" evolved to "every installable thing has config" — the collection exception isn't an exception because collections aren't installable.
4. Explicit agent declaration prevents silent auto-enrollment as new agents are added. Opt-in consent, not opt-in by silence.
5. Removing inheritance/recursive config trades trivial repetition for major clarity — one file = complete picture.

### Before and After

| Aspect | Before | After |
|--------|--------|-------|
| Fields | `type` (optional) + `agents` (optional) | `agents` (required) |
| Purpose | Boundary marker + metadata | Metadata only |
| Convention fallback | Yes (scan for asset dirs) | No (config required) |
| Type declaration | Explicit (`skill`/`plugin`/`collection`) | Inferred from structure |
| Collection config | Root `agntc.json` with `type: "collection"` | No root config needed |
| Agent defaults | Omit = all agents | No default, always explicit |
| Inheritance | Collection agents inherited by children | None, each unit declares own |

### Current State
- Resolved: `agntc.json` reduced to single required field (`agents`)
- Resolved: type inferred from structure, collection inferred from absence of root config
- Resolved: no inheritance, no defaults, no convention fallback
- Catalogued: ripple effects across four concluded discussions

### Next Steps
- [ ] Specification phase to reconcile ripple effects against source discussions
