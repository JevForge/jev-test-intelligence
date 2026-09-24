import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCoverageSummary } from '../src/collectors/coverage.js';

describe('LCOV coverage', () => {
  it('finds changed files below the line threshold', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'jev-ti-lcov-'));
    writeFileSync(
      join(workspace, 'coverage.info'),
      ['TN:', 'SF:src/auth.ts', 'LF:10', 'LH:7', 'end_of_record', ''].join('\n'),
    );

    expect(loadCoverageSummary(workspace, 'coverage.info', ['src/auth.ts'], 0.8)).toEqual({
      available: true,
      gaps: [{ path: 'src/auth.ts', pct: 0.7 }],
      threshold: 0.8,
      filesConsidered: 1,
    });
  });
});
