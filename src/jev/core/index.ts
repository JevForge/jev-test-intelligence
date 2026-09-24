/**
 * Stable shared boundary for Jev provider access.
 *
 * Action orchestration imports this surface so the provider contract can be
 * lifted into @jevforge/core without changing consumer imports later.
 */
export type { EvaluationRequest, JevProvider, JevProviderOptions } from '../contract.js';
export { createJevProvider, credentialEnvName } from '../factory.js';
export {
  decisionFromEvaluation,
  isSchemaRejected,
  SchemaRejectedError,
  unavailableDecision,
  type AnswerValue,
  type RawEvaluation,
} from '../normalize.js';
