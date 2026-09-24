import type { Decision, JevProviderId, LowConfidencePolicy, ReasonCode } from '../schemas/enums.js';
import { REASON_CODES } from '../schemas/enums.js';
import type { GroupDefinition, IntelligenceDecision } from '../schemas/intelligence.js';
import type { HistorySummary } from '../collectors/history.js';
import type { CoverageSummary } from '../collectors/coverage.js';
import { closeDependencies } from './graph.js';
import { sanitizeSummary } from '../utils/sanitize.js';

export interface PolicyInput {
  decision: IntelligenceDecision;
  groups: GroupDefinition[];
  minConfidence: number;
  policy: LowConfidencePolicy;
  requirePathHits: boolean;
  forceFullSuite: boolean;
  noChangedPaths: boolean;
  history: HistorySummary;
  coverage: CoverageSummary;
  frameworksDetected: string[];
  adapterParseErrors: string[];
  affectedComponents: string[];
}

export interface ExecutionResult {
  decision: Decision;
  selectedGroups: string[];
  skippedGroups: string[];
  confidence: number;
  reasonCodes: ReasonCode[];
  summary: string;
  provisional: boolean;
  needsReview: boolean;
  shouldFail: boolean;
  failureMessage: string;
  historyApplied: string[];
  provider: JevProviderId;
  fullSuite: boolean;
}

export function orderReasonCodes(codes: Iterable<string>): ReasonCode[] {
  const present = new Set(codes);
  return REASON_CODES.filter(code => present.has(code));
}

function blockedSelection(input: PolicyInput, unknown: string[]): boolean {
  const decision = input.decision;
  return (
    unknown.length > 0 ||
    decision.provisional ||
    (decision.decision !== 'SELECT_GROUPS' && decision.decision !== 'RUN_ALL') ||
    decision.confidence < input.minConfidence ||
    decision.reason_codes.includes('JEV_UNAVAILABLE') ||
    decision.reason_codes.includes('SCHEMA_REJECTED')
  );
}

