# Review Tracking: vercel-skills-compatibility - Claims Verification

## Findings

### 1. Vercel does not clone every `ssh://` URL as given

**Source**: Tree measurement — Vercel `skills` v1.7.0 (`7407f389`) `src/source-parser.ts:455`, `:500`, `:562–567`, read via `curl -s https://raw.githubusercontent.com/vercel-labs/skills/7407f3893ad4dceab546ac002c3ef806e4000c73/src/source-parser.ts`
**Category**: Enhancement to existing topic
**Move**: settled
**Affects**: §2.1 Source forms (the SSH / `.git` URL bullet)

**Problem**:
The specification says each source form is parsed the way Vercel parses it, and that Vercel clones every SSH address and `ssh://` URL as given. That is not what Vercel does. Vercel v1.7.0 turns an `ssh://` URL on github.com or gitlab.com into an https clone URL: `ssh://git@github.com/org/private.git` is cloned from `https://github.com/org/private.git`. An implementer who checks Vercel's code, as the parity-by-default rule tells them to, would build the same rewrite. A user who reaches a private repo only through an SSH key would then get an authentication failure on a line naming their SSH URL. Vercel gets past this with its gh-CLI SSH fallback (`src/git.ts:247–248`), which agntc does not adopt. An implementer who follows the specification's text clones over SSH, but that is a divergence from Vercel the specification never marks.

**Proposal**:
Correct the description of Vercel, and mark cloning an `ssh://` GitHub or GitLab URL as given as a divergence that protects the user's own git credentials (§1.2). This keeps the behaviour the specification already describes. The other option, following Vercel's https rewrite, has no case for it. The specification promises that private repositories work wherever the user's own credentials work, and it rejects Vercel's credential chain, which is the only thing that keeps the rewrite working in Vercel. Printed commands already reproduce "the SSH address" an install came from (§14.1).

**Evidence**:
Claim (§2.1): "SSH addresses (`git@host:path` and `ssh://` URLs) and `https://….git` URLs. Vercel clones either as given, with its whole path kept (v1.7.0 `src/source-parser.ts:562–567`, the fallback `{ type: 'git', url: input }`)."

Vercel v1.7.0 `src/source-parser.ts`, which runs these checks before the fallback:
- `455   const githubRepoMatch = input.match(/github\.com\/([^/]+)\/([^/]+)/);` → `461   url: \`https://github.com/${owner}/${cleanRepo}.git\``
- `500   const gitlabRepoMatch = input.match(/gitlab\.com\/(.+?)(?:\.git)?\/?$/);` → `507   url: \`https://gitlab.com/${repoPath}.git\``
- `562   // Fallback: treat as direct git URL` / `564 type: 'git', url: input` is reached only when none of the above match.

The same regexes run in order with `node -e`:
```
ssh://git@github.com/owner/repo.git => github -> https://github.com/owner/repo.git
ssh://git@gitlab.com/group/sub/repo.git => gitlab -> https://gitlab.com/group/sub/repo.git
ssh://git@example.com/group/sub/repo.git => falls through (azure/shorthand/well-known/fallback)
git@gitlab.com:group/subgroup/repo.git => falls through (azure/shorthand/well-known/fallback)
https://git.example.com/group/sub/repo.git => falls through (azure/shorthand/well-known/fallback)
```
Vercel's SSH rescue: `src/git.ts:247–248` `if (/Git operations protocol:\s+ssh/i.test(statusOutput)) { cloneTarget = repo.sshUrl; }`.
The discussion makes no claim about how Vercel clones `ssh://` URLs (`grep -n "ssh://\|as given" discussion/vercel-skills-compatibility.md` → no hits about SSH cloning). The claim appears only in the specification.

**Current**:
- SSH addresses (`git@host:path` and `ssh://` URLs) and `https://….git` URLs. Vercel clones either as given, with its whole path kept (v1.7.0 `src/source-parser.ts:562–567`, the fallback `{ type: 'git', url: input }`).

