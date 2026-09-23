# Agent services on macOS: launchd and test-environment notes

## Reusable launchd verification sequence

For an already-installed user service, do not invent a second label.

```bash
LABEL=com.example.service
UID_NUM="$(id -u)"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
plutil -lint "$PLIST"
launchctl print "gui/${UID_NUM}/${LABEL}"
lsof -nP -iTCP:<port> -sTCP:LISTEN
curl -fsS http://127.0.0.1:<port>/health
```

When replacing the checkout behind a running LaunchAgent:

- keep password/token material in the existing secret-adjacent env file;
- update only the executable path and working directory;
- validate the plist before loading;
- verify `ps` shows the new source path, not just that the port is open;
- verify the bind address is `127.0.0.1` or another explicitly intended private address.

On macOS, `launchctl bootstrap` can return an unhelpful I/O error even when the plist is valid and the job is no longer loaded. After confirming `launchctl print` reports no service, the legacy command is a useful fallback:

```bash
launchctl load -w "$PLIST"
launchctl print "gui/${UID_NUM}/${LABEL}"
```

Do not treat a live port alone as proof of a successful replacement. Check the process command path and fresh service logs.

## Venv dependency-probe contamination

A repository test wrapper may run under a repository `.venv` while inherited
`PYTHONPATH` or `AGENT_RUNTIME_DIR` exposes packages from another runtime venv.
The wrapper's `importlib.util.find_spec` probe can then skip installation even
though a child subprocess with a clean environment cannot import the package.

Diagnostic:

```bash
env -u PYTHONPATH -u AGENT_RUNTIME_DIR \
  .venv/bin/python - <<'PY'
import yaml, sys
print(sys.executable)
print(yaml.__file__)
PY
```

Repair the target venv, not the application runtime venv:

```bash
env -u PYTHONPATH -u AGENT_RUNTIME_DIR \
  .venv/bin/python -m pip install -r requirements-dev.txt
```

Then rerun the project's canonical wrapper. If a failing test passes in isolation after this repair but fails in the full suite, investigate shared module/cache/env pollution and platform-conditioned fixture assumptions before changing product code.
