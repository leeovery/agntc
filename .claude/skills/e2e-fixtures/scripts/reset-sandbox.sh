#!/usr/bin/env bash
# Wipe the sandbox back to a blank project (removes any installed assets +
# manifest) so the next install starts clean. Run between test cases.
#
# Usage: scripts/reset-sandbox.sh
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

rm -rf \
	"$SANDBOX/.claude" "$SANDBOX/.agents" "$SANDBOX/.cursor" "$SANDBOX/.agntc"
mkdir -p "$SANDBOX"

# Re-create the wrapper if it went missing.
if [ ! -x "$SANDBOX/agntc" ]; then
	cat >"$SANDBOX/agntc" <<EOF
#!/usr/bin/env bash
exec node "$CLI" "\$@"
EOF
	chmod +x "$SANDBOX/agntc"
fi

ok "sandbox reset: $SANDBOX  (blank — installed assets + manifest cleared)"
