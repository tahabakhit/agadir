# Canonical PATH for zsh and bash. Sourced by ~/.zshenv and again by ~/.zprofile,
# because macOS's /etc/zprofile (path_helper) moves system directories to the
# front after ~/.zshenv runs. Safe to source repeatedly.

_agadir_path=""
for _dir in \
	"$HOME/.local/bin" \
	"$HOME/.local/share/mise/shims" \
	"$HOME/.cargo/bin" \
	"$HOME/.bun/bin" \
	"$HOME/.opencode/bin" \
	"$HOME/go/bin" \
	/opt/homebrew/bin \
	/opt/homebrew/sbin \
	/usr/local/bin; do
	[ -d "$_dir" ] && _agadir_path="${_agadir_path:+$_agadir_path:}$_dir"
done

# Existing entries follow the canonical ones; duplicates keep their first position.
_rest="$_agadir_path${PATH:+:$PATH}"
PATH=""
while [ -n "$_rest" ]; do
	_dir="${_rest%%:*}"
	case "$_rest" in *:*) _rest="${_rest#*:}" ;; *) _rest="" ;; esac
	[ -n "$_dir" ] || continue
	case ":$PATH:" in *":$_dir:"*) ;; *) PATH="${PATH:+$PATH:}$_dir" ;; esac
done
export PATH
unset _agadir_path _dir _rest
