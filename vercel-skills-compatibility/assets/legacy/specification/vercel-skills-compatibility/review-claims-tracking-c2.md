# Review Tracking: vercel-skills-compatibility - Claims Verification

## Findings

### 1. SSH addresses and `.git` URLs do not work "as today" for paths deeper than owner/repo

**Source**: Tree measurement — `src/source-parser.ts:248–258` (`parseSshUrl`), `src/source-parser.ts:289–299` (`parseHttpsUrl`); Vercel v1.7.0 `src/source-parser.ts:562–567`
**Category**: Enhancement to existing topic
**Move**: settled
**Affects**: §2.1 Source forms (and §2.2's "Self-hosted git servers are reached with a `.git` URL or an SSH address", which relies on it)

**Problem**:
The specification says SSH addresses and `https://….git` URLs keep working as they do today, so nothing in the parser needs to change for them. That is not true. Today agntc keeps only two path segments of either form. For an SSH address it keeps the first two, and for an https URL the last two. So any repository whose path is deeper than `owner/repo` clones the wrong path. That covers a GitLab nested group over SSH (`git@gitlab.com:group/subgroup/repo.git` clones `git@gitlab.com:group/subgroup.git`), a self-hosted server under a group and subgroup by `.git` URL, and an Azure Repos SSH address (`git@ssh.dev.azure.com:v3/org/project/repo`). An `ssh://` URL, the only SSH form that can carry a port, is refused outright with "too many slashes in source "ssh://git"". Vercel clones all of these as given.

These are the routes the specification itself hands self-hosted users once a `.git`-less https URL becomes a refused website source. An implementer who reads "as today" leaves the parser alone. A user who pastes such a line then gets a clone failure, a misleading "too many slashes" error, or an install from the wrong repository. They find out when the add fails or installs content they did not ask for.

**Proposal**:
Keep SSH addresses and `.git` URLs in the source-form list without "as today". State that Vercel clones them as given, whole path kept, and record today's two-segment truncation and the `ssh://` refusal, the way the section already records the https truncation. Local paths keep "as today". The measurement settles this. The section's opening rule that each form is parsed the way Vercel parses it then covers the fix.

**Evidence**:
Claim (§2.1): "SSH addresses, `https://….git` URLs and local paths, as today."

agntc `src/source-parser.ts:248–258` (`parseSshUrl`):
```
const segments = pathPart.split("/").filter((s) => s !== "");
...
const owner = segments[0]!;
const repo = segments[1]!;
const cloneUrl = `git@${host}:${owner}/${repo}.git`;
```
`git@gitlab.com:group/subgroup/repo.git` → segments `["group","subgroup","repo"]` → cloneUrl `git@gitlab.com:group/subgroup.git`.

agntc `src/source-parser.ts:289–299` (`parseHttpsUrl`):
```
const owner = segments[segments.length - 2]!;
const repo = segments[segments.length - 1]!;
const cloneUrl = `https://${host}/${owner}/${repo}.git`;
```
`https://git.example.com/group/sub/repo.git` → cloneUrl `https://git.example.com/sub/repo.git`.

agntc `parseSource` (`src/source-parser.ts:83–96`) sends anything that is not a local path, `https://` or `git@` to `parseGitHubShorthand`. `ssh://git@host:7999/team/repo.git` splits on `@` to pathPart `ssh://git`, whose three `/`-segments throw at `src/source-parser.ts:363–366`: `too many slashes in source "${pathPart}" — expected owner/repo`.

Vercel v1.7.0 `src/source-parser.ts:562–567`: an SSH address or a `.git` URL off github.com/gitlab.com matches no earlier branch. `isWellKnownUrl` (`:575–598`) excludes non-http input and URLs ending `.git`, so the address falls through to:
```
// Fallback: treat as direct git URL
return {
  type: 'git',
  url: input,
  ...(fragmentRef ? { ref: fragmentRef } : {}),
};
```
That clones the address verbatim. No source document makes the "as today" claim. The discussion (Fragment and Subpath Forms; Website Sources) says only that self-hosted servers are reached "with `.git` or an SSH address".

**Current**:
- SSH addresses, `https://….git` URLs and local paths, as today.

**Proposed Text**:
- SSH addresses (`git@host:path` and `ssh://` URLs) and `https://….git` URLs. Vercel clones either as given, its whole path kept (v1.7.0 `src/source-parser.ts:562–567`, the fallback `{ type: 'git', url: input }`). agntc today keeps two path segments of each: the first two of an SSH address (`parseSshUrl` in `src/source-parser.ts`: `const owner = segments[0]!; const repo = segments[1]!;`) and the last two of an https URL (`parseHttpsUrl`). So `git@gitlab.com:group/subgroup/repo.git` clones `git@gitlab.com:group/subgroup.git`. agntc today refuses an `ssh://` URL as "too many slashes" (`grep -n "too many slashes" src/source-parser.ts` → line 365, reached through `parseGitHubShorthand`).
- Local paths, as today.

**Resolution**: Approved
**Notes**:

---

### 2. Without a terminal, `remove` exits silently. It never prints "Cancelled"

**Source**: Tree measurement — `echo -n | node --input-type=module -e "…p.confirm(…).then(r => { if (p.isCancel(r) || r !== true) { p.cancel('Cancelled'); } })"` against agntc's installed `@clack/prompts` 0.11.0; `src/commands/remove.ts:23–31`, `:99–101`, `:130–136`
**Category**: Source defect
**Move**: route
**Affects**: §10.4 A prompt that cannot be shown stops the command

**Problem**:
The specification describes today's no-terminal `remove` as reaching its cancel branch: it "prints 'Cancelled' and exits 0", at the confirmation and at the picker. It describes `add` as reading end-of-input "as a cancel". That is not what happens. agntc's prompt library never resolves a prompt when stdin ends. No cancel value comes back, the "Cancelled" branch never runs, and the process exits 0 silently once nothing is left to do. `add` behaves the same way, which is why it prints no message.

The exit-0-with-nothing-done outcome is real, so the refusal decision stands. But the record gives a wrong model of the mechanism. A refusal hung on the cancel branch, which is Vercel's own pattern (`exitInstallationCancelled` checks `!process.stdin.isTTY` after a cancel), would never fire in agntc. An agent caller's `npx agntc remove` would still exit 0 with nothing removed, and the agent would report a removal that never happened. Tests written to pin today's behaviour would also expect output that never appears.

**Evidence**:
Claim (§10.4): "Today, with no terminal, `add` reads end-of-input at the first prompt as a cancel. … `remove` likewise prints "Cancelled" and exits 0 with nothing removed (`src/commands/remove.ts`, at the confirmation and at the no-argument picker)."

agntc `src/commands/remove.ts:130–136`:
```
const confirmed = await p.confirm({ … });
if (p.isCancel(confirmed) || confirmed !== true) {
	p.cancel("Cancelled");
	throw new ExitSignal(0);
}
```
The picker (`:23–31`, `:99–101`) has the same shape. No spinner or timer is live at either prompt.

Measurement with agntc's own `@clack/prompts` (0.11.0, core 0.5.0), reproducing that branch with stdin at EOF:
```
$ echo -n | node --input-type=module -e "import * as p from '@clack/prompts'; p.confirm({message:'Remove x?'}).then(r => { if (p.isCancel(r) || r !== true) { p.cancel('Cancelled'); process.exitCode = 0; } });" ; echo "exit=$?"
│
◆  Remove x?
│  ● Yes / ○ No
└
exit=0
```
No "Cancelled" is printed: the `.then` never runs. The same holds for `p.multiselect` with `< /dev/null` (output ends at the rendered prompt, `exit=0`). `@clack/core`'s `prompt()` registers only `keypress` and `resize` listeners and no `close`/`end` listener: `grep -c "close" node_modules/@clack/core/dist/index.mjs` → 4, all of them its own `close()` method.

The defect is in the source: `discussion/vercel-skills-compatibility.md` line 741 ("`remove` without a terminal reads end-of-input as a cancel, prints "Cancelled" and exits 0 with nothing removed (`src/commands/remove.ts:134–136`; the no-argument picker at `:99–101`)"), with the add-side "reads end-of-input as cancel" at lines 45 and 732.

**Proposed Text**:

**Resolution**: Routed
**Notes**: Measured correction landed in the discussion in place (Context "Unattended today", No-TTY Behaviour context and trigger, amendment notes); §10.4 re-aligned.

---

## Observations

- §9.1 calls `--subagent` "Vercel-internal", but Vercel v1.7.0's help documents it as "Install to Eve subagents" (`src/cli.ts:145`). Only `--metadata` ("Attach valid JSON to the install telemetry event", `:144`) is internal. The refusal stands either way. The label comes from the discussion (line 584).
- §8.4's illustration "`add … -a cursor` on a Claude install" uses a flag today's `add` lacks (`grep -rn "\.option(" src/` shows only `--plugin`). Today's equivalent is ticking only Cursor at the agent prompt.
- §2.5's "Vercel … always installs the default branch HEAD" holds for a bare add only. Vercel honours a `#ref` fragment and a tree-URL ref (`src/source-parser.ts:284–314`, `:432–452`).
