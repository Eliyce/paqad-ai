import { Command } from 'commander';

import { resolveRuleApplicabilityForChange } from '@/context/rule-context.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { writeRulesLoaded } from '@/feature-evidence/rules-loaded.js';
import { readLedgerSessionId, resolveSessionId } from '@/rag-ledger/session.js';
import { compileRuleScripts } from '@/rule-scripts/compile.js';
import { applyRuleOverride } from '@/rule-scripts/override.js';

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
        `**▸ paqad** · compiled the rule-script map — ${result.ruleCount} ` +
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
      'Load the rules that apply to this change and record it: prints the ' +
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
      const applicability = await resolveRuleApplicabilityForChange(options.projectRoot, sessionId);

      if (!applicability.hasStore) {
        console.log(
          '**▸ paqad** · no compiled rules for this project — nothing to load. Run ' +
            '`paqad-ai rules compile` if you expected rules here.',
        );
        if (!options.silent) {
          console.log(JSON.stringify({ loaded: false, reason: 'no-compiled-rules' }));
        }
        return;
      }

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
          '**▸ paqad** · loaded the applicable rules, but no feature is active so nothing was ' +
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
        `**▸ paqad** · loaded and recorded ${record.applicable_rules.length} applicable ` +
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

  command
    .command('override')
    .description(
      'Record a person allowing one edit past a rule-script stop, using the one-time token ' +
        'from that stop (refused for a stop enforced by managed settings)',
    )
    .requiredOption('--rule <id>', 'Rule id from the stop')
    .requiredOption('--file <path>', 'File named by the stop')
    .requiredOption('--token <token>', 'One-time token from the stop')
    .option('--tool-use-id <id>', 'Tool call the stop was for')
    .option('--reason <text>', 'Why the person allowed it')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--session <id>', 'Session id (defaults to SE_SESSION / CLAUDE_SESSION_ID)')
    .action((options: RuleOverrideOptions) => {
      const outcome = applyRuleOverride({
        projectRoot: options.projectRoot,
        sessionHint:
          options.session ??
          process.env.SE_SESSION ??
          process.env.CLAUDE_SESSION_ID ??
          readLedgerSessionId(options.projectRoot),
        rule: options.rule,
        file: options.file,
        token: options.token,
        toolUseId: options.toolUseId,
        reason: options.reason,
      });
      if (!outcome.ok) {
        console.error(`**▸ paqad** · override refused: ${outcome.reason}.`);
        process.exitCode = 1;
        return;
      }
      console.log(
        `**▸ paqad** · recorded a one-time override of ${outcome.row.rule} on ` +
          `${outcome.row.file} by a person. It shows on the receipt.`,
      );
      console.log(JSON.stringify({ overridden: true, ...outcome.row, bundle: outcome.dirName }));
    });

  return command;
}

interface RuleOverrideOptions {
  rule: string;
  file: string;
  token: string;
  toolUseId?: string;
  reason?: string;
  projectRoot: string;
  session?: string;
}
