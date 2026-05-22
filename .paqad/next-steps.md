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