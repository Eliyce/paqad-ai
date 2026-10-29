import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REGISTER = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../runtime/claude-plugin/mod/register.tsx',
);

const HOOK_NAMES = new Set(['e', 'next', '$']);
const PARAMETER_NAMES = new Set(['e', 'next']);
const REJECTED = 'the plugin directory rejects it';

function isHookFunction(node: ts.Node): boolean {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return false;
  const call = node.parent;
  if (!ts.isCallExpression(call) || !call.arguments.some((argument) => argument === node)) {
    return false;
  }
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'on';
  return ts.isPropertyAccessExpression(callee) && callee.name.text === 'catch';
}

function assignedNames(target: ts.Node): ts.Identifier[] {
  if (ts.isIdentifier(target)) return [target];
  if (ts.isParenthesizedExpression(target)) return assignedNames(target.expression);
  if (ts.isSpreadElement(target)) return assignedNames(target.expression);
  if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return assignedNames(target.left);
  }
  if (ts.isArrayLiteralExpression(target)) return target.elements.flatMap(assignedNames);
  if (ts.isObjectLiteralExpression(target)) {
    return target.properties.flatMap((property) => {
      if (ts.isPropertyAssignment(property)) return assignedNames(property.initializer);
      if (ts.isShorthandPropertyAssignment(property)) return [property.name];
      if (ts.isSpreadAssignment(property)) return assignedNames(property.expression);
      return [];
    });
  }
  return [];
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function isUpdateOperator(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.PlusPlusToken || kind === ts.SyntaxKind.MinusMinusToken;
}

function directoryShapeFindings(source: string): string[] {
  const file = ts.createSourceFile(
    'register.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findings: string[] = [];
  const report = (node: ts.Node, what: string) => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    findings.push(`line ${line}: ${what}; ${REJECTED}`);
  };
  const reportAssigned = (target: ts.Node) => {
    for (const name of assignedNames(target)) {
      if (HOOK_NAMES.has(name.text)) report(name, `assignment to \`${name.text}\``);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (HOOK_NAMES.has(node.name.text)) {
        const what = ts.isCatchClause(node.parent) ? 'catch binding' : 'variable';
        report(node.name, `${what} named \`${node.name.text}\``);
      }
    }
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && HOOK_NAMES.has(node.name.text)) {
      report(node.name, `destructured binding named \`${node.name.text}\``);
    }
    if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
      reportAssigned(node.left);
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      isUpdateOperator(node.operator)
    ) {
      reportAssigned(node.operand);
    }
    if (
      (ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
      !ts.isVariableDeclarationList(node.initializer)
    ) {
      reportAssigned(node.initializer);
    }
    if (ts.isParameter(node)) {
      const hook = isHookFunction(node.parent);
      const plain = ts.isIdentifier(node.name) && !node.dotDotDotToken && !node.initializer;
      if (hook && !plain) {
        report(node, 'hook parameter that is not a plain name');
      } else if (!hook && ts.isIdentifier(node.name) && PARAMETER_NAMES.has(node.name.text)) {
        report(node.name, `parameter named \`${node.name.text}\` outside a hook`);
      }
    }
    if (ts.isIdentifier(node) && node.text === 'arguments') {
      report(node, '`arguments` used');
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

describe('register.tsx plugin directory shape', () => {
  it('declares, assigns and binds no hook parameter name outside the hooks', () => {
    expect(directoryShapeFindings(readFileSync(REGISTER, 'utf8'))).toEqual([]);
  });

  const rejected: Array<[string, string]> = [
    ['const next', 'const a = 1;\nconst next = a;'],
    ['let e', 'let a = 1;\nlet e = a;'],
    ['const $', 'const a = 1;\nconst $ = a;'],
    ['catch (e)', 'try {\n} catch (e) {\n  log(e);\n}'],
    ['next = x', 'let x = 1;\nnext = x;'],
    ['compound assignment', 'let x = 1;\ne += x;'],
    ['increment', 'let x = 1;\nnext++;'],
    ['object destructuring assignment', 'let y = {};\n({ a: next } = y);'],
    ['array rest assignment', 'let z = [];\n[...e] = z;'],
    ['destructured declaration', 'const y = {};\nconst { a: next } = y;'],
    ['function parameter e', 'const a = 1;\nfunction f(e) {\n  return e;\n}'],
    [
      'nested function inside a hook',
      "on('x', async ($, e, next) => {\n  const inner = (next) => next;\n  return inner(e);\n});",
    ],
    [
      'hook passed through a variable',
      "const a = 1;\nconst hook = async ($, e, next) => next(e);\non('x', hook);",
    ],
    ['destructured hook parameter', "const a = 1;\non('x', async ($, { args }) => args);"],
    ['arguments', 'function f($) {\n  return arguments.length;\n}'],
  ];

  it.each(rejected)('rejects %s with its line', (_label, source) => {
    const findings = directoryShapeFindings(source);
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding).toMatch(/^line 2: /);
      expect(finding).toContain(REJECTED);
    }
  });

  it('names what it rejects', () => {
    expect(directoryShapeFindings('try {\n} catch (e) {\n  log(e);\n}')).toEqual([
      `line 2: catch binding named \`e\`; ${REJECTED}`,
    ]);
  });

  it('allows hook parameters, catch handlers and $ helper parameters', () => {
    const source = [
      "on('session.start', async ($, e, next) => next(e)).catch(($, e, next) => next(e));",
      "on('command.run', { command: 'paqad' }, async ($, e) => answer($, e.args));",
      'function draw($, event) {\n  return $.ui.resolve(event);\n}',
      'promise.catch(() => tick($));',
      'try {\n  run();\n} catch {\n  stop();\n}',
    ].join('\n');
    expect(directoryShapeFindings(source)).toEqual([]);
  });
});
