import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { restoreCache, saveCache } from '@actions/cache';
import { z } from 'zod';
import type { ExecutionResult } from './policy.js';
import {
  REASON_CODES,
  DECISIONS,
  JEV_PROVIDERS,
  type ReasonCode,
  type Decision,
  type JevProviderId,
  type DecisionMode,
  type LowConfidencePolicy,
} from '../schemas/enums.js';
import type { GroupDefinition } from '../schemas/intelligence.js';

const CachedResultSchema = z.object({
  decision: z.enum(DECISIONS),
  selectedGroups: z.array(z.string()),
  skippedGroups: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  reasonCodes: z.array(z.enum(REASON_CODES)),
  summary: z.string(),
  provisional: z.boolean(),
  needsReview: z.boolean(),
  shouldFail: z.boolean(),
  failureMessage: z.string(),
  historyApplied: z.array(z.string()),
  provider: z.enum(JEV_PROVIDERS),
  fullSuite: z.boolean(),
});

export function fingerprintConfig(input: {
  groups: GroupDefinition[];
  lookback: number;
  minConfidence: number;
  policy: LowConfidencePolicy;
  requirePathHits: boolean;
  forceFullSuite: boolean;
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 32);
}

export function buildCacheKey(parts: {
  sha: string;
  configFingerprint: string;
  paths: string[];
  provider: JevProviderId | string;
  decisionMode: DecisionMode | string;
  monorepoPlan?: unknown;
}): string {
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        config: parts.configFingerprint,
        paths: [...parts.paths].sort(),
        provider: parts.provider,
        mode: parts.decisionMode,
        monorepoPlan: parts.monorepoPlan ?? null,
      }),
    )
    .digest('hex')
    .slice(0, 24);
  const sha = parts.sha.replace(/[^a-fA-F0-9]/g, '').slice(0, 40) || 'nosha';
  return `jev-ti-v1-${sha}-${hash}`;
}

const FILE = 'decision.json';

export async function tryRestoreDecisionCache(input: {
  enabled: boolean;
  key: string;
  cacheDir: string;
}): Promise<ExecutionResult | null> {
  if (!input.enabled) return null;
  mkdirSync(input.cacheDir, { recursive: true });
  const file = join(input.cacheDir, FILE);
  try {
    const hit = await restoreCache([input.cacheDir], input.key);
    if (!hit || !existsSync(file)) return null;
    const parsed = CachedResultSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    return {
      decision: parsed.decision as Decision,
      selectedGroups: parsed.selectedGroups,
      skippedGroups: parsed.skippedGroups,
      confidence: parsed.confidence,
      reasonCodes: parsed.reasonCodes as ReasonCode[],
      summary: parsed.summary,
      provisional: parsed.provisional,
      needsReview: parsed.needsReview,
      shouldFail: parsed.shouldFail,
      failureMessage: parsed.failureMessage,
      historyApplied: parsed.historyApplied,
      provider: parsed.provider as JevProviderId,
      fullSuite: parsed.fullSuite,
    };
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
  mkdirSync(input.cacheDir, { recursive: true });
  const file = join(input.cacheDir, FILE);
  const payload = CachedResultSchema.parse(input.result);
  writeFileSync(file, JSON.stringify(payload));
  try {
    await saveCache([input.cacheDir], input.key);
    return true;
  } catch {
    return false;
  }
}
