import { describe, expect, it } from 'vitest';
import { applyPolicy } from '../src/decision/policy.js';
import type { GroupDefinition, IntelligenceDecision } from '../src/schemas/intelligence.js';
import { emptyHistory } from '../src/collectors/history.js';

const groups: GroupDefinition[] = [
  {
    id: 'unit',
    paths: ['src/**'],
    needs: [],
    always: false,
    frameworks: ['vitest'],
    command: 'npm test',
    rerunOnRecentFailure: true,
    pathHit: true,
    componentHit: false,
  },
  {
    id: 'e2e',
    paths: ['e2e/**'],
    needs: ['unit'],
    always: false,
    frameworks: ['playwright'],
    rerunOnRecentFailure: false,
    pathHit: false,
    componentHit: false,
  },
];

function decision(partial: Partial<IntelligenceDecision>): IntelligenceDecision {
  return {
    decision: 'SELECT_GROUPS',
    selected_groups: ['unit'],
    confidence: 0.95,
    reason_codes: ['PATH_MATCH'],
    summary: 'ok',
    provisional: false,
    provider: 'vercel-ai-gateway',
    ...partial,
  };
}

describe('policy', () => {
  it('keeps trusted SELECT_GROUPS and closes needs', () => {
    const result = applyPolicy({
      decision: decision({ selected_groups: ['e2e'] }),
      groups: groups.map(group => ({ ...group, pathHit: false })),
      minConfidence: 0.7,
      policy: 'warn',
      requirePathHits: false,
      forceFullSuite: false,
      noChangedPaths: false,
      history: emptyHistory(),
      coverage: { available: false, gaps: [], threshold: 0.8, filesConsidered: 0 },
      frameworksDetected: ['vitest'],
      adapterParseErrors: [],
      affectedComponents: [],
    });
    expect(result.selectedGroups).toEqual(['unit', 'e2e']);
    expect(result.reasonCodes).toContain('DEPENDENCY_CLOSURE');
  });

  it('runs all groups on low confidence warn policy', () => {
    const result = applyPolicy({
      decision: decision({ confidence: 0.2, provisional: false }),
      groups,
      minConfidence: 0.7,
      policy: 'warn',
      requirePathHits: true,
      forceFullSuite: false,
      noChangedPaths: false,
      history: emptyHistory(),
      coverage: { available: false, gaps: [], threshold: 0.8, filesConsidered: 0 },
      frameworksDetected: [],
      adapterParseErrors: [],
      affectedComponents: [],
    });
    expect(result.fullSuite).toBe(true);
    expect(result.provisional).toBe(true);
    expect(result.reasonCodes).toContain('FULL_SUITE_SAFE');
    expect(result.reasonCodes).toContain('LOW_CONFIDENCE');
  });

  it('honors force_full_suite', () => {
    const result = applyPolicy({
      decision: decision({ selected_groups: ['unit'] }),
      groups,
      minConfidence: 0.7,
      policy: 'warn',
      requirePathHits: true,
      forceFullSuite: true,
      noChangedPaths: false,
      history: emptyHistory(),
      coverage: { available: false, gaps: [], threshold: 0.8, filesConsidered: 0 },
      frameworksDetected: [],
      adapterParseErrors: [],
      affectedComponents: [],
    });
    expect(result.decision).toBe('RUN_ALL');
    expect(result.selectedGroups).toEqual(['unit', 'e2e']);
  });

  it('no-op policy keeps always and history only', () => {
    const result = applyPolicy({
      decision: decision({ confidence: 0, provisional: true, reason_codes: ['JEV_UNAVAILABLE'] }),
      groups: groups.map(group =>
        group.id === 'unit' ? { ...group, always: true, pathHit: false } : group,
      ),
      minConfidence: 0.7,
      policy: 'no-op',
      requirePathHits: false,
      forceFullSuite: false,
      noChangedPaths: false,
      history: {
        enabled: true,
        available: true,
        failedGroupCounts: { e2e: 1 },
        rerunIds: ['e2e'],
      },
      coverage: { available: false, gaps: [], threshold: 0.8, filesConsidered: 0 },
      frameworksDetected: [],
      adapterParseErrors: [],
      affectedComponents: [],
    });
    expect(result.selectedGroups).toEqual(['unit', 'e2e']);
    expect(result.reasonCodes).toContain('POLICY_NO_OP');
  });
});
