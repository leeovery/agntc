---
status: in-progress
created: 2026-02-14
phase: Gap Analysis
topic: Core System
---

# Review Tracking: Core System - Gap Analysis

## Findings

### 1. Conflict Handling vs File Path Collisions — overlapping mechanisms

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Commands > `add` > Conflict Handling, File Path Collisions Across Plugins
**Priority**: Important

**Details**:
Step 7 (File Path Collisions) hard-blocks on ANY overlap between the incoming file list and existing manifest entries. Step 8 (Conflict Handling) includes ownership transfer logic that handles manifest-tracked files ("check if the existing path is tracked in the manifest by another plugin").

If step 7 already catches all manifest overlaps as hard blocks, the ownership transfer in step 8 can never trigger — it's dead code. An implementer would be confused about when ownership transfer is supposed to fire.

The intended distinction appears to be:
- Step 7: pre-check against manifest → hard block (protecting other plugins' integrity)
- Step 8: during-copy check against disk → soft prompt (handling unmanaged files on disk)

If that's the intent, the ownership transfer paragraph in Conflict Handling should be removed or clarified to only apply to unmanaged files.

**Proposed Addition**: (pending discussion)
**Resolution**: Pending
**Notes**:

---

### 2. "Skip" behavior in Conflict Handling is undefined

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Affects**: Commands > `add` > Conflict Handling
**Priority**: Important

**Details**:
The spec offers "Overwrite or skip?" per asset during conflict handling. But it doesn't define what "skip" means for the plugin's integrity:

- Skip that one asset and continue installing the rest? → Partial install, may break interdependent assets.
- Skip the entire plugin? → Then the prompt should say so.

Given that plugins are described as "atomic with interdependent assets" (in File Path Collisions), partial installs seem problematic. But conflict handling only fires for unmanaged files (after step 7 eliminates manifest conflicts), so the user might legitimately want to keep their manual file.

An implementer would need to decide. The spec should clarify.

**Proposed Addition**: (pending discussion)
**Resolution**: Pending
**Notes**:

---

### 3. Local path additions need consistency updates across the spec

**Source**: Specification analysis
**Category**: Enhancement to existing topic
**Affects**: Multiple sections
**Priority**: Important (bundled)

**Details**:
The local path support was added to the Source Argument section and a few targeted areas, but several other sections still assume git-only sources:

a. **`add` command description** (line 265): "Installs plugins from a git repo" — should include local paths
b. **`commit` field type** (Entry Fields table): says `string` but local installs use `null`. Should be `string | null`
c. **Nuke-and-Reinstall section**: step 2 says "Re-clone at the same ref (or HEAD for null ref)" — doesn't account for local path re-copy
d. **Update Check Per Plugin table**: no row for local path installs. Logic needs to identify local installs (ref: null + commit: null) and skip remote checks
e. **Error Handling section**: covers network/git errors but not local path errors (path doesn't exist, not readable, no agntc.json)
f. **Add flow step 11**: "Clean up temp clone dir" — doesn't apply to local paths
g. **Command Argument Validation**: covers unreachable URLs but not invalid local paths

**Proposed Addition**: (pending discussion)
**Resolution**: Pending
**Notes**:
