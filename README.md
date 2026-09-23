# agadir

My agent and shell setup in one repository:

- **A Pi package**: extensions, skills, prompts and a learn mode for the
  [Pi coding agent](https://pi.dev).
- **Dotfiles managed by [chezmoi](https://chezmoi.io)**: zsh, git, Herdr,
  WezTerm, and the configuration for Pi, Claude Code and Codex, including one set
  of global agent instructions shared by all three.

Take the whole thing or just the parts you want.

## What's inside

| Path | What it is |
|---|---|
| `pi/extensions/learn/` | Learn mode: `pi --learn`, `/learn`, a `quiz` tool, a spaced-review queue (`/review`) and a learning log. See its README for the research it follows. |
| `pi/extensions/snippets/` | `alt+o` menu of one-shot prompt snippets, plus a persistent `/orchestrator` mode. |
| `pi/extensions/git-status/` | Branch and working-tree summary in Pi's footer. |
| `pi/extensions/header/` | Startup header. |
| `pi/skills/` | Pi-specific skills: `analyze-sessions` (cost and transcript search), `session` (tracked sessions with Git attribution), `web-debug` (frontend debugging with terminal-browser). |
| `pi/prompts/` | `/handoff`, `/session-start`, `/session-close`. |
| `skills/` | Agent Skills that work in any harness: `github-workflows`, `herdr`, `macos-system-administration`. |
| `home/` | The chezmoi source: shell, git, Herdr, WezTerm, Pi, Claude Code and Codex configuration, subagent roles, global instructions. |
| `tools/merge-config.ts` | Merges owned keys into config files that their apps also write. |

## Use the Pi package

```sh
pi install git:github.com/tahabakhit/agadir
```

Load only some of it with a filter in `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    { "source": "git:github.com/tahabakhit/agadir", "extensions": ["pi/extensions/learn/index.ts"], "skills": [], "prompts": [] }
  ]
}
```

Then `pi --learn` starts a session in learn mode.

## Use the whole setup

Preview first; chezmoi replaces `~/.zshrc`, `~/.gitconfig` and the other managed
files:

```sh
brew install chezmoi
chezmoi init tahabakhit/agadir   # asks for name, email, signing key, optional Vertex project
chezmoi diff                     # review every change
chezmoi apply
```

`chezmoi init` asks each question once and keeps the answers in
`~/.config/chezmoi/chezmoi.toml`. On Windows only the WezTerm config is applied.

To work on the repository itself, clone it anywhere and point chezmoi at it:

```sh
git clone https://github.com/tahabakhit/agadir ~/dev/agadir
chezmoi init --source ~/dev/agadir --apply
```

Afterwards, `chezmoi diff` and `chezmoi apply` sync a machine, and
`chezmoi update` pulls and applies in one step. Pi loads the package straight
from the checkout, so extension and skill edits take effect on `/reload`.

## What stays on each machine

Nothing personal or machine-specific is committed. Each of these is optional and
read if present:

| File | For |
|---|---|
| `~/.config/shell/local.zshenv`, `local.zprofile`, `local.zsh` | Machine-specific shell setup (work tools, secrets loaders, extra PATH) |
| `~/.config/git/local` | Work identity, extra credential helpers, `includeIf` rules |
| `~/.config/agadir/instructions.local.md`, `instructions.<pi\|claude\|codex>.md` | Appended to the global agent instructions (all harnesses, or one): who you are, internal tool routing |
| `~/.config/agadir/snippets/*.md` | Your own prompt snippets (same name overrides a bundled one) |
| `~/.config/agadir/session-lifecycle.json` | Adapters for the `session` skill |
| `~/.config/wezterm/local.lua` | WezTerm per machine: start Herdr, SSH hosts (created once, never overwritten) |

Model and thinking-level choices stay in each tool's own settings. Subagent roles
have no model: they use the session's model unless you name one.

## Files that apps also write

For these files chezmoi changes only the keys listed and keeps everything else,
including key order. A file that already has these values is left untouched.

| File | Keys agadir owns |
|---|---|
| `~/.pi/agent/settings.json` | `packages`, `extensions`, `skills` |
| `~/.claude/settings.json` | telemetry and error-reporting env vars, `attribution`, secret-file `permissions.deny` rules (added, never removed), Vertex env vars when configured |
| `~/.codex/config.toml` | `personality`, `model_reasoning_summary` |

Pi does not install packages that settings declare, so `chezmoi apply` runs
`pi install` for any that are missing.

## Tests

```sh
npm test
```
