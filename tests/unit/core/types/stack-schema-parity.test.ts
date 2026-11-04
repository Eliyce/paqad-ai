import { describe, expect, it } from 'vitest';

import { DOMAIN_STACK_MAP, STACKS } from '@/core/types/domain';
import projectProfileSchema from '@/validators/schemas/project-profile.schema.json';
import { SchemaValidator } from '@/validators/validator.js';

function completeReport(stack: string | null): Record<string, unknown> {
  return {
    detected_domain: 'coding',
    detected_stack: stack,
    detected_capabilities: [],
    confidence: 'high',
    signals: [],
    timestamp: '2026-01-01T00:00:00.000Z',
  };
}

describe('schemas that copy the stack list', () => {
  const validator = new SchemaValidator();

  it.each([...STACKS])('AC-22: %s passes the detection report schema', (stack) => {
    expect(validator.validate('detection-report', completeReport(stack)).errors).toEqual([]);
  });

  it('AC-22: every non-content stack is in the project profile frameworks enum', () => {
    const allowed: string[] =
      projectProfileSchema.properties.stack_profile.properties.frameworks.items.enum;
    const nonContent = STACKS.filter(
      (stack) => !(DOMAIN_STACK_MAP.content as readonly string[]).includes(stack),
    );
    expect(nonContent.filter((stack) => !allowed.includes(stack))).toEqual([]);
  });

  it('a value outside the list still fails', () => {
    const result = validator.validate('detection-report', completeReport('not-a-stack'));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({ path: '/detected_stack', keyword: 'enum' });
  });
});
