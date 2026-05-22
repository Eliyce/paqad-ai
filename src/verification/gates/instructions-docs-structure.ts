import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { parse as parseYaml } from 'yaml';

import { isReservedWorkflowPolicyFile } from '@/pipeline/feature-development-policy.js';
import { SchemaValidator } from '@/validators/validator.js';
import { WorkflowTemplateValidator } from '@/workflows/template-validator.js';
import type { TemplateStep, WorkflowTemplate } from '@/workflows/types.js';

import type { Gate } from './gate.interface.js';
import { createFail, createPass } from './shared.js';

const REMEDIATION =
  'Move instruction documentation under an approved docs/instructions/{rules,stack,architecture,design-system,registries,workflows,tools,benchmarks,tech-debt}/ path.';

const NON_CANONICAL_ROOTS = [
  'docs/instruction/',
  'docs/instruction-docs/',
  'docs/instructions-docs/',
] as const;

const ALLOWED_TOP_LEVEL_AREAS = new Set([
  'rules',
  'stack',
  'architecture',
  'design-system',
  'registries',
  'workflows',
  'tools',
  'benchmarks',
  'tech-debt',
]);

export class InstructionsDocsStructureGate implements Gate {
  readonly gate = 'instructions-docs-structure' as const;

  async check(context: Parameters<Gate['check']>[0]) {
    if (!isProviderCompletionCheck(context)) {
      return createPass(this.gate, 'No instruction documentation changes detected');
    }

    const changedFiles = context.changed_files.map(normalizePath);
    const nonCanonicalPath = changedFiles.find((filePath) =>
      NON_CANONICAL_ROOTS.some((root) => isUnderPath(filePath, root)),
    );

    if (nonCanonicalPath) {
      return createFail(
        this.gate,
        `Invalid instruction documentation path ${nonCanonicalPath}`,
        REMEDIATION,
      );
    }

    const instructionPaths = changedFiles.filter((filePath) =>
      isUnderPath(filePath, 'docs/instructions/'),
    );

    if (instructionPaths.length === 0) {
      return createPass(this.gate, 'No instruction documentation changes detected');
    }

    for (const filePath of instructionPaths) {
      const structuralError = validateInstructionPath(filePath);
      if (structuralError) {
        return createFail(this.gate, structuralError, REMEDIATION);
      }

      const absolutePath = join(context.project_root, ...filePath.split('/'));
      if (!existsSync(absolutePath)) {
        return createFail(
          this.gate,
          `Instruction documentation file ${filePath} does not exist`,
          'Restore the touched instruction documentation file before completing the provider request.',
        );
      }

      const contentError = await validateFileContent(absolutePath, filePath);
      if (contentError) {
        return createFail(this.gate, contentError.detail, contentError.remediation);
      }
    }

    return createPass(this.gate, 'Instruction documentation structure is valid');
  }
}

interface ContentError {
  detail: string;
  remediation: string;
}

function validateInstructionPath(filePath: string): string | null {
  if (hasHiddenOrSystemSegment(filePath)) {
    return `Invalid instruction documentation path ${filePath}`;
  }

  const segments = filePath.split('/');
  if (segments.length < 4 || segments[0] !== 'docs' || segments[1] !== 'instructions') {
    return `Invalid instruction documentation path ${filePath}`;
  }

  const area = segments[2];
  if (!ALLOWED_TOP_LEVEL_AREAS.has(area)) {
    return `Invalid instruction documentation path ${filePath}`;
  }

  switch (area) {
    case 'rules':
      return validateRulesPath(filePath, segments);
    case 'stack':
      return validateFlatExtensionPath(filePath, segments, ['.md']);
    case 'architecture':
      return validateFlatExtensionPath(filePath, segments, ['.md', '.json']);
    case 'design-system':
      return validateFlatExtensionPath(filePath, segments, ['.md', '.json', '.css']);
    case 'registries':
      return validateFlatExtensionPath(filePath, segments, ['.md']);
    case 'workflows':
      return validateFlatExtensionPath(filePath, segments, ['.yaml', '.yml']);
    case 'tools':
      return validateToolsPath(filePath, segments);
    case 'benchmarks':
    case 'tech-debt':
      return validateFlatExtensionPath(filePath, segments, ['.md']);
    /* v8 ignore next 2 -- ALLOWED_TOP_LEVEL_AREAS is exhaustive with the switch cases above */
    default:
      return `Invalid instruction documentation path ${filePath}`;
  }
}

function validateRulesPath(filePath: string, segments: string[]): string | null {
  if (segments.length === 4) {
    const filename = segments[3];
    if (
      filename === 'writing-style.md' ||
      filename === 'module-map.yml' ||
      filename === 'module-map.yaml'
    ) {
      return null;
    }
    return `Invalid instruction documentation path ${filePath}`;
  }

  if (segments.length === 5 && extname(filePath) === '.md' && segments[3].length > 0) {
    return null;
  }

  return `Invalid instruction documentation path ${filePath}`;
}

function validateToolsPath(filePath: string, segments: string[]): string | null {
  if (segments.length === 5 && segments[3].length > 0 && extname(filePath) === '.md') {
    return null;
  }

  return `Invalid instruction documentation path ${filePath}`;
}

