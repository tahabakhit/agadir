---
name: macos-system-administration
description: macOS system administration for headless/remote setups — TCC/PPPC permissions, Python consolidation, shell environment (bash vs zsh PATH), LaunchAgents, and configuration profiles.
metadata:
  created_by: "agent"
  version: "1.0.0"
  triggers: "macOS permission prompts blocking headless operation; grant permissions to macOS app; Python installation consolidation on macOS; macOS PATH shell environment issues; LaunchAgent launchd configuration; mobileconfig configuration profile creation; fix python on mac"
---

# macOS System Administration

Administrative patterns for headless or remotely managed Apple Silicon Macs running current macOS releases.

## Core principles

- The Mac runs headless (remote/VNC only). Avoid solutions that require clicking GUI dialogs.
- Many unattended agent terminal tools use **bash** (not zsh). Bash configs (`.bashrc`, `.bash_profile`, `BASH_ENV`) matter for those sessions; zsh configs (`.zshenv`, `.zshrc`) matter for interactive terminals.
- Privilege escalation may be unavailable from unattended sessions. Keep a `cleanup-*.sh` script ready for an attended maintenance window.
- Prefer configuration profiles (`.mobileconfig`) over manual System Settings clicks. They are reproducible and scriptable.
- SIP stays enabled. Do not suggest disabling it.

## Python environment

### Canonical layout

A managed Mac should have exactly ONE system Python:

| Python | Path | Purpose |
|---|---|---|
| Homebrew 3.14.x | `/opt/homebrew/bin/python3` | Sole system Python (managed by brew) |
| Apple system | `/usr/bin/python3` | Ignore — Apple stub, needed by OS |
| UV-managed Python | `~/.local/share/uv/python/` | Runtime dependency (do not touch without owner approval) |

### Consolidation checklist

When python.org framework installs pollute the system:

1. Remove framework symlinks from `/usr/local/bin/` (sudo)
2. Remove framework directories from `/Library/Frameworks/Python.framework/Versions/` (sudo)
3. Remove free-threaded framework directories from `/Library/Frameworks/PythonT.framework/Versions/` (sudo)
4. Remove Applications symlinks like `/Applications/Python 3.14/` (sudo)
5. Fix PATH ordering so Homebrew wins over Apple system Python
6. Verify: `which python3` resolves to `/opt/homebrew/bin/python3`

See `references/python-consolidation.md` for detailed steps.

### PATH ordering (bash)

An unattended agent terminal may run `bash -c`, not zsh. To ensure Homebrew Python wins:

1. Set `BASH_ENV=$HOME/.bashrc` via `launchctl setenv` (needed for GUI-launched processes)
2. Create a LaunchAgent at `~/Library/LaunchAgents/<your-launch-agent-label>.plist` to persist `BASH_ENV` across reboots
3. `~/.bashrc` should prepend `/opt/homebrew/bin` to PATH
4. `~/.bash_profile` should source `~/.bashrc`

See `templates/bash-env-launchagent.plist` for the LaunchAgent boilerplate.

## TCC/PPPC permissions

### The problem

macOS TCC (Transparency, Consent, and Control) pops GUI dialogs for new apps requesting Full Disk Access, Accessibility, Automation, etc. When running headless, these dialogs are invisible and time out, causing silent failures.

### The solution: PPPC configuration profile

Create a `.mobileconfig` file with a `com.apple.TCC.configuration-profile-policy` payload. Install with:

```bash
sudo profiles install -path <file>.mobileconfig
```

### GUI app versus CLI TCC identities

A GUI agent application and its CLI or helper processes must not be assumed to
share one macOS permission identity. A replacement or update can change the
code signature or executable path and cause TCC to require re-approval.

Do **not** promise that moving work to a CLI solves all permission churn. CLI
work launched through a permitted terminal is often more stable than a GUI
runtime, but protected helpers can have separate TCC attribution.

Before deciding that a migration solves permission churn, inspect the actual
binaries used by the installation:

```bash
command -v agent-cli || true
command -v protected-helper || true
realpath "$(command -v protected-helper)" 2>/dev/null || true
codesign -dvvv "$(realpath "$(command -v protected-helper)")" 2>&1 | egrep 'Identifier|Signature|TeamIdentifier|CDHash' || true
```

