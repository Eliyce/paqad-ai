import { Command } from 'commander';

import { compileRuleScripts } from '@/rule-scripts/compile.js';

/**
 * `paqad-ai rules compile` — generate/refresh `rule-script-map.yml` from the rule
 * tree (issue #319). The rule-scripts enforcement engine was live but disarmed on
 * every fresh project because nothing produced the map it needs; this verb closes
 * that. Onboarding runs it after the rule refresh, and it can be re-run whenever
 * rules change (the reconciler detects drift). Deterministic: it lists every rule
 * and carries over any scripts already bound, but authors no scripts itself.
 */
export function createRulesCommand(): Command {
  const command = new Command('rules').description('Manage the rules-as-scripts enforcement map');

  command
    .command('compile')
    .description('Generate or refresh rule-script-map.yml from the rule tree (arms the gate)')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--silent', 'Suppress the machine-readable summary line', false)
    .action((options: { projectRoot: string; silent: boolean }) => {
      const result = compileRuleScripts(options.projectRoot);
      console.log(
        `▸ paqad · compiled the rule-script map — ${result.ruleCount} ` +
          `rule${result.ruleCount === 1 ? '' : 's'} listed, ${result.scriptedCount} ` +
          `script-enforced. The deterministic gate is armed.`,
      );
      if (!options.silent) {
        console.log(
          JSON.stringify({
            compiled: true,
            rules: result.ruleCount,
            scripted: result.scriptedCount,
          }),
        );
      }
    });

  return command;
}
