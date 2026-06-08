#!/usr/bin/env bash
# Shared config + helpers for the agntc e2e-fixtures skill.
# Sourced by setup.sh / teardown.sh / mutate.sh / reset-sandbox.sh.

set -euo pipefail

# --- Locations ---------------------------------------------------------------
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$LIB_DIR/.." && pwd)"
# The agntc project root (this skill lives inside it). Prefer git toplevel.
REPO_ROOT="$(git -C "$LIB_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$LIB_DIR/../../../.." && pwd))"

# The locally-built CLI under test (NOT the published npx version).
CLI="$REPO_ROOT/dist/cli.js"

# A throwaway blank project where installs are exercised. Overridable.
SANDBOX="${AGNTC_TEST_SANDBOX:-$HOME/agntc-test-sandbox}"

# --- GitHub fixture identity -------------------------------------------------
# Every fixture repo is "<OWNER>/<PREFIX>-<suffix>". The prefix is the safety
# boundary: teardown only ever touches repos matching it.
PREFIX="agntc-fix"
VISIBILITY="--private"
OWNER="${AGNTC_FIX_OWNER:-$(gh api user --jq .login 2>/dev/null || echo "")}"

# --- Output helpers ----------------------------------------------------------
c_blue=$'\033[34m'; c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_red=$'\033[31m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
log()  { printf '%s==>%s %s\n' "$c_blue" "$c_off" "$*"; }
ok()   { printf '%s ✓%s %s\n' "$c_green" "$c_off" "$*"; }
warn() { printf '%s ⚠%s %s\n' "$c_yellow" "$c_off" "$*" >&2; }
err()  { printf '%s ✗%s %s\n' "$c_red" "$c_off" "$*" >&2; }
die()  { err "$*"; exit 1; }

repo_full() { printf '%s/%s-%s' "$OWNER" "$PREFIX" "$1"; }   # repo_full <suffix>
repo_name() { printf '%s-%s' "$PREFIX" "$1"; }               # repo_name <suffix>

# --- Shared preflight --------------------------------------------------------
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }

preflight_common() {
	require_cmd gh
	require_cmd git
	require_cmd node
	[ -n "$OWNER" ] || die "could not resolve GitHub owner (is 'gh' authenticated? try: gh auth status)"
	gh auth status >/dev/null 2>&1 || die "gh is not authenticated — run: gh auth status"
}

has_delete_scope() {
	gh auth status 2>&1 | grep -qi "delete_repo"
}

# The canonical fixture list (suffixes). Kept here so setup, teardown, and the
# walkthrough never drift. Teardown additionally sweeps GitHub for any repo
# matching the prefix, so a partially-created run still cleans up fully.
FIXTURES=(
	bare-skill
	bare-skill-claude
	bare-skill-tagged
	plugin
	plugin-claude
	plugin-assets-only
	skills-only
	skills-only-typeplugin
	collection
	collection-mixed
	collection-stray-root
	collection-nested
	err-typeplugin-bareskill
	err-typeplugin-collection
	not-agntc
	config-malformed
	config-empty-agents
	symlink-escape
	tagged-zerover
	lifecycle-plugin
	lifecycle-break
	lifecycle-skills-only-member
)
