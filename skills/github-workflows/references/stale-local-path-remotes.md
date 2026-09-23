# Stale local-path remotes and first-hop host keys

Use this guide when a Git remote points to a local path that is unavailable or
obsolete, or when the first SSH/SCP connection to a known host cannot confirm its
host key in a non-interactive command.

## Symptom

```text
$ git pull
fatal: '<local-path>' does not appear to be a git repository
fatal: Could not read from remote repository.
```

The default remote points at an unavailable mount or another stale local path. The
repository itself may still be healthy.

## Diagnose

```bash
git remote -v        # list all remotes and identify the stale local path
git status            # confirm the working tree itself is healthy
```

## Fix

Fetch from a healthy remote and fast-forward only:

```bash
git fetch <healthy-remote> <branch> && git merge --ff-only <healthy-remote>/<branch>
```

- `--ff-only` refuses to proceed when history diverged, avoiding an unexpected
  merge commit.
- If the stale remote is permanently obsolete, remove or repoint it:
  `git remote remove <remote>` or `git remote set-url <remote> <healthy-url>`.
- Re-point upstream tracking when appropriate:
  `git branch --set-upstream-to=<healthy-remote>/<branch> <local-branch>`.
- After a fast-forward, a shell prompt may show that the branch is ahead of its
  old upstream tracking remote. Re-pointing upstream removes that misleading
  indicator; it does not by itself create local commits.

## First-hop host key failure (SCP/SSH non-interactive)

Symptom: `Host key verification failed` or `scp: Connection closed` on the first
connection to a known host because the key has not been recorded and the command
cannot display an interactive prompt.

Accept and record the key in one shot:

```bash
scp -o StrictHostKeyChecking=accept-new <file> <user>@<host>:/tmp/
```

Use this only for the first connection to a host whose identity was independently
confirmed. Keep strict host-key checking for subsequent connections.

## Safe recovery sequence

1. Fetch the selected branch from the healthy remote and merge with `--ff-only`.
2. If a file must be transferred, use `scp` with
   `StrictHostKeyChecking=accept-new` only for the confirmed first hop.
3. On the destination, install or inspect the file using the destination's own
   authority and permissions; remove temporary copies only after confirming the
   intended copy is present.

Keep the sequence read-only until the remote, destination, and ownership of the
change are confirmed.