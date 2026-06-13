## Required: Create Documentation Foundation

Before starting feature work, prompt your AI agent with:

```text
create documentation
```

This generates:
- `docs/instructions/**`
- `docs/instructions/rules/module-map.yml`

Review `docs/instructions/rules/module-map.yml` first. Confirm that module and feature names use business language, then prompt your AI agent with:

```text
create module documentation
```

That second prompt generates `docs/modules/**` from the reviewed module map.

## Optional: Give your rules teeth (rules-as-scripts)

To enforce `docs/instructions/rules/**` with deterministic checks instead of relying on the model to remember them, prompt your AI agent with:

```text
analyze rules
```

Review the generated `docs/instructions/rules/rule-script-map.yml`, then:

```text
generate rule scripts
```

Scripts run during `feature-development.checks`. The dashboard shows a Rule Compliance card (unknown until the first run).