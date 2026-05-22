# Vue Package Manager Guide

Use the package manager already configured by the project.

## Common Patterns

- install dependencies through the project's existing lockfile tool
- prefer project scripts over raw framework commands when both exist
- inspect `package.json` before adding framework-specific assumptions
- if the project uses Docker Compose, run package-manager commands through the correct `docker compose exec <node-service>` wrapper instead of assuming local Node
