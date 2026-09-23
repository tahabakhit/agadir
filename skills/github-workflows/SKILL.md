---
name: github-workflows
description: "Safety rules for Git and GitHub work (commits, pushes, PRs, cleanup), plus a read-only repository hygiene audit."
metadata:
  created_by: "agent"
  version: "2.0.0"
  author: "Implementation Notes"
---
# GitHub Workflows

Safety rules for Git and GitHub work. Use `gh` and Git directly; this skill
only adds safety boundaries and two focused tools.

## Safety boundary

Always inspect auth and repository state before an operation. Never put
credentials in URLs, arguments, logs, or tracked files; use an approved secret
injection path. Prefer `gh` when authenticated and native Git otherwise. Review
scope, diff, and destination before every write. Never use force-push, history
rewriting, wildcard staging, or destructive cleanup without an explicit request
and a bounded safety review.

A normal mid-session commit or push is only repository work: it does **not**
close a Pi session, open a PR automatically, or trigger the session-close
workflow. Load `../pi/session-close/SKILL.md` only when the user explicitly
invokes session close or explicitly asks to close/archive the current session.

## Read-only audit tools

From this skill directory, run the read-only Go audit when requested:

```bash
go run scripts/git_hygiene_audit.go /path/to/repo
go run scripts/git_hygiene_audit.go /path/to/projects --scan --max-depth 2 --json
```

For remotes that point at another machine's local checkout path over SSH, see
`references/stale-local-path-remotes.md`.
