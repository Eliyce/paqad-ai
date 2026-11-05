#!/usr/bin/env node

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUTPUT = '.paqad/authoring/stage-recipes/consumer-scan.json';

const RECIPE_SOURCES = {
  'planning-recipe': ['diff-minimizer'],
  'specification-recipe': ['acceptance-criteria-gen', 'edge-case-detection'],
  'development-recipe': ['scope-check', 'test-per-ac-planner'],
  'review-recipe': ['adversarial-review'],
  'documentation-sync-recipe': ['diff-doc-sync', 'canonical-doc-sync'],
  'checks-recipe': ['test-runner-discovery'],
};

const SCANNED_DIRS = [
  'runtime/base/rules',
  'runtime/base/agents',
  'runtime/base/skills',
  'runtime/capabilities',
  'runtime/claude-plugin/agents',
  'docs/instructions/workflows',
  'src/pipeline',
  'src/stage-isolation',
];

function filesUnder(dir, found = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) filesUnder(path, found);
    else found.push(path);
  }
  return found;
}

export function listWorkflows(root) {
  const text = readFileSync(join(root, 'src/pipeline/routed-workflow.ts'), 'utf8');
  const start = text.indexOf('OUTCOME_BY_WORKFLOW');
  const body = text.slice(text.indexOf('{', start), text.indexOf('};', start));
  return [...body.matchAll(/^\s*'?([a-z-]+)'?: '([a-z-]+)',/gmu)]
    .filter((match) => match[2] !== 'no-workflow')
    .map((match) => match[1]);
}

export function scanConsumers(root) {
  const skillsDir = join(root, 'runtime/base/skills');
  const skills = readdirSync(skillsDir).filter((name) =>
    statSync(join(skillsDir, name)).isDirectory(),
  );
  const files = SCANNED_DIRS.flatMap((dir) => filesUnder(join(root, dir))).map((path) => ({
    rel: relative(root, path),
    text: readFileSync(path, 'utf8'),
  }));
  const paired = Object.entries(RECIPE_SOURCES).flatMap(([recipe, sources]) =>
    sources.map((source) => [source, recipe]),
  );
  const items = skills.map((skill) => {
    const own = `runtime/base/skills/${skill}/`;
    const name = new RegExp(`(^|[^a-z-])${skill}($|[^a-z-])`, 'u');
    const consumers = files
      .filter((file) => !file.rel.startsWith(own) && name.test(file.text))
      .map((file) => file.rel)
      .sort();
    return {
      skill,
      consumers: consumers.length > 0 ? consumers : 'none',
      ...(RECIPE_SOURCES[skill] ? { copies: RECIPE_SOURCES[skill] } : {}),
      ...(paired.some(([source]) => source === skill)
        ? { copied_into: paired.filter(([source]) => source === skill).map(([, recipe]) => recipe) }
        : {}),
    };
  });
  const workflows = listWorkflows(root);
  return {
    workflows_read: workflows,
    workflow_count: workflows.length,
    skills: items,
    retired: [],
    note: 'Nothing is retired here. A skill with no consumer is only a candidate for a later review.',
  };
}

function main(argv) {
  if (argv.includes('--help')) {
    process.stdout.write('usage: skill-consumer-scan.mjs [--out <file>]\n');
    return;
  }
  const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : OUTPUT;
  const scan = scanConsumers(process.cwd());
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, `${JSON.stringify(scan, null, 2)}\n`);
  process.stdout.write(
    `${scan.workflow_count} workflows read, ${scan.skills.length} skills listed\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
