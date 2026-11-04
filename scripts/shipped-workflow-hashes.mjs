#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';
import YAML from 'yaml';

export const POLICY_PATH = 'src/pipeline/feature-development-policy.ts';
export const WORKFLOW_STAGES = [
  'planning',
  'specification',
  'development',
  'review',
  'checks',
  'documentation_sync',
  'delivery',
];

export function shippedEntryHash(text) {
  return createHash('sha256').update(text.replace(/\s+/gu, ' ').trim()).digest('hex');
}

function unresolved(label, node, sourceFile) {
  return new Error(`${label}: can't resolve ${node.getText(sourceFile).slice(0, 80)}`);
}

function collectConstants(sourceFile) {
  const constants = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
        constants.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return constants;
}

function resolveText(node, context) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return resolveText(node.expression, context);
  if (ts.isIdentifier(node)) {
    const value = context.constants.get(node.text);
    if (value === undefined) throw unresolved(context.label, node, context.sourceFile);
    return resolveText(value, context);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return resolveText(node.left, context) + resolveText(node.right, context);
  }
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.reduce(
      (text, span) => text + resolveText(span.expression, context) + span.literal.text,
      node.head.text,
    );
  }
  throw unresolved(context.label, node, context.sourceFile);
}

function functionListTexts(node, context) {
  const declaration = context.sourceFile.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === node.text,
  );
  const returned = declaration?.body?.statements.filter(ts.isReturnStatement).at(-1)?.expression;
  if (returned === undefined || !ts.isIdentifier(returned)) {
    throw unresolved(context.label, node, context.sourceFile);
  }
  const texts = [];
  const visit = (child) => {
    if (
      ts.isVariableDeclaration(child) &&
      ts.isIdentifier(child.name) &&
      child.name.text === returned.text &&
      child.initializer !== undefined
    ) {
      texts.push(...resolveList(child.initializer, context));
    }
    if (
      ts.isCallExpression(child) &&
      child.expression.getText(context.sourceFile) === `${returned.text}.push`
    ) {
      texts.push(...child.arguments.map((argument) => resolveText(argument, context)));
    }
    ts.forEachChild(child, visit);
  };
  visit(declaration.body);
  return texts;
}

function resolveList(node, context) {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
    return resolveList(node.expression, context);
  }
  if (ts.isIdentifier(node)) {
    const value = context.constants.get(node.text);
    if (value === undefined) throw unresolved(context.label, node, context.sourceFile);
    return resolveList(value, context);
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    return functionListTexts(node.expression, context);
  }
  if (!ts.isArrayLiteralExpression(node)) {
    throw unresolved(context.label, node, context.sourceFile);
  }
  return node.elements.flatMap((element) =>
    ts.isSpreadElement(element)
      ? resolveList(element.expression, context)
      : [resolveText(element, context)],
  );
}

function propertyNamed(objectNode, name) {
  return objectNode.properties.find(
    (property) =>
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) &&
      property.name.text === name,
  );
}

