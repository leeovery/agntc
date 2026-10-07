# Specification: Vercel Skills Compatibility

## Specification

### 1. Scope and Governing Rules

#### 1.1 What this feature is

agntc becomes a like-for-like replacement for Vercel's `skills` CLI for adding, updating and removing skills in a project. A line written for Vercel's CLI works when the binary is swapped (`npx skills add owner/repo` → `npx agntc add owner/repo`), with the same source formats and flags, unattended runs, and a pre-install summary. The resulting install behaves the same as Vercel's (§1.6). agntc keeps the capabilities that are its reason to exist (§1.4). The main one is installing several skills as one unit, including `--plugin` bundling of a repo of skills published to be installed one by one through Vercel's CLI.

The reference is Vercel's `skills` CLI v1.7.0 (npm `skills@1.7.0`, commit `7407f389`, 2026-09-17). "Vercel's behaviour" throughout this specification means that version.

#### 1.2 In scope

- Vercel syntax parity for `add`, `update` and `remove`: their source grammar, flags, aliases and positional arguments.
- Installing into the project (project scope only) from git repositories and local paths. Supported hosts are GitHub, GitLab (including nested groups), Azure Repos, GitHub Enterprise and self-hosted git servers (§2). Private repositories work wherever the user's own git credentials work; agntc does not adopt Vercel's credential chain.
- Unattended runs (§10) and the pre-install summary (§11).
- The structural breakage that stops Vercel-directory repos installing correctly today: skills carrying their own `agents/` folder, and skills nested in category folders (§5).
- Whatever agntc must record so `update` and `remove` keep working on what the new syntax installs (§4, §12).
- Printed commands that agntc itself refuses, or that change an install's shape when followed (§14).

#### 1.3 Out of scope

- **Roadmapped, decided later:**
  - global installs (`-g`), roadmap item `global-skill-installs`;
  - website (well-known-endpoint) sources, roadmap item `website-skill-sources`.
- **Not built:**
  - Vercel's other commands (`find`/`search`, `use`, `init`, `experimental_install`, `experimental_sync`);
  - skills.sh packs;
  - Notion sources;
  - direct links to a single `SKILL.md` or an archive;
  - Vercel's canonical `.agents/skills` store with symlink fan-out (§1.6);
  - the skills.sh blob fast path for allowlisted owners. agntc always clones, and the content is the publisher's repo either way.

A line that needs any of these is refused (§1.5), with a message naming the capability agntc doesn't support. It is never silently treated as something agntc does support.

#### 1.4 Syntax follows Vercel; capabilities stay agntc's

agntc's own syntax may change to match Vercel's. Every change must leave these capabilities reachable, because they are what agntc does that Vercel's CLI can't:

- **Units:** skills plus agents and hooks, installed, updated and removed as one; and `--plugin` bundling of a skills-only source.
- **The author's agent ceiling:** an `agntc.json` `agents` list restricts which agents a unit installs for.
- **Semver constraints with constrained update.**
- **Lenient validity:** a skill installs whatever its frontmatter holds, with no frontmatter gate.
- **Copy-safety:** path-traversal and symlink-escape guards run before any copy.

Vercel's behaviour is the default at every point of parity, edge cases included. agntc diverges only in three cases:
- Vercel's behaviour would remove a kept capability.
- It would override a position the owner holds.
- It would silently ignore part of a line (§1.5).

Each divergence in this specification is marked as one and names what it guards. Where this specification says nothing about a Vercel-syntax edge case, Vercel's behaviour is the answer, under the same test.

#### 1.5 Refusals

A **refusal** in this specification is always pre-flight:
- the command exits non-zero;
- it writes nothing (no installed files, no manifest entry) and removes nothing;
- its message names what was refused, and the way through where one exists.

A refusal that exited 0 would read as success to an AI agent caller, which acts on the exit status rather than the text.

**Never silently ignore.** No part of a line (a flag, a source form, a name) is silently dropped. Where Vercel ignores or drops something without saying so, agntc refuses instead: unknown flags (§9) and names that match nothing or only partly match (§7).

#### 1.6 Equivalence means behaving the same

An agntc install is equivalent to Vercel's when the skill behaves the same for the agent. The files do not have to sit where Vercel would put them. agntc keeps a real copy per agent in each agent's own directory:
- Claude: `.claude/skills/`
- Codex: `.agents/skills/`
- Cursor: `.cursor/skills/` (Vercel uses `.agents/skills/`)

Vercel instead keeps one canonical copy in `.agents/skills/` with symlinks from each agent's directory; agntc does not.

---

## Working Notes
