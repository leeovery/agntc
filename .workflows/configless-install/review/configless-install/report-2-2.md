TASK: configless-install-2-2 — `--plugin` installer-override flag surface + forwarding into the single detectType call as forcePlugin; catch Phase 1 TypeConflictError → identity-prefixed non-zero hard error.

ACCEPTANCE CRITERIA: addCommand accepts --plugin (options.plugin true/undefined); runAdd forwards forcePlugin; --plugin on skills-only → plugin via copyPluginAssets; on bare skill → TypeConflictError caught, p.cancel names source + conflict, ExitSignal(1), no write/copy; on member-dirs collection → throws, pipeline not entered; on multi-asset plugin → no-op; error pre-flight.

STATUS: Complete

SPEC CONTEXT: Structural Type Detection (--plugin highest-precedence override resolving only skills-only; hard error on unambiguous non-bundleable); Error & Abort (pre-flight, non-zero, names source). Planning analysis-2-6 refined: flag-triggered conflict attributes to flag, config-triggered to config — implementation's dual-branch message is this refinement.

IMPLEMENTATION: Implemented. src/commands/add.ts.
- addCommand option+forward 766-774 (.option("--plugin",...) + withExitSignal forwarding forcePlugin: options.plugin===true).
- runAdd signature 187-190 (options?: { forcePlugin?: boolean }, default falsy).
- forcePlugin forwarded at single detectType call 267-271, before collection-vs-standalone branch.
- Dedicated try/catch for TypeConflictError 272-290: identity-prefixed p.cancel + throw ExitSignal(1), pre-flight. Flag-attributed (284) vs config-attributed (285) per analysis-2-6.
- No precedence/conflict logic duplicated (centralised type-detection.ts:79-107). runCollectionPipeline untouched by --plugin.

TESTS: Adequate. tests/commands/add.test.ts "--plugin override flag" block 6138-6300: option registration; forwards forcePlugin true; absent→falsy; bundles skills-only via copyPluginAssets; bare skill hard error naming source + '--plugin flag' + structural, no addEntry/write/copy; member-dirs collection hard error + selectCollectionPlugins NOT called; config type:plugin attributes to config not flag; redundant no-op multi-asset; TypeConflictError before nuke/compute/copy/write. Cross-checks: recorded-type 774; direct-path reuse 3848/3878. Behaviour-focused, substring matching (not pinning redundant wording). TypeConflictError is a real throwable in mock so instanceof exercised. Not over-tested.

CODE QUALITY: Conventions followed (narrow option typing, withExitSignal reuse, identity-prefix+ExitSignal(1) mirrors sibling pre-flight handlers). SOLID good (single detectType authority; command only adds CLI surface + prefix + exit). Complexity low. Modern idioms (strict boolean coercion, instanceof narrowing). Readability good (thorough catch comment).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES:
- [idea] src/commands/add.ts:284 — flag-attributed message double-states "cannot bundle" (wraps err.message which itself ends "— cannot bundle"). Smoothing needs a decision on where the trailing phrase lives (detector half vs caller prefix) to avoid regressing the config branch + 1-4 detector tests; cosmetic only.
