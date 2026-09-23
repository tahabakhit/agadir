# Third-party material

| Path | Source | License |
|---|---|---|
| `pi/prompts/handoff.md` | Adapted from the `handoff` skill in [davidondrej/skills](https://github.com/davidondrej/skills) | MIT, Copyright (c) 2026 David Ondrej ([text](licenses/davidondrej-skills.txt)) |
| "Writing that lands in a repository" in `home/.chezmoitemplates/agent-instructions.md`, and some git aliases, shell aliases and history settings | Adapted from [lararosekelley/dotfiles](https://github.com/lararosekelley/dotfiles) | MIT, Copyright (c) 2014-2026 Lara Kelley ([text](licenses/lararosekelley-dotfiles.txt)) |

Everything else is original to this repository and covered by `LICENSE`.

## Packages it installs (not included here)

| Package | Source | Notes |
|---|---|---|
| `pi-subagents` | <https://github.com/edxeth/pi-subagents> | Subagent runtime for the roles in `home/dot_pi/private_agent/exact_agents/`. MIT. |
| `@tahabakhit/pi-research-kit` | <https://github.com/tahabakhit/pi-research-kit> | `web_search` / `web_fetch` for the researcher role. |
| `pi-agent-ide` | <https://github.com/alexshpunt/pi-agent-ide> | Only the search modules are enabled (`pi-agent-ide/private_extensions.json`); its edit hooks do not cover copy, move or delete. MIT. |
| `pi-blackhole` | <https://github.com/k0valik/pi-blackhole> | Memory and compaction; its default settings run background model workers. Installed with npm scripts disabled. MIT. |
| `pi-anthropic-vertex` (`@bump-pi` branch) | PR #32 to <https://github.com/twoGiants/pi-anthropic-vertex> | Installed only when a Vertex project is configured. Switch to the npm release once it includes the Opus 5.5 fix. MIT. |
