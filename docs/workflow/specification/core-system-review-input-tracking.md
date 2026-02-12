---
status: in-progress
created: 2026-02-12
phase: Input Review
topic: Core System
---

# Review Tracking: Core System - Input Review

## Findings

### 1. Local path support missing from `add` command

**Source**: cli-commands-ux.md — "Source argument formats" section
**Category**: New topic (missing feature)
**Affects**: Commands > `add` > Source Argument, Full Flow steps 1-2

**Details**:
The discussion explicitly lists three source formats for `add`: GitHub shorthand, full git URL, and **local path** (`/absolute/path` or `./relative/path`). Described as "for plugin development/testing without pushing to git first."

The spec only lists two formats (shorthand and URL). Steps 1-2 of the add flow also omit local path references. The discussion's step 1 says "Parse source argument (shorthand / URL / local path)" and step 2 says "Clone repo (shallow) or resolve local path."

Additionally, local path support raises unaddressed questions: what's the manifest key for a local install? What are `ref` and `commit`? How does `update` work?

**Proposed Addition**:
[Pending discussion]

**Resolution**: Pending
**Notes**:

---

### 2. List initial view detail level

**Source**: cli-commands-ux.md — "What should list show and how?" section
**Category**: Enhancement to existing topic
**Affects**: Commands > `list` > Initial View

**Details**:
The discussion says the initial view shows: "Plugin key + ref, Agents installed for, Asset counts, Update status" — all inline per plugin. The spec simplifies this to just plugin key + status indicator, deferring agents and asset counts to the detail view.

This appears to be an intentional refinement for a cleaner initial view, but worth confirming since the discussion explicitly included more detail.

**Proposed Addition**:
[Pending discussion — may be intentional, confirm or revert]

**Resolution**: Pending
**Notes**:

---

### 3. List post-action behavior after update

**Source**: cli-commands-ux.md — "What should list show and how?" section
**Category**: Enhancement to existing topic
**Affects**: Commands > `list` > Post-Action Behaviour

**Details**:
The discussion says "After executing an action, loop back to the list with updated state — don't exit." The spec says "After Update / Change version: remain in the detail view with refreshed information and a success indicator showing the new version."

The spec keeps you in the detail view after update (to see the new state), while the discussion returns to the list. The spec's approach arguably gives better feedback. Worth confirming.

**Proposed Addition**:
[Pending discussion — may be intentional, confirm or revert]

**Resolution**: Pending
**Notes**:
