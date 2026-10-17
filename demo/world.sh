#!/usr/bin/env bash
# The world the tapes record in, built under demo/out/world/: a home folder
# with a project in it, the repos agntc installs from, and a shell setup the
# tapes source. Nothing reaches the network or the real home folder.
#
# The repos are local bare repos that git reaches as GitHub repos through a
# url.insteadOf in a gitconfig of the world's own (GIT_CONFIG_GLOBAL), so
# `npx agntc add acme/team-skills` clones demo/out/world/repos/team-skills.git:
#
#   acme/team-skills   laravel/, a pack (eloquent, testing, a support folder
#                      shared/, an agent, a hook), and loose skills go and
#                      python. v1.2.0; `upstream` adds v1.3.0 (migrations
#                      added, testing removed) and v2.0.0, a major outside
#                      the ^1.2.0 a bare add records.
#   acme/writing       a skill at the root, pinned to v1.0.0 in `installed`;
#                      `upstream` tags v1.1.0, a newer tag the pin shows.
#
# `npx` and `git` are shims on the world's PATH: npx runs the build staged in
# demo/out/agntc/, its package.json carrying the latest release's version, as
# a published install would; git waits a moment before a clone or a remote
# read, as the network would, so the spinners show.
#
# Usage:  demo/world.sh build       the world at its start: repos at v1.0.0
#                                   and v1.2.0, the project empty
#         demo/world.sh upstream    the repos' later tags
#         demo/world.sh installed   the project's installs, as list and
#                                   update find them: laravel and go at
#                                   v1.2.0, writing at v1.0.0, a local skill
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
out="$here/out"
world="$out/world"
repos="$world/repos"
home="$world/home"
work="$world/work"

export GIT_CONFIG_GLOBAL="$world/gitconfig"
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=demo GIT_AUTHOR_EMAIL=demo@example.com
export GIT_COMMITTER_NAME=demo GIT_COMMITTER_EMAIL=demo@example.com

# A skill folder: its path, its description, and its name where the folder's
# own isn't it (a skill at a repo's root).
skill() {
	local name="${3:-$(basename "$1")}"
	mkdir -p "$1"
	cat >"$1/SKILL.md" <<EOF
---
name: $name
description: $2
---
# $name
EOF
}

# A commit and an annotated tag, dated by the tag's place in the story, so
# every commit hash is the same from one recording to the next.
release() {
	local date="$2"
	git add -A
	GIT_AUTHOR_DATE="$date" GIT_COMMITTER_DATE="$date" git commit -qm "$1"
	GIT_COMMITTER_DATE="$date" git tag -a -m "$1" "$1"
	git push -q origin main --tags
}

repo() {
	git init -q --bare -b main "$repos/$1.git"
	mkdir -p "$work/$1"
	cd "$work/$1"
	git init -q -b main
	git remote add origin "$repos/$1.git"
}

stage() {
	local version
	version="$(git -C "$root" describe --tags --abbrev=0 --match 'v*' 2>/dev/null || echo v0.0.0)"
	rm -rf "$out/agntc"
	mkdir -p "$out/agntc"
	cp -R "$root/dist" "$out/agntc/dist"
	ln -s "$root/node_modules" "$out/agntc/node_modules"
	printf '{ "name": "agntc", "version": "%s", "type": "module" }\n' "${version#v}" >"$out/agntc/package.json"
}

shims() {
	local node git
	# Run from the shell's own home: a version manager's node shim reads its
	# config there, and the npx shim calls node by its real path.
	node="$(node -p process.execPath)"
	git="$(command -v git)"
	mkdir -p "$world/bin"
	cat >"$world/bin/npx" <<EOF
#!/usr/bin/env bash
case "\${1:-}" in agntc | agntc@*) shift ;; esac
exec "$node" "$out/agntc/dist/cli.js" "\$@"
EOF
	cat >"$world/bin/git" <<EOF
#!/usr/bin/env bash
for arg in "\$@"; do
	case "\$arg" in clone | ls-remote) sleep 0.7; break ;; esac
done
exec "$git" "\$@"
EOF
	chmod +x "$world/bin/npx" "$world/bin/git"
}

gitconfig() {
	cat >"$GIT_CONFIG_GLOBAL" <<EOF
[user]
	name = demo
	email = demo@example.com
[commit]
	gpgSign = false
[tag]
	gpgSign = false
[init]
	defaultBranch = main
[advice]
	detachedHead = false
[url "file://$repos/team-skills.git"]
	insteadOf = https://github.com/acme/team-skills.git
[url "file://$repos/writing.git"]
	insteadOf = https://github.com/acme/writing.git
EOF
}

# What a tape sources, in the shell vhs opens: the world's home, PATH and
# git config, colour as a truecolor terminal reports it, and a bare prompt.
profile() {
	cat >"$world/profile.sh" <<EOF
export DEMO="$here"
export HOME="$home"
export PATH="$world/bin:\$PATH"
export GIT_CONFIG_GLOBAL="$GIT_CONFIG_GLOBAL"
export GIT_CONFIG_NOSYSTEM=1
export COLORTERM=truecolor
unset NO_COLOR FORCE_COLOR
PS1='\[\e[34m\]❯\[\e[0m\] '
cd "$home/project"
clear
EOF
}

build() {
	rm -rf "$world"
	mkdir -p "$repos" "$work" "$home/project"
	stage
	shims
	gitconfig
	profile

	repo team-skills
	mkdir -p laravel
	echo '{"type": "pack"}' >laravel/agntc.json
	skill laravel/skills/eloquent "Eloquent models, relations and queries"
	skill laravel/skills/testing "Pest tests for Laravel apps"
	mkdir -p laravel/skills/shared laravel/agents laravel/hooks
	echo "# Conventions the pack's skills share" >laravel/skills/shared/conventions.md
	echo "# Reviews a change against the conventions" >laravel/agents/reviewer.md
	printf '#!/bin/sh\nexit 0\n' >laravel/hooks/pre-commit.sh
	skill skills/go "Idiomatic Go: errors, interfaces and tests"
	skill skills/python "Typed Python with pytest"
	release v1.2.0 "2026-09-01T10:00:00Z"

	repo writing
	skill . "Plain, direct technical writing" writing
	release v1.0.0 "2026-08-01T10:00:00Z"

	mkdir -p "$home/dev"
	skill "$home/dev/review" "Reviews a diff before it ships"
}

upstream() {
	cd "$work/team-skills"
	skill laravel/skills/migrations "Laravel migrations and schema changes"
	git rm -rq laravel/skills/testing
	release v1.3.0 "2026-10-01T10:00:00Z"
	echo "# Reviews a change against the v2 conventions" >laravel/agents/reviewer.md
	release v2.0.0 "2026-10-10T10:00:00Z"

	cd "$work/writing"
	echo "Prefer the active voice." >>SKILL.md
	release v1.1.0 "2026-09-15T10:00:00Z"
}

installed() {
	source "$world/profile.sh" >/dev/null
	npx agntc add acme/team-skills/laravel --json >/dev/null
	npx agntc add acme/team-skills --skill go --json >/dev/null
	npx agntc add acme/writing@v1.0.0 --json >/dev/null
	npx agntc add ~/dev/review --json >/dev/null
}

case "${1:-}" in
build) build ;;
upstream) upstream ;;
installed) installed ;;
*)
	echo "usage: demo/world.sh build | upstream | installed" >&2
	exit 2
	;;
esac
