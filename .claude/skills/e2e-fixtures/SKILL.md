---
name: e2e-fixtures
description: Provision real GitHub repos covering every agntc install permutation (configless and config-bearing), walk the user through end-to-end testing of the local CLI build, then tear everything down. Use before a release to smoke-test add/update/list/remove against real repos.
allowed-tools: Bash, Read
---

# agntc end-to-end fixtures

A throwaway test harness. It creates ~22 **private** GitHub repos (`<owner>/agntc-fix-*`) spanning every shape agntc must handle — bare skills, plugins, skills-only, collections, error/leniency cases, copy-safety, version pinning, and update-lifecycle — then guides interactive testing of the **locally-built** CLI in a blank sandbox, and finally deletes everything.

Testing is a **hybrid**: this skill auto-runs the non-interactive paths (repo provisioning, mutations, and the pre-prompt error cases) and **hands you** the interactive ones (agent/member multiselects, conflict prompts, `list`), because `@clack/prompts` needs a real TTY. Drive interactive steps in your own terminal; report back; the orchestrator interprets.

## Files

- `scripts/lib.sh` — shared config (owner, `agntc-fix` prefix, sandbox path, CLI path) + the fixture list.
- `scripts/setup.sh` — build the CLI, create+push all fixtures, create the sandbox. Idempotent (skips existing repos).
- `scripts/mutate.sh <fixture>` — push the second commit for a lifecycle fixture (run between install and update).
- `scripts/reset-sandbox.sh` — wipe the sandbox blank between tests.
- `scripts/teardown.sh [-y]` — delete all `agntc-fix-*` repos + the sandbox.
- `references/fixture-matrix.md` — the full shape → expected-outcome table.
- `references/test-plan.md` — the step-by-step interactive walkthrough.

## Prerequisites

- Run from inside the agntc repo (scripts locate it via git).
- `gh` authenticated (`gh auth status`). For teardown to delete repos the token needs the **`delete_repo`** scope — if missing, setup warns; add it by editing the PAT at <https://github.com/settings/tokens> (tick `delete_repo`) or `unset GH_TOKEN && gh auth refresh -h github.com -s delete_repo`.
- `node` + `npm` (setup runs `npm run build`).

## Orchestration (how the assistant drives this)

### 1. Preflight & confirm
Resolve the owner: `gh api user --jq .login`. Tell the user how many repos will be created and that they're **private** under their account. **This is an outward-facing action — get explicit confirmation before running setup.** Check `gh auth status` for `delete_repo`; if absent, surface the fix and ask whether to proceed anyway (repos would need manual deletion later).

### 2. Set up
Run `bash .claude/skills/e2e-fixtures/scripts/setup.sh`. This builds the CLI and provisions all fixtures + the sandbox. Report the sandbox path.

### 3. Walk the test plan
Load `references/test-plan.md` and go group by group. For each case:
- **📍 (non-interactive — exits before any prompt):** the assistant runs it via Bash and asserts the outcome (e.g. non-zero exit + the expected message). Reset the sandbox first with `scripts/reset-sandbox.sh`.
- **⌨️ (interactive — needs a TTY):** the assistant prints the exact command (with `<owner>` substituted) for the user to run in their terminal from the sandbox, states the expected behaviour and what to verify, then waits for the user to report. Interpret the result together.
- For lifecycle tests (Group 7), the assistant runs `scripts/mutate.sh <fixture>` between the user's install and update steps.
- Reset the sandbox between installs unless a test explicitly builds on prior state (e.g. the `list` dashboard in Group 8).

**Hard rule:** never invoke interactive `add`/`update`/`list` flows through the Bash tool — they require a TTY and will hang or misbehave. Only run setup, teardown, mutate, reset, and the 📍 pre-prompt error cases.

### 4. Tear down
When testing is finished (or on request), confirm with the user, then run `bash .claude/skills/e2e-fixtures/scripts/teardown.sh -y`. It sweeps GitHub for every `agntc-fix-*` repo (catching partial runs), deletes them, and removes the sandbox. Without the `delete_repo` scope it stops and prints the fix.

## Notes

- The CLI under test is the **local build** (`dist/cli.js`), never the published `npx agntc`. Re-run `scripts/setup.sh` (or just `npm run build`) after code changes to retest.
- Fixtures are content-only throwaways; the `agntc-fix-` prefix is the safety boundary teardown keys on.
- Override the owner with `AGNTC_FIX_OWNER` and the sandbox location with `AGNTC_TEST_SANDBOX` if needed.
