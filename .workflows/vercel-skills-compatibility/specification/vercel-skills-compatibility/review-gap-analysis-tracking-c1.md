# Review Tracking: vercel-skills-compatibility - Gap Analysis

## Findings

### 1. Re-adding a skill installed before the identity change leaves two copies or fails

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Move**: settled
**Priority**: Critical
**Affects**: §4.4 Existing installs move on their next update; §8.4 A re-add adds agents and never drops them; §4.3 One key per skill

**Problem**:
Installs made before this change sit under their old key and folder: the folder basename, or a tree URL's full subpath. Only an update is said to move them to the declared-name folder and key. Running the add line again recomputes the key, finds no installed entry under it, and installs fresh. Users will commonly do that to pick up Vercel parity or to add an agent.

- **Declared name differs from the folder** (4 of 9 skills in `vercel-labs/agent-skills`): the project ends up with two managed copies of one skill side by side, both declaring the same name to the agent. The next update then moves the old entry onto the folder the new one holds and stops it with a non-zero exit, on every run.
- **Same name but a different key** (an old tree-URL install): the old entry counts as another managed install in the way, so an unattended re-run of the identical line fails. Answering "Remove and continue" or passing `--overwrite` drops the old entry's recorded agents, which is exactly what the re-add rule forbids.

**Proposal**:
A re-add treats an install of the same skill from the same repository, made under its old key or folder, as the installed entry. It moves the entry to its declared-name folder and key, as an update would. Agents follow the re-add rule: recorded agents are kept and the named ones are added.

What leaned:
- the spec's position that existing installs carry over to the new identity rather than being installed again beside it;
- the re-add rule that never drops a recorded agent;
- the install-folder rule's aim that the agent never sees two copies side by side.

Alternatives:
- Treat the old entry as a clash with another managed install. This fails a repeated unattended line, and drops recorded agents when overridden.
- Leave both installed. This is dead, because it produces the two side-by-side copies the folder rule exists to prevent.

**Proposed Text**:
New paragraph at the end of §4.4:

"A re-add reaches an existing install the same way. An install of the same skill from the same repository, made under its old key or folder, is the installed entry for that re-add (§8.4). It moves to its declared-name folder and key, as an update would move it, and keeps every recorded agent. A re-add never installs a second copy beside it."

**Resolution**: Pending
**Notes**:

---

### 2. Cancelling at "Proceed with installation?" after agreeing to remove a clashing install

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Move**: settled
**Priority**: Important
**Affects**: §10.1 The prompts an `add` can meet; §11.1 What `add` shows (item 5); §10.4 A prompt that cannot be shown stops the command

**Problem**:
At a terminal the clash prompts come before the final confirmation, since "Proceed with installation?" ends an attended add. Today, choosing "Remove <key> and continue" deletes the other install's files immediately.

If that stays, a user can agree to remove a clashing install and then answer no at the confirmation. They are left with the other install gone, nothing installed in its place, and an exit 0 that reads as a clean cancel. The spec doesn't say when the deletions agreed at a clash prompt actually happen.

**Proposal**:
Nothing the clash prompts agree to remove or overwrite is touched until "Proceed with installation?" is answered yes. Answering no there, or cancelling at any prompt, leaves every existing install and file as it was.

What leaned: the spec treats a deliberate cancel as a clean exit 0, leaves what was in the way intact whenever a clash stops a unit, and writes and removes nothing on a refusal. A cancel that had already deleted another install would be the one exit that loses work.

Alternative that also fits: show the clash prompts after the confirmation. That breaks the stated order, in which the confirmation ends the add.

**Proposed Text**:
In §10.1, after "Only the two clash prompts delete anything when answered yes.":

"What they agree to delete is removed only once "Proceed with installation?" is answered yes. Answering no there, or cancelling at any prompt, leaves every existing install and file as it was."

**Resolution**: Pending
**Notes**:

---

