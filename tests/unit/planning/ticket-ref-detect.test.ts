import { describe, expect, it } from 'vitest';

import { armIntakeNarration, detectTicketRefs } from '@/planning/ticket-ref-detect.js';

import { ticketRef } from '../../shared/ticket-ref.js';

describe('detectTicketRefs', () => {
  it('finds a Jira key for a jira tracker', () => {
    expect(detectTicketRefs('please do PQD-123 now', 'jira')).toEqual(['PQD-123']);
  });

  it('finds a GitHub ref for a github-issues tracker', () => {
    expect(detectTicketRefs(`fix ${ticketRef(45)} and ship`, 'github-issues')).toEqual([
      ticketRef(45),
    ]);
  });

  it('a jira tracker ignores a GitHub-style ref (and vice versa)', () => {
    expect(detectTicketRefs(`see ${ticketRef(45)}`, 'jira')).toEqual([]);
    expect(detectTicketRefs('see PQD-9', 'github-issues')).toEqual([]);
  });

  it('generic matches both shapes and dedupes in first-seen order', () => {
    expect(detectTicketRefs('PQD-1 then #2 then PQD-1 again', 'generic')).toEqual(['PQD-1', '#2']);
  });

  it('does not match a bare number or a path fragment as a GitHub ref', () => {
    expect(detectTicketRefs('the number 45 and a/path#3x', 'github-issues')).toEqual([]);
  });

  it('returns [] when there is no ref', () => {
    expect(detectTicketRefs('just some prose', 'jira')).toEqual([]);
  });
});

describe('armIntakeNarration', () => {
  it('names the exact deterministic fetch verb for the first ref', () => {
    const line = armIntakeNarration(['PQD-123', 'PQD-9']);
    expect(line).toContain('▸ paqad');
    expect(line).toContain('PQD-123, PQD-9');
    expect(line).toContain('paqad-ai intake fetch PQD-123');
  });

  it('is empty when there are no refs', () => {
    expect(armIntakeNarration([])).toBe('');
  });
});
