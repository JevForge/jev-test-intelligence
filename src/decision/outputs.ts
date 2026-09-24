const SAFE_COMMAND =
  /^(npm|pnpm|yarn|bun|npx|pytest|python|py|mvn|gradle|gradlew|\.\/gradlew)(\s+[A-Za-z0-9_@./:=-]+)*$/;

/** Accept only simple package/test runner invocations — never shell metacharacters. */
export function sanitizeCommand(command: string | undefined): string | undefined {
  if (command == null) return undefined;
  const trimmed = command.trim();
  if (!trimmed || trimmed.length > 200) return undefined;
  if (/[;&|`$<>\\\n\r]/.test(trimmed)) return undefined;
  if (!SAFE_COMMAND.test(trimmed)) return undefined;
  return trimmed;
}

export function buildMatrixOutput(selectedGroups: string[]): string {
  return JSON.stringify({
    include: selectedGroups.map(group => ({ group })),
  });
}

export function buildGroupIfSnippets(groupIds: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of groupIds) {
    out[id] =
      `contains(fromJSON(needs.intelligence.outputs.selected_test_groups), '${id}')`;
  }
  return out;
}

export function formatIfSnippetsMarkdown(
  snippets: Record<string, string>,
  selected: string[],
): string {
  const lines = ['### Suggested `if:` expressions', ''];
  for (const [id, expression] of Object.entries(snippets)) {
    const mark = selected.includes(id) ? 'run' : 'skip';
    lines.push(`- \`${id}\` (${mark}): \`if: ${expression}\``);
  }
  return lines.join('\n');
}

export function buildCommandsMap(groups: Array<{ id: string; command?: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const group of groups) {
    const safe = sanitizeCommand(group.command);
    if (safe) out[group.id] = safe;
  }
  return out;
}

/** Selected groups mapped to sanitized commands — for display / suggest-only workflows. */
export function buildRecommendedCommands(
  selectedGroups: string[],
  groups: Array<{ id: string; command?: string }>,
): Record<string, string> {
  const byId = new Map(groups.map(group => [group.id, group.command]));
  const out: Record<string, string> = {};
  for (const id of selectedGroups) {
    const safe = sanitizeCommand(byId.get(id));
    if (safe) out[id] = safe;
  }
  return out;
}
