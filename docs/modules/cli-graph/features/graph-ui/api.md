# Graph UI (React 19 + Vite SPA): API View

> Module: **Project Graph Command** (`cli-graph`) · Layer: `cli-commands` · Feature slug: `graph-ui`

graph-ui exports no TypeScript API. It is a single-page app built by `vite build` into `runtime/graph-ui/`, which `paqad-ai dashboard` serves. Its surface is the routes it shows and the server endpoints it calls.

## Routes

A hash router (`src/lib/router.ts`, `useHashRoute`). An unknown hash falls back to `pulse`.

| Hash | View |
| --- | --- |
| `#/pulse` | Home |
| `#/approvals`, `#/trust`, `#/build`, `#/automation`, `#/knowledge`, `#/setup` | The dashboard areas |
| `#/delivery-policy`, `#/instructions`, `#/module-map`, `#/design-tokens` | Editors that live under an area |
| `#/site-map` | The Site map |
| `#/graph` | The project graph |
| `#/dashboard` | The older full-status view |

## Server endpoints it reads

`/api/dashboard`, `/api/graph`, `/api/node/<id>`, `/api/chunk/<id>/content`, `/api/inventory`, `/api/audit`, `/api/decisions`, `/api/onboarding-checklist`, `/api/ops`, `/api/ops/<job id>`, `/api/packs`, `/api/saved-views`, `/api/config/profile`, `/api/config/rag`, `/api/config/module-map`, `/api/config/design-tokens`, `/api/config/delivery-policy`, `/api/files/instructions`, `/api/files/instructions/<path>`, `/api/ledger/receipts`, `/api/ledger/evidence`, `/api/ledger/ai-bom`, `/api/ledger/pr-comment`, `/api/export/evidence-packet?format=markdown`, `/api/export/siem?<params>`, `/api/site-map/map`, `/api/site-map/journeys` and `/api/site-map/progress`.

Live updates come from one server-sent event stream, `/api/events`.

## Server endpoints it writes

| Method | Endpoint |
| --- | --- |
| `POST` | `/api/decisions/<id>/resolve`, `/api/module-decisions/<id>/<action>`, `/api/ops/<action>`, `/api/capabilities/<name>`, `/api/similar`, `/api/site-map/journeys/curate`, `/api/site-map/layout`, `/api/site-map/layout/reset` |
| `PUT` | `/api/config/profile`, `/api/config/rag`, `/api/config/module-map`, `/api/config/design-tokens`, `/api/config/delivery-policy`, `/api/files/instructions/<path>`, `/api/saved-views/<id>` |
| `DELETE` | `/api/saved-views/<id>` |

`src/lib/api.ts` returns a 422 (validation) or a 409 (edit conflict, with the content on disk now) as a value the editors render. A 403 (read-only), a network failure, or a 409 on an ops job that is already running throws, with the server's sentence.
