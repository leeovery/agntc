---
status: in-progress
created: 2026-02-14
phase: Input Review
topic: Core System
---

# Review Tracking: Core System - Input Review

## Findings

### 1. Local path support missing from `add` command source formats

**Source**: cli-commands-ux.md — "What's the full `add` flow" section, Source argument formats
**Category**: Enhancement to existing topic
**Affects**: Commands > `add` > Source Argument > Supported formats

**Details**:
The cli-commands-ux discussion explicitly includes local paths as a supported source format:
- "Local path: `/absolute/path` or `./relative/path` — for plugin development/testing without pushing to git first"
- The discussion's flow step 2 says "Clone repo (shallow) or resolve local path"

The specification's supported formats table lists GitHub shorthand, HTTPS URL, SSH URL, and Direct path to plugin — but does not include local paths. The spec's add flow step 2 says "Clone repo (shallow)" without mentioning local path resolution.

This appears to have been unintentionally dropped during specification. Local path support is a distinct use case for plugin authors testing their work locally.

**Proposed Addition**:
(pending discussion)

**Resolution**: Pending
**Notes**:
