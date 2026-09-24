import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@actions/cache', () => ({
  restoreCache: vi.fn(async (paths: string[], key: string) => {
    const payload = store.get(key);
    if (!payload) return undefined;
    mkdirSync(paths[0]!, { recursive: true });
    writeFileSync(join(paths[0]!, 'decision.json'), payload);
    return key;
  }),
  saveCache: vi.fn(async (paths: string[], key: string) => {
    const file = join(paths[0]!, 'decision.json');
    if (!existsSync(file)) throw new Error('missing decision.json');
    store.set(key, readFileSync(file, 'utf8'));
    return 1;
  }),
}));

import { buildCacheKey, fingerprintConfig, saveDecisionCache, tryRestoreDecisionCache } from '../src/decision/cache.js';

describe('decision cache keys', () => {
  it('is stable for the same paths regardless of order and changes when paths differ', () => {
    const groups = [
      {
        id: 'unit',
        paths: ['src/**'],
        needs: [],
        always: false,
        frameworks: [],
        rerunOnRecentFailure: false,
        pathHit: false,
        componentHit: false,
      },
    ];
    const base = {
      sha: 'abcdef1234567890',
      configFingerprint: fingerprintConfig({
        groups,
        lookback: 10,
        minConfidence: 0.7,
        policy: 'warn' as const,
        requirePathHits: true,
        forceFullSuite: false,
      }),
      paths: ['src/a.ts', 'src/b.ts'],
      provider: 'vercel-ai-gateway' as const,
      decisionMode: 'jev' as const,
    };
    const a = buildCacheKey(base);
    const b = buildCacheKey({ ...base, paths: ['src/b.ts', 'src/a.ts'] });
    const c = buildCacheKey({ ...base, paths: ['docs/a.md'] });
    const d = buildCacheKey({
      ...base,
      monorepoPlan: { affected_projects: ['packages/api'] },
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(a.startsWith('jev-ti-v1-')).toBe(true);
  });
});

describe('decision cache Actions integration', () => {
  beforeEach(() => {
    store.clear();
  });

  it('round-trips a decision through restore/save mocks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jev-ti-cache-'));
    const key = 'jev-ti-v1-testkey';
    const result = {
      decision: 'SELECT_GROUPS' as const,
      selectedGroups: ['unit'],
      skippedGroups: ['e2e'],
      confidence: 0.9,
      reasonCodes: ['PATH_MATCH' as const],
      summary: 'ok',
      provisional: false,
      needsReview: false,
      shouldFail: false,
      failureMessage: '',
      historyApplied: [],
      provider: 'vercel-ai-gateway' as const,
      fullSuite: false,
    };
    expect(await saveDecisionCache({ enabled: true, key, cacheDir: dir, result })).toBe(true);
    const restored = await tryRestoreDecisionCache({
      enabled: true,
      key,
      cacheDir: mkdtempSync(join(tmpdir(), 'jev-ti-cache-rest-')),
    });
    expect(restored?.selectedGroups).toEqual(['unit']);
    expect(restored?.fullSuite).toBe(false);
  });
});
