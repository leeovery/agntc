/** A name YAML reads back as the same string without quotes. */
const PLAIN_NAME = /^[A-Za-z_][\w.-]*$/;

/** Plain words YAML would read as a boolean or null rather than a string. */
const RESERVED_WORD = /^(?:true|false|yes|no|on|off|y|n|null)$/i;

/** The name as a YAML scalar: bare when it reads back as itself, else quoted. */
function yamlName(name: string): string {
	const plain = PLAIN_NAME.test(name) && !RESERVED_WORD.test(name);
	return plain ? name : JSON.stringify(name);
}

export function skillMd(name: string): string {
	return `---
name: ${yamlName(name)}
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
