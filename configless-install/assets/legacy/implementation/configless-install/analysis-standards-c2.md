AGENT: standards
CYCLE: 2
STATUS: findings
FINDINGS_COUNT: 3

FINDINGS:

- FINDING: Skills-only collection member is enumerated then silently skipped as "nested collection" — contradicts the spec's "skills-only child → plugin member" membership rule
  SEVERITY: high
  FILES: src/commands/add.ts:513-537, src/type-detection.ts:92-96, src/type-detection.ts:201-206
  DESCRIPTION: The spec (Collection Membership & Selection Flow → Membership) is explicit: a child dir with asset-kind dirs (skills/agents/hooks) is a "plugin member." qualifiesAsMember honours this for enumeration — a skills-only child satisfies findPresentAssetDirs(childDir).length > 0, so it appears in the pickable list (tests/type-detection.test.ts:160-170, member "beta" = skills dir). But at install time the collection pipeline re-runs the ROOT detectType(pluginDir, { onWarn }) with NO override (add.ts:513). For a skills-only dir that detector applies the root-level skills-only ambiguity and returns { type: "collection" } (type-detection.ts:92-96). add.ts:528 then treats that as a nested collection and SKIPS the member with "nested collections not supported." Net result: a structurally-valid skills-only collection member is offered for selection, then silently dropped at install — it never installs as a plugin member as the spec requires, and a member-level type:plugin config is also never consulted (per-member detectType receives no configType). The unit tests miss this because they mock detectType to return plugin directly for the skills-dir member (add.test.ts:1276-1282, 1305-1311), so the real skills-only→collection→skip path is never exercised.
  RECOMMENDATION: Resolve a skills-only child to a plugin member at the collection level rather than letting the root skills-only ambiguity default it to collection. Per the spec's membership rule, any child with >=1 asset-kind dir is a plugin member, so the per-member detection should bundle skills-only (pass forcePlugin/equivalent member-level resolution, or read the member's config type), keeping the genuine nested-collection skip for children that resolve to member-dirs collections only. Add a collection-install test using a REAL skills-only member dir (not a mocked plugin result) to lock the behaviour.

- FINDING: Type-vs-structure hard-error message hard-codes "declares type plugin" even when the conflict came from the --plugin flag
  SEVERITY: low
  FILES: src/commands/add.ts:230-238
  DESCRIPTION: The single TypeConflictError handler emits `${parsed.manifestKey} declares type plugin but ${err.message}`. detectType raises TypeConflictError for BOTH override inputs — config type:plugin AND the --plugin installer flag. When the user passed --plugin on a bare skill or member-dirs collection (no config type at all), the message wrongly attributes the conflict to a declared config type. Spec (Error & Abort → Hard errors) requires the message to "name the offending source/unit and what conflicted"; mis-attributing the source is a minor accuracy regression. Behaviour (non-zero pre-flight exit) is correct.
  RECOMMENDATION: Distinguish the two override origins in the message (e.g. "the --plugin flag cannot bundle …" vs "declares type plugin but …"), driven by whether options.forcePlugin vs config.type === "plugin" triggered the conflict.

- FINDING: Dead ConfigError class still present, contradicting the lenient config-reading contract (carryover from c1)
  SEVERITY: low
  FILES: src/config.ts:17-22
  DESCRIPTION: The spec mandates fully lenient config reading. readConfig correctly never throws, so the exported ConfigError class is unreachable dead code. Flagged in cycle 1 and discarded there; re-surfaced. Harmless at runtime but invites a future caller to reintroduce a throwing path that would violate leniency.
  RECOMMENDATION: Remove the unused ConfigError class and its export so the type surface reflects that config reading has no error path.

SUMMARY: One high-severity drift — a skills-only collection member is enumerated for selection but silently skipped as a nested collection at install (add.ts re-runs the root detectType, which defaults skills-only→collection), contradicting the spec's "skills-only child → plugin member" rule; unit tests mask it by mocking detectType. Two low-severity notes: the type-conflict message mis-attributes a --plugin-flag conflict to a config "type plugin" declaration, and the dead ConfigError class (c1 carryover) remains. All other load-bearing decisions conform. Note: the c1 no-agents-mislabelled-failed finding has been resolved — CloneReinstallNoAgents now carries its own status:"no-agents".
