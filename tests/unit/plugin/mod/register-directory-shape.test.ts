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

function withoutWrappers(node: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(node)) return withoutWrappers(node.expression);
  if (ts.isAwaitExpression(node)) return withoutWrappers(node.expression);
  return node;
}

function isPassOn(node: ts.Expression, event: string, next: string): boolean {
  const call = withoutWrappers(node);
  return (
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === next &&
    call.arguments.length === 1 &&
    ts.isIdentifier(call.arguments[0]) &&
    call.arguments[0].text === event
  );
}

function isFixedAnswer(node: ts.Expression): boolean {
  const answer = withoutWrappers(node);
  return (
    ts.isObjectLiteralExpression(answer) &&
    answer.properties.some(
      (property) =>
        ts.isPropertyAssignment(property) &&
        property.name.getText() === 'decision' &&
        ts.isStringLiteral(property.initializer) &&
        (property.initializer.text === 'deny' || property.initializer.text === 'ask'),
    )
  );
}

function isReadableEventUse(use: ts.Identifier): boolean {
  const parent = use.parent;
  if (ts.isPropertyAccessExpression(parent)) {
    return parent.expression === use && parent.questionDotToken === undefined;
  }
  if (ts.isCallExpression(parent)) return parent.arguments.some((argument) => argument === use);
  return (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === use &&
    ts.isIdentifier(parent.name) &&
    (parent.parent.flags & ts.NodeFlags.Const) !== 0
  );
}

function isReference(use: ts.Identifier): boolean {
  const parent = use.parent;
  if (ts.isParameter(parent) && parent.name === use) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === use) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === use) return false;
  return true;
}

