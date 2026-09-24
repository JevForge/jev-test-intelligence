import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createJevProvider, credentialEnvName } from '../src/jev/factory.js';
import { decisionFromEvaluation, unavailableDecision } from '../src/jev/normalize.js';
import { executeIntelligence } from '../src/decision/execute.js';
import { buildEvidence, buildGroupQuestions } from '../src/decision/evidence.js';
import { buildCacheKey, fingerprintConfig, saveDecisionCache, tryRestoreDecisionCache } from '../src/decision/cache.js';
import {
  parseBool,
  parseDecisionMode,
  parseLookback,
  parseTimeout,
  parseUnitInterval,
  resolveProviderSettings,
} from '../src/action/settings.js';
import {
  buildCheckSummary,
  checkConclusion,
  createFetchCheckRunClient,
  maybeCreateCheckRun,
  resolveHeadSha,
} from '../src/github/check-run.js';
import {
  buildIntelligenceComment,
  createFetchCommentClient,
  upsertIntelligenceComment,
} from '../src/github/pr-comment.js';
import { listCompareFiles, listPullRequestFiles, pathsFromPushPayload } from '../src/collectors/github-paths.js';
import { assertGithubName, assertSha, summarizeHistory } from '../src/collectors/history.js';
import { loadJeConfig, coalesceProvider, coalescePolicy } from '../src/collectors/config.js';
import { createVercelAiGatewayProvider } from '../src/jev/vercel-ai-gateway.js';
import { postTypedEvaluation } from '../src/jev/http-evaluate.js';
import type { GroupDefinition } from '../src/schemas/intelligence.js';
import { emptyHistory } from '../src/collectors/history.js';

const groups: GroupDefinition[] = [
  {
    id: 'unit',
    paths: ['src/**'],
    needs: [],
    always: false,
    frameworks: ['vitest'],
    rerunOnRecentFailure: true,
    pathHit: true,
    componentHit: false,
  },
];

