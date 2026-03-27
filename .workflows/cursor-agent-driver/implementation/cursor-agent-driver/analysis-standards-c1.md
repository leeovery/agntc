AGENT: standards
FINDINGS: none
SUMMARY: Implementation conforms to specification and project conventions. All four spec sections are correctly implemented: CursorDriver with three-tier detection and skills-only TARGET_DIRS; AgentId union and KNOWN_AGENTS updated to include "cursor"; selectAgents filters to declaredAgents with "(not detected in project)" label hints and auto-skip for single-declared-and-detected; collection pipeline filters selectedAgents per-plugin and silently skips zero-match plugins with no manifest entry, no copy, and no summary line.