### 3. Whether a repository key still acts on every entry under it

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Move**: settled
**Priority**: Important
**Affects**: §12.1 What the arguments name; §7.1 What a name matches (on `remove` and `update`)

**Problem**:
Today, `remove owner/repo` and `update owner/repo` act on every entry installed from that repository when no entry has exactly that key. Under the new rules an argument may be a key "matched as names are". The name rules describe only exact matches, and the prefix behaviour appears only as a description of today.

Under the new grammar, `-y` on a skills-only repo installs every skill as its own `owner/repo/<folder>` entry, so `remove owner/repo` is the natural way to take the repo back out. Builders can read this two ways:
- Exact matching only: that line becomes a "matches nothing" refusal.
- Today's prefix rule kept: the same line removes every skill from the repo.

Either outcome surprises a user who expected the other.

**Proposal**:
Keep today's key matching:
- an entry with exactly that key is taken alone;
- a key with no exact entry acts on every entry under it.

What leaned: the spec changes what an argument may name (it adds skill names and several arguments) but nowhere withdraws the prefix rule it describes. With per-skill entries now the default for a skills-only repo, the repository key is the one handle on all of them.

Alternative: exact keys only, with the user naming the repo's skills one by one. That costs every multi-skill repo a long remove line.

**Proposed Text**:
In §12.1, after "Each argument is a skill name or an agntc key, matched as §7 sets out.":

"A key matches as it does today. An entry with exactly that key is taken alone, and a key with no exact entry acts on every entry under it. So `remove owner/repo` removes every entry installed from that repository."

**Resolution**: Pending
**Notes**:

---

### 4. `--plugin` with `--all` or `--skill '*'`: refused, or the whole bundle

**Source**: Specification analysis
**Category**: Contradiction
**Move**: settled
**Priority**: Important
**Affects**: §6.6 What `--plugin` refuses; §6.4 "All" never splits a unit; §9.1 The flag set (`--all`)

**Problem**:
`npx agntc add owner/repo --plugin --all` is an agent caller's natural way to say "bundle everything, unattended". The spec supports two incompatible readings of it:
- **Refused:** `--all` is shorthand for `--skill '*' --agent '*' -y`, and `--plugin` with `--skill` is refused.
- **Installs the bundle:** `--skill '*'` and `--all` on a unit install the whole unit, and a `--plugin` bundle is a unit.

A builder picks one reading, and the caller who expected the other gets either a failed run or an unexpected install.

**Proposal**:
`'*'` is not a pick. `--plugin` with `--skill '*'` or `--all` installs the whole bundle, and only a named skill beside `--plugin` is refused.

What leaned: the refusal's stated reason, that a bundle is the whole source, conflicts only with a partial pick. "All never splits a unit" already says "everything" on a unit means the unit whole.

Alternative: refuse every `--skill` beside `--plugin`, `'*'` included. That costs the caller a failed run for a line that has only one coherent meaning.

**Current**:
- **`--plugin` together with `--skill` or `@skill` is refused (§1.5).** A bundle is the whole source. A path in the source is not a pick, and it works with `--plugin` (§6.2).

**Proposed Text**:
- **`--plugin` together with a named skill (`--skill <name>` or `@skill`) is refused (§1.5).** A bundle is the whole source. `--skill '*'` and `--all` name no skill, so with `--plugin` they install the whole bundle (§6.4). A path in the source is not a pick, and it works with `--plugin` (§6.2).

**Resolution**: Pending
**Notes**:

---

### 5. `--all` beside `-a` silently widens an add and over-deletes a remove

**Source**: Specification analysis
**Category**: Enhancement to existing topic
**Move**: settled
**Priority**: Important
**Affects**: §9.1 The flag set (`--all` and the Refused list); §12.3 `remove` flags (`--all`)

**Problem**:
`--all` sets the agents itself, to every agent. So `add owner/repo --all -a cursor` and `remove --all -a cursor` each carry two conflicting agent instructions. The spec says what `--all` does beside names on `remove` (refused), but says nothing about `-a` on either command.

