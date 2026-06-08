#!/usr/bin/env bash
# Push a second commit to a lifecycle fixture so `update` has a real change to
# react to. Run BETWEEN the install step and the update step of a lifecycle test.
#
# Usage: scripts/mutate.sh <lifecycle-plugin|lifecycle-break|lifecycle-skills-only-member>
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

suffix="${1:-}"
[ -n "$suffix" ] || die "usage: mutate.sh <lifecycle-plugin|lifecycle-break|lifecycle-skills-only-member>"
full="$(repo_full "$suffix")"
gh repo view "$full" >/dev/null 2>&1 || die "fixture repo not found: $full (run setup.sh first)"

dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
gh repo clone "$full" "$dir" -- -q

case "$suffix" in
	lifecycle-plugin)
		# Benign addition: author adds a hooks/ dir and a new skill. Recorded type
		# is 'plugin'; update should REPLAY plugin and pick the new assets up.
		mkdir -p "$dir/hooks" "$dir/skills/extra"
		printf '#!/bin/sh\necho added\n' >"$dir/hooks/added.sh"
		cat >"$dir/skills/extra/SKILL.md" <<'EOF'
---
name: extra
description: Newly added skill (benign addition for update replay test).
---
# extra
EOF
		msg="benign addition: hooks/ + skills/extra"
		;;
	lifecycle-break)
		# Irreconcilable change: bare skill becomes a member-dirs collection. The
		# recorded type is 'skill' (root SKILL.md) which no longer exists →
		# derive-before-delete must ABORT and leave the install intact.
		git -C "$dir" rm -q SKILL.md
		cat >"$dir/alpha/SKILL.md" <<'EOF'
---
name: alpha
description: Member after the breaking reshape.
---
# alpha
EOF
		cat >"$dir/beta/SKILL.md" <<'EOF'
---
name: beta
description: Member after the breaking reshape.
---
# beta
EOF
		msg="breaking reshape: bare skill -> member-dirs collection"
		;;
	lifecycle-skills-only-member)
		# Add a reference file under skills/alpha so a successful member update has
		# something new to copy — exercises sourceSubpath relocation on update.
		echo "added reference content" >"$dir/skills/alpha/added-reference.md"
		msg="add skills/alpha/added-reference.md"
		;;
	*)
		die "no mutation defined for: $suffix"
		;;
esac

git -C "$dir" add -A
git -C "$dir" -c user.email=fixtures@agntc.test -c user.name=agntc-fixtures commit -qm "$msg"
git -C "$dir" push -q origin HEAD
ok "mutated $full — $msg"
