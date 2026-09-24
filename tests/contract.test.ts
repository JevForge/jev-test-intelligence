import { describe, expect, it } from 'vitest';
import { IntelligenceDecisionSchema } from '../src/schemas/intelligence.js';
import { decisionFromEvaluation, SchemaRejectedError } from '../src/jev/normalize.js';
import type { TestEvaluationState } from '../src/decision/evidence.js';

const state: TestEvaluationState = {
  changed_paths: ['src/auth/login.ts'],
  paths_truncated: false,
  groups: [
    {
      id: 'unit',
      paths: ['src/**'],
      needs: [],
      always: false,
      path_hit: true,
      component_hit: true,
      frameworks: ['vitest'],
      recent_failures: 0,
    },
    {
      id: 'e2e',
      paths: ['e2e/**'],
      needs: ['unit'],
      always: false,
      path_hit: false,
      component_hit: true,
      frameworks: ['playwright'],
      recent_failures: 0,
    },
  ],
  history: { enabled: false, available: false, failed_group_counts: {} },
  coverage: { available: false, gap_count: 0, threshold: 0.8 },
  frameworks: ['vitest', 'playwright'],
  affected_components: ['auth'],
  note: 'untrusted',
};

describe('decision contract', () => {
  it('accepts a valid SELECT_GROUPS decision', () => {
    const parsed = IntelligenceDecisionSchema.parse({
      decision: 'SELECT_GROUPS',
      selected_groups: ['unit'],
      confidence: 0.91,
      reason_codes: ['PATH_MATCH', 'CONFIGURED_ALLOWLIST'],
      summary: 'Select unit for auth path hit.',
      provisional: false,
      provider: 'vercel-ai-gateway',
    });
    expect(parsed.selected_groups).toEqual(['unit']);
  });

  it('rejects unknown groups and ABSTAIN with selections', () => {
    expect(() =>
      IntelligenceDecisionSchema.parse({
        decision: 'ABSTAIN',
        selected_groups: ['unit'],
        confidence: 0.2,
        reason_codes: ['POLICY_ABSTAIN'],
        summary: 'bad',
        provisional: true,
        provider: 'vercel-ai-gateway',
      }),
    ).toThrow();
  });

  it('maps boolean answers into SELECT_GROUPS', () => {
    const keyToGroup = new Map([
      ['group_0', 'unit'],
      ['group_1', 'e2e'],
    ]);
    const decision = decisionFromEvaluation(
      {
        provider: 'vercel-ai-gateway',
        modelLabel: 'typesafe-ai/jev',
        answers: {
          group_0: { type: 'boolean', probability: 0.9 },
          group_1: { type: 'boolean', probability: 0.1 },
          abstain: { type: 'boolean', probability: 0.1 },
          request_review: { type: 'boolean', probability: 0.1 },
          run_all: { type: 'boolean', probability: 0.1 },
        },
      },
      state,
      keyToGroup,
    );
    expect(decision.decision).toBe('SELECT_GROUPS');
    expect(decision.selected_groups).toEqual(['unit']);
  });

  it('rejects malformed boolean answers', () => {
    const keyToGroup = new Map([['group_0', 'unit']]);
    expect(() =>
      decisionFromEvaluation(
        {
          provider: 'vercel-ai-gateway',
          modelLabel: 'typesafe-ai/jev',
          answers: {
            group_0: { type: 'string', probability: 0.9 } as never,
            abstain: { type: 'boolean', probability: 0.1 },
            request_review: { type: 'boolean', probability: 0.1 },
            run_all: { type: 'boolean', probability: 0.1 },
          },
        },
        state,
        keyToGroup,
      ),
    ).toThrow(SchemaRejectedError);
  });
});
