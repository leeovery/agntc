#!/usr/bin/env bash
# Delete every agntc fixture repo (matching the prefix) and remove the sandbox.
# Sweeps GitHub directly, so it also cleans up partially-created runs.
#
# Usage: scripts/teardown.sh [-y]
#   -y / CONFIRM=1   skip the confirmation prompt
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

CONFIRM="${CONFIRM:-0}"
[ "${1:-}" = "-y" ] && CONFIRM=1

preflight_common

if ! has_delete_scope; then
	err "token lacks the 'delete_repo' scope — cannot delete repos."
	cat >&2 <<EOF

  Add it (classic PAT in GH_TOKEN): edit the token at
  https://github.com/settings/tokens and tick 'delete_repo'.
  Or, with gh's keyring: unset GH_TOKEN && gh auth refresh -h github.com -s delete_repo
EOF
	exit 1
fi

# Discover fixture repos on GitHub (authoritative — catches leftovers).
# Portable to bash 3.2 (macOS default) — no mapfile.
repos=()
while IFS= read -r line; do
	[ -n "$line" ] && repos+=("$line")
done < <(gh repo list "$OWNER" --json name -q '.[].name' --limit 200 | grep "^$PREFIX-" || true)

if [ "${#repos[@]}" -eq 0 ]; then
	log "no fixture repos found under $OWNER/$PREFIX-*"
else
	log "fixture repos to delete (${#repos[@]}):"
	printf '   %s/%s\n' "$OWNER" "${repos[@]}"
	if [ "$CONFIRM" != "1" ]; then
		printf '%sDelete these %d repos? [y/N] %s' "$c_yellow" "${#repos[@]}" "$c_off"
		read -r reply
		case "$reply" in y|Y|yes|YES) ;; *) die "aborted — nothing deleted"; esac
	fi
	for name in "${repos[@]}"; do
		if gh repo delete "$OWNER/$name" --yes >/dev/null 2>&1; then
			ok "deleted $OWNER/$name"
		else
			err "failed to delete $OWNER/$name"
		fi
	done
fi

# Remove the sandbox.
if [ -d "$SANDBOX" ]; then
	rm -rf "$SANDBOX"
	ok "removed sandbox: $SANDBOX"
fi

ok "teardown complete"
