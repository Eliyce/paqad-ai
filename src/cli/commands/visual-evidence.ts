import { Command } from 'commander';

import { activeFeatureDirOrNull } from '@/checks/report-target.js';
import { resolveFrameworkConfig } from '@/core/framework-config.js';
import { readProjectProfile } from '@/core/project-profile.js';
import {
  browserStatus,
  provisionBrowser,
  resolveVeRuntimeDir,
} from '@/visual-evidence/provision.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { attachVisualEvidence, VisualEvidenceAttachError } from '@/visual-evidence/attach.js';
import { AGENT_ATTACHED_JOURNEY } from '@/visual-evidence/types.js';
import { visualEvidenceFlagOn } from '@/visual-evidence/readiness.js';
import { resolveVisualEvidencePlan } from '@/visual-evidence/resolve-plan.js';
import { runVisualEvidence } from '@/visual-evidence/runner.js';
import {
  evaluateFrontendTrigger,
  PACK_REGISTRY_FAULT_REMEDIATION,
  PackRegistryEmptyError,
  packRegistryFaultDetail,
  type FrontendTrigger,
} from '@/visual-evidence/trigger.js';

/**
 * `paqad-ai visual-evidence` (issue #551) — capture screenshots of the documented flows a
 * frontend change affects, as feature-bundle evidence. Everything at runtime is deterministic:
 * no LLM is involved. Four verbs: `run` (scripted captures), `attach` (agent-attached screenshots,
 * issue #579; the two are the only writers of visual-evidence.json + screenshots/), `plan`
 * (dry-run the resolution), and `setup` (provision the browser runtime).
 */
