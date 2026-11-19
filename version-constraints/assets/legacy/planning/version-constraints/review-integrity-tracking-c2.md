---
status: complete
created: 2026-03-24
cycle: 2
phase: Plan Integrity Review
topic: Version Constraints
---

# Review Tracking: Version Constraints - Integrity

## Findings

### 1. vc-2-5 Do section contains deliberative "Actually" correction mid-stream

**Severity**: Important
**Plan Reference**: Phase 2 / vc-2-5
**Category**: Task Self-Containment
**Change Type**: update-task

**Details**:
The Do section of vc-2-5 presents an initial approach (call `resolveConstraintAndRef` in `runCollectionPipeline`), then immediately pivots with "Actually, looking at the code" to explain that the resolution must happen earlier in `runAdd()` before cloning. This is the same deliberative pattern that was fixed in vc-4-4 during cycle 1. An implementer reading the Do steps sequentially encounters a dead-end instruction (step 3: "Update the `parsed.ref` used by `cloneSource` to use the resolved ref (this may require restructuring...)") before being told the actual approach in step 4 ("Actually..."). The Do section should present only the final conclusion.

**Current**:
From vc-2-5 Do section (steps 2-4):

```
- In `runCollectionPipeline()`, call `resolveConstraintAndRef(parsed)` once at the top (after parsing, before plugin selection), getting the resolved `ref` and optional `constraint`
- Update the `parsed.ref` used by `cloneSource` to use the resolved ref (this may require restructuring — currently `cloneSource(parsed)` is called before `runCollectionPipeline`, so the resolution needs to happen before or be passed into the pipeline)
- Actually, looking at the code: `cloneSource(parsed)` happens in `runAdd()` before `runCollectionPipeline` is called. The resolution must happen before cloning. So the shared helper must be called in `runAdd()` before the clone step, and the resolved ref/constraint passed through to both the standalone path and the collection path.
```

**Proposed**:
Replace those three Do steps with a single clear step:

```
- In `runAdd()`, call `resolveConstraintAndRef(parsed)` before `cloneSource(parsed)` -- this is necessary because `cloneSource` happens in `runAdd()` before the collection pipeline is invoked, so the resolved ref must be set on `parsed` before cloning. The resolved constraint is passed through to both the standalone path and the collection pipeline via `CollectionPipelineInput`.
```

**Resolution**: Fixed
**Notes**:

---

### 2. vc-3-3 comment misleads about out-of-constraint info display scope

**Severity**: Minor
**Plan Reference**: Phase 3 / vc-3-3
**Category**: Task Self-Containment
**Change Type**: update-task

**Details**:
In vc-3-3's Do section code snippet, the `constrained-up-to-date` case has the comment `// out-of-constraint info is collected but displayed only in batch mode (vc-3-5)`. However, vc-3-5 explicitly handles both single-plugin and batch update modes. The spec says "Same format regardless of single-plugin or batch update." An implementer of vc-3-3 reading this comment might structure the code to `return null` immediately (as shown) without preserving the `outOfConstraint` data, making vc-3-5's subsequent single-plugin integration harder than necessary.

The comment should indicate that vc-3-5 handles display for both modes, and the `return null` is correct because vc-3-5 will add the out-of-constraint rendering after the `p.outro` call.

**Current**:
From vc-3-3 Do section, the `constrained-up-to-date` code block:

```typescript
  if (result.status === "constrained-up-to-date") {
    p.outro(`${key} is already up to date.`);
    // out-of-constraint info is collected but displayed only in batch mode (vc-3-5)
    return null;
  }
```

**Proposed**:
Replace the comment:

```typescript
  if (result.status === "constrained-up-to-date") {
    p.outro(`${key} is already up to date.`);
    // out-of-constraint info display is added by vc-3-5 (both single-plugin and batch modes)
    return null;
  }
```

**Resolution**: Fixed
**Notes**: The code itself is correct -- the comment is what's misleading. vc-3-5 will add rendering between `p.outro` and `return null`.