function findDefaultPolicyStages(sourceFile) {
  let found;
  const visit = (node) => {
    if (found !== undefined) return;
    if (ts.isObjectLiteralExpression(node)) {
      const stages = propertyNamed(node, 'stages');
      if (stages !== undefined && ts.isObjectLiteralExpression(stages.initializer)) {
        const hasEntries = WORKFLOW_STAGES.some((stage) =>
          stages.initializer.properties.some(
            (property) =>
              ts.isPropertyAssignment(property) &&
              property.name.getText(sourceFile) === stage &&
              ts.isObjectLiteralExpression(property.initializer) &&
              propertyNamed(property.initializer, 'instructions') !== undefined,
          ),
        );
        if (hasEntries) {
          found = stages.initializer;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  const declaration = sourceFile.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === 'defaultFeatureDevelopmentPolicy',
  );
  if (declaration !== undefined) visit(declaration);
  return found;
}

function addEntry(entries, stage, kind, text) {
  entries[stage][kind].add(text.replace(/\s+/gu, ' ').trim());
}

function readStageObjects(sourceFile, context, entries) {
  const stages = findDefaultPolicyStages(sourceFile);
  if (stages === undefined) throw new Error(`${context.label}: no default stage objects found`);
  for (const stage of WORKFLOW_STAGES) {
    const property = propertyNamed(stages, stage);
    if (property === undefined) continue;
    if (!ts.isObjectLiteralExpression(property.initializer)) {
      throw unresolved(context.label, property.initializer, sourceFile);
    }
    for (const [kind, key] of [
      ['instructions', 'instructions'],
      ['read', 'read'],
    ]) {
      const list = propertyNamed(property.initializer, key);
      if (list === undefined) continue;
      for (const text of resolveList(list.initializer, context)) {
        addEntry(entries, stage, kind, text);
      }
    }
  }
}

function templateCarrying(sourceFile) {
  let found;
  const visit = (node) => {
    if (found !== undefined) return;
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const head = ts.isTemplateExpression(node) ? node.getText(sourceFile) : node.text;
      if (/^stages:/mu.test(head)) {
        found = node;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function resolveTemplateSpan(expression, context) {
  if (
    ts.isCallExpression(expression) &&
    expression.expression.getText(context.sourceFile) === 'JSON.stringify' &&
    expression.arguments.length === 1
  ) {
    return JSON.stringify(resolveText(expression.arguments[0], context));
  }
  return resolveText(expression, context);
}

function yamlItemText(item, label) {
  if (typeof item === 'string') return item;
  const pairs =
    item !== null && typeof item === 'object' && !Array.isArray(item) ? Object.entries(item) : [];
  if (pairs.length === 1 && typeof pairs[0][1] === 'string')
    return `${pairs[0][0]}: ${pairs[0][1]}`;
  throw new Error(`${label} holds an item that isn't text: ${JSON.stringify(item)}`);
}

function embeddedTemplateText(sourceFile, context) {
  const template = templateCarrying(sourceFile);
  if (template === undefined) return null;
  return ts.isTemplateExpression(template)
    ? template.templateSpans.reduce(
        (joined, span) =>
          joined + resolveTemplateSpan(span.expression, context) + span.literal.text,
        template.head.text,
      )
    : template.text;
}

function readEmbeddedYaml(sourceFile, context, entries) {
  const text = embeddedTemplateText(sourceFile, context);
  if (text === null) return;
  const parsed = YAML.parse(text);
  const stages = parsed?.stages;
  if (stages === null || typeof stages !== 'object') {
    throw new Error(`${context.label}: the embedded template holds no stages`);
  }
  for (const stage of WORKFLOW_STAGES) {
    for (const kind of ['instructions', 'read']) {
      const list = stages[stage]?.[kind];
      if (list === undefined || list === null) continue;
      if (!Array.isArray(list)) {
        throw new Error(`${context.label}: ${stage}.${kind} in the template isn't a list`);
      }
      for (const item of list) {
        addEntry(entries, stage, kind, yamlItemText(item, `${context.label}: ${stage}.${kind}`));
      }
    }
  }
}

function emptyEntries() {
  return Object.fromEntries(
    WORKFLOW_STAGES.map((stage) => [stage, { instructions: new Set(), read: new Set() }]),
  );
}

function parseContext(source, label) {
  const sourceFile = ts.createSourceFile(
    'policy.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return { label, sourceFile, constants: collectConstants(sourceFile) };
}

export function renderEmbeddedTemplate(source, label) {
  const context = parseContext(source, label);
  return embeddedTemplateText(context.sourceFile, context);
}

export function collectEntriesFromSource(source, label, entries = emptyEntries()) {
  const context = parseContext(source, label);
  const { sourceFile } = context;
  readStageObjects(sourceFile, context, entries);
  readEmbeddedYaml(sourceFile, context, entries);
  return entries;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function collectEntriesFromHistory(cwd = process.cwd()) {
  const log = git(
    ['log', '--follow', '--format=%H', '--name-only', '--diff-filter=AMR', '--', POLICY_PATH],
    cwd,
  );
  const lines = log.split('\n').filter((line) => line.length > 0);
  const entries = emptyEntries();
  let commits = 0;
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const [commit, path] = [lines[index], lines[index + 1]];
    collectEntriesFromSource(git(['show', `${commit}:${path}`], cwd), commit, entries);
    commits += 1;
  }
  if (commits === 0) throw new Error(`No history found for ${POLICY_PATH}.`);
  return { entries, commits };
}

export function renderHashList(entries) {
  const lines = ['export const SHIPPED_WORKFLOW_ENTRIES: ShippedWorkflowEntries = {'];
  for (const stage of WORKFLOW_STAGES) {
    lines.push(`  ${stage}: {`);
    for (const kind of ['instructions', 'read']) {
      lines.push(`    ${kind}: [`);
      for (const hash of [...entries[stage][kind]].map(shippedEntryHash).sort()) {
        lines.push(`      '${hash}',`);
      }
      lines.push('    ],');
    }
    lines.push('  },');
  }
  lines.push('};');
  return `${lines.join('\n')}\n`;
}

function main() {
  const { entries, commits } = collectEntriesFromHistory();
  process.stdout.write(renderHashList(entries));
  const counts = WORKFLOW_STAGES.map(
    (stage) => `${stage} ${entries[stage].instructions.size}/${entries[stage].read.size}`,
  );
  process.stderr.write(`Read ${commits} commits. Instructions/read: ${counts.join(', ')}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
