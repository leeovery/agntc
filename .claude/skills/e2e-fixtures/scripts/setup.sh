#!/usr/bin/env bash
# Provision all agntc e2e fixture repos on GitHub, build the CLI under test,
# and create a blank sandbox project. Idempotent: existing fixtures are skipped.
#
# Usage: scripts/setup.sh
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# ---------------------------------------------------------------------------
# Content emitters
# ---------------------------------------------------------------------------

# skill_md <path> <name>  — write a minimal but realistic SKILL.md
skill_md() {
	mkdir -p "$(dirname "$1")"
	cat >"$1" <<EOF
---
name: $2
description: Fake skill "$2" for agntc end-to-end fixture testing.
---

# $2

This is throwaway fixture content used to exercise agntc's install pipeline.
EOF
}

# agntc_json <path> <json>  — write an agntc.json verbatim
agntc_json() { mkdir -p "$(dirname "$1")"; printf '%s\n' "$2" >"$1"; }

# ---------------------------------------------------------------------------
# Fixture tree builders — each populates the passed-in empty dir
# ---------------------------------------------------------------------------

fx_bare-skill()        { skill_md "$1/SKILL.md" refero-design; mkdir -p "$1/references"; echo "cheatsheet" >"$1/references/cheatsheet.md"; }
fx_bare-skill-claude() { skill_md "$1/SKILL.md" claude-only-skill; agntc_json "$1/agntc.json" '{ "agents": ["claude"] }'; }

fx_plugin() {
	skill_md "$1/skills/planning/SKILL.md" planning
	skill_md "$1/skills/review/SKILL.md" review
	mkdir -p "$1/agents" "$1/hooks"
	echo "# executor agent" >"$1/agents/executor.md"
	printf '#!/bin/sh\necho pre-commit\n' >"$1/hooks/pre-commit.sh"
}
fx_plugin-claude() { fx_plugin "$1"; agntc_json "$1/agntc.json" '{ "agents": ["claude"] }'; }
fx_plugin-assets-only() {
	mkdir -p "$1/agents" "$1/hooks"
	echo "# executor agent" >"$1/agents/executor.md"
	printf '#!/bin/sh\necho hook\n' >"$1/hooks/post-merge.sh"
}

fx_skills-only() {
	skill_md "$1/skills/alpha/SKILL.md" alpha
	skill_md "$1/skills/beta/SKILL.md" beta
	echo "ref" >"$1/skills/alpha/notes.md"
}
fx_skills-only-typeplugin() { fx_skills-only "$1"; agntc_json "$1/agntc.json" '{ "type": "plugin" }'; }

fx_collection() {
	skill_md "$1/alpha/SKILL.md" alpha
	skill_md "$1/beta/SKILL.md" beta
	skill_md "$1/tool/skills/inner/SKILL.md" inner      # tool = plugin member
	mkdir -p "$1/tool/agents"; echo "# agent" >"$1/tool/agents/a.md"
	echo "# collection" >"$1/README.md"
}
fx_collection-mixed() {
	skill_md "$1/alpha/SKILL.md" alpha
	agntc_json "$1/alpha/agntc.json" '{ "agents": ["claude"] }'   # config-bearing member
	skill_md "$1/beta/SKILL.md" beta                              # configless member
	skill_md "$1/tool/skills/inner/SKILL.md" inner               # plugin member, configless
	mkdir -p "$1/tool/agents"; echo "# agent" >"$1/tool/agents/a.md"
}
fx_collection-stray-root() {
	skill_md "$1/alpha/SKILL.md" alpha
	skill_md "$1/beta/SKILL.md" beta
	agntc_json "$1/agntc.json" '{ "agents": ["claude"] }'   # stray ROOT config, no type → ignored
}
fx_collection-nested() {
	skill_md "$1/alpha/SKILL.md" alpha
	# sub/ is itself a collection (members one level down) → skipped with a warning
	skill_md "$1/sub/x/SKILL.md" x
	skill_md "$1/sub/y/SKILL.md" y
}

fx_err-typeplugin-bareskill() { skill_md "$1/SKILL.md" should-error; agntc_json "$1/agntc.json" '{ "type": "plugin" }'; }
fx_err-typeplugin-collection() {
	skill_md "$1/alpha/SKILL.md" alpha
	skill_md "$1/beta/SKILL.md" beta
	agntc_json "$1/agntc.json" '{ "type": "plugin" }'   # type:plugin on member-dirs collection → hard error
}
fx_not-agntc() { echo "# just a readme, nothing installable" >"$1/README.md"; echo "data" >"$1/data.txt"; }

fx_config-malformed()    { skill_md "$1/SKILL.md" malformed-cfg; printf '{ "agents": ["claude",  }\n' >"$1/agntc.json"; }   # invalid JSON
fx_config-empty-agents() { skill_md "$1/SKILL.md" empty-agents;  agntc_json "$1/agntc.json" '{ "agents": [] }'; }

fx_symlink-escape() {
	skill_md "$1/SKILL.md" symlink-escape
	ln -s /etc/passwd "$1/escape-link"   # absolute target escapes the clone root → blocked pre-copy
}

