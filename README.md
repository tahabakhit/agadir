# dotfiles

My shell and agent setup, managed by [chezmoi](https://chezmoi.io): zsh, git,
Herdr, WezTerm, and the configuration for Pi, Claude Code and Codex.

It embeds no agent packages. `chezmoi apply` installs them from their own
repositories:

| Package | Source | What it is |
|---|---|---|
| [pi-learn](https://github.com/tahabakhit/pi-learn) | GitHub | Learn mode for Pi |
| [pi-toolkit](https://github.com/tahabakhit/pi-toolkit) | GitHub | Pi extensions, skills and prompts |
| [pi-research-kit](https://github.com/tahabakhit/pi-research-kit) | npm | Research tools for Pi |
| [agent-skills](https://github.com/tahabakhit/agent-skills) | GitHub, cloned to `~/.local/share/agent-skills` | Portable skills for Pi, Codex and Claude Code |

Third-party Pi packages are listed in `home/.chezmoidata/pi.toml` and
[NOTICE.md](NOTICE.md).

## What's inside

| Path | What it is |
|---|---|
| `home/` | The chezmoi source, selected by `.chezmoiroot` |
| `home/.chezmoidata/pi.toml` | Pi packages and portable skills every machine gets |
| `home/dot_pi/private_agent/exact_agents/` | Subagent roles |
| `tools/merge-config.ts` | Merges owned keys into config files that their apps also write |
| `tests/` | Sample answers and `render.sh`, which renders every target into temporary homes |

## Local checkouts

`chezmoi init` asks for two optional folders:

- **agentsRoot**: a folder holding checkouts of the packages above, laid out as
  `pi/learn`, `pi/toolkit`, `pi/research-kit` and `skills`. When set, Pi
  loads those packages from the checkouts and the skill links point there, so
  an edit takes effect on `/reload` without publishing. Their GitHub and npm
  entries are removed from Pi's settings, so nothing loads twice.
- **privateSkillsDir**: a folder of skill folders that are copied, not linked,
  into `~/.agents/skills` on every apply.

## Use the whole setup

Preview first; chezmoi replaces `~/.zshrc`, `~/.gitconfig` and the other managed
files:

```sh
brew install chezmoi
chezmoi init tahabakhit/dotfiles   # asks for name, email, signing key and optional settings
chezmoi diff                       # review every change
chezmoi apply
```

`chezmoi init` asks each question once and keeps the answers in
`~/.config/chezmoi/chezmoi.toml`.

On Windows, only the WezTerm config is applied and nothing is asked:

```powershell
winget install twpayne.chezmoi   # or: choco install chezmoi
chezmoi init --apply tahabakhit/dotfiles
```

It lands in `%USERPROFILE%\.config\wezterm\`, which WezTerm reads before
`%USERPROFILE%\.wezterm.lua`. New windows open PowerShell 7 if it is installed,
otherwise Windows PowerShell. CI applies it on a Windows runner and loads it in
WezTerm.

To work on the repository itself, clone it anywhere and point chezmoi at it:

```sh
git clone https://github.com/tahabakhit/dotfiles ~/dev/dotfiles
chezmoi init --source ~/dev/dotfiles --apply
```

Afterwards, `chezmoi diff` and `chezmoi apply` sync a machine, and
`chezmoi update` pulls and applies in one step.

## What stays on each machine

Nothing personal or machine-specific is committed. Each of these is optional and
read if present:

| File | For |
|---|---|
| `~/.config/shell/local.zshenv`, `local.zprofile`, `local.zsh` | Machine-specific shell setup (work tools, secrets loaders, extra PATH) |
| `~/.config/git/local` | Work identity, extra credential helpers, `includeIf` rules |
| `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.pi/agent/AGENTS.md` | Global agent instructions; chezmoi does not manage them |
| `~/.pi/agent/pi-toolkit/` | Your own snippets and `session` skill adapters; see pi-toolkit's README |
| `~/.config/wezterm/local.lua` | WezTerm per machine: start Herdr, SSH hosts (created once, never overwritten) |

Model and thinking-level choices stay in each tool's own settings. Subagent roles
have no model: they use the session's model unless you name one.

## Files that apps also write

For these files chezmoi changes only the keys listed and keeps everything else,
including key order. A file that already has these values is left untouched.

| File | Keys these dotfiles own |
|---|---|
| `~/.pi/agent/settings.json` | `packages`, `extensions`, `skills` |
| `~/.claude/settings.json` | telemetry and error-reporting env vars, `attribution`, secret-file `permissions.deny` rules (added, never removed), Vertex env vars when configured |
| `~/.codex/config.toml` | `personality`, `model_reasoning_summary` |

Pi does not install packages that settings declare, so `chezmoi apply` runs
`pi install` for any that are missing.

When Herdr is installed, `chezmoi apply` also installs the
[herdr-projects](https://github.com/eliasstravik/herdr-projects) plugin if it is
missing and runs its `configure`, which adds its progress hooks to Claude Code
and Codex. `configure` also writes its sidebar rows, the `prefix+y` popup key
and a tab-bar entry into Herdr's `config.toml`. chezmoi owns the rest of that
file and keeps those entries as the plugin wrote them, so plugin updates cause
no drift.

## Tests

```sh
npm test          # merge-config
tests/render.sh   # render every target with and without local checkouts
```
