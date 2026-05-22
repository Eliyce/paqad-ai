import { describe, expect, it } from 'vitest';

import { DataRetrievalDecider } from '@/mcp/decision-matrix.js';

describe('DataRetrievalDecider', () => {
  it('prefers MCP when server is available', () => {
    const decider = new DataRetrievalDecider(
      ['laravel-boost', 'database-inspector'],
      ['extract-routes.sh'],
    );
    const result = decider.decide('routes');
    expect(result.type).toBe('mcp');
    expect(result.server).toBe('laravel-boost');
  });

  it('falls back to script when no MCP available', () => {
    const decider = new DataRetrievalDecider([], ['extract-routes.sh']);
    const result = decider.decide('routes');
    expect(result.type).toBe('script');
    expect(result.script).toBe('extract-routes.sh');
  });

  it('falls back to LLM read as last resort', () => {
    const decider = new DataRetrievalDecider([], []);
    const result = decider.decide('routes');
    expect(result.type).toBe('llm-read');
  });

  it('uses database-inspector for schema when available', () => {
    const decider = new DataRetrievalDecider(['database-inspector'], []);
    const result = decider.decide('schema');
    expect(result.type).toBe('mcp');
    expect(result.server).toBe('database-inspector');
  });

  it('uses dart-mcp for widgets when available', () => {
    const decider = new DataRetrievalDecider(['dart-mcp'], []);
    const result = decider.decide('widgets');
    expect(result.type).toBe('mcp');
    expect(result.server).toBe('dart-mcp');
  });

  it('uses script for events extraction', () => {
    const decider = new DataRetrievalDecider([], ['extract-events.sh']);
    const result = decider.decide('events');
    expect(result.type).toBe('script');
    expect(result.script).toBe('extract-events.sh');
  });

  it('uses model extraction script when available', () => {
    const decider = new DataRetrievalDecider([], ['extract-models.sh']);
    const result = decider.decide('models');
    expect(result.type).toBe('script');
    expect(result.script).toBe('extract-models.sh');
  });
});
