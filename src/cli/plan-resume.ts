import { SliceExecutor } from '@/planning/slice-executor.js';

export async function resumePlanExecution(projectRoot: string, slug: string) {
  return new SliceExecutor().resume(projectRoot, slug);
}