function validateFlatExtensionPath(
  filePath: string,
  segments: string[],
  allowedExtensions: string[],
): string | null {
  if (segments.length !== 4 || !allowedExtensions.includes(extname(filePath))) {
    return `Invalid instruction documentation path ${filePath}`;
  }

  return null;
}

async function validateFileContent(
  absolutePath: string,
  relativePath: string,
): Promise<ContentError | null> {
  const content = await readFile(absolutePath, 'utf8');
  const extension = extname(relativePath);

  if (extension === '.md') {
    if (content.trim().length === 0) {
      return {
        detail: `Instruction markdown file ${relativePath} is empty`,
        remediation: 'Add non-empty markdown content before completing the provider request.',
      };
    }

    if (!hasMarkdownHeading(content)) {
      return {
        detail: `Instruction markdown file ${relativePath} does not contain a heading`,
        remediation: 'Add at least one markdown heading before completing the provider request.',
      };
    }

    return null;
  }

  if (extension === '.yaml' || extension === '.yml') {
    let parsed: unknown;
    try {
      parsed = parseYaml(content);
    } catch {
      return {
        detail: `Instruction YAML file ${relativePath} does not parse`,
        remediation: 'Fix the YAML syntax before completing the provider request.',
      };
    }

    if (isModuleMap(relativePath) && !hasTopLevelModulesArray(parsed)) {
      return {
        detail: `Instruction module map ${relativePath} must contain a top-level modules array`,
        remediation:
          'Add a top-level modules array to the instruction rule module map before completing the provider request.',
      };
    }
    if (isModuleMap(relativePath)) {
      return validateModuleMap(parsed, relativePath);
    }

    return validateWorkflowYaml(parsed, relativePath);
  }

  if (extension === '.json') {
    try {
      JSON.parse(content);
      return null;
    } catch {
      return {
        detail: `Instruction JSON file ${relativePath} does not parse`,
        remediation: 'Fix the JSON syntax before completing the provider request.',
      };
    }
  }

  if (content.trim().length === 0) {
    return {
      detail: `Instruction CSS file ${relativePath} is empty`,
      remediation: 'Add non-empty CSS content before completing the provider request.',
    };
  }

  return null;
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll('\\', '/').replace(/^\.?\//, '');
}

function isUnderPath(filePath: string, prefix: string): boolean {
  return filePath === prefix.slice(0, -1) || filePath.startsWith(prefix);
}

function isProviderCompletionCheck(context: Parameters<Gate['check']>[0]): boolean {
  return (
    context.verification_origin === 'provider-workflow' &&
    context.verification_stage === 'provider-completion'
  );
}

function hasHiddenOrSystemSegment(filePath: string): boolean {
  return filePath.split('/').some((segment) => segment.startsWith('.'));
}

function hasMarkdownHeading(markdown: string): boolean {
  return markdown.split(/\r?\n/u).some((line) => /^#{1,6}\s+\S/u.test(line.trim()));
}

function isModuleMap(relativePath: string): boolean {
  return (
    relativePath === 'docs/instructions/rules/module-map.yml' ||
    relativePath === 'docs/instructions/rules/module-map.yaml'
  );
}

function hasTopLevelModulesArray(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'modules' in value &&
    Array.isArray((value as { modules?: unknown }).modules)
  );
}

function validateModuleMap(value: unknown, relativePath: string): ContentError | null {
  /* v8 ignore next 3 -- hasTopLevelModulesArray rejects non-mappings before this validator runs */
  if (!isPlainObject(value)) {
    return moduleMapError(relativePath, 'must be a YAML mapping');
  }

  const requiredRootFields = ['version', 'last_updated_at', 'domain_glossary', 'modules'];
  for (const field of requiredRootFields) {
    if (!(field in value)) {
      return moduleMapError(relativePath, `is missing required field ${field}`);
    }
  }

  if (typeof value['version'] !== 'number') {
    return moduleMapError(relativePath, 'field version must be a number');
  }
  if (typeof value['last_updated_at'] !== 'string' || value['last_updated_at'].trim() === '') {
    return moduleMapError(relativePath, 'field last_updated_at must be a non-empty string');
  }
  if (!isDomainGlossary(value['domain_glossary'])) {
    return moduleMapError(
      relativePath,
      'field domain_glossary must include preferred_terms, synonyms, and notes',
    );
  }
  /* v8 ignore next 3 -- hasTopLevelModulesArray already requires modules to be an array */
  if (!Array.isArray(value['modules'])) {
    return moduleMapError(relativePath, 'field modules must be an array');
  }

  for (const [index, moduleEntry] of value['modules'].entries()) {
    const error = validateModuleMapEntry(moduleEntry, `modules[${index}]`);
    if (error) {
      return moduleMapError(relativePath, error);
    }
  }

  return null;
}

function validateModuleMapEntry(value: unknown, path: string): string | null {
  if (!isPlainObject(value)) {
    return `${path} must be a mapping`;
  }

  const requiredFields = [
    'name',
    'slug',
    'auto_update_module_name',
    'derivation',
    'confidence',
    'source_paths',
    'evidence',
    'features',
  ];
  for (const field of requiredFields) {
    if (!(field in value)) {
      return `${path} is missing required field ${field}`;
    }
  }

  const scalarError = validateSharedMapFields(value, path, 'auto_update_module_name');
  if (scalarError) {
    return scalarError;
  }

  if (!isEvidenceMap(value['evidence'])) {
    return `${path}.evidence must be a mapping with routes, tables, and/or symbols arrays`;
  }
  if (!Array.isArray(value['features'])) {
    return `${path}.features must be an array`;
  }

  for (const [index, feature] of value['features'].entries()) {
    const featureError = validateModuleFeatureEntry(feature, `${path}.features[${index}]`);
    if (featureError) {
      return featureError;
    }
  }

  return null;
}

function validateModuleFeatureEntry(value: unknown, path: string): string | null {
  if (!isPlainObject(value)) {
    return `${path} must be a mapping`;
  }

  const requiredFields = [
    'name',
    'slug',
    'auto_update_feature_name',
    'derivation',
    'confidence',
    'source_paths',
  ];
  for (const field of requiredFields) {
    if (!(field in value)) {
      return `${path} is missing required field ${field}`;
    }
  }

  return validateSharedMapFields(value, path, 'auto_update_feature_name');
}

function validateSharedMapFields(
  value: Record<string, unknown>,
  path: string,
  autoUpdateField: string,
): string | null {
  if (typeof value['name'] !== 'string' || value['name'].trim() === '') {
    return `${path}.name must be a non-empty string`;
  }
  if (typeof value['slug'] !== 'string' || value['slug'].trim() === '') {
    return `${path}.slug must be a non-empty string`;
  }
  if (typeof value[autoUpdateField] !== 'boolean') {
    return `${path}.${autoUpdateField} must be a boolean`;
  }
  if (
    !['user', 'locked_manifest', 'codebase_native', 'inferred', 'llm'].includes(
      String(value['derivation']),
    )
  ) {
    return `${path}.derivation must be a valid derivation value`;
  }
  if (!['high', 'medium', 'low'].includes(String(value['confidence']))) {
    return `${path}.confidence must be high, medium, or low`;
  }
  if (!isStringArray(value['source_paths'])) {
    return `${path}.source_paths must be an array of strings`;
  }

  return null;
}

function validateWorkflowYaml(value: unknown, relativePath: string): ContentError | null {
  /* v8 ignore next 1 -- split('/').at(-1) always returns a string for a relative path */
  const filename = relativePath.split('/').at(-1) ?? relativePath;
  if (isReservedWorkflowPolicyFile(filename)) {
    const validation = new SchemaValidator().validate('feature-development-policy', value);
    if (!validation.valid) {
      return {
        detail: `Instruction workflow policy ${relativePath} is invalid`,
        remediation:
          'Fix the feature-development policy schema before completing the provider request.',
      };
    }
    return null;
  }

  const template = value as WorkflowTemplate;
  const availableSkills = collectReferencedTemplateSkills(template);
  let validation: ReturnType<WorkflowTemplateValidator['validate']>;
  try {
    validation = new WorkflowTemplateValidator().validate(template, availableSkills);
  } catch {
    validation = { valid: false, errors: ['Template structure is invalid'] };
  }
  if (!validation.valid) {
    return {
      detail: `Instruction workflow template ${relativePath} is invalid`,
      remediation:
        'Fix the custom workflow template name, steps, skills, and failure directives before completing the provider request.',
    };
  }

  return null;
}

function collectReferencedTemplateSkills(template: WorkflowTemplate): Set<string> {
  const skills = new Set<string>();
  const steps = Array.isArray(template?.steps) ? template.steps : [];

  for (const step of steps) {
    if (isPlainObject(step) && Array.isArray(step['parallel'])) {
      for (const parallelStep of step['parallel']) {
        if (isPlainObject(parallelStep) && typeof parallelStep['skill'] === 'string') {
          skills.add(parallelStep['skill']);
        }
      }
    } else if (isWorkflowStep(step) && typeof step.skill === 'string') {
      skills.add(step.skill);
    }
  }

  return skills;
}

function isWorkflowStep(value: unknown): value is Extract<TemplateStep, { skill: string }> {
  return isPlainObject(value) && 'skill' in value;
}

function moduleMapError(relativePath: string, reason: string): ContentError {
  return {
    detail: `Instruction module map ${relativePath} ${reason}`,
    remediation:
      'Fix the instruction rule module map contract before completing the provider request.',
  };
}

function isDomainGlossary(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    isStringArray(value['preferred_terms']) &&
    isPlainObject(value['synonyms']) &&
    Object.values(value['synonyms']).every((entry) => typeof entry === 'string') &&
    typeof value['notes'] === 'string'
  );
}

function isEvidenceMap(value: unknown): boolean {
  if (!isPlainObject(value)) {
    return false;
  }

  return ['routes', 'tables', 'symbols'].every(
    (field) => value[field] === undefined || isStringArray(value[field]),
  );
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
