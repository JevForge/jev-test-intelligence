import { z } from 'zod';
import {
  DECISIONS,
  FRAMEWORKS,
  GROUP_ID_PATTERN,
  JEV_PROVIDERS,
  LOW_CONFIDENCE_POLICIES,
  REASON_CODES,
} from './enums.js';

export const GroupIdSchema = z.string().regex(GROUP_ID_PATTERN);

export const GroupConfigSchema = z.object({
  id: GroupIdSchema,
  paths: z.array(z.string().min(1).max(256)).max(50).default([]),
  needs: z.array(GroupIdSchema).max(32).default([]),
  always: z.boolean().default(false),
  frameworks: z.array(z.enum(FRAMEWORKS)).max(6).default([]),
  command: z.string().max(500).optional(),
  rerun_on_recent_failure: z.boolean().default(false),
});

export type GroupConfig = z.infer<typeof GroupConfigSchema>;

export const ComponentMapSchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9_@./-]{1,128}$/),
  paths: z.array(z.string().min(1).max(256)).min(1).max(50),
  groups: z.array(GroupIdSchema).min(1).max(32),
});

export type ComponentMap = z.infer<typeof ComponentMapSchema>;

export const MonorepoPlanSchema = z.object({
  plan_version: z.literal(1).optional(),
  affected_projects: z.array(z.string().min(1).max(128)).max(200).default([]),
  execution_plan: z
    .array(
      z.object({
        project: z.string().min(1).max(128),
        jobs: z.array(z.string().min(1).max(80)).max(50),
      }),
    )
    .max(200)
    .optional(),
});

export type MonorepoPlan = z.infer<typeof MonorepoPlanSchema>;

export const IntelligenceConfigSchema = z.object({
  version: z.literal(1).default(1),
  groups: z.array(GroupConfigSchema).min(1).max(64),
  components: z.array(ComponentMapSchema).max(200).default([]),
  history: z
    .object({
      lookback: z.number().int().min(1).max(20).optional(),
    })
    .optional(),
});

export type IntelligenceConfig = z.infer<typeof IntelligenceConfigSchema>;

export const HistoryRunSchema = z.object({
  head_branch: z.string().min(1).max(256).optional(),
  conclusion: z
    .enum(['success', 'failure', 'cancelled', 'skipped', 'timed_out', 'unknown'])
    .optional(),
  failed_groups: z.array(GroupIdSchema).max(64).default([]),
});

export type HistoryRun = z.infer<typeof HistoryRunSchema>;

export const HistoryFileSchema = z.object({
  runs: z.array(HistoryRunSchema).max(50),
});

export const JeConfigSchema = z.object({
  jev_provider: z.enum(JEV_PROVIDERS).optional(),
  jev_endpoint: z.string().url().optional(),
  jev_model: z.string().min(1).max(128).optional(),
  min_confidence: z.number().min(0).max(1).optional(),
  low_confidence_policy: z.enum(LOW_CONFIDENCE_POLICIES).optional(),
});

export type JeConfig = z.infer<typeof JeConfigSchema>;

export const IntelligenceDecisionSchema = z
  .object({
    decision: z.enum(DECISIONS),
    selected_groups: z.array(GroupIdSchema).max(64),
    confidence: z.number().min(0).max(1),
    reason_codes: z.array(z.enum(REASON_CODES)).min(1).max(16),
    summary: z.string().max(500),
    provisional: z.boolean(),
    provider: z.enum(JEV_PROVIDERS),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.selected_groups).size !== value.selected_groups.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'selected_groups must be unique',
        path: ['selected_groups'],
      });
    }
    if (
      value.decision !== 'SELECT_GROUPS' &&
      value.decision !== 'RUN_ALL' &&
      value.selected_groups.length > 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Only SELECT_GROUPS or RUN_ALL may list selected_groups',
        path: ['selected_groups'],
      });
    }
  });

export type IntelligenceDecision = z.infer<typeof IntelligenceDecisionSchema>;

export interface GroupDefinition {
  id: string;
  paths: string[];
  needs: string[];
  always: boolean;
  frameworks: string[];
  command?: string;
  rerunOnRecentFailure: boolean;
  pathHit: boolean;
  componentHit: boolean;
}
