---
name: session
description: Explicit-only tracked session start and close with a private Git baseline, session branch, conservative attribution, and a PR. Use only through /session-start or /session-close, never for ordinary commit or push requests.
disable-model-invocation: true
---

# Session

Opt-in, explicit-only. Load this skill only for `/session-start` or
`/session-close`; never start or close a session from a helper, memory, or
background process. Paths below are relative to this skill's directory.

## Script and configuration

`node scripts/lifecycle.ts <start|close|inspect> [options]` prints JSON on
stdout; on error it prints `session-start: …` or `session-close: …` and exits 1.

Configuration lookup: `--config <file>`, else `PI_SESSION_LIFECYCLE_CONFIG`,
else `~/.config/agadir/session-lifecycle.json` if it exists, else the bundled
`config.json` (both adapters disabled). A named file that is missing is an
error. Schema 1 sets `git.remote`, `git.base_branch` (null means the remote's
HEAD), `git.branch_prefix`, and two optional adapters: `github`
(`enabled`, `command`) and `notes` (`enabled`, `repo`, `remote`,
`base_branch`, `validation_command`, `intake_dir`). Refs must be plain ref
names; `intake_dir` must be relative without `..`. Invalid config fails before
any Git change. A disabled or missing adapter is reported as
`Skipped — not configured`, never as a failure.

## What the script enforces

- `PI_SESSION_FILE` must be a regular, non-symlink transcript whose `session`
  header ID equals `PI_SESSION_ID`. Sessions named `om-*` or with a known
  bracketed helper-role prefix (`[scout]`, `[worker]`, `[reviewer]`, …) are
  refused.
- Baselines live in `PI_SESSION_BASELINE_DIR` (absolute) or
  `$PI_CODING_AGENT_DIR/session-lifecycle/baselines` (default
  `~/.pi/agent`), never inside the repository. The directory has no group or
  other permissions and is owned by the current user, and neither it nor any ancestor below `HOME`
  may be a symlink. The baseline is written atomically as a `0600` file; close
  refuses it unless it is a regular file with exactly that mode and the
  current owner.
- `start` requires `--objective`, `--stopping-point`, and at least one each of
  `--scope`, `--allow`, and `--validation`. It refuses unborn or detached
  HEAD, any staged change, and an existing baseline or branch for the session.
- `close` is read-only. It never declares ownership (`owned_paths` is always
  empty); it only sorts changed paths into evidence-supported, ambiguous, and
  excluded pre-existing paths.

## Start

1. Read repository `AGENTS.md` and other applicable instructions.
2. Settle objective, in-scope paths or systems, allowed mutations, exact
   validation commands, and stopping point. Ask only about material unknowns.
3. Before any edit, run:

   ```bash
   node scripts/lifecycle.ts start \
     --objective '<objective>' \
     --scope '<path or system>' --allow '<allowed mutation>' \
     --validation '<exact check command>' \
     --stopping-point '<required stopping state>' \
     [--issue '<task reference>'] [--repo <path>] [--config <file>]
   ```

   Repeat `--scope`, `--allow`, and `--validation` as needed; do not drop
   known values. The script records HEAD, branch, upstream, remotes, and full
   porcelain status, then runs `git switch -c
   <prefix>-<model>-<session-id-8>-<UTC stamp>`. Unstaged and untracked work
   comes along untouched and is recorded as excluded.
4. Echo the persisted contract (from the baseline file) and branch to the user. A refusal (staged
   change, branch or path-safety failure) is a blocker: never unstage, stash,
   or clean the tree to get past it. Start makes no commit, push, PR, or
   notes-repository write.

## Close

1. Run `node scripts/lifecycle.ts close` before staging anything. A mismatched
   session ID, transcript, repository, or branch, or a missing baseline HEAD
   commit, is a hard stop. Without a
   baseline the report has `baseline: null` and reduced confidence; confirm
   with `node scripts/lifecycle.ts inspect`, and refuse to finalize if
   `session_kind` is not `human`.
2. Read repository instructions. Check root, branch, remotes, default branch,
   status, staged and unstaged diffs, untracked files, and `gh auth status`
   when GitHub is enabled.
3. Attribute conservatively:
   - A successful direct `write`/`edit` after the baseline boundary makes a
     path evidence-supported, not owned. Inspect its diff before staging.
   - A path dirty at start is excluded in full unless exact hunk ownership is
     proven; stage proven hunks with `git add -p` or an exact patch.
   - Ambiguous work stays untouched and is listed. Never ask a blanket
     "commit everything?". Shell commands, helper and memory sessions, and
     nested generated transcripts are never attribution proof.
   - Verify any commits the session already made against its timestamps and
     transcript; never duplicate them.
4. Run the focused, repository-prescribed checks for the attributable change.
   Record exact commands and outcomes. Do not fix unrelated failures, and never
   treat passing checks as permission to include ambiguous work.
5. On the recorded session branch, stage explicit paths or hunks only. Review
   `git diff --cached --check`, `git diff --cached --stat`, and the full staged
   diff, then commit with a message derived from the diff. In the no-baseline
   fallback, create a new `<prefix>-<model>-<session-id-8>-<UTC stamp>` branch
   without disturbing the dirty tree.
6. Push with upstream tracking to the configured remote. If GitHub is enabled,
   open a PR against the configured base (else the remote's default branch)
   covering changes, verification, blockers, and excluded dirty state. Never
   merge. Verify the pushed SHA and PR URL and that each committed path is
   clean.
7. If nothing is attributable, create no empty commit, branch, or PR.

## Notes repository adapter (optional)

Enabled only by a locally configured `adapters.notes`. Propose one note only
for durable, non-secret value: a decision with rationale, verified research
with source URLs, changed project or infrastructure state, an open risk or
dependency, or a pointer to a commit or PR. Otherwise record
`Notes: skipped — no durable update`. Follow the notes repository's own
privacy and routing instructions.

1. Draft `<intake_dir>/YYYY-MM-DD-<slug>.md` with a title and the sections
   Summary, Source / evidence, Date, Confidence (with basis), Affected area,
   Changed files, and Open questions (real uncertainty or `None`).
2. Show the path and full note and ask once with the question tool. Approval
   covers that exact text only. If denied, finish the primary close and report
   the note as skipped.
3. After approval, fetch the configured remote and create a temporary worktree
   on a new branch from `<remote>/<base_branch>`; never write the main
   checkout. Write only the note, stopping if the path exists. Run
   `validation_command`, stage only the note, commit, push, open a PR against
   `base_branch`, verify SHA and URL, then remove the clean worktree.
4. On failure, keep recoverable state and report the blocker. Never fall back
   to editing the main checkout.

## Forbidden, always

`git add -A`, `git add .`, wildcard staging, `git stash`, `restore`, `reset`,
`clean`, force push, history rewrites, and merging. Unrelated dirty files are
never stashed, restored, deleted, committed, or moved; they are reported.

## Receipt

Every close, including after a blocker or tool error, ends with non-empty text
under exactly these headings:

```markdown
## Completed
- <primary repository branch, commit, push, PR; notes adapter result or skip>
## Verified
- <exact commands and outcomes, remote and PR verification>
## Blockers
- <blocker or None>
## Optional follow-up
- <non-blocking item or None>
## Excluded changes
- <pre-existing or ambiguous paths left untouched, or None>
## Restart/reload
- <exact action, what it reloads, what changes; or Not required>
```

Never claim a commit, push, PR, or note unless the command succeeded and its
identifier was verified. Never call the session complete while a blocker
remains, and do not phrase optional follow-up as unfinished required work.
