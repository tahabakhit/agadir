# git-status

Adds a compact Git summary to Pi's built-in footer. It
shows the current branch, local tracked/untracked changes, conflicts, and
upstream ahead/behind counts from local tracking refs when available (it never
fetches). Pi's existing footer remains in place, so its model, context, session,
and usage information is not replaced. For example: `Git main · clean` or
`Git feature/footer · 2 changed · 1 untracked · ↑1↓2`.

The extension refreshes at session start, after tool and turn completion, and
while Pi is open (every 10 seconds). It invokes `git status` asynchronously,
without a shell, with a 2-second timeout, `--no-optional-locks`, and local
config overrides that disable fsmonitor hooks and the untracked cache; it makes
no Git changes. Untracked counts follow Git's `normal` mode, where an untracked
directory is one entry. If the current directory is not a Git worktree or Git
is unavailable, the extra status is hidden.

## Design basis

- Pi's [status-line example](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/status-line.ts)
  demonstrates adding persistent footer status through `ctx.ui.setStatus()`.
- Pi's [extension API docs](https://pi.dev/docs/latest/extensions) document
  `setStatus()` as footer/status-bar text.
- The community [@yorch/pi-statusbar](https://github.com/yorch/pi-statusbar)
  demonstrates the usefulness of surfacing branch and working-tree state.

This extension uses the additive status API rather than `setFooter()`, which replaces
Pi's entire built-in footer. This keeps the existing native footer and adds only
the Git information it does not already supply.
