AGENT: standards
FINDINGS:
- FINDING: Out-of-constraint section renders each line with its own info marker
  SEVERITY: low
  FILES: src/commands/update.ts:618-623, src/summary.ts:219-231
  DESCRIPTION: The spec mock-up shows the out-of-constraint section as a single block with the info icon only on the header line, with indented detail lines below it. The implementation renders each line (header and details) via separate `p.log.info()` calls, giving each line its own clack info marker. This changes the visual grouping from a single collated block to multiple independent info messages.
  RECOMMENDATION: This is a clack API limitation — there is no multi-line block info API. The current approach is the closest available approximation. Could be improved by rendering the header via `p.log.info()` and detail lines via `p.log.message()` to avoid double info markers on indented lines.
SUMMARY: Implementation conforms to the specification across all major decision points. The single low-severity finding is a minor rendering difference caused by the clack prompts API not supporting multi-line blocks, and does not affect correctness. All constraint syntax parsing, version resolution, manifest storage, add/update/list command behaviors, out-of-constraint detection, change-version constraint stripping, collection constraint propagation, never-downgrade guard, pre-1.0 semantics, and migration compatibility are implemented as specified.
