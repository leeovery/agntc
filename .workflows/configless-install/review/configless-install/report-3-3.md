TASK: configless-install-3-3 — Remove the dead try/catch(ConfigError) wrapper around child readConfig in runCollectionPipeline; drop ConfigError import from add.ts.

ACCEPTANCE CRITERIA: try/catch(ConfigError) removed (plain await readConfig(pluginDir,{onWarn})); no ConfigError reference in add.ts, import drops ConfigError; genuine non-ENOENT IO error still propagates → exit 1; build/type-check + suite green.

STATUS: Complete

SPEC CONTEXT: Config Model (leniency-vs-error boundary — reading lenient, only well-formed recognised type contradicting structure is a hard error in detection, not readConfig); Agent Selection (no hard errors for config problems). readConfig only throws genuine non-ENOENT IO errors (raw re-throw); ConfigError catch is dead. (Reviewed converged state — analysis-2-7 removed ConfigError class entirely.)

IMPLEMENTATION: Implemented (final converged state).
- src/commands/add.ts:515-521 — plain const pluginConfig = await readConfig(pluginDir,{onWarn}) into Map<string,AgntcConfig|null>; no try/catch, no ConfigError.
- Import (9-10): import type { AgntcConfig } + import { readConfig }; ConfigError dropped.
- ConfigError appears in zero .ts files (src + tests).
- IO propagation verified end-to-end: readConfig re-throws non-ENOENT (config.ts:30) → unguarded loop propagates → runAdd try (294) → outer catch (433-438) → p.cancel + ExitSignal(1). Abort-before-write structural (throw in step 3, writeManifest in step 6).

TESTS: Adequate.
- IO-error propagation: tests/commands/add.test.ts:1993-2017 "a child IO error still propagates" — member readConfig rejects EACCES; asserts ExitSignal code 1 + mockAddEntry/mockWriteManifest NOT called (no partial write).
- Configless-default replacement: 2565-2592 (configless member installs) + 1106-1162 (invalid/missing → installs configless, no warning).
- No test imports ConfigError (grep zero). EACCES test pins propagate-not-swallow (exit code + no manifest mutation). Not over-tested.

CODE QUALITY: Conventions followed (import type split for AgntcConfig). SOLID good (loop single responsibility; error policy centralized in outer catch). Complexity lowered (two-statement loop body). Modern idioms. Readability good (step-3 comment documents total readConfig + IO-abort contract).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES: None.
