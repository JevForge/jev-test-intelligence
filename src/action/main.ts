import { normalizeRepoPath, parseChangedPathsInput } from '../utils/paths.js';
import { redactSecrets } from '../utils/sanitize.js';
import {
  coalescePolicy,
  loadHistoryFile,
  loadJeConfig,
  loadIntelligenceConfig,
} from '../collectors/config.js';
import {
  annotateComponentHits,
  buildComponentEvidence,
  emptyHistory,
  fetchActionHistory,
  parseHistoryGroupIdMap,
  safeBranch,
  summarizeHistory,
  type HistorySummary,
} from '../collectors/history.js';
import { listCompareFiles, listPullRequestFiles, pathsFromPushPayload } from '../collectors/github-paths.js';
import { loadCoverageSummary, parseCoverageThreshold } from '../collectors/coverage.js';
import { discoverFrameworks, parseFrameworksInput } from '../adapters/index.js';
import { buildMonorepoEvidence, parseMonorepoPlan } from '../collectors/monorepo.js';
import { createJevProvider, credentialEnvName, unavailableDecision } from '../jev/core/index.js';
import { executeIntelligence } from '../decision/execute.js';
import { executeDeterministic } from '../decision/deterministic.js';
import { buildCacheKey, fingerprintConfig, saveDecisionCache, tryRestoreDecisionCache } from '../decision/cache.js';
import {
  buildCommandsMap,
  buildRecommendedCommands,
  buildGroupIfSnippets,
  buildMatrixOutput,
  formatIfSnippetsMarkdown,
} from '../decision/outputs.js';
import {
  buildIntelligenceComment,
  createFetchCommentClient,
  upsertIntelligenceComment,
} from '../github/pr-comment.js';
import {
  createFetchCheckRunClient,
  maybeCreateCheckRun,
  resolveHeadSha,
} from '../github/check-run.js';
import { formatTelemetryLine, writeTelemetryArtifact, type IntelligenceTelemetry } from '../telemetry.js';
import { join } from 'node:path';
import type { HistoryRun } from '../schemas/intelligence.js';
import {
  parseBool,
  parseDecisionMode,
  parseLookback,
  parseTimeout,
  parseUnitInterval,
  resolveProviderSettings,
} from './settings.js';

export interface ActionIO {
  inputs: Record<string, string | undefined>;
  env: Record<string, string | undefined>;
  workspace: string;
  eventName: string;
  payload: Record<string, unknown>;
  repo: { owner: string; repo: string };
  fetch: typeof fetch;
  info: (message: string) => void;
  warning: (message: string) => void;
  setOutput: (name: string, value: string) => void;
  setFailed: (message: string) => void;
  summary: (markdown: string) => void | Promise<void>;
}

function input(io: ActionIO, name: string): string {
  return io.inputs[name] ?? '';
}

async function collectChangedPaths(io: ActionIO, timeoutMs: number): Promise<{ paths: string[]; truncated: boolean }> {
  const explicit = input(io, 'changed_paths');
  if (explicit.trim()) {
    const paths = parseChangedPathsInput(explicit);
    return { paths, truncated: paths.length >= 400 };
  }
  const token = input(io, 'token');
  const { owner, repo } = io.repo;
  if ((io.eventName === 'pull_request' || io.eventName === 'pull_request_target') && token && owner && repo) {
    const pull = io.payload.pull_request as { number?: number } | undefined;
    const number = pull?.number ?? (typeof io.payload.number === 'number' ? io.payload.number : 0);
    const raw = await listPullRequestFiles({
      fetchImpl: io.fetch,
      token,
      owner,
      repo,
      pullNumber: number,
      timeoutMs,
    });
    const paths = raw.map(normalizeRepoPath).filter((path): path is string => path != null);
    return { paths: [...new Set(paths)].slice(0, 400), truncated: raw.length >= 400 };
  }
  if (io.eventName === 'push') {
    const fromPayload = pathsFromPushPayload(io.payload);
    let raw = fromPayload.paths;
    let truncated = fromPayload.possiblyTruncated;
    const before = typeof io.payload.before === 'string' ? io.payload.before : '';
    const after = typeof io.payload.after === 'string' ? io.payload.after : '';
    if (fromPayload.possiblyTruncated && token && owner && repo) {
      try {
        const compared = await listCompareFiles({
          fetchImpl: io.fetch,
          token,
          owner,
          repo,
          base: before,
          head: after,
          timeoutMs,
        });
        if (compared.length > 0) {
          raw = compared;
          truncated = compared.length >= 400;
        }
      } catch (error) {
        truncated = true;
        const message = error instanceof Error ? error.message : 'compare failed';
        io.warning(redactSecrets(message));
      }
    }
    const paths = raw.map(normalizeRepoPath).filter((path): path is string => path != null);
    return { paths: [...new Set(paths)].slice(0, 400), truncated };
  }
  return { paths: [], truncated: false };
}

