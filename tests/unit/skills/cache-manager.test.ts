import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SkillCacheManager } from '@/skills/cache-manager.js';

describe('SkillCacheManager', () => {
  it('cache miss returns hit false', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skill-cache-'));
    const input = join(root, 'schema.md');
    writeFileSync(input, '# schema');

    const result = await new SkillCacheManager(root).checkCache('database-design-review', [input]);
    expect(result).toEqual({
      hit: false,
      input_hash: expect.any(String),
    });
  });

  it('cache hit returns cached result', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skill-cache-'));
    const input = join(root, 'schema.md');
    writeFileSync(input, '# schema');

    const manager = new SkillCacheManager(root);
    const miss = await manager.checkCache('database-design-review', [input]);
    await manager.writeCache('database-design-review', miss.input_hash!, { findings: ['ok'] }, [
      input,
    ]);

    const result = await manager.checkCache('database-design-review', [input]);
    expect(result).toEqual({
      hit: true,
      input_hash: miss.input_hash,
      result: { findings: ['ok'] },
    });
  });

  it('input file change invalidates cache', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skill-cache-'));
    const input = join(root, 'schema.md');
    writeFileSync(input, '# schema');

    const manager = new SkillCacheManager(root);
    const miss = await manager.checkCache('database-design-review', [input]);
    await manager.writeCache('database-design-review', miss.input_hash!, { findings: ['ok'] }, [
      input,
    ]);

    writeFileSync(input, '# schema changed');
    const next = await manager.checkCache('database-design-review', [input]);

    expect(next.hit).toBe(false);
    expect(next.input_hash).not.toBe(miss.input_hash);
  });

  it('invalidateModule removes correct entries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skill-cache-'));
    const billing = join(root, 'docs/modules/billing/schema.md');
    const checkout = join(root, 'docs/modules/checkout/schema.md');
    mkdirSync(join(root, 'docs/modules/billing'), { recursive: true });
    mkdirSync(join(root, 'docs/modules/checkout'), { recursive: true });
    writeFileSync(billing, '# billing');
    writeFileSync(checkout, '# checkout');

    const manager = new SkillCacheManager(root);
    const billingHash = await manager.computeInputHash([billing]);
    const checkoutHash = await manager.computeInputHash([checkout]);

    await manager.writeCache('billing-review', billingHash, { findings: [] }, [billing]);
    await manager.writeCache('checkout-review', checkoutHash, { findings: [] }, [checkout]);

    const removed = await manager.invalidateModule('billing');
    const stats = await manager.getStats();

    expect(removed).toBe(1);
    expect(stats.total_entries).toBe(1);
  });

  it('computeInputHash is deterministic', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skill-cache-'));
    const first = join(root, 'a.md');
    const second = join(root, 'b.md');
    writeFileSync(first, 'alpha');
    writeFileSync(second, 'beta');

    const manager = new SkillCacheManager(root);
    const left = await manager.computeInputHash([first, second]);
    const right = await manager.computeInputHash([second, first]);

    expect(left).toBe(right);
  });

  it('never caches skills with cacheable: false', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skill-cache-'));
    const input = join(root, 'api-doc.md');
    writeFileSync(input, '# api doc');

    const manager = new SkillCacheManager(root);
    const miss = await manager.checkCache('api-doc-maintainer', [input]);
    await manager.writeCache('api-doc-maintainer', miss.input_hash!, { result: 'test' }, [input]);

    const check = await manager.checkCache('api-doc-maintainer', [input]);
    const stats = await manager.getStats();

    expect(check.hit).toBe(false);
    expect(stats.total_entries).toBe(0);
  });
});
