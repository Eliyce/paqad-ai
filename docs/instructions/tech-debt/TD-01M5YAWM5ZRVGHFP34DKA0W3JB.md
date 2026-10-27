---
id: "TD-01M5YAWM5ZRVGHFP34DKA0W3JB"
title: "Skill Authoring rule RL-70a6 flags the claude.ai compatibility key on every Claude plugin skill"
kind: "gap"
severity: "medium"
status: "open"
files:
  - ".paqad/scripts/rules/_shared/skill-authoring/001-frontmatter-no-invented-keys.mjs"
  - "docs/instructions/rules/_shared/skill-authoring.md"
  - "runtime/claude-plugin/skills"
found_in:
  change: "01M5XRN9CWF9RDTNFC1A21A0SV"
  issue: null
  stage: "review"
found_by: "review"
session: "fc6c87cb-2eca-4348-a38c-19dc8d58585c"
created_at: "2026-10-27T09:26:01.137Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The Skill Authoring rule (docs/instructions/rules/_shared/skill-authoring.md, RL-70a6) lists the allowed SKILL.md front-matter keys as name, description, model_tier, triggers, cacheable, cache_key_inputs, output_format and input_schema, and its heuristic script .paqad/scripts/rules/_shared/skill-authoring/001-frontmatter-no-invented-keys.mjs runs on every SKILL.md. The paqad Claude plugin skills under runtime/claude-plugin/skills (and their source under plugins/discovery/skills) must use only the six keys claude.ai accepts (name, description, license, compatibility, metadata, allowed-tools), which scripts/check-plugin-skills.mjs enforces. So RL-70a6 raises a medium heuristic finding on the compatibility key of all 31 plugin SKILL.md files on every change that touches them. The finding does not block, and no test fails (tests/unit/skills/coverage-completeness.test.ts only covers runtime/base and runtime/capabilities skills). The rule text and its script should say that Claude plugin skills follow the claude.ai key set instead, for example by scoping RL-70a6 away from runtime/claude-plugin/skills and plugins/discovery/skills. Changing the rule is a rule-text edit followed by script regeneration, so it is left out of this change.