**Proposed Text**:
- SSH addresses (`git@host:path` and `ssh://` URLs) and `https://….git` URLs, cloned as given with the whole path kept. Vercel clones a `git@host:path` address, an `https://….git` URL and an `ssh://` URL on any other host this way (v1.7.0 `src/source-parser.ts:562–567`, the fallback `{ type: 'git', url: input }`). An `ssh://` URL on github.com or gitlab.com first matches Vercel's GitHub pattern (`:455`) or gitlab.com pattern (`:500`), and Vercel clones it over https instead (`ssh://git@github.com/owner/repo.git` → `https://github.com/owner/repo.git`). **This diverges from Vercel, to keep private repositories working with the user's own git credentials (§1.2):** agntc clones the `ssh://` URL as given.

(The rest of the bullet, from "agntc today keeps only two path segments of each" onward, is unchanged.)

**Resolution**: Pending
**Notes**:

---

### 2. Vercel finds a skill whose folder is named `build`, `dist`, `node_modules` or `__pycache__`

**Source**: Tree measurement — Vercel `skills` v1.7.0 (`7407f389`) `src/skills.ts:284–299` (`walkSkillDirs`) and `:135–153` (`findSkillDirs`)
**Category**: Source defect
**Move**: route
**Affects**: §5.2 Discovery walk ("Every walk follows these rules")

**Problem**:
The specification says every discovery walk never enters `node_modules`, `.git`, `dist`, `build` or `__pycache__`. Vercel's walks over the search roots do look inside such a folder for a `SKILL.md` before deciding not to go deeper. So a skill whose own folder has one of those names, such as `skills/build/SKILL.md` or a root-level `dist/SKILL.md`, is a skill to Vercel. Only the fallback full-depth walk skips those folders outright. Built as written, agntc would not see that skill. It would be missing from the menu and from "all", and a pasted `npx agntc add owner/repo --skill build` would be refused as matching nothing, though Vercel installs it from the same line. A repo whose only skill sits in such a folder would be refused as having nothing installable.

**Evidence**:
Claim (§5.2): "It never enters `node_modules`, `.git`, `dist`, `build` or `__pycache__`."

Vercel v1.7.0 `src/skills.ts`:
```
288       for (const entry of entries) {
289         if (!entry.isDirectory()) continue;
291         const childDir = join(dir, entry.name);
292         const foundAtChild = await tryAddSkillAt(childDir);
296         if (foundAtChild || depth >= maxDepth || SKIP_DIRS.includes(entry.name)) continue;
298         await walkSkillDirs(childDir, maxDepth, depth + 1);
```
`tryAddSkillAt(childDir)` (`:273–282`) adds the skill when `childDir/SKILL.md` exists, and it runs before the `SKIP_DIRS` test, which only stops descent below that folder. The fallback walk filters first: `149 .filter((entry) => entry.isDirectory() && !SKIP_DIRS.includes(entry.name))`.

The source carries the same assertion. The discussion's discovery-walk passage, `discussion/vercel-skills-compatibility.md:399`, reads: "never below a found skill, skipping `node_modules`/`.git`/`dist`/`build`/`__pycache__`, symlinked directories not followed".

**Current**:

**Proposed Text**:

**Resolution**: Pending
**Notes**:

---

## Observations

- §2.2 explains why direct-download links are checked first: "every such GitHub link also matches the GitHub repo pattern". That holds for codeload.github.com and the github.com `/archive/`, `/raw/` and `/releases/` paths, but not for raw.githubusercontent.com or objects.githubusercontent.com. Neither matches `github\.com\/`, and Vercel's well-known check excludes raw.githubusercontent.com by host. The ordering rule itself is right either way.
- §13 places `checkUnmanagedConflicts` "in `src/commands/add.ts`". It is defined in `src/unmanaged-check.ts:15` and called from `src/commands/add.ts:218`. What the specification says it does (it checks only the incoming files) is correct.