export function createVisualEvidenceCommand(): Command {
  const command = new Command('visual-evidence').description(
    'Capture screenshots of documented flows for frontend changes as feature-bundle evidence',
  );

  command
    .command('run')
    .description(
      'Resolve the plan, boot the app, capture the flows, and write the bundle artifacts',
    )
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--json', 'Emit a machine-readable summary line', false)
    .action(async (options: { projectRoot: string; json: boolean }) => {
      const { projectRoot } = options;
      const profile = readProjectProfile(projectRoot);
      const flag = resolveFrameworkConfig(projectRoot).features.visual_evidence;
      const coding = profile?.active_capabilities?.includes('coding') ?? false;
      if (!flag || !coding) {
        report(
          options.json,
          'skipped',
          'visual evidence is off (flag off or coding capability absent).',
        );
        return;
      }
      const dirName = activeFeatureDirOrNull(projectRoot);
      if (!dirName) {
        report(options.json, 'skipped', 'no active feature bundle — nothing to write into.');
        return;
      }
      const trigger = await triggerOrInstallFault(projectRoot, options.json);
      if (!trigger) return;
      if (!trigger.triggered) {
        report(
          options.json,
          'skipped',
          'not-frontend — no changed file matched a frontend surface.',
        );
        return;
      }

      const result = await runVisualEvidence({
        projectRoot,
        dirName,
        profile,
        trigger: {
          changed_files: trigger.changed_files,
          matched_globs: trigger.matched_globs,
          packs: trigger.packs,
        },
        changedFiles: trigger.matched_files,
      });

      const captured = result.manifest?.steps.filter((s) => s.status === 'captured').length ?? 0;
      const glyph = result.result === 'captured' ? '🟢' : result.result === 'partial' ? '🟡' : '⚪';
      console.log(`**▸ paqad** · visual evidence ${result.result}`);
      console.log(`> ${glyph} ${captured} step(s) captured; ${result.skips.length} skip(s).`);
      for (const skip of result.skips) {
        console.log(`> ⚪ ${skip.reason}: ${skip.detail}`);
      }
      if (options.json) {
        console.log(
          JSON.stringify({ result: result.result, captured, skips: result.skips.length }),
        );
      }
    });

  command
    .command('plan')
    .description(
      'Print the resolved capture plan (journeys, matched files, scripts, skips) — no browser',
    )
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--json', 'Emit JSON', false)
    .action(async (options: { projectRoot: string; json: boolean }) => {
      const { projectRoot } = options;
      const trigger = await triggerOrInstallFault(projectRoot, options.json);
      if (!trigger) return;
      const plan = resolveVisualEvidencePlan(projectRoot, trigger.matched_files);
      if (options.json) {
        console.log(
          JSON.stringify({
            triggered: trigger.triggered,
            matched_files: trigger.matched_files,
            entries: plan.entries.map((e) => ({
              journey_id: e.journey_id,
              capture_script: e.capture_script,
              matched_by: e.matched_by,
            })),
            skips: plan.skips,
          }),
        );
        return;
      }
      console.log('**▸ paqad** · visual-evidence plan');
      console.log(`> ${trigger.triggered ? '🟢' : '⚪'} frontend-triggering: ${trigger.triggered}`);
      for (const entry of plan.entries) {
        console.log(
          `> 🟢 ${entry.journey_id} ← ${entry.capture_script} (${entry.matched_by.length} anchor(s))`,
        );
      }
      for (const skip of plan.skips) {
        console.log(`> ⚪ ${skip.reason}: ${skip.detail}`);
      }
    });

  command
    .command('attach')
    .description(
      'Attach your own PNG screenshots to the active feature bundle as agent-attached visual evidence',
    )
    .argument('<png...>', 'One or more .png screenshots, in order')
    .option('--ac <id>', 'The acceptance criterion these screenshots prove (e.g. AC-3)')
    .option('--label <text>', 'Caption for the screenshots (defaults to each file name)')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option(
      '--session <id>',
      'Session id (defaults to SE_SESSION / CLAUDE_SESSION_ID, then the shared ledger-session cache)',
    )
    .action(
      (
        files: string[],
        options: { ac?: string; label?: string; projectRoot: string; session?: string },
      ) => {
        const { projectRoot } = options;
        const refuse = (reason: string): void => {
          console.error(`▸ paqad · visual evidence attach refused: ${reason}`);
          process.exitCode = 1;
        };
        if (!visualEvidenceFlagOn(projectRoot)) {
          refuse('visual evidence is off (flag off or coding capability absent).');
          return;
        }
        const sessionId = resolveSessionId(
          projectRoot,
          options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null,
        );
        const dirName = currentFeature(projectRoot, sessionId);
        if (!dirName) {
          refuse('no active feature bundle to attach into. Start the change first.');
          return;
        }
        try {
          const result = attachVisualEvidence({
            projectRoot,
            dirName,
            files,
            ...(options.ac ? { ac: options.ac } : {}),
            ...(options.label ? { label: options.label } : {}),
          });
          const attached =
            result.manifest?.steps.filter((step) => step.journey_id === AGENT_ATTACHED_JOURNEY)
              .length ?? 0;
          console.log(
            `▸ paqad · visual evidence: attached ${files.length} screenshot(s); ${attached} agent-attached step(s) in the bundle (source: ${result.manifest?.source ?? 'agent-attached'}).`,
          );
        } catch (error) {
          if (!(error instanceof VisualEvidenceAttachError)) throw error;
          refuse(error.message);
        }
      },
    );

  command
    .command('setup')
    .description(
      'Provision the Playwright + Chromium runtime under ~/.paqad-ai/ve-runtime (idempotent)',
    )
    .option('--json', 'Emit JSON', false)
    .action(async (options: { json: boolean }) => {
      const veRuntime = resolveVeRuntimeDir();
      let status = browserStatus(veRuntime);
      if (status === 'provisioned') {
        report(options.json, 'provisioned', `browser already provisioned at ${veRuntime}.`);
        return;
      }
      console.error('Provisioning Playwright + Chromium (this may take a minute)…');
      try {
        await provisionBrowser(veRuntime);
        status = browserStatus(veRuntime);
        report(options.json, status, `browser ${status} at ${veRuntime}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report(options.json, 'failed', `provisioning failed: ${message}`);
        process.exitCode = 1;
      }
    });

  return command;
}

/**
 * Evaluate the frontend trigger, or print the install-fault line and set exit code 1 when the
 * built-in pack registry is empty (issue #579). Returns null on that fault.
 */
async function triggerOrInstallFault(
  projectRoot: string,
  json: boolean,
): Promise<FrontendTrigger | null> {
  try {
    return await evaluateFrontendTrigger(projectRoot);
  } catch (error) {
    if (!(error instanceof PackRegistryEmptyError)) throw error;
    report(
      json,
      'install-fault',
      `${packRegistryFaultDetail(error.runtimeRoot)} Next: ${PACK_REGISTRY_FAULT_REMEDIATION}`,
    );
    process.exitCode = 1;
    return null;
  }
}

/** Emit a one-line human message (and, with --json, a machine line). */
function report(json: boolean, status: string, message: string): void {
  console.log(`**▸ paqad** · visual evidence: ${message}`);
  if (json) {
    console.log(JSON.stringify({ status }));
  }
}
