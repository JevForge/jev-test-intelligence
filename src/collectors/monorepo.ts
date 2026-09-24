import { MonorepoPlanSchema, type ComponentMap, type GroupDefinition, type MonorepoPlan } from '../schemas/intelligence.js';

export interface MonorepoEvidence {
  affectedProjects: string[];
  mappedGroupIds: string[];
  droppedGroupIds: string[];
}

export function parseMonorepoPlan(raw: string): MonorepoPlan {
  const trimmed = raw.trim();
  if (!trimmed) return { affected_projects: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error('monorepo_plan is not valid JSON');
  }
  const result = MonorepoPlanSchema.safeParse(parsed);
  if (!result.success) throw new Error('monorepo_plan does not match the monorepo navigator contract');
  return result.data;
}

export function buildMonorepoEvidence(input: {
  plan: MonorepoPlan;
  components: ComponentMap[];
  groups: GroupDefinition[];
  allowlist: string[];
}): MonorepoEvidence {
  const affectedProjects = [...new Set(input.plan.affected_projects)].slice(0, 200);
  const affected = new Set(affectedProjects);
  const allow = new Set(input.allowlist);
  const mapped = new Set<string>();
  const dropped: string[] = [];

  const remember = (id: string) => {
    if (allow.has(id)) mapped.add(id);
    else dropped.push(id.slice(0, 80));
  };

  for (const component of input.components) {
    if (!affected.has(component.name)) continue;
    for (const groupId of component.groups) remember(groupId);
  }

  for (const step of input.plan.execution_plan ?? []) {
    if (!affected.has(step.project)) continue;
    for (const groupId of step.jobs) remember(groupId);
  }

  const ordered = input.groups.map(group => group.id).filter(id => mapped.has(id));
  return {
    affectedProjects,
    mappedGroupIds: ordered,
    droppedGroupIds: [...new Set(dropped)].slice(0, 50),
  };
}
