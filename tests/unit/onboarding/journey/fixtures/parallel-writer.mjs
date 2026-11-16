import process from 'node:process';
import { register } from 'node:module';

register('./ts-loader.mjs', import.meta.url);

const [root, count, label] = process.argv.slice(2);
const store = await import('../../../../../src/onboarding/journey/run-store.ts');
const events = await import('../../../../../src/onboarding/journey/events.ts');
for (let i = 0; i < Number(count); i += 1) {
  store.updateRun(root, (run) => {
    run.providers = [...run.providers, `${label}-${i}`];
  });
  events.appendEvent(root, {
    ts: new Date(0).toISOString(),
    run_id: 'run-parallel',
    kind: 'unit',
    stage: 'module_docs',
    unit: `${label}-${i}`,
  });
}
