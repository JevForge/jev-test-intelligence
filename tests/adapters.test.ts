import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverFrameworks } from '../src/adapters/index.js';
import { loadCoverageSummary } from '../src/collectors/coverage.js';
import { loadIntelligenceConfig } from '../src/collectors/config.js';
import { executeDeterministic } from '../src/decision/deterministic.js';
import { emptyHistory } from '../src/collectors/history.js';

function workspaceWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'jev-ti-'));
  for (const [relative, content] of Object.entries(files)) {
    const full = join(root, relative);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

describe('adapters and collectors', () => {
  it('discovers vitest, playwright, pytest, jest, junit, and cypress', () => {
    const root = workspaceWith({
      'package.json': JSON.stringify({
        scripts: { test: 'vitest run', e2e: 'playwright test', cy: 'cypress run' },
        devDependencies: {
          vitest: '3.0.0',
          jest: '29.0.0',
          '@playwright/test': '1.0.0',
          cypress: '13.0.0',
        },
      }),
      'vitest.config.ts': 'export default { test: {} }',
      'playwright.config.ts': 'export default {}',
      'cypress.config.ts': 'export default {}',
      'jest.config.js': 'module.exports = {}',
      'pytest.ini': '[pytest]\n',
      'pom.xml': '<project><dependencies><dependency><artifactId>junit-jupiter</artifactId></dependency></dependencies></project>',
    });
    const { detected } = discoverFrameworks(root, [
      'jest',
      'vitest',
      'pytest',
      'junit',
      'playwright',
      'cypress',
    ]);
    expect(detected.sort()).toEqual(['cypress', 'jest', 'junit', 'playwright', 'pytest', 'vitest']);
  });

  it('loads config and marks coverage gaps', () => {
    const root = workspaceWith({
      '.jev/test-intelligence.yml': `
version: 1
groups:
  - id: unit
    paths: [src/**]
    command: npm test
components:
  - name: auth
    paths: [src/auth/**]
    groups: [unit]
`,
      'coverage.json': JSON.stringify({
        files: {
          'src/auth/login.ts': { lines: { pct: 40 } },
          'src/other.ts': { lines: { pct: 95 } },
        },
      }),
    });
    const loaded = loadIntelligenceConfig(root, '.jev/test-intelligence.yml', '');
    expect(loaded.groups[0]?.id).toBe('unit');
    const coverage = loadCoverageSummary(root, 'coverage.json', ['src/auth/login.ts', 'src/other.ts'], 0.8);
    expect(coverage.available).toBe(true);
    expect(coverage.gaps.map(gap => gap.path)).toEqual(['src/auth/login.ts']);
  });

  it('deterministic mode selects path hits and components', () => {
    const groups = [
      {
        id: 'unit',
        paths: ['src/**'],
        needs: [],
        always: false,
        frameworks: ['vitest'],
        rerunOnRecentFailure: false,
        pathHit: false,
        componentHit: true,
      },
      {
        id: 'e2e',
        paths: ['e2e/**'],
        needs: [],
        always: false,
        frameworks: ['playwright'],
        rerunOnRecentFailure: false,
        pathHit: false,
        componentHit: false,
      },
    ];
    const result = executeDeterministic({
      provider: 'vercel-ai-gateway',
      groups,
      changedPaths: ['README.md'],
      requirePathHits: true,
      forceFullSuite: false,
      history: emptyHistory(),
      coverage: { available: false, gaps: [], threshold: 0.8, filesConsidered: 0 },
      frameworksDetected: ['vitest'],
      adapterParseErrors: [],
      affectedComponents: ['auth'],
      noChangedPaths: false,
    });
    expect(result.selectedGroups).toEqual(['unit']);
    expect(result.reasonCodes).toContain('COMPONENT_AFFECTED');
    expect(result.reasonCodes).toContain('DETERMINISTIC_ONLY');
  });
});
