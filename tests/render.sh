#!/bin/sh
# Render every chezmoi target into temporary homes with the sample answers and
# check the results. Touches nothing outside the temporary directories.
#   tests/render.sh
set -eu
src=$(cd "$(dirname "$0")/.." && pwd)
fail() { echo "render: $*" >&2; exit 1; }

render() { # config file, expected Pi package list (JSON)
	tmp=$(mktemp -d)
	config=$1
	shift
	cz_() { HOME=$tmp chezmoi --source "$src" --destination "$tmp" --config "$src/$config" --persistent-state "$tmp/state.boltdb" "$@"; }
	cz_ apply --exclude=scripts,externals
	[ -z "$(cz_ status --exclude=scripts,externals)" ] || fail "$config: status not clean after apply"
	for f in .pi/agent/settings.json .claude/settings.json .gitconfig; do
		[ -f "$tmp/$f" ] || fail "$config: $f missing"
	done
	node -e '
		const [file, want] = process.argv.slice(1);
		const got = JSON.stringify(require(file).packages);
		if (got !== want) { console.error(`packages\n  got  ${got}\n  want ${want}`); process.exit(1); }
	' "$tmp/.pi/agent/settings.json" "$1" || fail "$config: Pi packages differ"
	echo "$tmp"
}

third='"git:github.com/edxeth/pi-subagents","npm:pi-agent-ide","npm:pi-blackhole","git:github.com/mandre/pi-anthropic-vertex@bump-pi"'

home=$(render tests/chezmoi.toml "[$third,\"git:github.com/tahabakhit/pi-learn\",\"git:github.com/tahabakhit/pi-toolkit\",\"npm:@tahabakhit/pi-research-kit\"]")
[ "$(readlink "$home/.agents/skills/herdr")" = "$home/.local/share/agent-skills/herdr" ] || fail "skill link without agentsRoot"
echo "ok: remote packages"

home=$(render tests/chezmoi-local.toml "[$third,\"/opt/agents/pi/learn\",\"/opt/agents/pi/toolkit\",\"/opt/agents/pi/research-kit\"]")
[ "$(readlink "$home/.claude/skills/herdr")" = "/opt/agents/skills/herdr" ] || fail "skill link with agentsRoot"
grep -q '^extensions: /opt/agents/pi/research-kit,' "$home/.pi/agent/agents/researcher.md" || fail "researcher role source"
echo "ok: local packages"

tmp=$(mktemp -d)
chezmoi --source "$src" --config "$src/tests/chezmoi-local.toml" \
	--override-data "{\"privateSkillsDir\":\"$src/tests/fixtures/private-skills\"}" \
	execute-template <"$src/home/.chezmoiscripts/run_onchange_after_install-private-skills.sh.tmpl" >"$tmp/run.sh"
HOME=$tmp sh "$tmp/run.sh" >/dev/null
cmp -s "$src/tests/fixtures/private-skills/example/SKILL.md" "$tmp/.agents/skills/example/SKILL.md" || fail "private skill copy"
echo "ok: private skills copy"
