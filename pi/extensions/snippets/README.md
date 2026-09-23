# snippets

Attach short, single-purpose instructions to your next message, and switch a
persistent orchestrator mode on or off.

## One-shot snippets

Open the menu with `/snippets` or `alt+o` (interactive TUI only).

| Key | Action |
|---|---|
| `↑` / `↓` | Move (wraps around) |
| `space` | Toggle the snippet under the cursor |
| `tab` | Preview the snippet; `tab` or `esc` returns |
| `enter` | Apply the selection |
| `esc` | Cancel and keep the previous selection |

Active snippets are listed in a widget above the editor. When you send a
message, the active prepend snippets go before your text and the append
snippets after it, separated by blank lines. The selection then clears. It also
clears at every session start and is never saved. Messages sent by other
extensions are left alone.

Bundled snippets:

| Snippet | Placement | Purpose |
|---|---|---|
| `session-kickoff` | prepend | Get oriented and report before starting work |
| `ask-questions` | append | Ask about open choices, then wait for confirmation |
| `verify-not-assume` | append | Check facts instead of guessing |
| `diagnose-report` | append | Investigate and propose a fix without applying it |

### Adding your own

Put `*.md` files in `~/.config/agadir/snippets/`. A user file with the same
filename as a bundled one replaces it. Files are re-read on every menu open and
every send, so edits apply without `/reload`.

```markdown
---
name: short-answer
description: Keep the reply brief
placement: append   # prepend or append (default append)
order: 30           # lower comes first (default 9999)
---
Answer in three sentences or fewer.
```

Keys are case-insensitive and values may be quoted. Files without frontmatter
or with an empty body are ignored. Prepend snippets are listed first, then
append snippets; each group is sorted by `order`, then by `name`.

## Orchestrator mode

`/orchestrator` toggles the mode; `/orchestrator on|off|status` sets or reports
it. While it is on:

- the footer shows `orchestrator`;
- the text in `orchestrator.md` is added to the system prompt as an
  `<orchestrator_mode>` section on every agent start (edits apply on the next
  message);
- each change is saved in the session, so the mode survives resume and follows
  forks, and is emitted on `pi.events` as `agadir:orchestrator-mode` with a
  boolean payload.

## Tests

```sh
node --test pi/extensions/snippets/*.test.ts
```
