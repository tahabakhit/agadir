# Agent instructions

This repository is public. It is a chezmoi source (`home/`, selected by
`.chezmoiroot`) that installs agent packages from their own repositories; it
embeds none.

## Rules

- **Nothing personal or machine-specific in Git.** No secrets, tokens, email
  addresses, employer names, internal hostnames, cloud project IDs, private
  repository names or absolute home paths. Put them in chezmoi data (asked by
  `home/.chezmoi.toml.tmpl`) or in the machine-local files listed in `README.md`.
- **Models are machine-local.** Never set a model or thinking default in
  settings, templates, or subagent roles.
- **Own only what you must.** Files that apps also write go through
  `tools/merge-config.ts` with the smallest set of keys.
- **Packages live elsewhere.** Pi extensions, skills and prompts belong in
  their package repositories; this repository only lists them in
  `home/.chezmoidata/pi.toml`.
- **Third-party material** needs a license that allows redistribution and an
  entry in `NOTICE.md`. Never copy code or prompts from sources without a
  license; describe the behavior and write it fresh.
- **Languages:** TypeScript for tooling (runs on Node's built-in type
  stripping, no build step), POSIX shell for chezmoi scripts. No Python.

## Checks before committing

```sh
npm test
tests/render.sh
```

`tests/chezmoi.toml` and `tests/chezmoi-local.toml` hold sample answers for the
chezmoi prompts, without and with local package checkouts.
