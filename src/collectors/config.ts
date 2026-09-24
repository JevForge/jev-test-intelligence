import { readFileSync, existsSync, statSync } from 'node:fs';
import YAML from 'yaml';
import { ZodError, z } from 'zod';
import {
  ComponentMapSchema,
  GroupConfigSchema,
  HistoryFileSchema,
  IntelligenceConfigSchema,
  JeConfigSchema,
  type ComponentMap,
  type GroupDefinition,
  type HistoryRun,
  type JeConfig,
} from '../schemas/intelligence.js';
import {
  JEV_PROVIDERS,
  LOW_CONFIDENCE_POLICIES,
  type JevProviderId,
  type LowConfidencePolicy,
} from '../schemas/enums.js';
import { assertSafeGlob } from '../utils/globs.js';
import { resolveInside } from '../utils/paths.js';

const MAX_FILE_BYTES = 256_000;

export function readBounded(workspace: string, relativePath: string): string | null {
  const full = resolveInside(workspace, relativePath);
  if (!existsSync(full)) return null;
  const size = statSync(full).size;
  if (size > MAX_FILE_BYTES) {
    throw new Error(`File exceeds ${MAX_FILE_BYTES} bytes: ${relativePath}`);
  }
  return readFileSync(full, 'utf8');
}

function formatZod(error: ZodError): string {
  return error.issues.map(issue => `${issue.path.join('.') || 'config'}: ${issue.message}`).join('; ');
}

export function loadJeConfig(workspace: string, relativePath = '.jev/config.yml'): JeConfig {
  const raw = readBounded(workspace, relativePath);
  if (raw == null) return {};
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw) ?? {};
  } catch {
    throw new Error(`Invalid YAML in ${relativePath}`);
  }
  const result = JeConfigSchema.safeParse(parsed);
  if (!result.success) throw new Error(`Invalid ${relativePath}: ${formatZod(result.error)}`);
  return result.data;
}

export interface LoadedIntelligenceConfig {
  groups: GroupDefinition[];
  lookback: number;
  components: ComponentMap[];
}

function toDefinitions(groups: z.infer<typeof GroupConfigSchema>[]): GroupDefinition[] {
  const ids = groups.map(group => group.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Group ids must be unique');
  }
  const known = new Set(ids);
  for (const group of groups) {
    for (const glob of group.paths) assertSafeGlob(glob);
    for (const need of group.needs) {
      if (need === group.id) throw new Error(`Group ${group.id} cannot depend on itself`);
      if (!known.has(need)) throw new Error(`Group ${group.id} needs unknown group ${need}`);
    }
    if (group.command != null) {
      const command = group.command.trim();
      if (!command || /[\r\n\0]/.test(command)) {
        throw new Error(`Group ${group.id} has an invalid command`);
      }
    }
  }
  assertAcyclic(groups.map(group => ({ id: group.id, needs: group.needs })));
  return groups.map(group => ({
    id: group.id,
    paths: group.paths,
    needs: group.needs,
    always: group.always,
    frameworks: group.frameworks,
    command: group.command,
    rerunOnRecentFailure: group.rerun_on_recent_failure,
    pathHit: false,
    componentHit: false,
  }));
}

export function assertAcyclic(groups: { id: string; needs: string[] }[]): void {
  const needs = new Map(groups.map(group => [group.id, group.needs]));
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string) => {
    const mark = state.get(id);
    if (mark === 'visiting') throw new Error(`Group dependency cycle includes ${id}`);
    if (mark === 'done') return;
    state.set(id, 'visiting');
    for (const need of needs.get(id) ?? []) visit(need);
    state.set(id, 'done');
  };
  for (const group of groups) visit(group.id);
}

export function loadIntelligenceConfig(
  workspace: string,
  configPath: string,
  groupMapJson: string,
  componentMapJson = '',
): LoadedIntelligenceConfig {
  const raw = readBounded(workspace, configPath);
  let fileGroups: unknown;
  let lookback = 10;
  let components: ComponentMap[] = [];
  if (raw != null) {
    let parsed: unknown;
    try {
      parsed = YAML.parse(raw) ?? {};
    } catch {
      throw new Error(`Invalid YAML in ${configPath}`);
    }
    const result = IntelligenceConfigSchema.safeParse(parsed);
    if (!result.success) throw new Error(`Invalid ${configPath}: ${formatZod(result.error)}`);
    fileGroups = result.data.groups;
    lookback = result.data.history?.lookback ?? 10;
    components = result.data.components;
    for (const component of components) {
      for (const glob of component.paths) assertSafeGlob(glob);
    }
  }

  let groupsSource: unknown = fileGroups;
  if (groupMapJson.trim()) {
    try {
      groupsSource = JSON.parse(groupMapJson) as unknown;
    } catch {
      throw new Error('group_map is not valid JSON');
    }
    const parsedGroups = z.array(GroupConfigSchema).min(1).max(64).safeParse(groupsSource);
    if (!parsedGroups.success) throw new Error(`Invalid group_map: ${formatZod(parsedGroups.error)}`);
    groupsSource = parsedGroups.data;
  }

  if (componentMapJson.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(componentMapJson) as unknown;
    } catch {
      throw new Error('component_map is not valid JSON');
    }
    const result = z.array(ComponentMapSchema).max(200).safeParse(parsed);
    if (!result.success) throw new Error(`Invalid component_map: ${formatZod(result.error)}`);
    components = result.data;
    for (const component of components) {
      for (const glob of component.paths) assertSafeGlob(glob);
    }
  }

  if (!groupsSource) {
    throw new Error(`Missing test intelligence config at ${configPath}`);
  }
  const groups = Array.isArray(groupsSource)
    ? toDefinitions(z.array(GroupConfigSchema).min(1).max(64).parse(groupsSource))
    : toDefinitions(IntelligenceConfigSchema.parse({ groups: groupsSource }).groups);

  const known = new Set(groups.map(group => group.id));
  for (const component of components) {
    for (const groupId of component.groups) {
      if (!known.has(groupId)) {
        throw new Error(`Component ${component.name} maps unknown group ${groupId}`);
      }
    }
  }
  return { groups, lookback, components };
}

export function loadHistoryFile(workspace: string, relativePath: string): HistoryRun[] | null {
  const raw = readBounded(workspace, relativePath);
  if (raw == null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Invalid JSON in ${relativePath}`);
  }
  const result = HistoryFileSchema.safeParse(parsed);
  if (!result.success) throw new Error(`Invalid ${relativePath}: ${formatZod(result.error)}`);
  return result.data.runs;
}

export function coalesceProvider(input: string | undefined, config: JeConfig): JevProviderId {
  const value = (input?.trim() || config.jev_provider || 'vercel-ai-gateway') as JevProviderId;
  if (!JEV_PROVIDERS.includes(value)) throw new Error(`Unsupported jev_provider: ${value}`);
  return value;
}

export function coalescePolicy(input: string | undefined, config: JeConfig): LowConfidencePolicy {
  const value = (input?.trim() || config.low_confidence_policy || 'warn') as LowConfidencePolicy;
  if (!LOW_CONFIDENCE_POLICIES.includes(value)) {
    throw new Error(`Unsupported low_confidence_policy: ${value}`);
  }
  return value;
}
