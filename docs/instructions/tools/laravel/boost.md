# Laravel Boost Guide

Use Laravel Boost MCP as the default diagnostic path when the project exposes it.

## Start Here

- Begin with `application-info` to confirm PHP, Laravel, package, and model context.
- Use `search-docs` before guessing Laravel ecosystem behavior.

## Common Tool Order

- Backend failure: `last-error`, then `read-log-entries`
- Frontend/browser issue: `browser-logs`
- Schema/data question: `database-schema`, then `database-query`
- Route/config question: `list-routes`, `get-config`, `list-available-config-keys`

## Scope

- Prefer Boost for structured diagnostics, route/config inspection, docs search, and runtime checks.
- Fall back to manual file scanning only when Boost cannot provide the needed data.
