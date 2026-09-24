import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveInside } from './utils/paths.js';

export interface IntelligenceTelemetry {
  duration_ms: number;
  provider: string;
  provisional: boolean;
  selected_count: number;
  cache_hit: boolean;
  decision: string;
  decision_mode: string;
  adapter_count: number;
}

/** Structured log line — never include paths, secrets, or group names. */
export function formatTelemetryLine(event: IntelligenceTelemetry): string {
  return JSON.stringify({ jev_test_intelligence_telemetry: event });
}

export function writeTelemetryArtifact(
  workspace: string,
  relativePath: string,
  event: IntelligenceTelemetry,
): void {
  const file = resolveInside(workspace, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(event));
}
