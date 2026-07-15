# .paqad/configs/.config.app — Application, version, enterprise, and feature flags
#
# The framework master switch, the background version/update policy, the licensed
# enterprise/governance switches, and the planning feature flags.
#
# Every key below is COMMENTED OUT, so paqad uses its built-in default until you
# uncomment a line to override it. Precedence, highest first: PAQAD_* env var >
# your local ../.config > these tracked team files > code default. This file is
# tracked; `paqad-ai update` refreshes it and keeps every value you uncommented.

# ── Framework master switch ─────────────────────────────────
# Turn paqad off entirely (vanilla mode). Absent/true = on. (env: PAQAD_ENABLE)
# paqad_enable=true

# ── Version & updates ───────────────────────────────────────
# Pull newer framework versions in the background on session start. (env: PAQAD_AUTO_UPDATE)
# auto_update=true
# Refuse to run below this version. "latest" = no fixed floor, track newest. Or pin e.g. 1.28.1. (env: PAQAD_MINIMUM_VERSION)
# minimum_version=latest
# How often the background version check runs. (env: PAQAD_VERSION_CHECK_INTERVAL_HOURS)
# version_check_interval_hours=12

# ── Enterprise / governance (licensed, off by default) ──────
# Master switch for the enterprise/governance capabilities. (env: PAQAD_ENTERPRISE)
enterprise=true
# Write the receipt + evidence ledger set under .paqad/ledger/. (env: PAQAD_ENTERPRISE_EVIDENCE_LEDGER)
enterprise_evidence_ledger=true
# Write the CycloneDX ai-bom.json view. (env: PAQAD_ENTERPRISE_AI_BOM)
enterprise_ai_bom=true
# Resolve framework citations into the receipt (token-spending path). (env: PAQAD_ENTERPRISE_COMPLIANCE_CITATIONS)
enterprise_compliance_citations=true

# ── Feature flags ───────────────────────────────────────────
# Stop after the spec phase; do not implement. (env: PAQAD_SPEC_ONLY_MODE)
# spec_only_mode=false
# Enable the market-research agent in planning. (env: PAQAD_MARKET_RESEARCH)
market_research=true
# Enable the design-research agent in planning. (env: PAQAD_DESIGN_RESEARCH)
# design_research=false
# Use the multi-agent team for full-lane work. (env: PAQAD_TEAM_AGENTS)
# team_agents=true

# ── Added in a newer paqad version ────────────────────────────
# Opt in to complementary analytics instrumentation (issue #241, refined #279). OFF (default) is silent; ON authorizes wiring tracking + a per-event tracking-plan doc. (env: PAQAD_ANALYTICS_INSTRUMENTATION)
# analytics_instrumentation=false

# ── Added in a newer paqad version ────────────────────────────
# Token-neutral rule loading (issue #284). ON (default) delivers the lean rule contract (manifest + only the rule text that applies to the files in play) and lifts the full-load mandate. OFF restores loading docs/instructions/rules in full every session. (env: PAQAD_LEAN_RULES)
# lean_rules=true

# ── Added in a newer paqad version ────────────────────────────
# Render a per-feature evidence report.html from the bundle at end-of-change (issue #371). ON (default) is local, free, and zero-LLM. OFF stops writing the page. (env: PAQAD_FEATURE_REPORT)
feature_report=true