Read as the shorthand it expands to, `-a cursor` has no effect:
- The add installs for Claude and Codex as well as Cursor.
- The remove deletes Claude's and Codex's copies of every install, when the user asked only to take Cursor's away. This one is destructive and silent.

**Proposal**:
`--all` together with `-a`/`--agent` is refused on both commands. The message names the explicit form that removes or installs for only some agents.

What leaned: the spec's rule that where Vercel silently drops part of a line, agntc refuses instead. Also its own refusal of `--all` beside names on `remove`.

Alternative that also fits: let an explicit `-a` narrow `--all`. That gives the user what they asked for, but redefines the shorthand Vercel documents.

**Current**:
§9.1:
**Refused (§1.5):**
- `-g`/`--global`, because global installs are out of scope (§1.3);
- `--subagent` and `--metadata`, which are Vercel-internal;
- any flag agntc does not recognise.

§12.3:
| `--all` | Remove every install. Implies `-y`, and cannot be combined with names. |

**Proposed Text**:
§9.1:
**Refused (§1.5):**
- `-g`/`--global`, because global installs are out of scope (§1.3);
- `--subagent` and `--metadata`, which are Vercel-internal;
- `--all` together with `-a`/`--agent`, because `--all` already sets every agent. The message names the explicit form, `--skill '*' --agent <agents> -y`;
- any flag agntc does not recognise.

§12.3:
| `--all` | Remove every install. Implies `-y`, and cannot be combined with names or with `-a`. The refusal names `-s '*' -a <agents> -y` for removing from some agents only. |

**Resolution**: Pending
**Notes**:

---

### 6. Printed add commands for installs from hosts other than GitHub

**Source**: Specification analysis
**Category**: Enhancement to existing topic
**Move**: settled
**Priority**: Important
**Affects**: §14.1 The rule (printed `add` commands); §14.2 Where agntc prints commands today

**Problem**:
Every printed `add` form is GitHub shorthand: `owner/repo@skill` and `owner/repo/<path>`. The feature now installs from GitLab (nested groups included), Azure Repos, GitHub Enterprise, self-hosted `.git` URLs, SSH addresses and local paths, but `owner/repo` always reads as GitHub.

For such an install, advice printed in the shorthand clones a different GitHub repository, or none. This covers the upgrade line, the newer-tag line and the derive-before-delete remedy. A user who follows it gets the wrong install or a failure, which breaks the rule that following a printed command reproduces the install.

**Proposal**:
A printed `add` names the source in a form that reaches the same repository:
- the `owner/repo` shorthand for GitHub only;
- otherwise the form the install came from, with the skill named by `--skill` where that form takes no `@skill`.

What determined it: the rule's own headline, that following a printed command reproduces the install, leaves only one live option. Printing the shorthand for a non-GitHub install reaches the wrong repository.

**Current**:
- **Printed `add` commands:**
  - carry `--plugin` whenever the entry is a plugin;
  - name a single skill the way a user selects it, by `@skill` (`owner/repo@skill`), never by manifest key (§4.3);
  - name a plugin member by its path in the repo (`owner/repo/<path>`);
  - put versions after `#`, in the `#ref@skill` form where a skill is named (§2.4).

**Proposed Text**:
- **Printed `add` commands:**
  - name the source in a form that reaches the same repository. The `owner/repo` shorthand is used only for GitHub. Any other install prints the form it came from: the `gitlab:` prefix or the GitLab or Azure Repos URL, the GitHub Enterprise URL, the `.git` URL, the SSH address or the local path. Where that form takes no `@skill`, the skill is named with `--skill`;
  - carry `--plugin` whenever the entry is a plugin;
  - name a single skill the way a user selects it, by `@skill` (`owner/repo@skill`), never by manifest key (§4.3);
  - name a plugin member by its path in the repo (`owner/repo/<path>`);
  - put versions after `#`, in the `#ref@skill` form where a skill is named (§2.4).

**Resolution**: Pending
**Notes**:

---

