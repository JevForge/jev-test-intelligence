import {
  IntelligenceDecisionSchema,
  type GroupDefinition,
  type IntelligenceDecision,
} from '../schemas/intelligence.js';
import type { JevProviderId } from '../schemas/enums.js';
import type { HistorySummary } from '../collectors/history.js';
import type { CoverageSummary } from '../collectors/coverage.js';
import { orderReasonCodes, type ExecutionResult } from './policy.js';
import { closeDependencies, annotatePathHits } from './graph.js';
import { matchPath } from '../utils/globs.js';
import { sanitizeSummary } from '../utils/sanitize.js';

export function buildDeterministicDecision(
  provider: JevProviderId,
  groups: GroupDefinition[],
  history: HistorySummary,
  requirePathHits: boolean,
): IntelligenceDecision {
  const selected = new Set<string>();
  for (const group of groups) {
    if (group.always) selected.add(group.id);
    if (requirePathHits && group.pathHit) selected.add(group.id);
    if (group.componentHit) selected.add(group.id);
  }
  for (const id of history.rerunIds) selected.add(id);
  const selected_groups = groups.map(group => group.id).filter(id => selected.has(id));
  return IntelligenceDecisionSchema.parse({
    decision: 'SELECT_GROUPS',
    selected_groups,
    confidence: 1,
    reason_codes: orderReasonCodes(['DETERMINISTIC_ONLY', 'CONFIGURED_ALLOWLIST']),
    summary: sanitizeSummary(
      `Deterministic mode selected ${selected_groups.length} allowlisted test group(s) without calling Jev.`,
    ),
    provisional: true,
    provider,
  });
}

export function executeDeterministic(input: {
  provider: JevProviderId;
  groups: GroupDefinition[];
  changedPaths: string[];
  requirePathHits: boolean;
  forceFullSuite: boolean;
  history: HistorySummary;
  coverage: CoverageSummary;
  frameworksDetected: string[];
  adapterParseErrors: string[];
  affectedComponents: string[];
  noChangedPaths: boolean;
}): ExecutionResult {
  if (input.forceFullSuite) {
    const orderedIds = input.groups.map(group => group.id);
    return {
      decision: 'RUN_ALL',
      selectedGroups: orderedIds,
      skippedGroups: [],
      confidence: 1,
      reasonCodes: orderReasonCodes(['FULL_SUITE_SAFE', 'DETERMINISTIC_ONLY', 'CONFIGURED_ALLOWLIST']),
      summary: sanitizeSummary(`force_full_suite selected all ${orderedIds.length} allowlisted test groups.`),
      provisional: false,
      needsReview: false,
      shouldFail: false,
      failureMessage: '',
      historyApplied: [],
      provider: input.provider,
      fullSuite: true,
    };
  }

  const groups = annotatePathHits(input.groups, input.changedPaths, matchPath);
  const decision = buildDeterministicDecision(
    input.provider,
    groups,
    input.history,
    input.requirePathHits,
  );

  const always = groups.filter(group => group.always).map(group => group.id);
  const pathHits = groups.filter(group => group.pathHit).map(group => group.id);
  const componentHits = groups.filter(group => group.componentHit).map(group => group.id);
  const selected = [
    ...decision.selected_groups,
    ...always,
    ...input.history.rerunIds,
    ...(input.requirePathHits ? pathHits : []),
    ...componentHits,
  ];
  if (input.coverage.available && input.coverage.gaps.length > 0) {
    selected.push(...pathHits, ...componentHits);
  }
  const closed = closeDependencies(selected, groups);
  const orderedIds = groups.map(group => group.id);
  const selectedGroups = closed.ids;
  const skippedGroups = orderedIds.filter(id => !selectedGroups.includes(id));
  const runSet = new Set(selectedGroups);
  const reasons = new Set<string>(['DETERMINISTIC_ONLY', 'CONFIGURED_ALLOWLIST']);
  if (input.noChangedPaths) reasons.add('NO_CHANGED_PATHS');
  if (always.length > 0) reasons.add('ALWAYS_RUN');
  if (closed.added.length > 0) reasons.add('DEPENDENCY_CLOSURE');
  if (input.history.rerunIds.some(id => runSet.has(id))) reasons.add('HISTORY_RERUN');
  if (input.history.enabled && !input.history.available) reasons.add('HISTORY_UNAVAILABLE');
  if (input.coverage.available && input.coverage.gaps.length > 0) reasons.add('COVERAGE_GAP');
  if (input.frameworksDetected.length > 0) reasons.add('FRAMEWORK_DISCOVERED');
  if (input.adapterParseErrors.length > 0) reasons.add('ADAPTER_PARSE_ERROR');
  if (input.affectedComponents.length > 0) reasons.add('COMPONENT_AFFECTED');
  for (const group of groups) {
    if (!runSet.has(group.id)) continue;
    if (group.pathHit) reasons.add('PATH_MATCH');
    if (group.paths.length > 0 && !group.pathHit) reasons.add('NO_PATH_MATCH');
    if (group.componentHit) reasons.add('COMPONENT_AFFECTED');
  }
  const fullSuite = selectedGroups.length === orderedIds.length && orderedIds.length > 0;
  if (fullSuite) reasons.add('FULL_SUITE_SAFE');

  return {
    decision: fullSuite ? 'RUN_ALL' : 'SELECT_GROUPS',
    selectedGroups,
    skippedGroups,
    confidence: 1,
    reasonCodes: orderReasonCodes(reasons),
    summary: sanitizeSummary(
      `Deterministic mode selected ${selectedGroups.length} of ${orderedIds.length} allowlisted test groups without calling Jev.`,
    ),
    provisional: true,
    needsReview: false,
    shouldFail: false,
    failureMessage: '',
    historyApplied: input.history.rerunIds.filter(id => runSet.has(id)),
    provider: input.provider,
    fullSuite,
  };
}
