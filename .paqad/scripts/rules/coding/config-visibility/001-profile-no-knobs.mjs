// @paqad-rule-script
// rule_id: RL-a9c3
// source: docs/instructions/rules/coding/config-visibility.md
// kind: deterministic
// scope: changed-files
// runtime: node
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
const payload = JSON.parse(readFileSync(0, 'utf8'));
const projectRoot = payload.projectRoot;
// test fixtures deliberately contain violations — they are samples, not code
const files = payload.files.filter((f) => !/(^|\/)(__fixtures__|fixtures)(\/|$)/.test(f));
const findings = [];
const read = (rel) => { try { return readFileSync(join(projectRoot, rel), 'utf8'); } catch { return null; } };
const KNOBS = new Set(['analytics_instrumentation','analytics_strictness','auto_update','block_on_stale_docs','decisions_ask_threshold','decisions_idle_timeout_minutes','decisions_max_screens_per_task','design_research','enterprise','enterprise_ai_bom','enterprise_compliance_citations','enterprise_evidence_ledger','escalate_db_row_threshold','escalate_destructive_operations','escalate_risky_migrations','escalate_security_findings','full_lane_default','lean_rules','market_research','minimum_version','model_default','model_fast','model_reasoning','paqad_enable','rag_base_branch','rag_embedding_model','rag_embedding_provider','rag_enabled','rag_max_file_size','rag_similarity_threshold','rag_top_n','require_adversarial_review','require_db_review_for_migrations','research_depth','rule_compliance','spec_only_mode','stages_mode','team_agents','version_check_interval_hours']);
for (const file of files) {
  if (basename(file) !== 'project-profile.yaml') continue;
  const text = read(file); if (text === null) continue;
  text.split('\n').forEach((line, i) => {
    const m = /^([a-z_]+):/.exec(line);
    if (m && KNOBS.has(m[1])) findings.push({ file, line: i + 1, message: `framework knob "${m[1]}" belongs in the .config layer, not project-profile.yaml (hard cutover)`, severity: 'high' });
  });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-a9c3', kind: 'deterministic', findings }));
