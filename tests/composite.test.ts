import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('composite wrapper', () => {
  it('checks out then calls the node action and re-exports selected_test_groups', () => {
    const raw = readFileSync('composite/action.yml', 'utf8');
    expect(raw).toContain('uses: actions/checkout@v4');
    expect(raw).toContain('uses: JevForge/jev-test-intelligence@v0');
    expect(raw).toContain('steps.ti.outputs.selected_test_groups');
    expect(raw).toContain('id: ti');
  });
});
