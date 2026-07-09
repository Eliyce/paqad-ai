import { Command } from 'commander';

import { FRAMEWORK_CONFIG_SPECS, readConfigsDir, readDotConfig } from '@/core/framework-config.js';
import { resolveRuleComplianceMode } from '@/kernel/capability.js';
import { resolveStagesMode } from '@/stage-evidence/mode.js';

/**
 * `paqad-ai config effective` (issue #326) — print, per knob, the value that ACTUALLY
 * binds, which surface it came from, and which gate consumes it. It turns the invisible
 * "which setting wins?" question into one command, and exposes the two-truth placebos:
 * a knob whose `consumed by:` is `NOTHING` is a setting a team can change with no effect,
 * because no running code reads it. Strictly read-only — it never writes any config.
 *
 * The consumer map is hand-curated and honest (`NOTHING` only for knobs verified to have
 * no runtime consumer). `rule_compliance` and `stages_mode` are shown via their real
 * floored resolvers, so the yaml/tracked stricter-of truth (#319) is visible, not the
 * raw surface value.
 */

/** The `NOTHING` sentinel: a knob no running code reads (a placebo). */
const NOTHING = 'NOTHING';

/**
 * Knob → the gate/consumer that reads it, or `NOTHING` when nothing does. Verified by
 * source scan (issue #326): the `NOTHING` set is the "two-truth" strictness/escalation/
 * decision-threshold/research knobs that map to `feature-development.yaml` policy fields
 * no code consumes today.
 */
const KNOB_CONSUMERS: Record<string, string> = {
  paqad_enable: 'enablement gate (bootstrap + every hook)',
  auto_update: 'silent background update',
  minimum_version: 'silent update (version floor)',
  version_check_interval_hours: 'background version check',
  enterprise: 'enterprise policy (ledger/receipt master switch)',
  enterprise_evidence_ledger: 'evidence ledger writer',
  enterprise_ai_bom: 'AI-BOM projector',
  enterprise_compliance_citations: 'compliance-citation resolver',
  spec_only_mode: 'onboarding orchestrator (planning)',
  market_research: 'market-research agent (planning)',
  design_research: 'design-research agent (planning)',
  team_agents: 'full-lane team routing',
  analytics_instrumentation: 'analytics gate + classifier',
  lean_rules: 'context seam (rule injection)',
  rag_enabled: 'context seam / retrieval',
  rag_embedding_provider: 'RAG embedding provider',
  rag_embedding_model: 'RAG embedding model',
  rag_similarity_threshold: 'RAG hybrid scoring',
  rag_top_n: 'RAG retrieval depth',
  rag_max_file_size: 'RAG index build',
  rag_base_branch: 'branch-aware RAG index',
  research_depth: NOTHING,
  model_default: 'model selection (skills/model-selector)',
  model_reasoning: 'model routing (budget optimizer)',
  model_fast: 'model routing (budget optimizer)',
  full_lane_default: NOTHING,
  require_adversarial_review: NOTHING,
  block_on_stale_docs: NOTHING,
  require_db_review_for_migrations: NOTHING,
  escalate_destructive_operations: NOTHING,
  escalate_risky_migrations: NOTHING,
  escalate_security_findings: NOTHING,
  escalate_db_row_threshold: NOTHING,
  decisions_ask_threshold: NOTHING,
  decisions_max_screens_per_task: NOTHING,
  decisions_idle_timeout_minutes: NOTHING,
  stages_mode: 'stages capability gate (pre-code block)',
  rule_compliance: 'rule-scripts capability gate',
  analytics_strictness: 'analytics AC-track gate',
};

interface EffectiveKnob {
  key: string;
  value: string;
  surface: string;
  consumed_by: string;
}

/** Resolve every knob's effective value + winning surface + consumer. Read-only. */
export function resolveEffectiveConfig(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): EffectiveKnob[] {
  const localMap = readDotConfig(projectRoot);
  const teamMap = readConfigsDir(projectRoot).merged;

  return FRAMEWORK_CONFIG_SPECS.map((spec) => {
    const envVal = env[spec.env];
    let value: string;
    let surface: string;
    if (envVal !== undefined && envVal.trim() !== '') {
      value = envVal;
      surface = `env:${spec.env}`;
    } else if (localMap.has(spec.key)) {
      value = localMap.get(spec.key) ?? '';
      surface = 'local .paqad/.config';
    } else if (teamMap.has(spec.key)) {
      value = teamMap.get(spec.key) ?? '';
      surface = 'team configs/.config.*';
    } else {
      value = spec.default === undefined ? '(unset)' : String(spec.default);
      surface = 'default';
    }

    // The two floored knobs (#319): show the value the gate actually uses (the
    // stricter of tracked/yaml + local/env), not the raw surface value.
    if (spec.key === 'rule_compliance') {
      value = resolveRuleComplianceMode(projectRoot, env);
      surface = `${surface} → floored`;
    } else if (spec.key === 'stages_mode') {
      value = resolveStagesMode(projectRoot, env);
      surface = `${surface} → floored`;
    }

    return { key: spec.key, value, surface, consumed_by: KNOB_CONSUMERS[spec.key] ?? NOTHING };
  });
}

export function createConfigCommand(): Command {
  const command = new Command('config').description('Inspect the framework configuration');

  command
    .command('effective')
    .description(
      'Print, per knob, the value that actually binds, its source surface, and the gate ' +
        'that consumes it (consumed by: NOTHING flags a placebo). Read-only.',
    )
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--json', 'emit machine-readable JSON')
    .action((options: { projectRoot: string; json?: boolean }) => {
      const knobs = resolveEffectiveConfig(options.projectRoot);
      if (options.json) {
        console.log(JSON.stringify({ knobs }, null, 2));
        return;
      }
      const keyWidth = Math.max(...knobs.map((knob) => knob.key.length));
      const valWidth = Math.max(...knobs.map((knob) => knob.value.length), 5);
      for (const knob of knobs) {
        console.log(
          `${knob.key.padEnd(keyWidth)}  ${knob.value.padEnd(valWidth)}  ` +
            `[${knob.surface}]  consumed by: ${knob.consumed_by}`,
        );
      }
      const placebos = knobs.filter((knob) => knob.consumed_by === NOTHING).length;
      console.log(
        `\n${knobs.length} knobs · ${placebos} with no consumer (placebo — no running code reads them).`,
      );
    });

  return command;
}