### 7. `"type": "plugin"` on a root SKILL.md beside `skills/` alone: bundle or single skill

**Source**: Specification analysis
**Category**: Contradiction
**Move**: settled
**Priority**: Important
**Affects**: §5.1 Reading a source's shape (rule 2 paragraph); §6.6 What `--plugin` refuses (the excepted shape); §6 Units Under Vercel Selection (unit definition)

**Problem**:
Take a repo with a root `SKILL.md` beside `skills/` alone, whose `agntc.json` declares `"type": "plugin"`. The spec supports two incompatible readings of it:
- **A unit:** any source declaring `"type": "plugin"` counts as a unit, installed whole, and picks from it are refused.
- **A single skill:** the shape rules read the root `SKILL.md` first and honour the declaration only beside `agents/`/`hooks/`. The `--plugin` exception adds that "without the flag that root reads as a single skill".

Under the second reading, a fresh add installs only the root skill and drops the author's declaration. Meanwhile, existing installs of that repo stay recorded as bundles, so fresh adds and existing entries disagree. That is the inconsistency the plugin-to-skill update repair exists to remove.

**Proposal**:
The declaration bundles that shape the way the flag does: the skills under `skills/` install as one unit and the root `SKILL.md` is left out.

What leaned:
- the unit definition counts any declaring source as a unit;
- the shape rules already let the declaration keep a `SKILL.md`-rooted folder whole beside `agents/`/`hooks/`;
- the `--plugin` exception keeps exactly this bundle when the installer asks for it, and the author's declaration is the same request from the side that knows the skills.

Alternative: Vercel's root early-out wins and the declaration is ignored for this shape. That silently drops a statement the unit rules otherwise honour.

**Current**:
§5.1:
A folder that holds `SKILL.md` *and* `skills/` beside `agents/`/`hooks/` is a plugin, and its root `SKILL.md` is ignored. The same holds for a folder holding `SKILL.md` beside `agents/` and/or `hooks/` whose `agntc.json` declares `"type": "plugin"`: the author's declaration keeps it whole.

§6.6:
Without the flag that root reads as a single skill (§5.1).

**Proposed Text**:
§5.1:
A folder that holds `SKILL.md` *and* `skills/` beside `agents/`/`hooks/` is a plugin, and its root `SKILL.md` is ignored. The same holds for a folder holding `SKILL.md` beside `agents/` and/or `hooks/` whose `agntc.json` declares `"type": "plugin"`: the author's declaration keeps it whole. A folder holding `SKILL.md` beside `skills/` alone whose `agntc.json` declares `"type": "plugin"` bundles the skills under `skills/` as one unit and leaves the root `SKILL.md` out, as `--plugin` does on that shape (§6.6).

§6.6:
Without the flag, or an `agntc.json` declaring `"type": "plugin"` (§5.1), that root reads as a single skill.

**Resolution**: Pending
**Notes**:

---

### 8. The occupied-folder check on update covers only two of the ways an update lands somewhere new

**Source**: Specification analysis
**Category**: Enhancement to existing topic
**Move**: settled
**Priority**: Important
**Affects**: §12.6 An occupied target folder

**Problem**:
An update stops on an occupied folder, or replaces it under `--overwrite`. That rule is introduced with two cases: an entry moving to its declared-name folder, and a plugin repaired into a skill. Updates also land in new places in three other cases:
- the author adds a skill to a bundle or plugin (the spec says it joins on the next update);
- a plugin version adds an agent or hook file;
- a skill's declared name changes upstream.

The update path has no clash check today. A builder who adds one only for the two named cases leaves the others writing over the user's own copy, a Vercel install, or another entry's skill. Two manifest entries then own the same files, so removing one deletes the other's.

**Proposal**:
The rule covers every folder or file an update writes that the entry did not own before, and the two named cases are examples.

What leaned: the section's opening sentence already states the general condition. The harm it guards against, overwriting what someone else owns without asking, is the same whatever brought the new folder.

