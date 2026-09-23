import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const script = path.join(import.meta.dirname, 'lifecycle.ts');
const git = 'git';
// Every fixture is a disposable temp Git repo with its own HOME and runtime dir.
function fixture() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'pi-lifecycle-')),
    repo = path.join(tmp, 'repo'),
    home = path.join(tmp, 'home');
  mkdirSync(repo);
  mkdirSync(home);
  const g = (...args: string[]) => execFileSync(git, ['-C', repo, ...args], { stdio: 'ignore' });
  g('init', '-q');
  g('config', 'user.name', 'Temporary User');
  g('config', 'user.email', 'temporary@example.invalid');
  writeFileSync(path.join(repo, 'tracked.txt'), 'base\n');
  g('add', '.');
  g('commit', '-qm', 'base');
  const transcript = path.join(tmp, 'session.jsonl');
  writeFileSync(
    transcript,
    JSON.stringify({ type: 'session', id: 'session-1234', cwd: repo }) + '\n',
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    GIT_CONFIG_GLOBAL: '/dev/null',
    PI_SESSION_FILE: transcript,
    PI_SESSION_ID: 'session-1234',
    PI_CODING_AGENT_DIR: path.join(tmp, 'runtime'),
    PI_SESSION_BASELINE_DIR: path.join(tmp, 'runtime', 'baselines'),
    PI_SESSION_GIT: git,
    PI_MODEL: 'test-model',
  };
  delete env.PI_SESSION_LIFECYCLE_CONFIG;
  delete env.PI_REPO_ROOT;
  const branch = () =>
    execFileSync(git, ['-C', repo, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
  return {
    tmp,
    repo,
    home,
    transcript,
    env,
    g,
    branch,
    run: (...args: string[]) =>
      spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env }),
    start: (...extra: string[]) =>
      spawnSync(
        process.execPath,
        [
          script,
          'start',
          '--repo',
          repo,
          '--objective',
          'test',
          '--scope',
          'tracked.txt',
          '--allow',
          'edit files',
          '--validation',
          'true',
          '--stopping-point',
          'review',
          ...extra,
        ],
        { encoding: 'utf8', env },
      ),
  };
}
function records(file: string, paths: string[]) {
  const items: object[] = [
    {
      type: 'message',
      id: 'abandoned-call',
      parentId: null,
      message: {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'abandoned-tool',
            name: 'write',
            arguments: { path: 'abandoned.txt' },
          },
        ],
      },
    },
    {
      type: 'message',
      id: 'abandoned-result',
      parentId: 'abandoned-call',
      message: { role: 'toolResult', toolCallId: 'abandoned-tool', isError: false },
    },
  ];
  paths.forEach((p, i) => {
    items.push({
      type: 'message',
      id: `call-${i}`,
      parentId: i ? `result-${i - 1}` : null,
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: `tool-${i}`, name: 'edit', arguments: { path: p } }],
      },
    });
    items.push({
      type: 'message',
      id: `result-${i}`,
      parentId: `call-${i}`,
      message: { role: 'toolResult', toolCallId: `tool-${i}`, isError: false },
    });
  });
  writeFileSync(
    file,
    readFileSync(file, 'utf8') + items.map((x) => JSON.stringify(x)).join('\n') + '\n',
  );
}

test('start records private baseline, creates branch, excludes dirty files, and close reports direct edits', () => {
  const f = fixture();
  writeFileSync(path.join(f.repo, 'before.txt'), 'preexisting');
  const start = f.start();
  assert.equal(start.status, 0, start.stderr);
  const payload = JSON.parse(start.stdout);
  assert.match(payload.branch, /^agent\/pi-test-model-session-/);
  const baseline = JSON.parse(readFileSync(payload.baseline, 'utf8'));
  assert.equal(statSync(payload.baseline).mode & 0o077, 0);
  assert.deepEqual(baseline.dirty_paths, ['before.txt']);
  assert.deepEqual(baseline.validation_commands, ['true']);
  writeFileSync(path.join(f.repo, 'tracked.txt'), 'changed');
  writeFileSync(path.join(f.repo, 'new.txt'), 'new');
  records(f.transcript, ['tracked.txt', 'new.txt']);
  const close = f.run('close', '--repo', f.repo);
  assert.equal(close.status, 0, close.stderr);
  const report = JSON.parse(close.stdout);
  assert.deepEqual(
    report.evidence_supported_paths,
    ['new.txt', 'tracked.txt'],
    JSON.stringify(report),
  );
  assert.deepEqual(report.excluded_preexisting_paths, ['before.txt']);
  assert.equal(report.owned_paths.length, 0);
  assert.equal(report.adapters.github, 'Skipped — not configured');
  assert.equal(report.adapters.notes, 'Skipped — not configured');
});

test('close refuses a branch other than the recorded session branch', () => {
  const f = fixture(),
    before = f.branch();
  assert.equal(f.start().status, 0);
  f.g('switch', '-q', before);
  const close = f.run('close', '--repo', f.repo);
  assert.equal(close.status, 1);
  assert.match(close.stderr, /does not match baseline/);
});

