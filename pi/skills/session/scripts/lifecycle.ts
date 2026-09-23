#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
  readlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

type Json = Record<string, any>;
const expandHome = (p: string) =>
  p === '~' || p.startsWith('~/') ? path.join(homedir(), p.slice(1)) : p;
const helper =
  /^\[(?:scout|worker|reviewer|fast-reviewer|researcher|adversarial-reviewer|escalation-architect)\]/;
class LifecycleError extends Error {}
const fail = (message: string): never => {
  throw new LifecycleError(message);
};
const gitBin = process.env.PI_SESSION_GIT || 'git';
function git(repo: string, ...args: string[]): string {
  try {
    return execFileSync(gitBin, ['-C', repo, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (e: any) {
    fail(`git ${args.join(' ')} failed: ${(e.stderr || e.message).toString().trim()}`);
  }
}
function tryGit(repo: string, ...args: string[]): string | null {
  try {
    return (
      execFileSync(gitBin, ['-C', repo, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || null
    );
  } catch {
    return null;
  }
}
function readJsonLines(file: string): Json[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line) => {
      try {
        const x = JSON.parse(line);
        return x && typeof x === 'object' ? [x] : [];
      } catch {
        return [];
      }
    });
}
function identity() {
  const file = process.env.PI_SESSION_FILE,
    id = process.env.PI_SESSION_ID;
  if (!file || !id || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id))
    fail('PI_SESSION_FILE and a safe PI_SESSION_ID are required');
  if (!existsSync(file) || lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile())
    fail(`PI_SESSION_FILE is not a regular file: ${file}`);
  const records = readJsonLines(file),
    header = records.find((x) => x.type === 'session');
  if (header?.id !== id)
    fail(
      'session transcript is missing its required session header ID or does not match PI_SESSION_ID',
    );
  const name = records.filter((x) => x.type === 'session_info').at(-1)?.name || '';
  if (name.startsWith('om-') || helper.test(name))
    fail('session lifecycle is disabled for helper and memory sessions');
  return { file: realpathSync(file), id, header, records };
}
// Lookup: --config, then PI_SESSION_LIFECYCLE_CONFIG, then the local override,
// then the bundled config.json (adapters disabled).
function config(flag?: string) {
  const configured = flag || process.env.PI_SESSION_LIFECYCLE_CONFIG;
  const local = path.join(homedir(), '.config/agadir/session-lifecycle.json');
  const cfg = configured
    ? expandHome(configured)
    : existsSync(local)
      ? local
      : path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'config.json');
  if (!existsSync(cfg)) {
    if (configured) fail(`configured lifecycle file does not exist: ${cfg}`);
    return { schema: 1, git: {}, adapters: {} };
  }
  let value: Json;
  try {
    value = JSON.parse(readFileSync(cfg, 'utf8'));
  } catch (e: any) {
    fail(`invalid lifecycle config ${cfg}: ${e.message}`);
  }
  return validateConfig(value!, cfg);
}
// Git refs and branch names come from config; keep them to plain ref characters.
const safeRef = (v: unknown) =>
  typeof v === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(v) &&
  !v.includes('..') &&
  !v.includes('//') &&
  !v.endsWith('/');
function validateConfig(value: Json, source: string): Json {
  const bad = (what: string): never => fail(`lifecycle config ${what}: ${source}`);
  if (value?.schema !== 1 || typeof value.git !== 'object' || typeof value.adapters !== 'object')
    bad('has an unsupported shape');
  for (const key of ['remote', 'base_branch', 'branch_prefix'])
    if (value.git[key] != null && !safeRef(value.git[key])) bad(`git.${key} is unsafe`);
  const github = value.adapters.github ?? {};
  if (github.enabled === true && !(typeof github.command === 'string' && github.command.trim()))
    bad('enables GitHub without a command');
  const notes = value.adapters.notes ?? {};
  if (notes.enabled === true) {
    for (const key of ['repo', 'remote', 'base_branch', 'validation_command', 'intake_dir'])
      if (!(typeof notes[key] === 'string' && notes[key].trim()))
        bad(`enables the notes adapter without ${key}`);
    if (!safeRef(notes.remote) || !safeRef(notes.base_branch))
      bad('has an unsafe notes remote or branch');
    if (path.isAbsolute(notes.intake_dir) || notes.intake_dir.split(/[\\/]/).includes('..'))
      bad('has a notes intake_dir that is absolute or escapes the repo');
  }
  return value;
}
function repoRoot(repo?: string) {
  return realpathSync(
    git(
      repo || process.env.PI_REPO_ROOT || identity().header.cwd || process.cwd(),
      'rev-parse',
      '--show-toplevel',
    ),
  );
}
function status(root: string): Json[] {
  const raw = execFileSync(gitBin, [
    '-C',
    root,
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ]);
  const parts = raw.toString('utf8').split('\0'),
    out: Json[] = [];
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    if (!s) continue;
    const xy = s.slice(0, 2),
      entry: Json = { path: s.slice(3), index: xy[0], worktree: xy[1] };
    if (xy.includes('R') || xy.includes('C')) entry.original_path = parts[++i];
    out.push(entry);
  }
  return out;
}
function hashPath(root: string, rel: string): string | null {
  try {
    const p = path.join(root, rel),
      st = lstatSync(p),
      bytes = st.isSymbolicLink() ? Buffer.from(`symlink:${readlinkSync(p)}`) : readFileSync(p);
    return createHash('sha256').update(bytes).digest('hex');
  } catch {
    return null;
  }
}
function details(root: string, remote = 'origin') {
  const st = status(root).map((x) => ({
    ...x,
    worktree_sha256: hashPath(root, x.path),
    index_sha256: (() => {
      try {
        return createHash('sha256')
          .update(execFileSync(gitBin, ['-C', root, 'show', `:${x.path}`]))
          .digest('hex');
      } catch {
        return null;
      }
    })(),
  }));
  return {
    repo_root: root,
    head: tryGit(root, 'rev-parse', 'HEAD'),
    branch: tryGit(root, 'branch', '--show-current'),
    upstream: tryGit(root, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'),
    default_branch: tryGit(
      root,
      'symbolic-ref',
      '--quiet',
      '--short',
      `refs/remotes/${remote}/HEAD`,
    ),
    remotes: (tryGit(root, 'remote') || '').split('\n').filter(Boolean),
    status: st,
  };
}
function baselineDir(root: string, create: boolean) {
  const configured = process.env.PI_SESSION_BASELINE_DIR
    ? expandHome(process.env.PI_SESSION_BASELINE_DIR)
    : path.join(
        process.env.PI_CODING_AGENT_DIR || path.join(homedir(), '.pi/agent'),
        'session-lifecycle/baselines',
      );
  if (!path.isAbsolute(configured)) fail('PI_SESSION_BASELINE_DIR must be absolute');
  const raw = path.resolve(configured);
  if (raw === root || raw.startsWith(root + path.sep))
    fail('session baseline runtime must be outside the repository');
  refuseSymlinks(raw);
  if (create) {
    mkdirSync(raw, { recursive: true, mode: 0o700 });
    refuseSymlinks(raw);
    if (ownedByOther(raw)) fail(`runtime directory is not owned by the current user: ${raw}`);
    chmodSync(raw, 0o700);
  }
  if (existsSync(raw)) {
    if ((lstatSync(raw).mode & 0o077) !== 0) fail(`runtime directory is not private: ${raw}`);
    if (ownedByOther(raw)) fail(`runtime directory is not owned by the current user: ${raw}`);
  }
  return raw;
}
// Refuse a symlinked baseline directory, or a symlinked ancestor below HOME.
function refuseSymlinks(dir: string) {
  const home = path.resolve(homedir()) + path.sep;
  for (let p = dir; p === dir || p.startsWith(home); p = path.dirname(p)) {
    let link = false;
    try {
      link = lstatSync(p).isSymbolicLink();
    } catch {}
    if (link) fail(`runtime path is a symlink: ${p}`);
    if (p === path.dirname(p)) break;
  }
}
const ownedByOther = (p: string) =>
  typeof process.getuid === 'function' && lstatSync(p).uid !== process.getuid();
function baselinePath(id: string, root: string, create: boolean) {
  return path.join(baselineDir(root, create), `${id}.json`);
}
function activeRecords(records: Json[]) {
  const entries = new Map(records.filter((x) => typeof x.id === 'string').map((x) => [x.id, x]));
  let cursor = records
      .slice()
      .reverse()
      .find((x) => x.type !== 'session' && typeof x.id === 'string')?.id,
    active = new Set<string>();
  while (cursor && !active.has(cursor)) {
    active.add(cursor);
    cursor = entries.get(cursor)?.parentId;
  }
  return records.filter((x) => x.type === 'session' || active.has(x.id));
}
function writeEvidence(transcript: string, root: string, after = 0) {
  const records = readJsonLines(transcript),
    active = activeRecords(records),
    activeIds = new Set(active.map((x) => x.id)),
    calls = new Map<string, Json>(),
    done = new Set<string>();
  let offset = 0;
  for (const line of readFileSync(transcript, 'utf8').split('\n')) {
    if (!line) continue;
    let r: Json;
    try {
      r = JSON.parse(line);
    } catch {
      offset += Buffer.byteLength(line) + 1;
      continue;
    }
    const m = r.message || {};
    if (r.type === 'message' && activeIds.has(r.id) && m.role === 'assistant' && offset >= after)
      for (const part of m.content || []) if (part.type === 'toolCall') calls.set(part.id, part);
    if (r.type === 'message' && activeIds.has(r.id) && m.role === 'toolResult' && !m.isError)
      done.add(m.toolCallId);
    offset += Buffer.byteLength(line) + 1;
  }
  const cwdValue = records.find((x) => x.type === 'session')?.cwd || root,
    cwd = realpathSync(cwdValue),
    out = new Set<string>();
  for (const id of done) {
    const c = calls.get(id);
    if (!c || !['write', 'edit'].includes(c.name) || typeof c.arguments?.path !== 'string')
      continue;
    const p = path.resolve(cwd, c.arguments.path);
    if (p.startsWith(root + path.sep)) out.add(path.relative(root, p));
  }
  return [...out].sort();
}
function start(args: any) {
  const { file, id } = identity(),
    objective = args.objective || '';
  if (
    !objective.trim() ||
    !args.scope?.some((x: string) => x.trim()) ||
    !args.allow?.some((x: string) => x.trim()) ||
    !args.validation?.some((x: string) => x.trim()) ||
    !args['stopping-point']?.trim()
  )
    fail(
      'objective, at least one scope, allowed mutation, validation command, and stopping point are required',
    );
  const root = repoRoot(args.repo),
    cfg = config(args.config),
    d = details(root, cfg.git.remote || 'origin');
  if (!d.head || !d.branch)
    fail('session-start requires an existing HEAD commit and attached Git branch');
  const staged = d.status.filter((x) => x.index !== ' ' && x.index !== '?').map((x) => x.path);
  if (staged.length)
    fail(`pre-existing staged changes cannot be safely isolated: ${staged.join(', ')}`);
  const bp = baselinePath(id, root, true);
  if (existsSync(bp)) fail(`baseline already exists for this session: ${bp}`);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/T/, '-').slice(0, 15),
    model = process.env.PI_MODEL || process.env.PI_MODEL_ID || 'unknown';
  const slug =
    (process.env.PI_MODEL || process.env.PI_MODEL_ID || 'pi-agent')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'pi-agent';
  const branch = `${cfg.git.branch_prefix || 'agent/pi'}-${slug}-${id.slice(0, 8)}-${stamp}`;
  if (tryGit(root, 'show-ref', '--verify', `refs/heads/${branch}`))
    fail(`session branch already exists: ${branch}`);
  git(root, 'switch', '-c', branch);
  const payload = {
    schema: 1,
    created_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    session_id: id,
    session_file: file,
    session_kind: 'human',
    transcript_boundary_bytes: lstatSync(file).size,
    model,
    objective: objective.trim(),
    issue: args.issue || null,
    scope: args.scope.map((x: string) => x.trim()).filter(Boolean),
    allowed_mutations: args.allow.map((x: string) => x.trim()).filter(Boolean),
    validation_commands: args.validation.map((x: string) => x.trim()).filter(Boolean),
    stopping_point: args['stopping-point'].trim(),
    repo_root: root,
    head: d.head,
    branch_before: d.branch,
    branch,
    upstream: d.upstream,
    default_branch: d.default_branch,
    remotes: d.remotes,
    status: d.status,
    dirty_paths: [
      ...new Set(d.status.flatMap((x: Json) => [x.path, x.original_path].filter(Boolean))),
    ].sort(),
    baseline: {
      staged: d.status.filter((x) => x.index !== ' ' && x.index !== '?'),
      unstaged: d.status.filter((x) => x.worktree !== ' '),
    },
    config: cfg,
  };
  try {
    const temp = `${bp}.${randomUUID()}`;
    writeFileSync(temp, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    chmodSync(temp, 0o600);
    renameSync(temp, bp);
  } catch (e) {
    git(root, 'switch', d.branch);
    git(root, 'branch', '-D', branch);
    throw e;
  }
  return { baseline: bp, branch, repo_root: root, excluded_preexisting: payload.dirty_paths };
}
function commandExists(command: string) {
  return (process.env.PATH || '')
    .split(path.delimiter)
    .some((dir) => existsSync(path.join(dir, command)));
}
function adapterStatuses(cfg: Json) {
  const out: Json = {};
  for (const name of ['github', 'notes']) {
    const item = { ...(cfg.adapters?.[name] || {}) };
    if (typeof item.repo === 'string') item.repo = expandHome(item.repo);
    if (item.enabled !== true) out[name] = 'Skipped — not configured';
    else if (name === 'github' && !commandExists(item.command || 'gh'))
      out[name] = 'Blocked — configured gh command is unavailable';
    else if (
      name === 'notes' &&
      (!item.repo || !existsSync(item.repo) || !tryGit(item.repo, 'rev-parse', '--git-dir'))
    )
      out[name] = 'Blocked — configured notes repository is unavailable';
    else if (name === 'notes' && !tryGit(item.repo, 'remote', 'get-url', item.remote))
      out[name] = 'Blocked — configured notes remote is unavailable';
    else out[name] = 'Configured — perform only the explicit workflow steps';
  }
  return out;
}
function close(args: any) {
  const { file, id } = identity(),
    root = repoRoot(args.repo),
    bp = baselinePath(id, root, false);
  if (!existsSync(bp)) {
    const evidence = writeEvidence(file, root),
      cfg = config(args.config);
    return {
      baseline: null,
      confidence: 'reduced — no matching baseline; confirmation required',
      session_id: id,
      owned_paths: [],
      changed_after_baseline_paths: [],
      excluded_preexisting_paths: [],
      ambiguous_paths: evidence,
      fallback_evidence_paths: evidence,
      fallback_reason: `no matching session baseline: ${bp}`,
      effective_config: cfg,
      config_source: 'close-time configuration (no baseline)',
      git_targets: { remote: null, base_branch: null },
      adapters: adapterStatuses(cfg),
    };
  }
  if (
    lstatSync(bp).isSymbolicLink() ||
    !lstatSync(bp).isFile() ||
    (lstatSync(bp).mode & 0o777) !== 0o600 ||
    ownedByOther(bp)
  )
    fail(`baseline is not a private regular file owned by the current user: ${bp}`);
  const base = JSON.parse(readFileSync(bp, 'utf8'));
  if (
    base.session_id !== id ||
    realpathSync(base.session_file) !== file ||
    realpathSync(base.repo_root) !== root
  )
    fail('session baseline identity does not match current session/repository');
  if (git(root, 'branch', '--show-current') !== base.branch)
    fail(
      `active session branch does not match baseline (${git(root, 'branch', '--show-current')} != ${base.branch})`,
    );
  validateConfig(base.config, 'session baseline');
  if (!tryGit(root, 'cat-file', '-t', `${base.head}^{commit}`))
    fail(`baseline HEAD is not an available commit: ${base.head}`);
  const changed = new Set(status(root).flatMap((x) => [x.path, x.original_path].filter(Boolean)));
  for (const p of git(root, 'diff', '--name-only', '-z', base.head, 'HEAD')
    .split('\0')
    .filter(Boolean))
    changed.add(p);
  const dirty = new Set(base.dirty_paths),
    candidates = [...changed].filter((x) => !dirty.has(x)).sort(),
    evidence = new Set(writeEvidence(file, root, base.transcript_boundary_bytes));
  const supported = candidates.filter((x) => evidence.has(x)),
    ambiguous = candidates.filter((x) => !evidence.has(x));
  return {
    confidence: ambiguous.length ? 'mixed — confirmation required' : 'direct tool evidence',
    repo_root: root,
    session_id: id,
    baseline_branch: base.branch,
    current_branch: base.branch,
    owned_paths: [],
    evidence_supported_paths: supported,
    changed_after_baseline_paths: candidates,
    excluded_preexisting_paths: [...changed].filter((x) => dirty.has(x)).sort(),
    ambiguous_paths: ambiguous,
    current_status: status(root),
    effective_config: base.config,
    baseline: bp,
    config_source: 'session baseline',
    git_targets: {
      remote: base.config.git?.remote || base.remotes[0] || null,
      base_branch: base.config.git?.base_branch || base.default_branch || null,
    },
    adapters: adapterStatuses(base.config),
  };
}
function inspect(args: any) {
  const file = args.session || process.env.PI_SESSION_FILE;
  if (!file) fail('--session is required when PI_SESSION_FILE is unset');
  const records = readJsonLines(file),
    header = records.find((x) => x.type === 'session') || {},
    active = activeRecords(records),
    calls = new Map<string, Json>(),
    done = new Set<string>(),
    user: string[] = [],
    assistant: string[] = [],
    mutating: string[] = [];
  for (const r of active) {
    const m = r.message || {};
    if (m.role === 'user' || m.role === 'assistant') {
      const text = (m.content || [])
        .filter((p: Json) => p.type === 'text' && p.text)
        .map((p: Json) => p.text)
        .join('\n');
      if (text) (m.role === 'user' ? user : assistant).push(text);
    }
    if (m.role === 'assistant')
      for (const p of m.content || []) if (p.type === 'toolCall') calls.set(p.id, p);
    if (m.role === 'toolResult' && !m.isError) done.add(m.toolCallId);
  }
  const cwd = realpathSync(header.cwd || process.cwd()),
    paths = new Set<string>();
  for (const [id, c] of calls) {
    if (done.has(id) && ['write', 'edit'].includes(c.name) && c.arguments?.path)
      paths.add(path.resolve(cwd, c.arguments.path));
    if (
      c.name === 'bash' &&
      /\bgit(?:\s+-C\s+\S+)?\s+(?:add|commit|push|switch|checkout|merge|rebase|reset|restore|clean|cherry-pick|revert|tag|branch\s+-(?:d|D|m|M))\b/.test(
        c.arguments?.command || '',
      )
    )
      mutating.push(c.arguments.command);
  }
  const name = records.filter((x) => x.type === 'session_info').at(-1)?.name || null;
  return {
    session_file: path.resolve(file),
    session_id: header.id || process.env.PI_SESSION_ID,
    started_at: header.timestamp,
    cwd,
    session_name: name,
    session_kind: name?.startsWith('om-')
      ? 'memory'
      : name && helper.test(name)
        ? 'helper'
        : 'human',
    active_leaf_id:
      records
        .slice()
        .reverse()
        .find((x) => x.type !== 'session' && x.id)?.id || null,
    directly_written_paths: [...paths].sort(),
    mutating_git_commands: mutating,
    user_message_count: user.length,
    assistant_text_message_count: assistant.length,
    last_user_text: user.at(-1) || '',
    last_assistant_text: assistant.at(-1) || '',
  };
}
function main() {
  const action = process.argv[2];
  try {
    if (action === 'inspect') {
      const { values } = parseArgs({
        args: process.argv.slice(3),
        options: { session: { type: 'string' } },
      });
      console.log(JSON.stringify(inspect(values), null, 2));
      return;
    }
    if (!['start', 'close'].includes(action))
      fail('usage: node lifecycle.ts <start|close|inspect> [options]');
    const { values } = parseArgs({
      args: process.argv.slice(3),
      options: {
        objective: { type: 'string', default: '' },
        issue: { type: 'string' },
        scope: { type: 'string', multiple: true, default: [] },
        allow: { type: 'string', multiple: true, default: [] },
        validation: { type: 'string', multiple: true, default: [] },
        'stopping-point': { type: 'string', default: '' },
        repo: { type: 'string' },
        config: { type: 'string' },
      },
    });
    console.log(JSON.stringify(action === 'start' ? start(values) : close(values), null, 2));
  } catch (e: any) {
    console.error(`${action === 'start' ? 'session-start' : 'session-close'}: ${e.message}`);
    process.exitCode = 1;
  }
}
main();
