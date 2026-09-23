# agadir: agent instructions

This repository is public. It is a Pi package (`package.json`, `pi/`, `skills/`)
and a chezmoi source (`home/`, selected by `.chezmoiroot`).

## Rules

- **Nothing personal or machine-specific in Git.** No secrets, tokens, email
  addresses, employer names, internal hostnames, cloud project IDs, or absolute
  home paths. Put them in chezmoi data (asked by `home/.chezmoi.toml.tmpl`) or in
  the machine-local files listed in `README.md`.
- **Models are machine-local.** Never set a model or thinking default in
  settings, templates, or subagent roles.
- **Own only what you must.** Files that apps also write go through
  `tools/merge-config.ts` with the smallest set of keys.
- **Keep skills lean**: workflows or tools the model would not know otherwise.
  Portable skills go in `skills/`, Pi-only ones in `pi/skills/`.
- **Third-party material** needs a license that allows redistribution and an
  entry in `NOTICE.md`. Never copy code or prompts from sources without a
  license; describe the behavior and write it fresh.
- **Languages:** TypeScript for Pi and agent tooling (runs on Node's built-in
  type stripping, no build step), Go or Rust for other tools. No Python.

## Checks before committing

```sh
npm test
tmp=$(mktemp -d) && HOME=$tmp chezmoi --source "$PWD" --destination "$tmp" \
  --config tests/chezmoi.toml apply --dry-run --exclude=scripts --verbose
```

`tests/chezmoi.toml` holds sample answers for the chezmoi prompts. For changes
to a Pi extension, also load it: `pi --no-extensions -e ./pi/extensions/<name>/index.ts -p "Reply OK"`.
