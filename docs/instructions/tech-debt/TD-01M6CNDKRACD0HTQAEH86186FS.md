---
id: "TD-01M6CNDKRACD0HTQAEH86186FS"
title: "Rule RL-70a6 still teaches top-level paqad skill keys and flags metadata on every paqad skill"
kind: "gap"
severity: "medium"
status: "open"
files:
  - ".paqad/scripts/rules/_shared/skill-authoring/001-frontmatter-no-invented-keys.mjs"
  - "docs/instructions/rules/_shared/skill-authoring.md"
found_in:
  change: "01M6C9EFA7XZX6DXB3QPRXS7RH"
  issue: "796"
  stage: "review"
found_by: "paqad-review"
session: "f8332752-20fc-5e2a-a0e4-9b2570786496"
created_at: "2026-11-01T22:59:25.525Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

Rule RL-70a6 (docs/instructions/rules/_shared/skill-authoring.md:18) still lists `model_tier`, `triggers`, `cacheable`, `cache_key_inputs`, `output_format` and `input_schema` as the top-level SKILL.md keys to use. Its heuristic script `.paqad/scripts/rules/_shared/skill-authoring/001-frontmatter-no-invented-keys.mjs` now raises a medium finding on the `metadata` key of every paqad skill (121 rows in the review digest of change 01M6C9EFA7XZX6DXB3QPRXS7RH).

The change moved paqad's custom keys under `metadata` and `skill.meta.yaml` and narrowed `PAQAD_RUNTIME_SKILL_FIELDS` (src/authoring/lint/fields.ts), so a top-level `model_tier` now blocks under SK-006. An author who follows RL-70a6 as written gets blocked by the skill lint. `metadata` is a standard Agent Skills key.

## Fix

Rewrite RL-70a6 to name the Agent Skills key set plus `metadata` (with `paqad-meta` pointing at `skill.meta.yaml`). Then regenerate the rule script through the rules workflow so the `metadata` false positive goes away. The related TD-01M5YAWM5ZRVGHFP34DKA0W3JB covers the `compatibility` key on plugin skills.
