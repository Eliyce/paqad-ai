---
name: sample-skill
description: Sample bundled skill fixture
model_tier: medium
triggers:
  - workflow: [feature-development]
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  request_text:
    type: string
    required: true
    description: Sample request payload.
---

## What It Does

Fixture skill body for adapter bundle tests.