function permissionHookFindings(source: string, kind = ts.ScriptKind.TSX): string[] {
  const file = ts.createSourceFile('register.tsx', source, ts.ScriptTarget.Latest, true, kind);
  const findings: string[] = [];
  const report = (node: ts.Node, what: string) => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    findings.push(`line ${line}: ${what}; ${REJECTED}`);
  };

  const checkHook = (hook: ts.ArrowFunction | ts.FunctionExpression) => {
    const [, eventParameter, nextParameter] = hook.parameters;
    if (!eventParameter || !ts.isIdentifier(eventParameter.name)) return;
    const event = eventParameter.name.text;
    const next =
      nextParameter && ts.isIdentifier(nextParameter.name) ? nextParameter.name.text : '';

    const uses = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === event && isReference(node)) {
        if (!isReadableEventUse(node)) {
          report(node, `event \`${event}\` used by itself in a ${ts.SyntaxKind[node.parent.kind]}`);
        }
      }
      ts.forEachChild(node, uses);
    };
    uses(hook.body);

    let kept: string | null = null;
    const nextCalls = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === next
      ) {
        let place: ts.Node = node.parent;
        while (ts.isAwaitExpression(place) || ts.isParenthesizedExpression(place)) {
          place = place.parent;
        }
        const keeps =
          ts.isVariableDeclaration(place) &&
          ts.isIdentifier(place.name) &&
          (place.parent.flags & ts.NodeFlags.Const) !== 0 &&
          kept === null;
        if (keeps) kept = place.name.text;
        else if (!ts.isReturnStatement(place) && place !== hook) {
          report(
            node,
            `\`${next}(${event})\` called somewhere other than a return or the one const that keeps its answer`,
          );
        }
      }
      ts.forEachChild(node, nextCalls);
    };
    nextCalls(hook.body);

    const insideClosure = (node: ts.Node): boolean => {
      for (let up = node.parent; up !== hook; up = up.parent) {
        if (ts.isFunctionLike(up)) return true;
      }
      return false;
    };
    const answerUses = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === kept && isReference(node)) {
        const parent = node.parent;
        const declared = ts.isVariableDeclaration(parent) && parent.name === node;
        const returned = ts.isReturnStatement(parent);
        const read =
          ts.isPropertyAccessExpression(parent) &&
          parent.expression === node &&
          parent.questionDotToken === undefined &&
          !insideClosure(node);
        if (!declared && !returned && !read) {
          report(
            node,
            `answer \`${kept}\` used somewhere other than its return or a plain member read`,
          );
        }
      }
      ts.forEachChild(node, answerUses);
    };
    if (kept !== null) answerUses(hook.body);

    const checkAnswer = (answer: ts.Expression) => {
      if (!isPassOn(answer, event, next) && !isFixedAnswer(answer)) {
        report(
          answer,
          'answer not written in the return itself, as next(e) or a fixed deny or ask',
        );
      }
    };
    const returns = (node: ts.Node): void => {
      if (ts.isFunctionLike(node)) return;
      if (ts.isReturnStatement(node) && node.expression) checkAnswer(node.expression);
      ts.forEachChild(node, returns);
    };
    if (ts.isBlock(hook.body)) ts.forEachChild(hook.body, returns);
    else checkAnswer(hook.body);
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'on' &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === 'tool.check'
    ) {
      const hook = node.arguments[node.arguments.length - 1];
      if (ts.isArrowFunction(hook) || ts.isFunctionExpression(hook)) checkHook(hook);
      else report(hook, 'tool.check hook not written in the call');
      const handled = node.parent;
      if (
        ts.isPropertyAccessExpression(handled) &&
        handled.name.text === 'catch' &&
        ts.isCallExpression(handled.parent)
      ) {
        const handler = handled.parent.arguments[0];
        if (handler && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) {
          checkHook(handler);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

describe('register.tsx permission hook', () => {
  it('reads its event plainly and calls next(e) only in a return or one const, and returns next(e) itself', () => {
    expect(permissionHookFindings(readFileSync(REGISTER, 'utf8'))).toEqual([]);
  });

  const hookWith = (line: string) =>
    `on('tool.check', async ($, e, next) => {\n  ${line}\n  return next(e);\n});`;

  const rejected: Array<[string, string]> = [
    ['cast', hookWith('const a = (e as { agentId?: string }).agentId;')],
    ['optional chain', hookWith('const a = e?.agentId;')],
    ['destructuring', hookWith('const { agentId } = e;')],
    ['loop head', hookWith('for (const k in e) log(k);')],
    ['test', hookWith("if (e) log('x');")],
    ['template', hookWith('log(`${e}`);')],
    ['list', hookWith('log([e]);')],
    ['object', hookWith('log({ e });')],
    ['spread', hookWith('log({ ...e });')],
    ['let binding', hookWith('let x = e;')],
    [
      'loosening return',
      "on('tool.check', async ($, e, next) => {\n  return { decision: (await next(e)).decision };\n});",
    ],
    [
      'returned kept answer',
      "on('tool.check', async ($, e, next) => {\n  const r = await next(e); return r;\n});",
    ],
    ['next(e) as a statement', hookWith('next(e);')],
    ['next(e) as an argument', hookWith('await note($, e, await next(e));')],
    ['next(e) in a let', hookWith('let r = await next(e);')],
    ['next(e) in a test', hookWith("if ((await next(e)).decision === 'deny') log('x');")],
    [
      'answer handed whole to a function',
      "on('tool.check', async ($, e, next) => {\n  const r = await next(e); note(r); return r;\n});",
    ],
    [
      'answer read in a closure',
      "on('tool.check', async ($, e, next) => {\n  const r = await next(e); later(() => r.decision); return r;\n});",
    ],
    [
      'answer in an object',
      "on('tool.check', async ($, e, next) => {\n  const r = await next(e); log({ r }); return r;\n});",
    ],
    [
      'allow literal',
      "on('tool.check', async ($, e, next) => {\n  return { decision: 'allow' };\n});",
    ],
    [
      'hook passed through a variable',
      "const hook = async ($, e, next) => next(e);\non('tool.check', hook);",
    ],
  ];

  it.each(rejected)('rejects a %s with its line', (_label, source) => {
    const findings = permissionHookFindings(source);
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding).toMatch(/^line 2: /);
      expect(finding).toContain(REJECTED);
    }
  });

  it('rejects an angle-bracket cast with its line', () => {
    const source = hookWith('const a = (<{ agentId?: string }>e).agentId;');
    expect(permissionHookFindings(source, ts.ScriptKind.TS)).toEqual([
      `line 2: event \`e\` used by itself in a TypeAssertionExpression; ${REJECTED}`,
    ]);
  });

  it('names what it rejects', () => {
    expect(
      permissionHookFindings(hookWith('const a = (e as { agentId?: string }).agentId;')),
    ).toEqual([`line 2: event \`e\` used by itself in a AsExpression; ${REJECTED}`]);
  });

  it('allows member reads, the event handed to a helper, one kept answer read for the band and next(e) or a fixed deny or ask returned', () => {
    const source = [
      "on('tool.check', async ($, e, next) => {",
      '  const verdict = await next(e);',
      '  const decision = verdict.decision;',
      "  const agent = typeof e.agentId === 'string' && e.agentId !== '' ? e.agentId : null;",
      '  const event = e;',
      '  await notePermission($, e, decision);',
      "  if (event.tool === 'Bash') return { decision: 'ask', reason: 'why' };",
      "  if (agent === null || verdict.decision === 'deny') return { decision: 'deny', reason: 'why' };",
      '  return next(e);',
      '}).catch(($, e, next) => next(e));',
      "on('tool.check', { tool: 'Read' }, async ($, e, next) => next(e));",
      "on('tool.check', { tool: 'Bash' }, async ($, e, next) => {",
      '  return next(e);',
      '});',
    ].join('\n');
    expect(permissionHookFindings(source)).toEqual([]);
  });
});

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
