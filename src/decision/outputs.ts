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
    if (group.command) out[group.id] = group.command;
  }
  return out;
}
