---
id: "TD-01M7859TVCDA6A80X2VFSHJA2J"
title: "ChatGPT directory listing text no longer names the refine, size and sprint skills it still ships"
kind: "follow-up"
severity: "low"
status: "open"
files:
  - "plugins/discovery/build/skills.yml"
found_in:
  change: "01M77Y10DBA2ZPCGAA0GTC0QF4"
  issue: "890"
  stage: "review"
found_by: "paqad-review"
session: "08836cd6-d63d-4462-b84b-03f79333848d"
created_at: "2026-11-12T15:16:28.617Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

The shared listing text in plugins/discovery/build/skills.yml (description, long_description, capabilities, default_prompts, keywords) was rewritten without refine, size or sprint for the discovery plugin. The ChatGPT directory package (dist/hosts/chatgpt-directory) reuses that text but still ships refine-ticket, size-work and plan-sprint, and its start skill still routes to them. Its listing now under-describes what it does, and its displayName changed from "Paqad Product Discovery" to "paqad discovery". The spec allows shared listing text changes (non-goal: no change beyond shared listing text), so this is out of scope for this change. Follow-up: give the ChatGPT directory target its own listing text, or drop those skills from it, before the next directory submission.