async function collectHistory(
  io: ActionIO,
  enabled: boolean,
  groups: Parameters<typeof summarizeHistory>[1],
  lookback: number,
  timeoutMs: number,
): Promise<HistorySummary> {
  if (!enabled) return emptyHistory();
  const historyPath = input(io, 'history_path') || '.jev/test-history.json';
  let runs: HistoryRun[] = [];
  let available = false;
  try {
    const fileRuns = loadHistoryFile(io.workspace, historyPath);
    if (fileRuns != null) {
      runs = fileRuns;
      available = true;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'history load failed';
    io.warning(redactSecrets(message));
  }

  const token = input(io, 'token');
  const allowlist = groups.map(group => group.id);
  const nameToId = parseHistoryGroupIdMap(
    input(io, 'job_id_map').trim() || input(io, 'history_group_id_map'),
  );
  if (token && io.repo.owner && io.repo.repo) {
    try {
      const apiRuns = await fetchActionHistory({
        fetchImpl: io.fetch,
        token,
        owner: io.repo.owner,
        repo: io.repo.repo,
        branch: safeBranch(input(io, 'history_branch') || undefined),
        lookback,
        timeoutMs,
        allowlist,
        nameToId,
      });
      runs = [...runs, ...apiRuns].slice(0, lookback);
      available = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'history request failed';
      io.warning(redactSecrets(message));
    }
  }

  if (!available) {
    return { enabled: true, available: false, failedGroupCounts: {}, rerunIds: [] };
  }
  return summarizeHistory(runs, groups, lookback, safeBranch(input(io, 'history_branch') || undefined));
}

export async function runAction(io: ActionIO): Promise<void> {
  try {
    await run(io);
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 500);
    io.setFailed(
      `[JEV Test Intelligence] ${message || 'Unexpected failure. Check config_path, secrets, and provider settings.'}`,
    );
  }
}

