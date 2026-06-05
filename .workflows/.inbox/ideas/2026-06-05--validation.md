# Validation (skills, content, config) — deferred concerns

A general "validation" bucket collecting everything validation-flavoured surfaced during the `configless-install` discussion, to be discussed together later. Configless install makes these more pressing because the old trust gate — "the repo shipped an `agntc.json`" — is gone, so agntc now clones and copies genuinely arbitrary third-party repos. None of the below is being built in the configless-install feature itself; they're parked here on purpose.

**1. Skill validity ("is this actually a skill?").** agntc currently does *no* `SKILL.md` validation — detection only checks the file exists, and the configless decision deliberately keeps it that way (identity = directory basename, no frontmatter parsing). Vercel's floor is stricter: `parseSkillMd` accepts a skill only if the frontmatter has `name` *and* `description` as strings, else it's not a skill. Worth deciding later whether agntc should adopt any such gate (and what it rejects).

**2. Untrusted frontmatter / content parsing safety.** If agntc ever does start parsing `SKILL.md` frontmatter (for validation or any other reason), it must be YAML-only — Vercel deliberately stripped gray-matter's `---js` engine to avoid eval-based RCE when parsing repos they don't control. We parse none today, so this is latent, but it's the security precondition for any future parsing.

**3. Content / tree limits.** `cloneSource` has no size cap and `copyBareSkill` copies the whole tree unbounded. Define sensible ceilings (total bytes, file count, max depth) with a clear error when exceeded, plus a sensible ignore-list (Vercel skips `node_modules/.git/dist/build/__pycache__`).

**4. Executable / hook safety.** A configless "plugin" with a `hooks/` directory installs hook scripts that run on the agent's next invocation — effectively arbitrary code execution, with less scrutiny than a config-bearing install used to imply. Options to weigh: confirming/surfacing hooks at install, flagging executables, or reviewing content before it lands in `.claude/hooks/`.

**5. Config validation depth.** configless-install chose a *lenient* posture: an absent / empty / malformed `agntc.json` falls back to the default (all `KNOWN_AGENTS`) rather than erroring, and unknown keys are ignored. Revisit later whether config deserves real schema validation (and whether silent fallback on a malformed file is the right long-term call, since it can mask an author's typo).

**6. Agent-level identity collisions.** Because agntc keys on directory basename, two installed skills that *self-declare* the same frontmatter `name` (in different folders) are invisible to agntc — the agent sees a name clash agntc never detected. Out of scope for configless; an integrity concern to consider.

**Already handled in configless-install (context, not for later):** the cheap security-boundary floor — path-traversal validation on source selectors/subpaths (Vercel's `isSubpathSafe`) and symlink-escape rejection during copy — is folded into that feature. The items above are the deeper layer left for this validation discussion.

Relevant files: `src/git-clone.ts` (`cloneSource`), `src/copy-bare-skill.ts` (`copyBareSkill`), `src/type-detection.ts` (detection), `src/config.ts` (config read). Reference floor: Vercel `skills` (`parseSkillMd`, YAML-only frontmatter, `isSubpathSafe`).