Interpretation:
- A stable Apple Developer ID `TeamIdentifier` is preferable for helpers that request TCC permissions.
- An ad-hoc signed helper (`Signature=adhoc`, `TeamIdentifier=not set`) is a candidate for update-related re-approval, not proof that re-approval will occur every time.
- A report about one helper is evidence to investigate, not sufficient evidence to generalize to every CLI operation.

For an ad-hoc signed GUI app in a PPPC profile, use `path` IdentifierType with
a stable bundle identifier as the CodeRequirement when supported by the
application's signing identity. Re-install the profile after updates when the
path or identifier changes.

See `references/agent-cli-tcc.md` for the evidence-based GUI/CLI/helper
 distinction and migration verification checklist.

See `templates/tcc-pppc.mobileconfig` for the canonical profile template.

### Permissions to grant for headless operation

| Permission | Apps | Purpose |
|---|---|---|
| SystemPolicyAllFiles (FDA) | Terminal.app, approved agent app, Python binaries | File I/O anywhere, inherited by subprocesses |
| Accessibility | Approved agent app | GUI automation, clicking, typing, screenshots |
| DeveloperTool | Terminal.app, approved agent app | Prevent Gatekeeper prompts |

### Bundle ID vs path anchoring

- **bundleID**: Stable for Apple-signed apps (Terminal.app). Use `identifier "com.apple.Terminal" and anchor apple`.
- **path**: Required for ad-hoc signed apps and some Homebrew binaries. Use a stable bundle identifier as CodeRequirement when supported.

### Getting code requirements

```bash
codesign -dr - /path/to/binary.app
```

For bundleID apps, this returns a requirement string usable in the profile. For ad-hoc signed, it returns a cdhash that changes on every update.

## Shell environment

### Key fact: unattended agent terminals may use bash

An unattended agent terminal may invoke `/bin/bash -c`, not zsh. Always check
both `.bashrc`/`.bash_profile` and `.zshenv`/`.zshrc` when debugging environment
issues.

### Persisting env vars for GUI apps

`launchctl setenv` only lasts until reboot. For permanent GUI-app environment:
1. Create a LaunchAgent in `~/Library/LaunchAgents/`
2. Use `RunAtLoad` + `LimitLoadToSessionType=Aqua`
3. Load it immediately: `launchctl load ~/Library/LaunchAgents/<name>.plist`

See `templates/bash-env-launchagent.plist`.

## LaunchAgent and venv verification

For an existing headless service, inspect and reuse the current label before creating another one. A safe macOS lifecycle check is:

1. Validate the plist with `plutil -lint`.
2. Load/reload the existing job in the user GUI domain, preserving its secret-adjacent environment file rather than copying secrets into the plist or chat.
3. Verify the actual process command path with `ps`, the listener address with `lsof`, and the application health endpoint with `curl`.
4. Confirm the listener is loopback-only when the service is meant to stay private.
5. If `launchctl bootstrap` returns a vague I/O error after a clean `bootout`, try the legacy `launchctl load -w` path and inspect `launchctl print gui/$(id -u)/<label>` before changing the plist again.

When a repository test wrapper uses an agent venv or inherits `PYTHONPATH`, its dependency probe can falsely report a complete target venv. For clean subprocess tests, remove inherited agent paths while installing/checking dependencies:

```bash
env -u PYTHONPATH -u AGENT_RUNTIME_DIR \
  .venv/bin/python -m pip install -r requirements-dev.txt
```

Then run the repository's canonical test wrapper, not a bare system pytest. Keep environment failures, platform-conditioned fixture assumptions, and real product failures separate.

See `references/launchd-and-venv.md` for the reusable launchd verification sequence and the clean-subprocess venv test pattern.

## Pitfalls

- **Do not suggest disabling SIP.** It is unnecessary for any of these solutions.
- **Do not hardcode Python binary paths in scripts** — use `/usr/bin/env python3` or the Homebrew path.
- **`tccutil` can only reset permissions, not grant them.** Useless for headless setup.
- **Do not use cdhash in mobileconfig for ad-hoc signed apps** unless the user accepts re-installing the profile after every app update.
- **An unattended agent terminal may not be a zsh terminal.** Check `.bashrc` when PATH, virtual-environment, or environment variables do not work.
