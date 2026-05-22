import type { SkillCacheManager } from '../skills/cache-manager.js';

export class CacheWarmer {
  constructor(private readonly cacheManager: SkillCacheManager) {}

  async prewarm(skillName: string, predictedInputFiles: string[]): Promise<boolean> {
    try {
      const existing = await this.cacheManager.checkCache(skillName, predictedInputFiles);
      if (existing.hit) return false; // already cached, no need to prewarm

      // Use the canonical hash algorithm from the cache manager so prewarm writes
      // under the same key that checkCache will look up at runtime.
      const inputHash = await this.cacheManager.computeInputHash(predictedInputFiles);

      // Write a placeholder prewarm marker so the cache entry key is pre-registered
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