export function applyPolicy(input: PolicyInput): ExecutionResult {
  const orderedIds = input.groups.map(group => group.id);
  const allow = new Set(orderedIds);
  const always = input.groups.filter(group => group.always).map(group => group.id);
  const pathHits = input.groups.filter(group => group.pathHit).map(group => group.id);
  const componentHits = input.groups.filter(group => group.componentHit).map(group => group.id);
  const unknown = input.decision.selected_groups.filter(id => !allow.has(id));
  const reasons = new Set<string>(input.decision.reason_codes);
  reasons.add('CONFIGURED_ALLOWLIST');
  if (input.noChangedPaths) reasons.add('NO_CHANGED_PATHS');
  if (input.history.enabled && !input.history.available) reasons.add('HISTORY_UNAVAILABLE');
  if (input.coverage.available && input.coverage.gaps.length > 0) reasons.add('COVERAGE_GAP');
  if (input.frameworksDetected.length > 0) reasons.add('FRAMEWORK_DISCOVERED');
  if (input.adapterParseErrors.length > 0) reasons.add('ADAPTER_PARSE_ERROR');
  if (input.affectedComponents.length > 0) reasons.add('COMPONENT_AFFECTED');

  let decisionOut: Decision = input.decision.decision;
  let provisional = input.decision.provisional;
  let needsReview = false;
  let shouldFail = false;
  let selected: string[];

  if (input.forceFullSuite) {
    reasons.add('FULL_SUITE_SAFE');
    decisionOut = 'RUN_ALL';
    selected = [...orderedIds];
    provisional = false;
  } else if (input.decision.decision === 'RUN_ALL' && !blockedSelection(input, unknown)) {
    reasons.add('FULL_SUITE_SAFE');
    selected = [...orderedIds];
  } else if (blockedSelection(input, unknown)) {
    provisional = true;
    if (input.decision.decision === 'SELECT_GROUPS' && input.decision.confidence < input.minConfidence) {
      reasons.add('LOW_CONFIDENCE');
    }
    if (unknown.length > 0) reasons.add('SCHEMA_REJECTED');
    if (input.policy === 'request-review') {
      decisionOut = 'REQUEST_REVIEW';
      needsReview = true;
      reasons.add('POLICY_REQUEST_REVIEW');
      reasons.add('POLICY_RUN_ALL');
      reasons.add('FULL_SUITE_SAFE');
      selected = [...orderedIds];
    } else if (input.policy === 'no-op') {
      decisionOut = input.decision.decision === 'REQUEST_REVIEW' ? 'REQUEST_REVIEW' : 'ABSTAIN';
      reasons.add('POLICY_NO_OP');
      if (decisionOut === 'ABSTAIN') reasons.add('POLICY_ABSTAIN');
      selected = [...always, ...input.history.rerunIds, ...componentHits];
    } else if (input.policy === 'fail') {
      decisionOut = input.decision.decision === 'REQUEST_REVIEW' ? 'REQUEST_REVIEW' : 'ABSTAIN';
      reasons.add('POLICY_RUN_ALL');
      reasons.add('FULL_SUITE_SAFE');
      shouldFail = true;
      selected = [...orderedIds];
    } else {
      decisionOut = input.decision.decision === 'REQUEST_REVIEW' ? 'REQUEST_REVIEW' : 'ABSTAIN';
      reasons.add('POLICY_RUN_ALL');
      reasons.add('FULL_SUITE_SAFE');
      selected = [...orderedIds];
    }
  } else {
    selected = [
      ...input.decision.selected_groups,
      ...always,
      ...input.history.rerunIds,
      ...componentHits,
    ];
    if (input.requirePathHits) selected.push(...pathHits);
    if (input.coverage.available && input.coverage.gaps.length > 0) {
      selected.push(...pathHits, ...componentHits);
    }
    if (input.history.rerunIds.length > 0) reasons.add('HISTORY_RERUN');
    if (always.length > 0) reasons.add('ALWAYS_RUN');
  }

  const closed = closeDependencies(selected, input.groups);
  if (closed.added.length > 0) reasons.add('DEPENDENCY_CLOSURE');
  const selectedGroups = closed.ids;
  const skippedGroups = orderedIds.filter(id => !selectedGroups.includes(id));
  const runSet = new Set(selectedGroups);
  const fullSuite = selectedGroups.length === orderedIds.length && orderedIds.length > 0;

  for (const group of input.groups) {
    if (!runSet.has(group.id)) continue;
    if (group.pathHit) reasons.add('PATH_MATCH');
    if (group.paths.length > 0 && !group.pathHit) reasons.add('NO_PATH_MATCH');
    if (group.componentHit) reasons.add('COMPONENT_AFFECTED');
  }
  if (input.history.rerunIds.some(id => runSet.has(id))) reasons.add('HISTORY_RERUN');
  if (fullSuite) reasons.add('FULL_SUITE_SAFE');

  const summary = input.forceFullSuite
    ? sanitizeSummary(`force_full_suite selected all ${orderedIds.length} allowlisted test groups.`)
    : blockedSelection(input, unknown) && !input.forceFullSuite
      ? sanitizeSummary(
          `Deterministic policy ${input.policy} applied after ${input.decision.provider} returned ${input.decision.decision}. ${input.decision.summary} Selected ${selectedGroups.length} group(s).`,
        )
      : sanitizeSummary(
          `Jev (${input.decision.provider}) selected ${selectedGroups.length} of ${orderedIds.length} allowlisted test groups.`,
        );

  const failureMessage = shouldFail
    ? sanitizeSummary(
        `Test Intelligence policy fail stopped the job after a non-trusted Jev result. Outputs still list the full allowlist so a continue-on-error consumer does not skip tests by accident.`,
      )
    : '';

  return {
    decision: decisionOut === 'SELECT_GROUPS' && fullSuite ? 'RUN_ALL' : decisionOut,
    selectedGroups,
    skippedGroups,
    confidence: input.decision.confidence,
    reasonCodes: orderReasonCodes(reasons),
    summary,
    provisional,
    needsReview,
    shouldFail,
    failureMessage,
    historyApplied: input.history.rerunIds.filter(id => runSet.has(id)),
    provider: input.decision.provider,
    fullSuite,
  };
}
