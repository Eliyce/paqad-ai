# Laravel Boost

Laravel Boost (`laravel/boost`) is a local MCP server that augments AI-assisted
development. It exposes ~15 read-oriented tools plus Laravel-specific AI
guidelines and a documentation API — it is **not** a module system, scaffolding
generator, or runtime framework. Module structure and boundaries are defined in
`docs/instructions/rules/module-map.yml`, not by Boost.

- Install Boost as a dev dependency only: `composer require laravel/boost --dev`, then `php artisan boost:install`. Never reference Boost from production code paths or non-dev dependencies.
- Re-run `php artisan boost:install` when the set of AI agents or enabled features (guidelines, MCP server) changes, rather than hand-editing generated agent config.
- Prefer Boost's `search-docs` tool for version-specific Laravel ecosystem documentation instead of relying on memory; confirm APIs against the installed package versions reported by `application-info`.
- Use the `tinker` tool to verify Eloquent queries, model relationships, and PHP expressions against the running application before writing code that depends on them.
- Use `database-schema` and the read-only `database-query` tool to confirm real table and column names and relationships; do not assume schema.
- Ground changes in real application state: use `list-routes`, `list-artisan-commands`, and `get-config` to confirm registered routes, available commands, and config values instead of inventing them.
- Diagnose failures from runtime evidence — inspect `last-errors`, `read-log-entries`, and `browser-logs` — rather than guessing at causes.
- Treat Boost's installed AI guidelines as authoritative Laravel conventions and follow them; keep custom project guidelines additive, not contradictory.
