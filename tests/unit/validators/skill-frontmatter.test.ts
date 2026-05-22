import { describe, expect, it } from 'vitest';

import { SchemaValidator } from '@/validators';

describe('skill-frontmatter schema', () => {
  const validator = new SchemaValidator();

  it('passes with valid frontmatter', () => {
    const valid = {
      name: 'database-design-review',
      description: 'Reviews schema changes',
      model_tier: 'reasoning',
      triggers: [{ database_impact: ['schema_change'] }],
      max_lines: 300,
      cacheable: true,
      cache_key_inputs: ['database/migrations/**'],
      output_format: 'markdown',
      input_schema: {
        schema_paths: {
          type: 'path[]',
          required: true,
          description: 'Schema paths',
        },
      },
      on_complete: {
        emit: 'done',
        triggers: ['router'],
      },
      tools: ['mcp__laravel_boost__database_schema'],
    };
    const result = validator.validate('skill-frontmatter', valid);
    expect(result.valid).toBe(true);
  });

  it('fails when tools contains non-string values', () => {
    const invalid = {
      name: 'test-skill',
      description: 'Test',
      model_tier: 'fast',
      tools: ['valid-tool', 42],
    };
    const result = validator.validate('skill-frontmatter', invalid);
    expect(result.valid).toBe(false);
  });

  it('fails with invalid model_tier', () => {
    const invalid = {
      name: 'test-skill',
      description: 'Test',
      model_tier: 'extreme',
      triggers: [{ workflow: ['feature-development'] }],
      cacheable: false,
      cache_key_inputs: [],
      output_format: 'markdown',
      input_schema: {
        request_text: {
          type: 'string',
          required: true,
        },
      },
    };
    const result = validator.validate('skill-frontmatter', invalid);
    expect(result.valid).toBe(false);
  });

  it('fails when max_lines exceeds 300', () => {
    const invalid = {
      name: 'test-skill',
      description: 'Test',
      model_tier: 'fast',
      triggers: [{ workflow: ['feature-development'] }],
      cacheable: false,
      cache_key_inputs: [],
      output_format: 'markdown',
      input_schema: {
        request_text: {
          type: 'string',
          required: true,
        },
      },
      max_lines: 500,
    };
    const result = validator.validate('skill-frontmatter', invalid);
    expect(result.valid).toBe(false);
  });

  it('fails when output_format is missing', () => {
    const invalid = {
      name: 'test-skill',
      description: 'Test',
      model_tier: 'fast',
      triggers: [{ workflow: ['feature-development'] }],
      cacheable: false,
      cache_key_inputs: [],
      input_schema: {
        request_text: {
          type: 'string',
          required: true,
        },
      },
    };

    expect(validator.validate('skill-frontmatter', invalid).valid).toBe(false);
  });

  it('fails when input_schema entries are malformed', () => {
    const invalid = {
      name: 'test-skill',
      description: 'Test',
      model_tier: 'fast',
      triggers: [{ workflow: ['feature-development'] }],
      cacheable: false,
      cache_key_inputs: [],
      output_format: 'markdown',
      input_schema: {
        request_text: {
          type: 'wrong',
          required: true,
        },
      },
    };

    expect(validator.validate('skill-frontmatter', invalid).valid).toBe(false);
  });

  it('fails when request_routing.target_workflow is not a known workflow or custom target', () => {
    const invalid = {
      name: 'workflow-router',
      description: 'Routes requests',
      model_tier: 'fast',
      request_routing: [
        {
          priority: 100,
          patterns: ['create documentation'],
          target_workflow: 'documentaiton-update',
        },
      ],
      cacheable: true,
      cache_key_inputs: ['request_text'],
      output_format: 'yaml',
      input_schema: {
        request_text: {
          type: 'string',
          required: true,
        },
      },
    };

    expect(validator.validate('skill-frontmatter', invalid).valid).toBe(false);
  });
});