test('close without a baseline reports reduced confidence and owns nothing', () => {
  const f = fixture();
  records(f.transcript, ['tracked.txt']);
  const close = f.run('close', '--repo', f.repo);
  assert.equal(close.status, 0, close.stderr);
  const report = JSON.parse(close.stdout);
  assert.equal(report.baseline, null);
  assert.match(report.confidence, /^reduced/);
  assert.deepEqual(report.ambiguous_paths, ['tracked.txt']);
  assert.deepEqual(report.owned_paths, []);
});

test('refuses staged changes without switching branch', () => {
  const f = fixture(),
    branch = f.branch();
  writeFileSync(path.join(f.repo, 'staged.txt'), 'staged');
  f.g('add', 'staged.txt');
  const run = f.start();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /pre-existing staged/);
  assert.equal(f.branch(), branch);
});

test('start requires at least one validation command', () => {
  const f = fixture(),
    branch = f.branch();
  const run = f.run(
    'start',
    '--repo',
    f.repo,
    '--objective',
    'test',
    '--scope',
    'x',
    '--allow',
    'edit',
    '--stopping-point',
    'review',
  );
  assert.equal(run.status, 1);
  assert.match(run.stderr, /validation command/);
  assert.equal(f.branch(), branch);
});

test('refuses a symlinked baseline directory or ancestor below HOME', () => {
  for (const kind of ['dir', 'ancestor']) {
    const f = fixture(),
      branch = f.branch(),
      real = path.join(f.home, 'real');
    mkdirSync(real, { mode: 0o700 });
    const link = path.join(f.home, 'link');
    symlinkSync(real, link);
    f.env.PI_SESSION_BASELINE_DIR = kind === 'dir' ? link : path.join(link, 'baselines');
    const run = f.start();
    assert.equal(run.status, 1, kind);
    assert.match(run.stderr, /runtime path is a symlink/, kind);
    assert.equal(f.branch(), branch, kind);
  }
});

test('refuses a baseline directory owned by another user', () => {
  const f = fixture(),
    branch = f.branch();
  // Pretend to be a different uid so the temp runtime dir looks foreign-owned.
  const run = spawnSync(
    process.execPath,
    [
      '--import',
      'data:text/javascript,process.getuid=()=>4242424',
      script,
      'start',
      '--repo',
      f.repo,
      '--objective',
      't',
      '--scope',
      'x',
      '--allow',
      'e',
      '--validation',
      'true',
      '--stopping-point',
      'r',
    ],
    { encoding: 'utf8', env: f.env },
  );
  assert.equal(run.status, 1);
  assert.match(run.stderr, /not owned by the current user/);
  assert.equal(f.branch(), branch);
});

test('inspect finds only successful direct writes on the active branch', () => {
  const f = fixture();
  records(f.transcript, ['written.txt']);
  const inspect = f.run('inspect', '--session', f.transcript);
  assert.equal(inspect.status, 0, inspect.stderr);
  assert.deepEqual(JSON.parse(inspect.stdout).directly_written_paths, [
    path.join(realpathSync(f.repo), 'written.txt'),
  ]);
});

test('config lookup: --config, then env, then the local override file', () => {
  const unsafe = JSON.stringify({ schema: 1, git: { branch_prefix: 'x;y' }, adapters: {} });
  const safe = JSON.stringify({ schema: 1, git: { branch_prefix: 'flag/pi' }, adapters: {} });

  const local = fixture();
  mkdirSync(path.join(local.home, '.config/agadir'), { recursive: true });
  writeFileSync(path.join(local.home, '.config/agadir/session-lifecycle.json'), unsafe);
  const localRun = local.start();
  assert.equal(localRun.status, 1);
  assert.match(localRun.stderr, /branch_prefix is unsafe/);

  const both = fixture(),
    envFile = path.join(both.tmp, 'env.json'),
    flagFile = path.join(both.tmp, 'flag.json');
  writeFileSync(envFile, unsafe);
  writeFileSync(flagFile, safe);
  both.env.PI_SESSION_LIFECYCLE_CONFIG = envFile;
  const flagRun = both.start('--config', flagFile);
  assert.equal(flagRun.status, 0, flagRun.stderr);
  assert.match(JSON.parse(flagRun.stdout).branch, /^flag\/pi-/);
});

test('refuses unsafe or missing config before touching Git', () => {
  const cases: Array<[string, object | null, RegExp]> = [
    [
      'prefix',
      { schema: 1, git: { branch_prefix: 'x;rm -rf' }, adapters: {} },
      /git\.branch_prefix is unsafe/,
    ],
    ['remote', { schema: 1, git: { remote: '../evil' }, adapters: {} }, /git\.remote is unsafe/],
    [
      'notes',
      {
        schema: 1,
        git: {},
        adapters: {
          notes: {
            enabled: true,
            repo: '~/d',
            remote: 'o',
            base_branch: 'main',
            validation_command: 'make',
            intake_dir: '../out',
          },
        },
      },
      /intake_dir/,
    ],
    ['missing', null, /does not exist/],
  ];
  for (const [name, cfg, error] of cases) {
    const f = fixture(),
      file = path.join(f.tmp, `${name}.json`),
      branch = f.branch();
    if (cfg) writeFileSync(file, JSON.stringify(cfg));
    const run = f.start('--config', file);
    assert.equal(run.status, 1, name);
    assert.match(run.stderr, error, name);
    assert.equal(f.branch(), branch, name);
  }
});
