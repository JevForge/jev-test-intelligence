import {
  IntelligenceDecisionSchema,
  type IntelligenceDecision,
} from '../schemas/intelligence.js';
import type { JevProviderId, ReasonCode } from '../schemas/enums.js';
import { sanitizeSummary } from '../utils/sanitize.js';
import type { TestEvaluationState } from '../decision/evidence.js';

export class SchemaRejectedError extends Error {
  constructor(message: string) {
    super(`SCHEMA_REJECTED: ${message}`);
    this.name = 'SchemaRejectedError';
  }
}

export function isSchemaRejected(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('SCHEMA_REJECTED');
}

export interface AnswerValue {
  type?: string;
  probability?: number;
  confidence?: number;
}

export interface RawEvaluation {
  provider: JevProviderId;
  modelLabel: string;
  answers: Record<string, AnswerValue | undefined>;
  confidence?: Record<string, number>;
}

function probabilityOf(answer: AnswerValue | undefined, label: string): number {
  if (!answer || answer.type !== 'boolean' || typeof answer.probability !== 'number') {
    throw new SchemaRejectedError(`${label} must be a boolean answer`);
  }
  if (!Number.isFinite(answer.probability) || answer.probability < 0 || answer.probability > 1) {
    throw new SchemaRejectedError(`${label} probability is outside 0..1`);
  }
  return answer.probability;
}

function derivedReasons(
  state: TestEvaluationState,
  selected: string[],
  decision: IntelligenceDecision['decision'],
): ReasonCode[] {
  const codes = new Set<ReasonCode>(['CONFIGURED_ALLOWLIST']);
  if (decision === 'ABSTAIN') codes.add('POLICY_ABSTAIN');
  if (decision === 'REQUEST_REVIEW') codes.add('POLICY_REQUEST_REVIEW');
  if (decision === 'RUN_ALL') codes.add('FULL_SUITE_SAFE');
  const selectedSet = new Set(selected);
  for (const group of state.groups) {
    if (!selectedSet.has(group.id)) continue;
    if (group.path_hit) codes.add('PATH_MATCH');
    if (group.paths.length > 0 && !group.path_hit) codes.add('NO_PATH_MATCH');
    if (group.component_hit) codes.add('COMPONENT_AFFECTED');
    if (group.recent_failures > 0) codes.add('HISTORY_RERUN');
  }
  if (state.changed_paths.length === 0) codes.add('NO_CHANGED_PATHS');
  if (state.affected_components.length > 0) codes.add('COMPONENT_AFFECTED');
  if (state.history.enabled && !state.history.available) codes.add('HISTORY_UNAVAILABLE');
  if (state.coverage.available && state.coverage.gap_count > 0) codes.add('COVERAGE_GAP');
  if (state.frameworks.length > 0) codes.add('FRAMEWORK_DISCOVERED');
  return [...codes].slice(0, 16);
}

export function decisionFromEvaluation(
  raw: RawEvaluation,
  state: TestEvaluationState,
  keyToGroup: Map<string, string>,
): IntelligenceDecision {
  const selected: string[] = [];
  const margins: number[] = [];
  for (const [key, groupId] of keyToGroup) {
    const probability = probabilityOf(raw.answers[key], key);
    margins.push(Math.max(probability, 1 - probability));
    if (probability >= 0.5) selected.push(groupId);
  }
  const abstain = probabilityOf(raw.answers.abstain, 'abstain');
  const review = probabilityOf(raw.answers.request_review, 'request_review');
  const runAll = probabilityOf(raw.answers.run_all, 'run_all');
  const providerConfidence = raw.confidence
    ? Object.entries(raw.confidence)
        .filter(([key]) => keyToGroup.has(key))
        .map(([, value]) => value)
        .filter(value => typeof value === 'number' && Number.isFinite(value))
    : [];
  const confidence =
    providerConfidence.length > 0
      ? Math.min(1, Math.max(0, providerConfidence.reduce((sum, value) => sum + value, 0) / providerConfidence.length))
      : margins.length > 0
        ? margins.reduce((sum, value) => sum + value, 0) / margins.length
        : 0;

  let decision: IntelligenceDecision['decision'] = 'SELECT_GROUPS';
  let selectedGroups = selected;
  if (abstain >= 0.55) {
    decision = 'ABSTAIN';
    selectedGroups = [];
  } else if (runAll >= 0.55) {
    decision = 'RUN_ALL';
    selectedGroups = state.groups.map(group => group.id);
  } else if (review >= 0.55 && confidence < 0.85) {
    decision = 'REQUEST_REVIEW';
    selectedGroups = [];
  }

  const summary =
    decision === 'SELECT_GROUPS'
      ? `Jev (${raw.provider}, ${raw.modelLabel}) marked ${selectedGroups.length} allowlisted test group(s) to run.`
      : decision === 'RUN_ALL'
        ? `Jev (${raw.provider}, ${raw.modelLabel}) requested the full allowlisted suite.`
        : decision === 'ABSTAIN'
          ? `Jev (${raw.provider}, ${raw.modelLabel}) abstained from selecting test groups.`
          : `Jev (${raw.provider}, ${raw.modelLabel}) requested review before skipping test groups.`;

  return IntelligenceDecisionSchema.parse({
    decision,
    selected_groups: selectedGroups,
    confidence,
    reason_codes: derivedReasons(state, selectedGroups, decision),
    summary: sanitizeSummary(summary),
    provisional: false,
    provider: raw.provider,
  });
}

export function unavailableDecision(
  provider: JevProviderId,
  message: string,
  code: 'JEV_UNAVAILABLE' | 'SCHEMA_REJECTED' = 'JEV_UNAVAILABLE',
): IntelligenceDecision {
  return IntelligenceDecisionSchema.parse({
    decision: 'ABSTAIN',
    selected_groups: [],
    confidence: 0,
    reason_codes: [code, 'POLICY_ABSTAIN'],
    summary: sanitizeSummary(message),
    provisional: true,
    provider,
  });
}
