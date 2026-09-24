export interface IntelligenceTelemetry {
  duration_ms: number;
  provider: string;
  provisional: boolean;
  selected_count: number;
  cache_hit: boolean;
  decision: string;
  decision_mode: string;
}

/** Structured log line — never include paths, secrets, or group names. */
export function formatTelemetryLine(event: IntelligenceTelemetry): string {
  return JSON.stringify({ jev_test_intelligence_telemetry: event });
}
