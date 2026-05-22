import type { ContextHitEntry } from '@/core/types/context.js';

export interface HitTrackerInput {
  session_id: string;
  phase: string;
  story?: string;
}

export class ContextHitTracker {
  private readonly loaded = new Set<string>();
  private readonly referenced = new Set<string>();
  private readonly input: HitTrackerInput;

  constructor(sessionId: string, phase: string, story?: string);
  constructor(input: HitTrackerInput);
  constructor(sessionIdOrInput: string | HitTrackerInput, phase?: string, story?: string) {
    this.input =
      typeof sessionIdOrInput === 'string'
        ? { session_id: sessionIdOrInput, phase: phase ?? 'unknown', story }
        : sessionIdOrInput;
  }

  recordLoaded(files: string[]): void {
    files.forEach((file) => this.loaded.add(file));
  }

  recordReferenced(file: string): void {
    this.referenced.add(file);
  }

  computeHitRate(): ContextHitEntry {
    const filesLoaded = this.loaded.size;
    const filesReferenced = this.referenced.size;
    const hitRate = filesLoaded === 0 ? 0 : filesReferenced / filesLoaded;
    const unreferencedFiles = [...this.loaded].filter((file) => !this.referenced.has(file)).sort();

    return {
      session_id: this.input.session_id,
      phase: this.input.phase,
      story: this.input.story,
      files_loaded: filesLoaded,
      files_referenced: filesReferenced,
      hit_rate: Math.round(hitRate * 100) / 100,
      unreferenced_files: unreferencedFiles,
      timestamp: new Date().toISOString(),
    };
  }

  reset(): void {
    this.loaded.clear();
    this.referenced.clear();
  }
}
