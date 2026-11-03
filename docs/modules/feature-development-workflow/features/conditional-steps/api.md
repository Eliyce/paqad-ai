# Conditional / Failure Handling — API View

> Module: **Feature Development Workflow** (`feature-development-workflow`) · Layer: `agent-workflows` · Feature slug: `conditional-steps`

Conditional steps have no HTTP surface. The stages, their checks and the team's additions come from paqad's own policy plus the team files in `.paqad/configs/feature-development/`. paqad writes the result to a generated, git-ignored view at `docs/instructions/workflows/feature-development.yaml`. The API is two CLI verbs and a few exported functions.

## Team files

The team's additions live in `.paqad/configs/feature-development/`: `workflow.yaml` (extra stage instructions and reads), `checks.yaml` (stage checks), and `analytics.yaml`, `evidence.yaml`, `reuse.yaml`, `rules.yaml`, `safety.yaml` and `specification.yaml` for the settings of each area. Every file starts header-only. A key appears only when the team changed it, so everything else keeps paqad's default.

## CLI: `paqad-ai config view`

Rebuilds the generated view when its sources changed.

| Flag | Meaning |
|---|---|
| `--project-root <path>` | Project root. Default: the current directory. |

Behaviour:

- Prints nothing when the view is up to date or was rebuilt cleanly.
- When the view was edited by hand (its hash no longer matches `.paqad/state/feature-development-view.sha256`), it moves the edited fields into `.paqad/configs/feature-development/`, rebuilds the view and prints `docs/instructions/workflows/feature-development.yaml was edited by hand; paqad moved the edit and rebuilt it.` followed by one `Moved your edit to ... into .paqad/configs/<file>: <path>.` line per field. It also writes a `WARN feature-development-view.moved` planning audit row.
- Prints `... couldn't be rebuilt: <reason>` when the rebuild fails.
- A view without the generated header is an old hand-written workflow file. It is left alone (`legacy`) until `paqad-ai config migrate` moves it.
- Projects whose profile domain isn't `coding` are skipped.

## CLI: `paqad-ai config migrate`

Moves the team settings from the old `.paqad/configs/.config.*` files and the old hand-written feature-development workflow file into the YAML files in `.paqad/configs/`.

| Flag | Meaning |
|---|---|
| `--project-root <path>` | Project root. Default: the current directory. |
| `--dry-run` | Print what would move without writing anything. |

Prints one line per moved setting. Exits 1 when the migration reports an error.

## TypeScript

```ts
// src/pipeline/feature-development-view.ts
export const FEATURE_DEVELOPMENT_VIEW_FILE = 'feature-development.yaml';
export const FEATURE_DEVELOPMENT_VIEW_RELATIVE: string; // docs/instructions/workflows/feature-development.yaml
export const FEATURE_DEVELOPMENT_VIEW_HEADER: string;
export function isFeatureDevelopmentViewFile(fileName: string): boolean;
export function featureDevelopmentViewPath(projectRoot: string): string;
export function isGeneratedView(text: string): boolean;
export function renderFeatureDevelopmentView(policy: FeatureDevelopmentPolicy): string;
export function viewHash(text: string): string;
export function readStoredViewHash(projectRoot: string): string | null;
export interface ViewRefreshResult {
  status: 'unchanged' | 'written' | 'legacy' | 'skipped';
  handEdited: boolean;
  moved: string[];
  warnings: string[];
}
export function refreshFeatureDevelopmentView(projectRoot: string): ViewRefreshResult;
export function viewEditedByHand(projectRoot: string): boolean;
export function rebuildFeatureDevelopmentView(projectRoot: string): string[];

// src/core/team-config-migrate.ts
export function migrateTeamConfig(
  projectRoot: string,
  options?: MigrateTeamConfigOptions,
): TeamConfigMigration;
```