Alternative: check only the two named cases. That is dead, because it leaves the same overwrite unguarded on the other paths.

**Current**:
An update can write into a folder it did not own before. This happens when an entry moves to its declared-name folder (§4.4) or is repaired from plugin to skill (§5.5).

**Proposed Text**:
An update can write into a folder or file it did not own before. This happens when:
- an entry moves to its declared-name folder (§4.4);
- an entry is repaired from plugin to skill (§5.5);
- the source gains a skill, agent or hook the entry takes in (§6.2);
- a skill's declared name changes upstream.

**Resolution**: Pending
**Notes**:

---

### 9. Selecting one plugin member without the menu

**Source**: Specification analysis
**Category**: Gap/Ambiguity
**Move**: settled
**Priority**: Important
**Affects**: §7.1 What a name matches (on `add`); §11.2 `-l` / `--list`; §11.1 What `add` shows (item 2)

**Problem**:
A source can mix loose skills with plugin members, and `--list` shows the plugin members with their contents. The spec presents `--list` as how an agent caller sees a repo before choosing with `--skill` and `-a`. But names on `add` match skills only, and a plugin member is not a skill.

An agent caller that reads `--list` and passes a member's folder name to `--skill` gets one of two outcomes:
- a "matches nothing" refusal that lists skills;
- if the name happens to match one of the member's own skills, that skill installed alone without its agents and hooks. Units exist to prevent exactly that partial install.

Nothing tells the caller that a member is chosen by its path.

**Proposal**:
No name matches a plugin member. It is selected by its path in the source, the form agntc already prints for it. `--list` and the add miss message show each plugin member with that path.

What leaned: names match skills only (the declared name, else the folder name), and printed commands already name a plugin member by its path.

Alternative: let a name match a plugin member's folder name and install the member whole. That needs a precedence rule for a member whose folder shares a name with one of its own skills.

**Proposed Text**:
New bullet in §7.1 under "On `add`":

"  - A plugin member (§5.3) is not a skill, and no name matches it. It is selected by its path in the source (`owner/repo/<path>`), the form agntc prints for it (§14.1). `--list` (§11.2) and the miss message (§7.2) show each plugin member with that path."

**Resolution**: Pending
**Notes**:

---

## Observations

- §12.6 says update handles an occupied folder "the way `add` does (§10.3)", which could be read as including `add`'s terminal clash prompt. Its bullets say update only stops or replaces, never prompts.
- §4.4 doesn't say the update that moves an entry to a new key names the move in its output, though the §5.5 repair does. A script still using the old key then meets a §7.2 refusal.
- §9.2 doesn't say whether the JSON `agents` values use Vercel's identifiers (`claude-code`) or agntc's (`claude`).
- §9.2 requires `-y` for `--json`, and §10.5 says an agent caller behaves "as if `-y` were given". Whether that satisfies the requirement is implied but unstated.
- The key for an install from GitLab nested groups, Azure Repos or a self-hosted host is unstated. An `acme/tools` install from GitHub and one from GitLab would share the key `acme/tools`.
- Keys for units are unstated: plugin members nested in category folders, and path-narrowed bundles. Two plugin members that share a folder basename would share a key.
- With `--plugin`, a path to a folder of a unit's skills (§6.5) could give one narrowed bundle entry (§6.2) or separate picks. Either way it carries the same warning.
- Some skills installed by path would not be reached by discovery from the repo root: those beyond the walk's depth, or a lower-priority duplicate name. They print as `owner/repo@skill`, which reproduces a different skill or none.
- `--list` beside `--skill`/`-a`: unstated whether the names filter the listing or are ignored. Nothing is installed either way.
- `owner/repo@skill#v2.0.0` (reversed order) reads as a skill named `skill#v2.0.0` and is refused with the skill list, rather than pointed at the `#ref@skill` form.
- §5.1 rule 1 announces "one exception", but the rule-2 paragraph holds two cases.
- A plugin with only `agents/`/`hooks/` installed under `--json` yields an empty array, because only skills appear as entries.
