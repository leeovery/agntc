# Task Authoring Analysis: Batched vs Individual

Comparative analysis of task authoring quality during the core-system planning session. The plan contains 5 phases with 47 tasks (45 active, 2 cancelled/merged), reviewed across 4 review cycles.

## Authoring Mode Breakdown

**Individual (1 task per agent invocation):** 14 tasks
- Phase 1: cs-1-1 through cs-1-11 (11 tasks)
- Phase 2: cs-2-1, cs-2-2, cs-2-3 (3 tasks)

**Batched (2+ tasks per agent invocation):** 33 tasks
- Phase 2: cs-2-4 + cs-2-5 (batch of 2)
- Phase 3: cs-3-1 to cs-3-4 (batch of 4), cs-3-5 to cs-3-8 (batch of 4), cs-3-9 to cs-3-11 (batch of 3)
- Phase 4: cs-4-1 to cs-4-10 (batch of 10)
- Phase 5: cs-5-1 to cs-5-10 (batch of 10)

## Review Findings by Authoring Mode

### Hallucinations (invented content not in spec)

| Mode | Tasks | Hallucinations | Rate |
|------|-------|---------------|------|
| Individual | 14 | 3 | 21.4% |
| Batched | 33 | 4 | 12.1% |

**Individual hallucinations:**
- cs-1-4: Type validation tests (non-array, non-string checks not in spec)
- cs-1-4: Throws on all-unknown agents after filter (spec says warn+continue)
- cs-1-8: Copy overwrites existing destination independently (spec's add flow handles conflicts before copy)

**Batched hallucinations:**
- cs-5-1: Per-plugin 5s timeout in parallel check (spec doesn't specify timeout)
- cs-5-6: Tag display truncation at 50+ (spec doesn't specify truncation)
- cs-4-6: Tag list max 10 in update output (spec doesn't specify max)
- cs-4-9: Manifest entry removal and specific error message on post-nuke clone failure (spec doesn't prescribe recovery behavior)

**Pattern:** Both modes hallucinate the same way -- inventing plausible implementation details (timeouts, limits, type checking, error recovery) not grounded in the spec. Batched mode had a lower rate.

### Missing spec content

| Mode | Tasks | Missing | Rate |
|------|-------|---------|------|
| Individual | 14 | 2 | 14.3% |
| Batched | 33 | 4 | 12.1% |

**Individual missing:**
- cs-1-3: Git runtime prerequisite not noted
- cs-1-9: Atomic manifest write not specified (spec says "single atomic write")

**Batched missing:**
- cs-4-1: Empty directories left in place after remove
- cs-4-1: No modification detection on remove (no checksums)
- cs-3-10: Existing plugin migration context
- cs-3-8: Local path error for unreadable/no-config paths

**Pattern:** Both modes miss minor spec details at similar rates. Neither mode systematically missed major requirements.

### Structural/scope issues (from integrity review)

| Mode | Tasks | Issues | Rate |
|------|-------|--------|------|
| Individual | 14 | 2 | 14.3% |
| Batched | 33 | 3 | 9.1% |

**Individual issues:**
- cs-1-1: Do section 12 steps (too verbose for scaffolding)
- cs-1-10: Do section 13 steps (too verbose for integration)

**Batched issues:**
- cs-3-3: Task too small (verification, not TDD cycle) -- merged into cs-3-1
- cs-4-9: Overlaps with cs-1-3 retry logic -- merged into cs-4-4
- cs-4-10/cs-5-10: Overlapping scope across phases -- cs-5-10 clarified as refactoring

**Pattern:** Individual tasks tended to be too verbose (excessive Do steps). Batched tasks tended to create overlap or too-thin tasks. The too-thin/overlap issues are arguably task design problems (from the task designer agent) rather than authoring quality -- the authoring agent was given tasks that shouldn't have existed as separate items.

### Cascading errors (batched-specific risk)

The clone-before-nuke pipeline issue originated in cs-4-4 (Phase 4, batch of 10). The spec says "nuke-and-reinstall" but also says "existing files are left in place" for all-agents-dropped during update. The batched agent implemented nuke-before-clone, which violates the second requirement.

This error cascaded:
- Cycle 2: cs-4-4 corrected (root fix)
- Cycle 3: cs-5-4 aligned (inherited old pattern from Phase 5 batch)
- Cycle 3: cs-4-5 and cs-5-6 also corrected (same class of issue)

**1 root error -> 4 affected tasks across 2 phases.** Individual authoring wouldn't have prevented the root error (it's a spec interpretation issue), but the cascading effect is batching-specific -- later tasks in the same or subsequent batches inherit the interpretation from earlier ones.

### Incomplete coverage

| Mode | Tasks | Incomplete | Rate |
|------|-------|-----------|------|
| Individual | 14 | 0 | 0% |
| Batched | 33 | 1 | 3.0% |

- cs-5-8: Rollback edge case (cross-plugin overwrite) mentioned in context but not in acceptance criteria

### Additional findings (not quality issues)

- cs-3-6: Async migration impact -- callers not enumerated (batched, minor self-containment gap)
- cs-3-7: Direct-path add-command wiring missing (batched, parser created but behavioral change in add flow absent)

## Summary Table

| Metric | Individual (14 tasks) | Batched (33 tasks) |
|--------|----------------------|-------------------|
| Hallucination rate | 21.4% | 12.1% |
| Missing content rate | 14.3% | 12.1% |
| Structural issues | 14.3% | 9.1% |
| Incomplete coverage | 0% | 3.0% |
| Total findings/task | 0.50 | 0.39* |
| Do section verbosity | Too verbose (12-13 steps) | Appropriately concise (3-5 steps) |
| Cross-task coherence | Good | Good |
| Cascading error risk | N/A | Present (1 instance) |

*Excluding cascading findings from a single root cause.

## Key Observations

1. **Batched authoring produced equal or slightly better quality** across all measured metrics. The lower hallucination rate was unexpected.

2. **The batched agent held full phase context**, which may have grounded it better against the spec. Individual agents only saw the task table (names + edge cases) of other tasks, not their full descriptions. The batched agent could see how all tasks in the phase related.

3. **The one real risk with batching is error propagation.** A bad spec interpretation in one task infects others in the same batch or subsequent batches. The review process caught this within 2 cycles.

4. **Individual tasks were more verbose** (12-13 Do steps for scaffolding/integration tasks). Batched tasks were more concise. The integrity reviewer flagged individual tasks for verbosity but never flagged batched tasks for insufficient detail.

5. **Task design issues (too small, overlapping) appeared in batched phases** but are attributable to the task designer agent, not the authoring agent. The authoring agent faithfully fleshed out tasks that shouldn't have existed as separate items.

6. **The review process catches the same classes of issues regardless of authoring mode.** Hallucinations, missing content, and structural issues were all surfaced and fixed. The review is the quality gate, not the authoring mode.

## Recommendation

One agent per phase for task authoring is the sweet spot. The data supports it producing comparable-or-better quality, it's significantly faster, and the mandatory review cycles catch the same classes of issues either way.

## Important Context

- The planning-task-author agent does NOT receive previously authored task descriptions when authoring sequentially. It only receives the task table (names, edge cases, status). This means the "context building" advantage of sequential authoring is limited in the current implementation.
- A single batched agent actually has MORE cross-task context than sequential agents do, because it can see the full descriptions of all tasks it has authored within the same invocation.
- The spec for this project (core-system) is approximately 577 lines -- a moderately complex specification. Results may differ for significantly larger or smaller specs.
- Token usage for the largest batch (10 tasks, Phase 4) was ~44k tokens -- well within context limits with no signs of degradation.
