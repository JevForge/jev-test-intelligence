import { describe, expect, it, vi } from 'vitest';
import {
  fetchActionHistory,
  parseHistoryGroupIdMap,
  resolveFailedGroupIds,
} from '../src/collectors/history.js';

describe('history group id map', () => {
  it('parses name→id maps and rejects invalid JSON', () => {
    expect(parseHistoryGroupIdMap('{"Unit tests":"unit"}')).toEqual({ 'Unit tests': 'unit' });
    expect(() => parseHistoryGroupIdMap('{')).toThrow(/not valid JSON/);
    expect(() => parseHistoryGroupIdMap('[]')).toThrow(/JSON object/);
  });

  it('resolves failed jobs through allowlist and name map', () => {
    const failed = resolveFailedGroupIds(
      [
        { name: 'Unit tests', conclusion: 'failure' },
        { name: 'docs', conclusion: 'success' },
        { name: 'e2e', conclusion: 'timed_out' },
      ],
      new Set(['unit', 'e2e']),
      { 'Unit tests': 'unit' },
    );
    expect(failed.sort()).toEqual(['e2e', 'unit']);
  });
});

describe('fetchActionHistory', () => {
  it('loads failed groups from Actions API pages', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/actions/runs?')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              workflow_runs: [{ id: 11, head_branch: 'main', conclusion: 'failure' }],
            };
          },
        } as Response;
      }
      if (String(url).includes('/jobs')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { jobs: [{ name: 'unit', conclusion: 'failure' }] };
          },
        } as Response;
      }
      return { ok: false, status: 404, async json() { return {}; } } as Response;
    });

    const runs = await fetchActionHistory({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      token: 't',
      owner: 'JevForge',
      repo: 'demo',
      lookback: 5,
      timeoutMs: 5000,
      allowlist: ['unit'],
    });
    expect(runs).toEqual([
      { head_branch: 'main', conclusion: 'failure', failed_groups: ['unit'] },
    ]);
  });
});
