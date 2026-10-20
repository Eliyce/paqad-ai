import type { SkillCacheManager } from '../skills/cache-manager.js';

export class CacheWarmer {
  constructor(private readonly cacheManager: SkillCacheManager) {}

  async prewarm(skillName: string, predictedInputFiles: string[]): Promise<boolean> {
    try {
      const existing = await this.cacheManager.checkCache(skillName, predictedInputFiles);
      if (existing.hit) return false;

      const inputHash = await this.cacheManager.computeInputHash(predictedInputFiles);

      await this.cacheManager.writeCache(
        skillName,
        inputHash,
        '[prewarm-pending]',
        predictedInputFiles,
      );
      return true;
    } catch {
      return false;
    }
  }
}
