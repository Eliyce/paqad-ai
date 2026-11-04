# Conditional / Failure Handling — API View

> Module: **Feature Development Workflow** (`feature-development-workflow`) · Layer: `agent-workflows` · Feature slug: `conditional-steps`

Conditional steps have no HTTP surface. The stages, their checks and the team's additions come from paqad's own policy plus the team files in `.paqad/configs/feature-development/`, which paqad reads directly. `paqad-ai config show` prints every setting and `paqad-ai stage brief <stage> --full` prints a stage's full `read:` list and instructions. The API is one CLI verb and a few exported functions.

## Team files

The team's additions live in `.paqad/configs/feature-development/`: `workflow.yaml` (extra stage instructions and reads), `checks.yaml` (stage checks), and `analytics.yaml`, `evidence.yaml`, `reuse.yaml`, `rules.yaml` and `specification.yaml` for the settings of each area. Every file starts header-only. A key appears only when the team changed it, so everything else keeps paqad's default.

## CLI: `paqad-ai config migrate`

Moves the team settings from the old `.paqad/configs/.config.*` files and the old hand-written feature-development workflow file into the YAML files in `.paqad/configs/`.

| Flag | Meaning |
|---|---|
| `--project-root <path>` | Project root. Default: the current directory. |
| `--dry-run` | Print what would move without writing anything. |

Prints one line per moved setting. A hand-written workflow file is deleted once its settings are carried, and listed as deleted. Exits 1 when the migration reports an error.

## TypeScript

```ts
// src/pipeline/feature-development-view.ts
export const FEATURE_DEVELOPMENT_VIEW_FILE = 'feature-development.yaml';
export const FEATURE_DEVELOPMENT_VIEW_RELATIVE: string; // the old workflow file path, read only by the migration and the cleanup
export function isFeatureDevelopmentViewFile(fileName: string): boolean;
export function featureDevelopmentViewPath(projectRoot: string): string;
export function isGeneratedView(text: string): boolean;

// src/update/generated-files-cleanup.ts
export function removeGeneratedFiles(projectRoot: string): string[];

// src/core/team-config-migrate.ts
export function migrateTeamConfig(
  projectRoot: string,
  options?: MigrateTeamConfigOptions,
): TeamConfigMigration;
```
