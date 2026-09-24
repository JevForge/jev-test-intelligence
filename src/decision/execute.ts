import type { JevProvider } from '../jev/core/index.js';
import { isSchemaRejected, unavailableDecision } from '../jev/core/index.js';
import type { LowConfidencePolicy } from '../schemas/enums.js';
import type { GroupDefinition } from '../schemas/intelligence.js';
import type { HistorySummary } from '../collectors/history.js';
import type { CoverageSummary } from '../collectors/coverage.js';
import { annotatePathHits } from './graph.js';
import { matchPath } from '../utils/globs.js';
import { buildEvidence, buildGroupQuestions } from './evidence.js';
import { applyPolicy, type ExecutionResult } from './policy.js';

export interface ExecuteInput {
  provider: JevProvider;
  groups: GroupDefinition[];
  changedPaths: string[];
  pathsTruncated: boolean;
  minConfidence: number;
  policy: LowConfidencePolicy;
  requirePathHits: boolean;
  forceFullSuite: boolean;
  history: HistorySummary;
  coverage: CoverageSummary;
  frameworksDetected: string[];
  adapterParseErrors: string[];
  affectedComponents: string[];
}

export async function executeIntelligence(input: ExecuteInput): Promise<ExecutionResult> {
  const groups = annotatePathHits(input.groups, input.changedPaths, matchPath);
  const state = buildEvidence({
    groups,
    changedPaths: input.changedPaths,
    pathsTruncated: input.pathsTruncated,
    history: input.history,
    coverage: input.coverage,
    frameworks: input.frameworksDetected,
    affectedComponents: input.affectedComponents,
  });
  const { questions, keyToGroup } = buildGroupQuestions(groups);
  let decision;
  try {
    decision = await input.provider.evaluateTestSelection({ state, questions, keyToGroup });
  } catch (error) {
    if (!isSchemaRejected(error)) throw error;
    const message = error instanceof Error ? error.message : 'SCHEMA_REJECTED';
    decision = unavailableDecision(input.provider.id, message, 'SCHEMA_REJECTED');
  }
  return applyPolicy({
    decision,
    groups,
    minConfidence: input.minConfidence,
    policy: input.policy,
    requirePathHits: input.requirePathHits,
    forceFullSuite: input.forceFullSuite,
    noChangedPaths: input.changedPaths.length === 0,
    history: input.history,
    coverage: input.coverage,
    frameworksDetected: input.frameworksDetected,
    adapterParseErrors: input.adapterParseErrors,
    affectedComponents: input.affectedComponents,
  });
}
