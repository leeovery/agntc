# Scripts and agents

When stdin or stdout isn't a terminal, or with `--json`, agntc draws nothing and never waits on a question.

## The document

Each command prints one JSON document on stdout:

- `ok`: true exactly when the exit code is 0.
- `command`: the command that ran.
- `scope`: `"project"` or `"global"`, on the commands that take `-g`.
- the command's result: what was installed, updated, listed or removed.
- `warnings` and `notes`: what a terminal run would have said beside its rows.
- `error`, when it failed: a `message`, and the `flags` that answer it when a question stopped it.

## Questions become flags

Where a terminal run would ask, the command stops and its `error` names the flags that answer it:

| Question | Answer with | Without it |
|---|---|---|
| What to install | `--skill`, `--pack`, `--all`, or the path to one skill or pack | `add` stops; the document lists what it found |
| Replace files in the way | `--overwrite` | That item stops; the rest install |
| Confirm a removal | `remove -y` | `remove` stops |
| What to remove | `remove <key>` | `remove` stops |
| Remove what's gone upstream | `update -y` | Kept and reported; exit 0 |
| What to scaffold | `init <type> -y` | `init` stops |

## Exit codes

- `0`: everything asked for was done.
- `1`: something failed or couldn't go ahead. `update` and `add` carry on with the other installs, and the document says which failed.
