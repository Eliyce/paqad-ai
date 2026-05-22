import { describe, expect, it } from 'vitest';

import { ContextHitTracker } from '@/context/hit-tracker.js';

describe('ContextHitTracker', () => {
  it('returns hit rate 0 when no files loaded', () => {
    const tracker = new ContextHitTracker('sess-1', 'impl');
    const result = tracker.computeHitRate();
    expect(result.hit_rate).toBe(0);
    expect(result.files_loaded).toBe(0);
  });

  it('returns hit rate 1.0 when all loaded files are referenced', () => {
    const tracker = new ContextHitTracker('sess-1', 'impl');
    tracker.recordLoaded(['a.ts', 'b.ts']);
    tracker.recordReferenced('a.ts');
    tracker.recordReferenced('b.ts');
    const result = tracker.computeHitRate();
    expect(result.hit_rate).toBe(1.0);
    expect(result.unreferenced_files).toEqual([]);
  });

  it('returns correct hit rate when some files unreferenced', () => {
    const tracker = new ContextHitTracker('sess-1', 'impl', 'story-03');
    tracker.recordLoaded(['a.ts', 'b.ts', 'c.ts', 'd.ts']);
    tracker.recordReferenced('a.ts');
    tracker.recordReferenced('c.ts');
    const result = tracker.computeHitRate();
    expect(result.hit_rate).toBe(0.5);
    expect(result.unreferenced_files).toEqual(['b.ts', 'd.ts']);
    expect(result.story).toBe('story-03');
  });

  it('returns hit rate 0 when nothing referenced', () => {
    const tracker = new ContextHitTracker('sess-1', 'impl');
    tracker.recordLoaded(['a.ts', 'b.ts']);
    const result = tracker.computeHitRate();
    expect(result.hit_rate).toBe(0);
    expect(result.unreferenced_files).toEqual(['a.ts', 'b.ts']);
  });

  it('deduplicates loaded and referenced files', () => {
    const tracker = new ContextHitTracker('sess-1', 'impl');
    tracker.recordLoaded(['a.ts', 'a.ts', 'b.ts']);
    tracker.recordReferenced('a.ts');
    tracker.recordReferenced('a.ts');
    const result = tracker.computeHitRate();
    expect(result.files_loaded).toBe(2);
    expect(result.files_referenced).toBe(1);
  });

  it('includes timestamp in ISO format', () => {
    const tracker = new ContextHitTracker('sess-1', 'impl');
    const result = tracker.computeHitRate();
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('reset clears all state', () => {
    const tracker = new ContextHitTracker('sess-1', 'impl');
    tracker.recordLoaded(['a.ts']);
    tracker.recordReferenced('a.ts');
    tracker.reset();
    const result = tracker.computeHitRate();
    expect(result.files_loaded).toBe(0);
    expect(result.files_referenced).toBe(0);
  });
});