async function run(io: ActionIO): Promise<void> {
  const started = Date.now();
  const workspace = io.workspace;
  const jeConfig = loadJeConfig(workspace, input(io, 'jev_config_path') || '.jev/config.yml');
  const loaded = loadIntelligenceConfig(
    workspace,
    input(io, 'config_path') || '.jev/test-intelligence.yml',
    input(io, 'group_map'),
    input(io, 'component_map'),
  );
  const settings = resolveProviderSettings({
    inputProvider: input(io, 'jev_provider'),
    inputEndpoint: input(io, 'jev_endpoint'),
    inputModel: input(io, 'jev_model'),
    config: jeConfig,
    trustRepoEndpoint: parseBool(input(io, 'trust_repo_jev_endpoint'), false),
  });
  const minConfidence = parseUnitInterval(
    input(io, 'min_confidence'),
    jeConfig.min_confidence ?? 0.7,
  );
  const policy = coalescePolicy(input(io, 'low_confidence_policy'), jeConfig);
  const timeoutMs = parseTimeout(input(io, 'jev_timeout_ms'));
  const requirePathHits = parseBool(input(io, 'require_path_hits'), true);
  const forceFullSuite = parseBool(input(io, 'force_full_suite'), false);
  const includeHistory = parseBool(input(io, 'include_history'), false);
  const discoverFrameworksEnabled = parseBool(input(io, 'discover_frameworks'), true);
  const decisionMode = parseDecisionMode(input(io, 'decision_mode'));
  const coverageThreshold = parseCoverageThreshold(input(io, 'coverage_threshold'));
  if (!parseBool(input(io, 'dry_run'), true)) {
    io.info('[JEV Test Intelligence] dry_run=false — policy fail may fail this step. Tests are never executed by this action.');
  }

  const changed = await collectChangedPaths(io, timeoutMs);
  const lookback = parseLookback(input(io, 'history_lookback'), loaded.lookback);
  const history = await collectHistory(io, includeHistory, loaded.groups, lookback, timeoutMs);
  const components = buildComponentEvidence(changed.paths, loaded.components);
  const monorepo = buildMonorepoEvidence({
    plan: parseMonorepoPlan(input(io, 'monorepo_plan')),
    components: loaded.components,
    groups: loaded.groups,
    allowlist: loaded.groups.map(group => group.id),
  });
  const affectedComponents = [...new Set([...components.affectedComponents, ...monorepo.affectedProjects])];
  let groups = annotateComponentHits(
    loaded.groups,
    [...new Set([...components.mappedGroupIds, ...monorepo.mappedGroupIds])],
  );

  const frameworks = discoverFrameworksEnabled
    ? discoverFrameworks(workspace, parseFrameworksInput(input(io, 'frameworks')))
    : { results: [], detected: [], parseErrors: [] };

  const coverage = loadCoverageSummary(
    workspace,
    input(io, 'coverage_path') || undefined,
    changed.paths,
    coverageThreshold,
  );

  const cacheEnabled = parseBool(input(io, 'cache_decisions'), false);
  const cacheKey = buildCacheKey({
    sha: io.env.GITHUB_SHA || 'nosha',
    configFingerprint: fingerprintConfig({
      groups: loaded.groups,
      lookback: loaded.lookback,
      minConfidence,
      policy,
      requirePathHits,
      forceFullSuite,
    }),
    paths: changed.paths,
    provider: settings.provider,
    decisionMode,
  });
  const cacheDir = join(workspace, '.jev', '.decision-cache');
  let cacheHit = false;
  let result = await tryRestoreDecisionCache({ enabled: cacheEnabled, key: cacheKey, cacheDir });
  if (result) {
    cacheHit = true;
    io.info(`[JEV Test Intelligence] Restored decision cache (${cacheKey}).`);
  } else {
    result =
      decisionMode === 'deterministic'
        ? executeDeterministic({
            provider: settings.provider,
            groups,
            changedPaths: changed.paths,
            requirePathHits,
            forceFullSuite,
            history,
            coverage,
            frameworksDetected: frameworks.detected,
            adapterParseErrors: frameworks.parseErrors,
            affectedComponents,
            noChangedPaths: changed.paths.length === 0,
          })
        : await executeIntelligence({
            provider: settings.refusal
              ? {
                  id: settings.provider,
                  async evaluateTestSelection() {
                    return unavailableDecision(settings.provider, settings.refusal!);
                  },
                }
              : createJevProvider(settings.provider, {
                  apiKey: io.env[credentialEnvName(settings.provider)],
                  endpoint: settings.endpoint,
                  model: settings.model,
                  timeoutMs,
                  fetchImpl: io.fetch,
                }),
            groups,
            changedPaths: changed.paths,
            pathsTruncated: changed.truncated,
            minConfidence,
            policy,
            requirePathHits,
            forceFullSuite,
            history,
            coverage,
            frameworksDetected: frameworks.detected,
            adapterParseErrors: frameworks.parseErrors,
            affectedComponents,
          });
    if (cacheEnabled) {
      const saved = await saveDecisionCache({ enabled: true, key: cacheKey, cacheDir, result });
      if (saved) io.info(`[JEV Test Intelligence] Saved decision cache (${cacheKey}).`);
    }
  }

  if (decisionMode === 'deterministic' && !cacheHit) {
    io.info('[JEV Test Intelligence] decision_mode=deterministic — Jev was not called.');
  }

  const commands = buildCommandsMap(loaded.groups);
  const recommendedCommands = buildRecommendedCommands(result.selectedGroups, loaded.groups);
  const ifSnippets = buildGroupIfSnippets(loaded.groups.map(group => group.id));

  io.setOutput('decision', result.decision);
  io.setOutput('selected_test_groups', JSON.stringify(result.selectedGroups));
  io.setOutput('skipped_test_groups', JSON.stringify(result.skippedGroups));
  io.setOutput('selected_test_groups_csv', result.selectedGroups.join(','));
  io.setOutput('skipped_test_groups_csv', result.skippedGroups.join(','));
  io.setOutput('confidence', String(result.confidence));
  io.setOutput('reason_codes', JSON.stringify(result.reasonCodes));
  io.setOutput('summary', result.summary);
  io.setOutput('provisional', String(result.provisional));
  io.setOutput('needs_review', String(result.needsReview));
  io.setOutput('affected_paths', JSON.stringify(changed.paths));
  io.setOutput('history_applied', JSON.stringify(result.historyApplied));
  io.setOutput('frameworks_detected', JSON.stringify(frameworks.detected));
  io.setOutput('coverage_gaps', JSON.stringify(coverage.gaps));
  io.setOutput('monorepo_affected_projects', JSON.stringify(monorepo.affectedProjects));
  io.setOutput('monorepo_dropped_groups', JSON.stringify(monorepo.droppedGroupIds));
  io.setOutput('commands', JSON.stringify(commands));
  io.setOutput('recommended_command', JSON.stringify(recommendedCommands));
  io.setOutput('matrix', buildMatrixOutput(result.selectedGroups));
  io.setOutput('if_snippets', JSON.stringify(ifSnippets));
  io.setOutput('jev_provider', result.provider);
  io.setOutput('cache_hit', String(cacheHit));
  io.setOutput('full_suite', String(result.fullSuite));

  await io.summary(
    [
      '## JEV Test Intelligence',
      '',
      `Decision: \`${result.decision}\``,
      '',
      `Selected: ${result.selectedGroups.join(', ') || '(none)'}`,
      '',
      `Skipped: ${result.skippedGroups.join(', ') || '(none)'}`,
      '',
      result.summary,
      '',
      formatIfSnippetsMarkdown(ifSnippets, result.selectedGroups),
    ].join('\n'),
  );

  const commentEnabled = parseBool(input(io, 'comment_on_github'), false);
  if (commentEnabled) {
    const pull =
      io.eventName === 'pull_request' || io.eventName === 'pull_request_target'
        ? (io.payload.pull_request as { number?: number } | undefined)
        : undefined;
    const issueNumber = pull?.number ?? (typeof io.payload.number === 'number' ? io.payload.number : 0);
    const token = input(io, 'token');
    try {
      const client =
        token && io.repo.owner && io.repo.repo && issueNumber > 0
          ? createFetchCommentClient({
              fetchImpl: io.fetch,
              token,
              owner: io.repo.owner,
              repo: io.repo.repo,
              issueNumber,
            })
          : null;
      const body = buildIntelligenceComment({
        decision: result.decision,
        selectedGroups: result.selectedGroups,
        skippedGroups: result.skippedGroups,
        provisional: result.provisional,
        confidence: result.confidence,
        reasonCodes: result.reasonCodes,
        summary: result.summary,
      });
      const status = await upsertIntelligenceComment(true, client, body);
      io.info(`[JEV Test Intelligence] PR comment: ${status}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'comment failed';
      io.warning(redactSecrets(message));
    }
  }

  const checkEnabled = parseBool(input(io, 'create_check_run'), false);
  if (checkEnabled) {
    const token = input(io, 'token');
    try {
      const headSha = resolveHeadSha(io.payload, io.env.GITHUB_SHA);
      const client =
        token && io.repo.owner && io.repo.repo
          ? createFetchCheckRunClient({
              fetchImpl: io.fetch,
              token,
              owner: io.repo.owner,
              repo: io.repo.repo,
            })
          : null;
      const status = await maybeCreateCheckRun(true, headSha, client, {
        decision: result.decision,
        selectedGroups: result.selectedGroups,
        skippedGroups: result.skippedGroups,
        provisional: result.provisional,
        confidence: result.confidence,
        reasonCodes: result.reasonCodes,
        summary: result.summary,
        shouldFail: result.shouldFail,
        needsReview: result.needsReview,
      });
      io.info(`[JEV Test Intelligence] Check run: ${status}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'check run failed';
      io.warning(redactSecrets(message));
    }
  }

  if (result.provisional) io.warning(`[JEV Test Intelligence] ${result.summary}`);
  const dryRun = parseBool(input(io, 'dry_run'), true);
  if (result.shouldFail) {
    if (dryRun) {
      io.warning(
        `[JEV Test Intelligence] dry_run=true — not failing the step: ${result.failureMessage}`,
      );
    } else {
      io.setFailed(`[JEV Test Intelligence] ${result.failureMessage}`);
    }
  }

  if (parseBool(input(io, 'telemetry'), false)) {
    const event: IntelligenceTelemetry = {
      duration_ms: Date.now() - started,
      provider: result.provider,
      provisional: result.provisional,
      selected_count: result.selectedGroups.length,
      cache_hit: cacheHit,
      decision: result.decision,
      decision_mode: decisionMode,
      adapter_count: frameworks.results.filter(adapter => adapter.discovered).length,
    };
    io.info(formatTelemetryLine(event));
    const artifactPath = input(io, 'telemetry_artifact_path').trim();
    if (artifactPath) {
      try {
        writeTelemetryArtifact(workspace, artifactPath, event);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'telemetry artifact failed';
        io.warning(redactSecrets(message));
      }
    }
  }
}
