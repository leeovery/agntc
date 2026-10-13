export function skillMd(name: string): string {
	return `---
name: ${name}
description: Brief description of what this skill does and when to use it.
---

# ${name}

## Instructions

[Describe what the agent should do when this skill is invoked]
`;
}

export const PACK_CONFIG = `${JSON.stringify({ type: "pack" }, null, 2)}\n`;

export const AGENT_MD = `---
name: my-agent
description: Brief description of what this agent does and when to use it.
---

[Describe the agent's role and how it should work]
`;

export const HOOK_SH = `#!/usr/bin/env bash
# Installs to .claude/hooks/my-hook.sh. Register it in .claude/settings.json:
#   "hooks": { "PostToolUse": [{ "matcher": "Write|Edit", "hooks": [
#     { "type": "command", "command": "\\"$CLAUDE_PROJECT_DIR\\"/.claude/hooks/my-hook.sh" }
#   ] }] }
# The event arrives as JSON on stdin.

exit 0
`;
