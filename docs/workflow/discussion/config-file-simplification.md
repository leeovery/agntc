---
topic: config-file-simplification
status: in-progress
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
- [ ] What ripple effects does this have on other concluded discussions?

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

The bare-skill fallback was implicit behaviour: "if no asset dirs found, check for SKILL.md." The author had to know this without being told. Making skill a first-class type eliminates the fallback and maps each type to a distinct installation behaviour:

- **`skill`** — SKILL.md at directory root. Copy the directory as a skill.
- **`plugin`** — asset dirs inside. Scan and route each to its target.
- **`collection`** — container of selectable installables. (But see later question — this was subsequently dropped as a type.)

Each type = one installation path. No inference, no fallback.

### Decision

**Three types considered, settled on two: `skill` and `plugin`.** Collection was dropped as a type (see "Does collection need to be a type?" below).

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

- `type` field: `"skill"` or `"plugin"` only
- Collection detected by: no root config + subdirs with configs
- Collection has no metadata to declare (no agents, no type that affects installation)
- Removes a type value and its associated documentation

Confidence: High.

---
