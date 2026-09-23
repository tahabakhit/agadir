# Agent CLI and macOS TCC: GUI versus helper processes

## Evidence pattern

A GUI agent runtime can lose macOS privacy permissions after an update when its
code signature or executable path changes. Ad-hoc signing, in particular, can
produce a new CDHash when the runtime is replaced.

A report that a protected helper or managed Python executable requires
re-approval is useful evidence to investigate, not a universal rule for every
CLI installation.

## Correct operational conclusion

CLI is a lower-risk migration, not a universal TCC fix:

- Normal CLI work launched from Terminal/iTerm commonly benefits from permissions granted to the terminal application.
- GUI runtimes can have update-related permission churn when their executable or signature changes.
- Screen control, screenshots, Accessibility, and other protected operations may execute through separate helper binaries and have separate TCC attribution.
- A managed or uv-managed Python executable can be ad-hoc signed or replaced independently. Inspect it before promising permission stability.
- Avoid broad claims such as “CLI is unaffected” or “every update will reset permissions.” Verify the actual binary, signature, path, and operation.

## Migration verification checklist

```bash
command -v agent-cli || true
command -v protected-helper || true
realpath "$(command -v protected-helper)" 2>/dev/null || true
codesign -dvvv "$(realpath "$(command -v protected-helper)")" 2>&1 | egrep 'Identifier|Signature|TeamIdentifier|CDHash' || true
```

For a managed Python target, resolve the virtual-environment link and inspect the target without reading secrets:

```bash
python3 - <<'PY'
import os
p = os.path.expanduser('~/.local/share/agent-runtime/venv/bin/python')
print('venv:', p)
print('target:', os.path.realpath(p))
PY
codesign -dvvv "$HOME/.local/share/agent-runtime/venv/bin/python" 2>&1 | egrep 'Identifier|Signature|TeamIdentifier|CDHash' || true
```

Interpretation:

- `Signature=adhoc` and `TeamIdentifier=not set` mean the executable is a candidate for update-related TCC churn.
- A stable Developer ID `TeamIdentifier` is better, but does not prove every permission category is inherited or persistent.
- Test the actual protected operation after an update, rather than inferring from the wrapper path.

## Recommendation shape

Recommend CLI migration when the goal is to reduce GUI-runtime permission churn. State the remaining limitation explicitly: helper-process permissions may still need separate grants. For maximum stability, use CLI for terminal/file work and invoke GUI automation only when needed. Keep the prior runtime available for rollback until the CLI workflow has been exercised.
