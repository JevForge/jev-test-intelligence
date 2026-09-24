import { describe, expect, it } from 'vitest';
import { buildMonorepoEvidence, parseMonorepoPlan } from '../src/collectors/monorepo.js';
import type { ComponentMap, GroupDefinition } from '../src/schemas/intelligence.js';

const groups: GroupDefinition[] = [
  {
    id: 'unit',
    paths: [],
    needs: [],
    always: false,
    frameworks: [],
    rerunOnRecentFailure: false,
    pathHit: false,
    componentHit: false,
  },
  {
    id: 'e2e',
    paths: [],
    needs: ['unit'],
    always: false,
    frameworks: [],
    rerunOnRecentFailure: false,
    pathHit: false,
    componentHit: false,
  },
];

const components: ComponentMap[] = [
  { name: '@acme/web', paths: ['apps/web/**'], groups: ['unit', 'e2e'] },
];

describe('monorepo plan hand-off', () => {
  it('maps affected projects and execution groups to the allowlist', () => {
    const plan = parseMonorepoPlan(
      JSON.stringify({
        plan_version: 1,
        affected_projects: ['@acme/web'],
        execution_plan: [{ project: '@acme/web', jobs: ['e2e', 'unknown'] }],
      }),
    );

    expect(
      buildMonorepoEvidence({
        plan,
        components,
        groups,
        allowlist: groups.map(group => group.id),
      }),
    ).toEqual({
      affectedProjects: ['@acme/web'],
      mappedGroupIds: ['unit', 'e2e'],
      droppedGroupIds: ['unknown'],
    });
  });

  it('rejects malformed plans and future versions', () => {
    expect(() => parseMonorepoPlan('{')).toThrow(/not valid JSON/);
    expect(() => parseMonorepoPlan(JSON.stringify({ plan_version: 2 }))).toThrow(/contract/);
  });
});
