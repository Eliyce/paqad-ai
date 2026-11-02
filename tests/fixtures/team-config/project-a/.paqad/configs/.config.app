# .paqad/configs/.config.app — Application, version, enterprise, and feature flags
#
# Every key below is COMMENTED OUT, so paqad uses its built-in default until you
# uncomment a line to override it.

# ── Framework master switch ─────────────────────────────────
# Turn paqad off entirely (vanilla mode). Absent/true = on. (env: PAQAD_ENABLE)
# paqad_enable=true

# ── Enterprise / governance (licensed, off by default) ──────
# Master switch for the enterprise/governance capabilities. (env: PAQAD_ENTERPRISE)
enterprise=true
# Write the receipt + evidence ledger set under .paqad/ledger/. (env: PAQAD_ENTERPRISE_EVIDENCE_LEDGER)
enterprise_evidence_ledger=true

# ── Feature flags ───────────────────────────────────────────
# Enable the market-research agent in planning. (env: PAQAD_MARKET_RESEARCH)
market_research=true
# Build the site map. (env: PAQAD_SITE_MAP)
site_map=true
