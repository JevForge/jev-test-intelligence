import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runAction, type ActionIO } from '../src/action/main.js';

function workspaceWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'jev-ti-main-'));
  for (const [relative, content] of Object.entries(files)) {
    const full = join(root, relative);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function baseConfig(): string {
  return `
version: 1
groups:
  - id: unit
    paths: [src/**]
    command: npm test
    rerun_on_recent_failure: true
  - id: e2e
    paths: [e2e/**]
    needs: [unit]
`;
}

function createIo(
  workspace: string,
  overrides: Partial<ActionIO> & { inputs?: Record<string, string> } = {},
): ActionIO & { outputs: Record<string, string>; failed?: string; warnings: string[]; infos: string[] } {
  const outputs: Record<string, string> = {};
  const warnings: string[] = [];
  const infos: string[] = [];
  const io: ActionIO & {
    outputs: Record<string, string>;
    failed?: string;
    warnings: string[];
    infos: string[];
  } = {
    outputs,
    warnings,
    infos,
    inputs: {
      config_path: '.jev/test-intelligence.yml',
      changed_paths: 'src/a.ts',
      decision_mode: 'deterministic',
      dry_run: 'true',
      discover_frameworks: 'false',
      force_full_suite: 'false',
      ...(overrides.inputs ?? {}),
    },
    env: overrides.env ?? {},
    workspace,
    eventName: overrides.eventName ?? 'push',
    payload: overrides.payload ?? {},
    repo: overrides.repo ?? { owner: 'JevForge', repo: 'demo' },
    fetch: overrides.fetch ?? globalThis.fetch.bind(globalThis),
    info: message => {
      infos.push(message);
    },
    warning: message => {
      warnings.push(message);
    },
    setOutput: (name, value) => {
      outputs[name] = value;
    },
    setFailed: message => {
      io.failed = message;
    },
    summary: () => undefined,
  };
  return io;
}

describe('main action paths', () => {
  it('provisional full suite when Jev gateway key is missing', async () => {
    const workspace = workspaceWith({ '.jev/test-intelligence.yml': baseConfig() });
    const io = createIo(workspace, {
      inputs: {
        config_path: '.jev/test-intelligence.yml',
        changed_paths: 'src/a.ts',
        decision_mode: 'jev',
        low_confidence_policy: 'warn',
        dry_run: 'true',
        discover_frameworks: 'false',
      },
      env: {},
    });
    await runAction(io);
    expect(io.failed).toBeUndefined();
    expect(io.outputs.provisional).toBe('true');
    expect(io.outputs.full_suite).toBe('true');
    expect(JSON.parse(io.outputs.selected_test_groups!)).toEqual(['unit', 'e2e']);
  });

  it('fails the step when dry_run=false and policy is fail', async () => {
    const workspace = workspaceWith({ '.jev/test-intelligence.yml': baseConfig() });
    const io = createIo(workspace, {
      inputs: {
        config_path: '.jev/test-intelligence.yml',
        changed_paths: 'src/a.ts',
        decision_mode: 'jev',
        low_confidence_policy: 'fail',
        dry_run: 'false',
        discover_frameworks: 'false',
      },
    });
    await runAction(io);
    expect(io.failed).toMatch(/Test Intelligence/);
  });

  it('emits telemetry without secrets', async () => {
    const workspace = workspaceWith({ '.jev/test-intelligence.yml': baseConfig() });
    const io = createIo(workspace, {
      inputs: {
        config_path: '.jev/test-intelligence.yml',
        changed_paths: 'src/a.ts',
        decision_mode: 'deterministic',
        telemetry: 'true',
        discover_frameworks: 'false',
      },
    });
    await runAction(io);
    expect(io.infos.some(line => line.includes('jev_test_intelligence_telemetry'))).toBe(true);
  });

  it('collects PR changed paths via GitHub API', async () => {
    const workspace = workspaceWith({ '.jev/test-intelligence.yml': baseConfig() });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      async json() {
        return [{ filename: 'src/auth.ts' }];
      },
    })) as unknown as typeof fetch;
    const io = createIo(workspace, {
      inputs: {
        config_path: '.jev/test-intelligence.yml',
        changed_paths: '',
        decision_mode: 'deterministic',
        discover_frameworks: 'false',
        token: 't',
      },
      eventName: 'pull_request',
      payload: { pull_request: { number: 9 } },
      fetch: fetchImpl,
    });
    await runAction(io);
    expect(JSON.parse(io.outputs.affected_paths!)).toContain('src/auth.ts');
  });

  it('upserts PR comment and creates check run when enabled', async () => {
    const workspace = workspaceWith({ '.jev/test-intelligence.yml': baseConfig() });
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/comments') && (!init || init.method === 'GET' || !init.method)) {
        return { ok: true, status: 200, async text() { return '[]'; } } as Response;
      }
      if (String(url).includes('/comments') && init?.method === 'POST') {
        return { ok: true, status: 201, async text() { return '{}'; } } as Response;
      }
      if (String(url).includes('/checks')) {
        return { ok: true, status: 201 } as Response;
      }
      return { ok: true, status: 200, async text() { return '[]'; }, async json() { return []; } } as Response;
    });
    const io = createIo(workspace, {
      inputs: {
        config_path: '.jev/test-intelligence.yml',
        changed_paths: 'src/a.ts',
        decision_mode: 'deterministic',
        comment_on_github: 'true',
        create_check_run: 'true',
        discover_frameworks: 'false',
        token: 't',
      },
      eventName: 'pull_request',
      payload: { pull_request: { number: 3, head: { sha: 'abcdef1234567' } } },
      env: { GITHUB_SHA: 'abcdef1234567' },
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await runAction(io);
    expect(io.infos.some(line => line.includes('PR comment'))).toBe(true);
    expect(io.infos.some(line => line.includes('Check run'))).toBe(true);
  });

  it('applies history file reruns', async () => {
    const workspace = workspaceWith({
      '.jev/test-intelligence.yml': baseConfig(),
      '.jev/test-history.json': JSON.stringify({
        runs: [{ head_branch: 'main', conclusion: 'failure', failed_groups: ['unit'] }],
      }),
    });
    const io = createIo(workspace, {
      inputs: {
        config_path: '.jev/test-intelligence.yml',
        changed_paths: 'README.md',
        decision_mode: 'deterministic',
        include_history: 'true',
        require_path_hits: 'false',
        discover_frameworks: 'false',
      },
    });
    await runAction(io);
    expect(JSON.parse(io.outputs.history_applied!)).toContain('unit');
    expect(JSON.parse(io.outputs.selected_test_groups!)).toContain('unit');
  });

  it('surfaces config errors via setFailed', async () => {
    const workspace = workspaceWith({
      '.jev/test-intelligence.yml': 'version: 1\ngroups: []\n',
    });
    const io = createIo(workspace, {
      inputs: {
        config_path: '.jev/test-intelligence.yml',
        changed_paths: 'src/a.ts',
        decision_mode: 'deterministic',
        discover_frameworks: 'false',
      },
    });
    await runAction(io);
    expect(io.failed).toMatch(/JEV Test Intelligence/);
  });
});
