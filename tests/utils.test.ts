import { describe, expect, it } from 'vitest';
import { formatTelemetryLine } from '../src/telemetry.js';
import { sanitizeSummary, redactSecrets } from '../src/utils/sanitize.js';
import { matchPath } from '../src/utils/globs.js';
import { assertPublicHttpsEndpoint } from '../src/utils/endpoint.js';

describe('utils', () => {
  it('redacts secrets and truncates summaries', () => {
    expect(redactSecrets('token=sk-abcdefghijklmnopqrstuvwxyz')).toContain('[REDACTED]');
    expect(sanitizeSummary('a'.repeat(600)).length).toBeLessThanOrEqual(500);
  });

  it('matches globs and blocks private endpoints', () => {
    expect(matchPath('src/auth/login.ts', 'src/**')).toBe(true);
    expect(assertPublicHttpsEndpoint('https://api.example.com/jev').ok).toBe(true);
    expect(assertPublicHttpsEndpoint('http://api.example.com/jev').ok).toBe(false);
    expect(assertPublicHttpsEndpoint('https://127.0.0.1/jev').ok).toBe(false);
  });

  it('formats telemetry without secrets', () => {
    const line = formatTelemetryLine({
      duration_ms: 12,
      provider: 'vercel-ai-gateway',
      provisional: false,
      selected_count: 2,
      cache_hit: false,
      decision: 'SELECT_GROUPS',
      decision_mode: 'deterministic',
    });
    expect(line).toContain('jev_test_intelligence_telemetry');
    expect(line).not.toContain('AI_GATEWAY');
  });
});