# Lifecycle fixtures (UNTAGGED → HEAD-tracked, so update re-clones the new shape)
fx_lifecycle-plugin() {            # benign addition + type replay on update
	skill_md "$1/skills/core/SKILL.md" core
	mkdir -p "$1/agents"; echo "# agent" >"$1/agents/exec.md"
}
fx_lifecycle-break() { skill_md "$1/SKILL.md" will-break; }   # bare skill → mutated to collection → derive-before-delete abort
fx_lifecycle-skills-only-member() {                          # sourceSubpath relocation on member update
	skill_md "$1/skills/alpha/SKILL.md" alpha
	skill_md "$1/skills/beta/SKILL.md" beta
}

# ---------------------------------------------------------------------------
# Publishing
# ---------------------------------------------------------------------------

# git_commit_all <dir> <message>
git_commit_all() {
	git -C "$1" add -A
	git -C "$1" -c user.email=fixtures@agntc.test -c user.name=agntc-fixtures commit -qm "$2"
}

# publish <suffix> <dir>  — create the private repo and push main (+ any tags)
publish() {
	local suffix="$1" dir="$2" full; full="$(repo_full "$suffix")"
	gh repo create "$full" "$VISIBILITY" --source="$dir" --remote=origin --push \
		-d "agntc e2e test fixture ($suffix) — auto-created, safe to delete" >/dev/null
	git -C "$dir" push -q origin --tags 2>/dev/null || true
	ok "created $full"
}

# make <suffix>  — single-commit, untagged fixture from its fx_<suffix> builder
make() {
	local suffix="$1" full; full="$(repo_full "$suffix")"
	if gh repo view "$full" >/dev/null 2>&1; then warn "exists, skipping: $full"; return 0; fi
	local dir; dir="$(mktemp -d)"
	git -C "$dir" init -q -b main
	"fx_$suffix" "$dir"
	git_commit_all "$dir" "agntc e2e fixture: $suffix"
	publish "$suffix" "$dir"
	rm -rf "$dir"
}

# make_tagged <suffix> <tag1> <tag2> ...  — one commit per tag, used for version tests
make_tagged() {
	local suffix="$1"; shift
	local full; full="$(repo_full "$suffix")"
	if gh repo view "$full" >/dev/null 2>&1; then warn "exists, skipping: $full"; return 0; fi
	local dir; dir="$(mktemp -d)"
	git -C "$dir" init -q -b main
	skill_md "$dir/SKILL.md" "$suffix"
	local v
	for v in "$@"; do
		echo "version $v" >"$dir/VERSION"
		git_commit_all "$dir" "release $v"
		# Annotated tag with a message — robust whether or not the user's git
		# config forces annotated tags (lightweight `git tag <v>` errors then).
		git -C "$dir" tag -a "$v" -m "release $v"
	done
	publish "$suffix" "$dir"
	rm -rf "$dir"
}

# ---------------------------------------------------------------------------
# Sandbox
# ---------------------------------------------------------------------------

make_sandbox() {
	rm -rf "$SANDBOX"
	mkdir -p "$SANDBOX"
	# Convenience wrapper so the walkthrough can use `./agntc <cmd>` against the
	# locally-built CLI under test.
	cat >"$SANDBOX/agntc" <<EOF
#!/usr/bin/env bash
exec node "$CLI" "\$@"
EOF
	chmod +x "$SANDBOX/agntc"
	cat >"$SANDBOX/README.txt" <<EOF
agntc e2e sandbox — blank project for exercising installs.
Run the CLI under test with:  ./agntc <command>
Reset between tests with:     <skill>/scripts/reset-sandbox.sh
EOF
	ok "sandbox ready: $SANDBOX  (run installs with ./agntc ...)"
}

build_cli() {
	log "building CLI under test (npm run build)…"
	( cd "$REPO_ROOT" && npm run build >/dev/null 2>&1 ) || die "npm run build failed — fix the build first"
	[ -f "$CLI" ] || die "expected built CLI at $CLI but it is missing"
	ok "built $CLI"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
	preflight_common
	has_delete_scope || warn "token lacks 'delete_repo' scope — teardown will not be able to delete repos until you add it (see SKILL.md)."

	log "owner: $OWNER   prefix: $PREFIX   visibility: ${VISIBILITY#--}"
	build_cli

	# Standalone — bare skill
	make bare-skill
	make bare-skill-claude
	make_tagged bare-skill-tagged v1.0.0 v1.1.0 v2.0.0
	# Standalone — plugin
	make plugin
	make plugin-claude
	make plugin-assets-only
	# Skills-only (ambiguous)
	make skills-only
	make skills-only-typeplugin
	# Collections
	make collection
	make collection-mixed
	make collection-stray-root
	make collection-nested
	# Errors / leniency
	make err-typeplugin-bareskill
	make err-typeplugin-collection
	make not-agntc
	make config-malformed
	make config-empty-agents
	# Copy-safety
	make symlink-escape
	# Version pinning extra
	make_tagged tagged-zerover v0.1.0 v0.2.0
	# Update lifecycle (untagged / HEAD-tracked)
	make lifecycle-plugin
	make lifecycle-break
	make lifecycle-skills-only-member

	make_sandbox
	echo
	ok "setup complete — $(gh repo list "$OWNER" --json name -q '[.[].name]|map(select(startswith("'"$PREFIX"'-")))|length' --limit 200) fixture repos under $OWNER/$PREFIX-*"
	log "next: walk the test plan (references/test-plan.md). Tear down with scripts/teardown.sh."
}

# Only run when executed directly (sourcing exposes the builders for testing).
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
	main "$@"
fi
