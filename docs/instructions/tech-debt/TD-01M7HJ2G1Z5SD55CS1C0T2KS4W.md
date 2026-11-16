---
id: "TD-01M7HJ2G1Z5SD55CS1C0T2KS4W"
title: "engines.node allows Node versions commander 15 does not support"
kind: "bug"
severity: "medium"
status: "open"
files:
  - "package.json"
found_in:
  change: null
  issue: null
  stage: null
found_by: "orchestrator"
session: "7f9f31a9-4447-5b01-a192-8d0f55ad2feb"
created_at: "2026-11-16T06:52:49.521Z"
reopened_at: null
issue: null
closed_reason: null
---

## What

## What

package.json declares engines.node >=22.0.0, but commander 15 needs Node 22.12.0 or later, so installs on Node 22.0 to 22.11 accept a CLI that may not start. Raise engines.node to >=22.12.0 and update docs/instructions/stack. @inquirer/prompts 8.8.0 raises the floor to 22.22.2 if upgraded.
