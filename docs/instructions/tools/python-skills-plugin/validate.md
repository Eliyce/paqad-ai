# Validation Guide

Run the official validators on the built output, never on the source tree (CI-9).

| Validator | Command |
|---|---|
| Agent Skills spec | `skills-ref validate dist/plugins/paqad-product-discovery/skills/<skill>` |
| Plugin package | `claude plugin validate --strict dist/plugins/paqad-product-discovery` |

## Notes

- `skills-ref` checks frontmatter and naming against the Agent Skills specification.
- Pin the plugin CLI version in CI so a validator upgrade cannot change a green build silently.
