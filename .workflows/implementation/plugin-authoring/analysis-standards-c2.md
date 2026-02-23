AGENT: standards
FINDINGS:
- FINDING: init command allows excess arguments despite spec requiring none
  SEVERITY: medium
  FILES: /Users/leeovery/Code/agntc/src/commands/init.ts:70
  DESCRIPTION: The command definition uses `.allowExcessArguments(true)` which silently accepts extra positional arguments (e.g., `npx agntc init foo bar` would succeed without error). The specification states "No arguments. No flags." and Phase 1 acceptance requires "npx agntc init is a registered command accepting no arguments and no flags." Commander's default behavior (`allowExcessArguments(false)`) already enforces this -- the explicit `true` overrides that protection and contradicts the spec. No other command in the project uses `allowExcessArguments(true)`.
  RECOMMENDATION: Remove `.allowExcessArguments(true)` from the command definition. Commander's default behavior will reject excess arguments, which is the correct behavior per the specification.

SUMMARY: Implementation conforms to the specification across all major requirements (prompt flow, file scaffolding, skip-if-exists, reconfigure semantics, preview format, success messages, template content). One medium-severity finding: the init command explicitly allows excess arguments via `.allowExcessArguments(true)` despite the spec requiring no arguments.