describe('coverage edges', () => {
  it('covers settings parsers and provider resolution', () => {
    expect(parseBool(undefined, true)).toBe(true);
    expect(parseBool('true', false)).toBe(true);
    expect(parseBool('false', true)).toBe(false);
    expect(() => parseBool('maybe', true)).toThrow();
    expect(parseUnitInterval('', 0.7)).toBe(0.7);
    expect(parseUnitInterval('0.5', 0.7)).toBe(0.5);
    expect(() => parseUnitInterval('2', 0.7)).toThrow();
    expect(parseTimeout('')).toBe(45_000);
    expect(parseTimeout('1000')).toBe(1000);
    expect(() => parseTimeout('10')).toThrow();
    expect(parseLookback('', 8)).toBe(8);
    expect(parseLookback('5', 8)).toBe(5);
    expect(() => parseLookback('99', 8)).toThrow();
    expect(parseDecisionMode('deterministic')).toBe('deterministic');
    expect(() => parseDecisionMode('magic')).toThrow();

    expect(
      resolveProviderSettings({
        inputProvider: '',
        config: {},
        trustRepoEndpoint: false,
      }).model,
    ).toBe('typesafe-ai/jev');

    const refused = resolveProviderSettings({
      inputProvider: 'custom-compatible',
      config: { jev_endpoint: 'https://example.com/jev', jev_model: 'jev' },
      trustRepoEndpoint: false,
    });
    expect(refused.refusal).toMatch(/Refusing/);

    const ok = resolveProviderSettings({
      inputProvider: 'custom-compatible',
      inputEndpoint: 'https://example.com/jev',
      inputModel: 'jev-1',
      config: {},
      trustRepoEndpoint: false,
    });
    expect(ok.endpoint).toBe('https://example.com/jev');
  });

  it('covers evidence, execute, cache, and factory', async () => {
    const evidence = buildEvidence({
      groups,
      changedPaths: ['src/a.ts'],
      pathsTruncated: false,
      history: emptyHistory(),
      coverage: { available: true, gaps: [{ path: 'src/a.ts', pct: 0.2 }], threshold: 0.8, filesConsidered: 1 },
      frameworks: ['vitest'],
      affectedComponents: ['auth'],
    });
    expect(evidence.groups[0]?.path_hit).toBe(true);
    const { questions, keyToGroup } = buildGroupQuestions(groups);
    expect(questions.group_0).toBeTruthy();

    const provider = {
      id: 'vercel-ai-gateway' as const,
      async evaluateTestSelection() {
        return decisionFromEvaluation(
          {
            provider: 'vercel-ai-gateway',
            modelLabel: 'typesafe-ai/jev',
            answers: {
              group_0: { type: 'boolean', probability: 0.9 },
              abstain: { type: 'boolean', probability: 0.1 },
              request_review: { type: 'boolean', probability: 0.1 },
              run_all: { type: 'boolean', probability: 0.1 },
            },
          },
          evidence,
          keyToGroup,
        );
      },
    };

    const result = await executeIntelligence({
      provider,
      groups,
      changedPaths: ['src/a.ts'],
      pathsTruncated: false,
      minConfidence: 0.7,
      policy: 'warn',
      requirePathHits: true,
      forceFullSuite: false,
      history: emptyHistory(),
      coverage: { available: false, gaps: [], threshold: 0.8, filesConsidered: 0 },
      frameworksDetected: ['vitest'],
      adapterParseErrors: [],
      affectedComponents: [],
    });
    expect(result.selectedGroups).toEqual(['unit']);

    const dir = mkdtempSync(join(tmpdir(), 'jev-cache-'));
    const key = buildCacheKey({
      sha: 'abc123',
      configFingerprint: fingerprintConfig({
        groups,
        lookback: 10,
        minConfidence: 0.7,
        policy: 'warn',
        requirePathHits: true,
        forceFullSuite: false,
      }),
      paths: ['src/a.ts'],
      provider: 'vercel-ai-gateway',
      decisionMode: 'jev',
    });
    await saveDecisionCache({ enabled: true, key, cacheDir: dir, result });
    const restored = await tryRestoreDecisionCache({ enabled: true, key, cacheDir: dir });
    expect(restored?.selectedGroups).toEqual(['unit']);

    expect(credentialEnvName('vercel-ai-gateway')).toBe('AI_GATEWAY_API_KEY');
    expect(credentialEnvName('typesafe-native')).toBe('TYPESAFE_API_KEY');
    expect(credentialEnvName('custom-compatible')).toBe('JEV_CUSTOM_API_KEY');
    expect(createJevProvider('typesafe-native', { timeoutMs: 1000 }).id).toBe('typesafe-native');
    expect(unavailableDecision('vercel-ai-gateway', 'down').provisional).toBe(true);
  });

  it('covers github helpers and path collectors', async () => {
    expect(assertGithubName('JevForge', 'owner')).toBe('JevForge');
    expect(() => assertGithubName('bad name', 'owner')).toThrow();
    expect(assertSha('abcdef1')).toBe('abcdef1');
    expect(assertSha('0000000')).toBeNull();

    const comment = buildIntelligenceComment({
      decision: 'SELECT_GROUPS',
      selectedGroups: ['unit'],
      skippedGroups: [],
      provisional: false,
      confidence: 0.9,
      reasonCodes: ['PATH_MATCH'],
      summary: 'ok',
    });
    expect(comment).toContain('JEV Test Intelligence');

    const comments: Array<{ id: number; body: string }> = [];
    const client = {
      async listComments() {
        return comments;
      },
      async createComment(body: string) {
        comments.push({ id: 1, body });
      },
      async updateComment(id: number, body: string) {
        const found = comments.find(item => item.id === id);
        if (found) found.body = body;
      },
    };
    expect(await upsertIntelligenceComment(true, client, comment)).toBe('posted');
    expect(await upsertIntelligenceComment(true, client, comment + 'x')).toBe('updated');

    expect(checkConclusion({ shouldFail: true, decision: 'ABSTAIN', needsReview: false })).toBe('failure');
    expect(checkConclusion({ shouldFail: false, decision: 'REQUEST_REVIEW', needsReview: true })).toBe('neutral');
    expect(checkConclusion({ shouldFail: false, decision: 'SELECT_GROUPS', needsReview: false })).toBe('success');
    expect(
      buildCheckSummary({
        decision: 'SELECT_GROUPS',
        selectedGroups: ['unit'],
        skippedGroups: [],
        provisional: false,
        confidence: 0.9,
        reasonCodes: ['PATH_MATCH'],
        summary: 'ok',
        shouldFail: false,
      }),
    ).toContain('Selected');

    expect(resolveHeadSha({ after: 'abcdef1234567' }, undefined)).toBe('abcdef1234567');

    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/pulls/')) {
        return {
          ok: true,
          async json() {
            return [{ filename: 'src/a.ts' }];
          },
        } as Response;
      }
      if (String(url).includes('/compare/')) {
        return {
          ok: true,
          async json() {
            return { files: [{ filename: 'src/b.ts' }] };
          },
        } as Response;
      }
      if (String(url).includes('/checks')) {
        return { ok: true } as Response;
      }
      if (String(url).includes('/comments')) {
        return {
          ok: true,
          status: 200,
          async text() {
            return '[]';
          },
        } as Response;
      }
      return { ok: false, status: 500, async text() { return ''; } } as Response;
    });

    await expect(
      listPullRequestFiles({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        token: 't',
        owner: 'JevForge',
        repo: 'demo',
        pullNumber: 1,
        timeoutMs: 5000,
      }),
    ).resolves.toEqual(['src/a.ts']);

    await expect(
      listCompareFiles({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        token: 't',
        owner: 'JevForge',
        repo: 'demo',
        base: 'aaa',
        head: 'bbb',
        timeoutMs: 5000,
      }),
    ).resolves.toEqual(['src/b.ts']);

    expect(
      pathsFromPushPayload({
        commits: [{ added: ['src/c.ts'], modified: [], removed: [] }],
      }).paths,
    ).toEqual(['src/c.ts']);

    const checkClient = createFetchCheckRunClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      token: 't',
      owner: 'JevForge',
      repo: 'demo',
    });
    await expect(
      maybeCreateCheckRun(true, 'abcdef1', checkClient, {
        decision: 'SELECT_GROUPS',
        selectedGroups: ['unit'],
        skippedGroups: [],
        provisional: false,
        confidence: 0.9,
        reasonCodes: ['PATH_MATCH'],
        summary: 'ok',
        shouldFail: false,
        needsReview: false,
      }),
    ).resolves.toBe('created');

    const commentClient = createFetchCommentClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      token: 't',
      owner: 'JevForge',
      repo: 'demo',
      issueNumber: 7,
    });
    await expect(commentClient.listComments()).resolves.toEqual([]);
  });

  it('covers history summarize, config helpers, and HTTP evaluate', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jev-cfg-'));
    mkdirSync(join(root, '.jev'), { recursive: true });
    writeFileSync(
      join(root, '.jev', 'config.yml'),
      'jev_provider: vercel-ai-gateway\nmin_confidence: 0.8\nlow_confidence_policy: fail\n',
    );
    const cfg = loadJeConfig(root, '.jev/config.yml');
    expect(coalesceProvider('', cfg)).toBe('vercel-ai-gateway');
    expect(coalescePolicy('', cfg)).toBe('fail');

    const summary = summarizeHistory(
      [{ failed_groups: ['unit'], head_branch: 'main', conclusion: 'failure' }],
      groups,
      5,
      'main',
    );
    expect(summary.rerunIds).toEqual(['unit']);

    const posted = await postTypedEvaluation(
      'custom-compatible',
      {
        apiKey: 'k',
        endpoint: 'https://example.com/jev',
        model: 'jev',
        timeoutMs: 1000,
        fetchImpl: (async () => ({
          ok: true,
          async json() {
            return {
              answers: {
                group_0: { type: 'boolean', probability: 0.8 },
                abstain: { type: 'boolean', probability: 0.1 },
                request_review: { type: 'boolean', probability: 0.1 },
                run_all: { type: 'boolean', probability: 0.1 },
              },
            };
          },
        })) as unknown as typeof fetch,
      },
      { model: 'jev' },
    );
    expect('answers' in posted).toBe(true);

    const gateway = createVercelAiGatewayProvider({
      apiKey: 'k',
      timeoutMs: 1000,
      evaluateImpl: async () => ({
        answers: {
          group_0: { type: 'boolean', probability: 0.8 },
          abstain: { type: 'boolean', probability: 0.1 },
          request_review: { type: 'boolean', probability: 0.1 },
          run_all: { type: 'boolean', probability: 0.1 },
        },
        providerMetadata: { typesafe: { confidence: { group_0: 0.9 } } },
      }),
    });
    const { keyToGroup } = buildGroupQuestions(groups);
    const decision = await gateway.evaluateTestSelection({
      state: buildEvidence({
        groups,
        changedPaths: ['src/a.ts'],
        pathsTruncated: false,
        history: emptyHistory(),
        coverage: { available: false, gaps: [], threshold: 0.8, filesConsidered: 0 },
        frameworks: [],
        affectedComponents: [],
      }),
      questions: buildGroupQuestions(groups).questions,
      keyToGroup,
    });
    expect(decision.decision).toBe('SELECT_GROUPS');
  });
});
