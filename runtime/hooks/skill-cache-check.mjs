import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', () => {
  const parsed = JSON.parse(input || '{}');

  if (!parsed.cache_dir || !parsed.skill_name) {
    process.stderr.write(
      JSON.stringify({ message: 'skill-cache-check: missing cache_dir or skill_name' }),
    );
    process.exit(2);
  }

  const files = (parsed.input_files ?? []).slice().sort();
  const hash = createHash('sha256');
  for (const file of files) {
    if (!existsSync(file)) {
      // Skip missing files instead of crashing — file may have been deleted
      continue;
    }
    hash.update(readFileSync(file, 'utf8'));
  }
  const digest = hash.digest('hex');
  const cachePath = join(parsed.cache_dir, `${parsed.skill_name}-${digest}.json`);
  mkdirSync(dirname(cachePath), { recursive: true });

  if (parsed.write_result !== undefined) {
    writeFileSync(
      cachePath,
      JSON.stringify(
        {
          skill_name: parsed.skill_name,
          input_hash: digest,
          result: parsed.write_result,
          created_at: new Date().toISOString(),
          files_hashed: files,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  if (!existsSync(cachePath)) {
    process.exit(1);
  }

  process.stdout.write(readFileSync(cachePath, 'utf8'));
  process.exit(0);
});
