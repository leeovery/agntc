# Review Tracking: Vercel Skills Compatibility - Claims Verification

## Findings

### 1. A pasted `check` is reported as "too many arguments", not as an unknown command

**Source**: Tree measurement — `node /Users/leeovery/Code/agntc/dist/cli.js check` (run from `/tmp`), `src/cli.ts` root `program.action(...)`, `node_modules/commander/lib/command.js:1578–1609`
**Category**: Source defect
**Move**: route
**Affects**: 12.4 `update` flags and aliases

**Problem**:
The specification says that a pasted `npx agntc check` (Vercel's undocumented alias for update) fails as an unknown command and changes nothing. It does exit 1 and change nothing. But the user sees `error: too many arguments. Expected 0 arguments but got 1.` followed by the full help. Nothing tells them that `check` is not an agntc command or that `update` is the command they want.

This happens because agntc's root command has its own action (bare `agntc` prints help). With a root action, commander treats any word it doesn't recognise as an extra argument to the root command. It never reports it as an unknown command. An implementer who trusts the claim will leave `check` unhandled and ship that confusing message. The source discussion makes the same assertion, so the fix belongs there.

**Evidence**:
Claim (spec, `update` flags and aliases): "**`check` is not registered.** … A pasted `check` fails as an unknown command and changes nothing."

Measurement:
```
$ cd /tmp && node /Users/leeovery/Code/agntc/dist/cli.js check
exit=1
error: too many arguments. Expected 0 arguments but got 1.

Usage: agntc [options] [command]
```
`src/cli.ts`: `program.action(() => { program.outputHelp(); });` gives the root command an action handler. `node_modules/commander/lib/command.js` (commander 13.1.0):
- line 28: `this._allowExcessArguments = false;`
- lines 1578–1580: `if (this._actionHandler) { checkForUnknownOptions(); this._processArguments(); …`. This branch runs before the `else if (this.commands.length) { this.unknownCommand(); }` branch at line 1609, so the unknown-command path is never reached while the root has an action.

The source carries the same claim. In `.workflows/vercel-skills-compatibility/discussion/vercel-skills-compatibility.md`, line 274: "**`check` is not adopted.** … A pasted `check` fails as an unknown command rather than changing anything."

**Proposed Text**:

**Resolution**: Routed
**Notes**: Measured correction repaired in place in the discussion (amendment notes); every citing decision survives. Specification re-aligned.

---

### 2. `--subagent` and `--metadata` are documented Vercel flags, not Vercel-internal ones

**Source**: Tree measurement — Vercel `skills` v1.7.0 (commit `7407f3893ad4dceab546ac002c3ef806e4000c73`) `src/cli.ts:137–148`, `src/add.ts:2469–2496`
**Category**: Source defect
**Move**: route
**Affects**: 9.1 The flag set (the "Refused" list)

**Problem**:
The specification refuses `--subagent` and `--metadata` because they are "Vercel-internal". That implies no line a user copies from Vercel would carry them. In fact Vercel v1.7.0 lists both in `skills --help` under Add Options as ordinary user flags:
- `--metadata <json>` attaches JSON to the install telemetry event.
- `--subagent <names>` installs into Eve subagents.

So a user can paste a documented Vercel line that carries either flag and have it refused. If the stated reason stays "internal", the refusal message would call a documented flag internal. It would not name what agntc doesn't do here: install into Eve subagents, or send install telemetry. The specification's refusal rule requires a refusal message to name exactly that. The ground for the refusal belongs to the source discussion's flag decision.

**Evidence**:
Claim (spec, the flag set, Refused): "`--subagent` and `--metadata`, which are Vercel-internal".

Measurement, from `curl -s https://raw.githubusercontent.com/vercel-labs/skills/7407f3893ad4dceab546ac002c3ef806e4000c73/src/cli.ts` (the `showHelp()` text):
```
137: ${BOLD}Add Options:${RESET}
...
144:   --metadata <json>      Attach valid JSON to the install telemetry event
145:   --subagent <names>     Install to Eve subagents (use 'root' for the root agent)
```
`src/add.ts:2469–2496` parses both as normal add options. `--metadata` is validated as JSON, and an error is pushed if it is invalid. `--subagent` takes a variadic list of names.

The source carries the same claim. In `.workflows/vercel-skills-compatibility/discussion/vercel-skills-compatibility.md`, line 603: "**Refused:** `-g` (roadmapped), `--subagent` and `--metadata` (Vercel-internal), and any flag agntc does not recognise."

**Proposed Text**:

**Resolution**: Routed
**Notes**: Measured correction repaired in place in the discussion (amendment notes); every citing decision survives. Specification re-aligned.

---

### 3. Vercel honours refs, so "always installs the default branch HEAD" is false

**Source**: Tree measurement — Vercel `skills` v1.7.0 (commit `7407f3893ad4dceab546ac002c3ef806e4000c73`) `src/source-parser.ts:284–314`, `:432–451`, `src/add.ts:1401`, `:1413`, `src/git.ts:295–301`
**Category**: Source defect
**Move**: route
**Affects**: 2.5 Version a bare add installs (bears on 2.4 `#` carries versions and refs)

**Problem**:
The specification justifies its bare-add divergence by saying that Vercel "has no version concept and always installs the default branch HEAD". Only the bare-add half is true. Vercel v1.7.0 reads a `#ref` fragment (including `#ref@skill`) and a tree URL's ref, and clones exactly that ref. So the `#` grammar the specification adopts is Vercel's own, not an agntc invention.

Under the rule that Vercel's behaviour answers any Vercel-syntax edge case the specification leaves open, Vercel's handling also decides the `#` cases the specification does not cover:
- A tree URL that also carries a `#` fragment: Vercel lets the tree URL's ref win.
- A percent-encoded fragment such as `#feature%2Fx`: Vercel decodes it.
- A `#` on a URL that is not a git source: Vercel keeps it as part of the URL.

An implementer told that Vercel has no ref handling has nothing to defer to in these cases. A pasted Vercel line could then install a different version from the one Vercel installs, and the user would notice only when the installed version differs from what the line names. The source discussion makes the same claim, so the correction belongs there first.

**Evidence**:
Claim (spec, version a bare add installs): "Vercel has no version concept and always installs the default branch HEAD."

Measurement, from `curl -s https://raw.githubusercontent.com/vercel-labs/skills/7407f3893ad4dceab546ac002c3ef806e4000c73/src/source-parser.ts`:
- `:284–314` `parseFragmentRef`. It splits `#ref` and `#ref@skill`, decodes each part with `decodeURIComponent`, and returns the input unchanged when `!looksLikeGitSource(inputWithoutFragment)`.
- `:432–441`: `ref: ref || fragmentRef`, `subpath: …` for a GitHub tree URL with a path. `:443–451` does the same for a tree URL with a branch only, so the tree ref takes precedence over a fragment.

From `src/add.ts`:
- `:1401`, `:1413`: `tempDir = await cloneRepo(parsed.url, parsed.ref);`

From `src/git.ts`:
- `:295` `export async function cloneRepo(url: string, ref?: string)`
- `:301`: `const cloneOptions = ref ? ['--depth', '1', '--branch', ref] : ['--depth', '1'];`

The source carries the same claim. In `.workflows/vercel-skills-compatibility/discussion/vercel-skills-compatibility.md`, line 55 ("Vercel always installs default-branch HEAD") and line 675 ("Vercel has no version concept and always installs the default branch HEAD").

**Proposed Text**:

**Resolution**: Routed
**Notes**: Measured correction repaired in place in the discussion (amendment notes); every citing decision survives. Specification re-aligned.

---

## Observations

- In 2.2, the reason given for checking direct-download links first ("every such GitHub link also matches the GitHub repo pattern") does not hold for raw.githubusercontent.com or objects.githubusercontent.com: Vercel's `github\.com\/([^/]+)\/([^/]+)` at `source-parser.ts:455` does not match `githubusercontent.com/`. The required order is unaffected.
- In 10.4, "Today, with no terminal, add exits 0 with nothing installed" is too broad. A source whose author declares exactly one agent, and that agent is detected, meets no prompt today (`src/agent-select.ts:39–46`) and installs.
- 13 cites "`checkUnmanagedConflicts` in `src/commands/add.ts`". The function is defined in `src/unmanaged-check.ts:15` and called from `src/commands/add.ts:218`.
- 10.3 says Vercel lists "the existing folders" as `overwrites:`. Vercel actually lists, for each skill, the agents whose target already exists (`add.ts:1871–1878`).
- In 5.3, "61 of 258 skill folders" across "ten skills.sh leaderboard repos" names no repos, so the specification as written gives no way to reproduce it. It is motivation only.
