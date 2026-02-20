AGENT: standards
FINDINGS:
- FINDING: update command missing collection prefix matching
  SEVERITY: high
  FILES: /Users/leeovery/Code/agntc/src/commands/update.ts:84
  DESCRIPTION: The spec defines three invocation modes for `update`: no-arg (all), `owner/repo` (specific plugin or all from collection), and `owner/repo/plugin-name` (specific collection plugin). The implementation does a direct manifest lookup (`manifest[key]`) at line 84, which fails with "Plugin {key} is not installed" when `owner/repo` is passed but the manifest only contains collection entries like `owner/repo/plugin-name`. The `remove` command correctly implements this via `resolveTargetKeys` with prefix matching, but `update` lacks equivalent logic.
  RECOMMENDATION: Add prefix-matching logic to `runUpdate` (similar to `resolveTargetKeys` in remove.ts) so that `npx agntc update owner/repo` resolves to all collection plugins under that prefix and updates them sequentially.

- FINDING: Config validation error messages missing spec-required prefix
  SEVERITY: medium
  FILES: /Users/leeovery/Code/agntc/src/config.ts:50, /Users/leeovery/Code/agntc/src/config.ts:56
  DESCRIPTION: The spec explicitly defines these error messages: "Invalid agntc.json: agents field is required" and "Invalid agntc.json: agents must not be empty". The implementation throws ConfigError with messages "agents field is required" and "agents must not be empty" -- missing the "Invalid agntc.json:" prefix. The JSON parse error on line 42 correctly includes the prefix, but the structural validation errors do not.
  RECOMMENDATION: Change line 50 to `throw new ConfigError("Invalid agntc.json: agents field is required")` and line 56 to `throw new ConfigError("Invalid agntc.json: agents must not be empty")`.

- FINDING: computeIncomingFiles produces wrong granularity for plugin collision/unmanaged checks
  SEVERITY: medium
  FILES: /Users/leeovery/Code/agntc/src/compute-incoming-files.ts:50-69
  DESCRIPTION: The spec states unmanaged conflict detection operates at the "asset level" -- each skill directory, each agent file, each hook file is one conflict. The `computePluginFiles` function produces parent target directory paths (e.g., `.claude/skills/`, `.claude/agents/`) rather than individual asset paths within those directories. This means collision and unmanaged checks operate at the wrong granularity -- an entire target directory rather than individual assets. For bare-skill mode this is correct (produces `.claude/skills/{name}/`), but for plugin mode the paths are too coarse. This also affects `checkFileCollisions` since it compares these coarse paths against manifest entries that store fine-grained file paths.
  RECOMMENDATION: `computePluginFiles` should scan the source asset directories and produce individual asset-level paths (e.g., `.claude/skills/planning/`, `.claude/agents/executor.md`) rather than parent directory paths. This requires the source directory as input so it can enumerate the actual assets.

- FINDING: Summary output format diverges from spec for add command
  SEVERITY: low
  FILES: /Users/leeovery/Code/agntc/src/summary.ts:63-71
  DESCRIPTION: The spec defines a multi-line per-agent summary format with indentation (e.g., "Claude:\n    12 skills, 3 agents, 2 hooks\n  Codex:\n    12 skills"). The implementation produces a single-line format ("Installed owner/repo@ref -- claude: 2 skill(s)"). While functionally equivalent in conveying the information, the format diverges from what was specified.
  RECOMMENDATION: Consider aligning the summary format to match the spec's multi-line, per-agent layout with proper indentation and capitalized agent names.

SUMMARY: One high-severity finding: the update command lacks collection prefix matching that the spec requires and the remove command correctly implements. Two medium findings: config error messages missing the spec-required prefix, and incoming file computation at wrong granularity for plugin collision checks. One low finding on summary output formatting.
