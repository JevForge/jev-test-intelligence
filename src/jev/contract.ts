/**
 * Local Jev provider contract for Test Intelligence.
 *
 * When `@jevforge/core` is published, swap adapters to import `JevProvider`
 * from that package instead of this module.
 */
import type { JevProviderId } from '../schemas/enums.js';
import type { IntelligenceDecision } from '../schemas/intelligence.js';
import type { TestEvaluationState } from '../decision/evidence.js';

export interface EvaluationRequest {
  state: TestEvaluationState;
  questions: Record<string, { type: 'boolean'; instructions: string }>;
  keyToGroup: Map<string, string>;
}

export interface JevProvider {
  readonly id: JevProviderId;
  evaluateTestSelection(request: EvaluationRequest): Promise<IntelligenceDecision>;
}

export interface JevProviderOptions {
  apiKey?: string;
  endpoint?: string;
  model?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  evaluateImpl?: (args: {
    model: unknown;
    state: Record<string, unknown>;
    questions: EvaluationRequest['questions'];
    maxRetries?: number;
    abortSignal?: AbortSignal;
    providerOptions?: Record<string, unknown>;
  }) => Promise<{
    answers: Record<string, { type?: string; probability?: number; confidence?: number }>;
    providerMetadata?: { typesafe?: { confidence?: Record<string, number> } };
  }>;
}
