import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExecutionResult } from './policy.js';
import type { DecisionMode, JevProviderId, LowConfidencePolicy } from '../schemas/enums.js';
import type { GroupDefinition } from '../schemas/intelligence.js';

export function fingerprintConfig(input: {
  groups: GroupDefinition[];
  lookback: number;
  minConfidence: number;
  policy: LowConfidencePolicy;
  requirePathHits: boolean;
  forceFullSuite: boolean;
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 24);
}

export function buildCacheKey(input: {
  sha: string;
  configFingerprint: string;
  paths: string[];
  provider: JevProviderId;
  decisionMode: DecisionMode;
}): string {
  const pathHash = createHash('sha256').update(input.paths.join('\n')).digest('hex').slice(0, 16);
  return `jev-ti-${input.sha.slice(0, 12)}-${input.configFingerprint}-${pathHash}-${input.provider}-${input.decisionMode}`;
}

export async function tryRestoreDecisionCache(input: {
  enabled: boolean;
  key: string;
  cacheDir: string;
}): Promise<ExecutionResult | null> {
  if (!input.enabled) return null;
  const file = join(input.cacheDir, `${input.key}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as ExecutionResult;
  } catch {
    return null;
  }
}

export async function saveDecisionCache(input: {
  enabled: boolean;
  key: string;
  cacheDir: string;
  result: ExecutionResult;
}): Promise<boolean> {
  if (!input.enabled) return false;
  try {
    mkdirSync(input.cacheDir, { recursive: true });
    writeFileSync(join(input.cacheDir, `${input.key}.json`), JSON.stringify(input.result));
    return true;
  } catch {
    return false;
  }
}
