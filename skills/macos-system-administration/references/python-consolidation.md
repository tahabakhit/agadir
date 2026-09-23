# Python Consolidation on macOS

How to clean up multiple Python installations and settle on one system Python (Homebrew) without disturbing project or agent-runtime virtual environments.

## Diagnostic: find all Pythons

```bash
# What's on PATH (in order)?
echo $PATH | tr ':' '\n' | while read dir; do
  for py in "$dir"/python3 "$dir"/python; do
    [ -x "$py" ] && echo "$py -> $(readlink -f "$py" 2>/dev/null || echo "$py")"
  done
done

# All framework installs
ls -d /Library/Frameworks/Python.framework/Versions/*/
ls -d /Library/Frameworks/PythonT.framework/Versions/*/  # free-threaded

# Homebrew
brew list --versions python@3.14

# UV-managed runtime interpreters (do not touch without owner approval)
ls ~/.local/share/uv/python/

# Check venvs for framework dependency
find ~/dev -name "pyvenv.cfg" -exec grep -l "Python.framework" {} \;
```

## Step 1: Remove /usr/local/bin symlinks

The python.org installer creates symlinks in `/usr/local/bin`. Remove them all:

```bash
sudo rm /usr/local/bin/python3* /usr/local/bin/pip3* \
        /usr/local/bin/idle3* /usr/local/bin/pydoc3*
```

After this, `which python3` should fall through to either `/usr/bin/python3` (Apple) or `/opt/homebrew/bin/python3` (Homebrew), depending on PATH order.

## Step 2: Remove framework directories

```bash
# Python.framework (standard)
sudo rm -rf /Library/Frameworks/Python.framework/Versions/3.13
sudo rm -rf /Library/Frameworks/Python.framework/Versions/3.14

# PythonT.framework (free-threaded)
sudo rm -rf /Library/Frameworks/PythonT.framework/Versions/3.13
sudo rm -rf /Library/Frameworks/PythonT.framework/Versions/3.14

# Applications symlinks
sudo rm -rf "/Applications/Python 3.13"
sudo rm -rf "/Applications/Python 3.14"
```

## Step 3: Fix PATH ordering

The goal: `/opt/homebrew/bin` before `/usr/local/bin` and `/usr/bin`.

### System level (for all users)

Create `/etc/paths.d/00-homebrew` so path_helper sorts it first:

```bash
echo "/opt/homebrew/bin" | sudo tee /etc/paths.d/00-homebrew
echo "/opt/homebrew/sbin" | sudo tee -a /etc/paths.d/00-homebrew
```

### User level: bash (unattended agent terminal sessions)

Create `~/.bashrc`:
```bash
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$HOME/.local/bin:$PATH"
[ -f ~/.fzf.bash ] && source ~/.fzf.bash
```

Create `~/.bash_profile`:
```bash
source ~/.bashrc 2>/dev/null || true
```

Set `BASH_ENV` for GUI-launched processes:
```bash
launchctl setenv BASH_ENV "$HOME/.bashrc"
```

Create `~/Library/LaunchAgents/<your-launch-agent-label>.plist` to persist across reboots (see `templates/bash-env-launchagent.plist`).

### User level: zsh (interactive terminal)

Ensure `~/.zshenv` has Homebrew first:
```bash
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$HOME/.local/bin:$PATH"
```

## Step 4: Verify

```bash
# In both bash and zsh (or the agent terminal shell):
which python3        # -> /opt/homebrew/bin/python3
python3 --version    # -> Python 3.14.x
which pip3           # -> /opt/homebrew/bin/pip3

# Check no framework remnants
ls /Library/Frameworks/Python.framework/Versions/  # Should be empty or "Current" symlink only
```

## What NOT to remove

- `/usr/bin/python3` — Apple's system Python. Required by macOS. Just ensure Homebrew comes first in PATH.
- `~/.local/share/uv/python/` — UV-managed Python interpreters used by project or agent-runtime virtual environments.
- Project and agent-runtime virtual environments — preserve them unless the owning workflow explicitly approves replacement.

## If a project venv breaks after consolidation

The venv was likely created with a framework Python. Recreate it:

```bash
cd project-dir
rm -rf .venv
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Homebrew Python should already have common packages installed globally (boto3, requests, etc.) but venvs are isolated by design — they need their own installs.
