import { describe, expect, it } from 'vitest';
import { credentialEnvName, createJevProvider } from '../src/jev/core/index.js';

describe('Jev core boundary', () => {
  it('exposes the shared provider factory without changing provider ids', () => {
    expect(createJevProvider('typesafe-native', { timeoutMs: 1000 }).id).toBe('typesafe-native');
    expect(credentialEnvName('custom-compatible')).toBe('JEV_CUSTOM_API_KEY');
  });
});
