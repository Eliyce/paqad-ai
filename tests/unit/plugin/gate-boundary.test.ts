import { readFileSync } from 'node:fs';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

interface HookGroup {
  matcher?: string;
  hooks: { command: string; onFailure?: string }[];
}

const hooksFile = JSON.parse(readFileSync('runtime/claude-plugin/hooks.json', 'utf8')) as {
  hooks: { PreToolUse: HookGroup[] };
};

function stringValues(source: string): string[] {
  const file = ts.createSourceFile('register.tsx', source, ts.ScriptTarget.Latest, false);
  const values: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) values.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return values;
}

describe('AC-7: the edit gate holds without the HUD', () => {
  it.each(['Edit', 'Write', 'NotebookEdit'])(
    'AC-7: %s runs the capability gate, and a gate failure blocks it',
    (tool) => {
      const gates = hooksFile.hooks.PreToolUse.filter((group) =>
        new RegExp(`^(?:${group.matcher ?? ''})$`).test(tool),
      )
        .flatMap((group) => group.hooks)
        .filter((hook) => hook.command.includes('runtime/hooks/capability-gate.mjs" pre-mutation'));
      expect(gates.map((gate) => gate.onFailure)).toEqual(['block']);
    },
  );

  it('AC-7: register.tsx holds no allow answer, so the HUD can only leave a stop in place', () => {
    const source = readFileSync('runtime/claude-plugin/mod/register.tsx', 'utf8');
    expect(stringValues(source)).not.toContain('allow');
  });
});
