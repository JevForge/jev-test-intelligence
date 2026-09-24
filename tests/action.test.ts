import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAction, type ActionIO } from '../src/action/main.js';

function workspaceWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'jev-ti-action-'));
  for (const [relative, content] of Object.entries(files)) {
    const full = join(root, relative);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function createIo(workspace: string, overrides: Partial<ActionIO> = {}): ActionIO & {
  outputs: Record<string, string>;
  failed?: string;
} {
  const outputs: Record<string, string> = {};
  const io: ActionIO & { outputs: Record<string, string>; failed?: string } = {
    outputs,
    inputs: {
      config_path: '.jev/test-intelligence.yml',
      changed_paths: 'src/auth/login.ts',
      decision_mode: 'deterministic',
      dry_run: 'true',
      discover_frameworks: 'true',
      force_full_suite: 'false',
      ...((overrides.inputs as Record<string, string> | undefined) ?? {}),
    },
    env: {},
    workspace,
    eventName: 'push',
    payload: {},
    repo: { owner: 'JevForge', repo: 'demo' },
    fetch: globalThis.fetch.bind(globalThis),
    info: () => undefined,
    warning: () => undefined,
    setOutput: (name, value) => {
      outputs[name] = value;
    },
    setFailed: message => {
      io.failed = message;
    },
    summary: () => undefined,
    ...overrides,
  };
  return io;
}

describe('action integration', () => {
  it('emits selected groups in deterministic mode', async () => {
    const workspace = workspaceWith({
      '.jev/test-intelligence.yml': `
version: 1
groups:
  - id: unit
    paths: [src/**]
    command: npm test
  - id: e2e
    paths: [e2e/**]
    needs: [unit]
components:
  - name: auth
    paths: [src/auth/**]
    groups: [unit, e2e]
`,
      'package.json': JSON.stringify({
        scripts: { test: 'vitest run' },
        devDependencies: { vitest: '3.0.0' },
      }),
      'vitest.config.ts': 'export default {}',
    });
    const io = createIo(workspace);
    await runAction(io);
    expect(io.failed).toBeUndefined();
    expect(JSON.parse(io.outputs.selected_test_groups!)).toEqual(['unit', 'e2e']);
    expect(io.outputs.full_suite).toBe('true');
    expect(JSON.parse(io.outputs.frameworks_detected!)).toContain('vitest');
    expect(JSON.parse(io.outputs.commands!).unit).toBe('npm test');
    expect(JSON.parse(io.outputs.recommended_command!)).toEqual({ unit: 'npm test' });
  });

  it('force_full_suite selects every group', async () => {
    const workspace = workspaceWith({
      '.jev/test-intelligence.yml': `
version: 1
groups:
  - id: unit
    paths: [src/**]
  - id: docs
    paths: [docs/**]
`,
    });
    const io = createIo(workspace, {
      inputs: {
        config_path: '.jev/test-intelligence.yml',
        changed_paths: 'docs/readme.md',
        decision_mode: 'deterministic',
        force_full_suite: 'true',
        dry_run: 'true',
        discover_frameworks: 'false',
      },
    });
    await runAction(io);
    expect(io.outputs.decision).toBe('RUN_ALL');
    expect(JSON.parse(io.outputs.selected_test_groups!)).toEqual(['unit', 'docs']);
  });
});
