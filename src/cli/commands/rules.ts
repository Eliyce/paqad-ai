import { Command } from 'commander';

import { resolveRuleApplicabilityForChange } from '@/context/rule-context.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { writeRulesLoaded } from '@/feature-evidence/rules-loaded.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
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

  command
    .command('load')
    .description(
      'Load the rules that apply to this change and record it (issue #557): prints the ' +
        'applicable full rule text and writes rules-loaded.json into the active feature bundle',
    )
    .option('--project-root <path>', 'Project root', process.cwd())
    .option(
      '--session <id>',
      'Session id (defaults to SE_SESSION / CLAUDE_SESSION_ID, then the shared ledger-session cache)',
    )
    .option('--silent', 'Suppress the machine-readable summary line', false)
    .action(async (options: { projectRoot: string; session?: string; silent: boolean }) => {
      const sessionId = resolveSessionId(
        options.projectRoot,
        options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null,
      );
      const applicability = await resolveRuleApplicabilityForChange(options.projectRoot);

      if (!applicability.hasStore) {
        console.log(
          '▸ paqad · no compiled rules for this project — nothing to load. Run ' +
            '`paqad-ai rules compile` if you expected rules here.',
        );
        if (!options.silent) {
          console.log(JSON.stringify({ loaded: false, reason: 'no-compiled-rules' }));
        }
        return;
      }

      // Surface the applicable full rule text so running the verb actually LOADS the rules
      // into the agent's context (the tool result), independent of the route — this is the
      // load, not a rubber stamp.
      console.log(
        `## Rules loaded for this change — ${applicability.applicable.length} apply` +
          `\n\n${applicability.loadedRuleText}\n`,
      );

      const record = writeRulesLoaded(options.projectRoot, sessionId, {
        applicable: applicability.applicable,
        ruleTextHash: applicability.ruleTextHash,
        changedPaths: applicability.changedPaths,
      });

      if (!record) {
        console.log(
          '▸ paqad · loaded the applicable rules, but no feature is active so nothing was ' +
            'recorded — run `paqad-ai stage start planning` to open the change first.',
        );
        if (!options.silent) {
          console.log(
            JSON.stringify({ loaded: true, recorded: false, reason: 'no-active-feature' }),
          );
        }
        return;
      }

      const dirName = currentFeature(options.projectRoot, sessionId);
      console.log(
        `▸ paqad · loaded and recorded ${record.applicable_rules.length} applicable ` +
          `rule${record.applicable_rules.length === 1 ? '' : 's'} for this change.`,
      );
      if (!options.silent) {
        console.log(
          JSON.stringify({
            loaded: true,
            recorded: true,
            rules: record.applicable_rules.length,
            rule_text_hash: record.rule_text_hash,
            bundle: dirName,
          }),
        );
      }
    });

  return command;
}
