# Non-interactive install flags (`--yes`, `--agents`, …)

Allow automating `add` (and where applicable `update`/`remove`) by supplying every
interactive choice as a flag, so it can run unattended (CI, scripts, agent-driven):

- `--agents claude,codex` — pre-answer the agent selection (skip the prompt). Must
  still respect each unit's declared ceiling (intersection), exactly like the
  interactive path.
- `--yes` / `-y` — accept defaults / confirmations where applicable (e.g. conflict
  overwrite prompts, collection select-all?). Define precisely what "yes" answers.
- Consider collection member selection via flag (or rely on the existing tree-path
  selector / select-all) so a collection can install unattended too.

Open questions to design: interaction with auto-select, what `--yes` does at each
prompt, conflict resolution under `--yes`, and error behaviour when a flagged agent
isn't in a unit's ceiling.

**This is real product/feature work — better run through the workflow pipeline
(discussion → spec → plan → impl) than bolted on ad hoc.** Logged here as the seed.

Source: e2e-fixtures testing session (2026-06-09); user request, who noted it's
"probably better handled by the workflows."
