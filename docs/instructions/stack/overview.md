# Stack Overview

## Project

- **Name:** paqad-ai
- **Version:** see `package.json` (root), graph-ui sub-app independent
- **Description:** Spec-driven development framework — AI agents that think before they type
- **License:** MIT
- **Entry archetype:** Node library + CLI (`paqad-ai` bin), with an embedded React SPA (`graph-ui`)

## Top-Level Toolchain

| Concern         | Choice                                                         |
|-----------------|----------------------------------------------------------------|
| Language        | TypeScript (ES modules, `"type": "module"`)                    |
| Node engine     | `>=22.0.0` to install; building needs 22.18+ (24.11+ on 24)    |
| Package manager | pnpm (root + `graph-ui`)                                       |
| Bundler         | tsup 9 (library/CLI, shared chunks, no source maps), Vite (graph-ui SPA) |
| Test runner     | Vitest 5 (root and graph-ui)                                   |
| Lint            | ESLint (flat config: `eslint.config.js`)                       |
| Format          | Prettier                                                       |
| Typecheck       | `tsc --noEmit`                                                 |

Building from source needs Node 22.18 or later (24.11 or later on Node 24) because tsup 9
needs it. The published `engines` field stays `>=22.0.0`. Exact ranges are in
[versions.md](versions.md).

## Frameworks & Major Libraries

### CLI / Framework Runtime (root)

- `commander` — CLI argument parsing
- `@inquirer/prompts` — interactive prompts
- `chalk`, `ora` — terminal UX
- `execa` — subprocess execution
- `fast-glob`, `pathe` — filesystem scanning
- `handlebars` — template rendering (workflow & doc templates)
- `yaml` — config / profile parsing
- `ajv` — JSON Schema validation
- `openai` — model API client (default routing target) and the optional cloud embeddings
- `@huggingface/transformers` v4 — local embeddings and reranking, pinned to `dtype: 'q8'`
- `gifenc` — GIF encoding for visual evidence

### Embedded UI (`graph-ui/`)

- React 19
- Tailwind CSS 4
- Vite SPA toolchain
- Vitest 5 (the same major as the root package)

## Capabilities (active)

`content`, `coding`, `security`

## Detected Traits

`eslint`, `tailwind`, `typescript`, `vite-spa`, `vitest`

## Repository Layout (top-level)

```
src/                # framework source (CLI, runtime, intelligence, workflows)
runtime/            # shipped runtime assets (rules, skills, templates) — packaged in dist
graph-ui/           # standalone React + Vite SPA for graph visualization
scripts/            # build & test helper scripts
tests/              # vitest test suites
docs/instructions/  # canonical project docs (this directory)
.paqad/             # framework metadata: profile, detection, decisions, vectors
website/            # docs/marketing site assets
```

## Commands

| Action    | Command          |
|-----------|------------------|
| Install   | `pnpm install`   |
| Dev       | `pnpm dev`       |
| Test      | `pnpm test`      |
| Lint      | `pnpm lint`      |
| Format    | `pnpm format`    |
| Build     | `pnpm build`     |
| Typecheck | `pnpm typecheck` |
| Full CI   | `pnpm ci`        |

<!-- paqad:stack:packages:start -->
## Packages

- `@changesets/changelog-git` 0.2.1 (dev)
- `@changesets/changelog-github` 1.0.1 (dev): @changesets/changelog-github is used by naming it in the config's changelog option with a { repo } option and needs a G…
- `@changesets/cli` 3.0.3 (dev): Changesets CLI 3.0 renamed `changeset tag` to `changeset git-tag`, makes `changeset version` exit 1 with no changesets,…
- `@codemirror/lang-markdown` 6.5.0
- `@codemirror/lang-yaml` 6.1.3
- `@codemirror/state` 6.6.0: Extension compartments make configuration dynamic; Compartment.reconfigure creates an effect that reconfigures the comp…
- `@codemirror/view` 6.43.1: EditorView.contentAttributes is the facet that provides additional DOM attributes for the editor's editable DOM element…
- `@dagrejs/dagre` 3.1.1: Dagre node width/height default to 0; layout writes x/y as the node center and edge points onto the edge label; setDefa…
- `@eslint/js` 10.0.1 (dev): preserve-caught-error requires a cause when throwing a new error in a catch block, checks only built-in error construct…
- `@huggingface/transformers` 4.3.2: PretrainedOptions: revision defaults to 'main' (any git ref, e.g. a commit ID), cache_dir overrides the standard cache,…
- `@inquirer/prompts` 8.7.5: On Ctrl+C Inquirer rejects the prompt promise (ExitPromptError); the README highly recommends handling it gracefully vi…
- `@tailwindcss/vite` 4.3.0 (dev): The Vite setup is: install tailwindcss and @tailwindcss/vite, add tailwindcss() to the Vite config plugins, and @import…
- `@types/node` 26.6.6 (dev): DefinitelyTyped sets each @types package's major.minor from the library version it describes (e.g. Node 20.8 types publ…
- `@types/react` 19.2.15 (dev): React 19 types require an argument to useRef (all refs are mutable) and remove the global JSX namespace in favour of Re…
- `@types/react-dom` 19.2.3 (dev)
- `@vitejs/plugin-react` 4.7.0 (dev): For React refresh to work correctly a file should only export React components; incompatible exports invalidate the mod…
- `@vitest/coverage-v8` 5.0.5 (dev): Vitest's coverage guide says TypeScript is transpiled with esbuild, which strips comments, so ignore hints need @preser…
- `@vitest/coverage-v8` 5.1.0 (dev): Vitest's coverage guide says TypeScript is transpiled with esbuild, which strips comments, so ignore hints need @preser…
- `@xyflow/react` 12.11.3: Functions passed as props to &lt;ReactFlow&gt; should be memoized with useCallback, and objects/arrays such as defaultEdgeOpt…
- `ajv` 8.20.0: Ensure each schema is compiled only once, and use a single Ajv instance for the whole application.
- `chalk` 6.0.1: chalkStderr is a separate instance configured with color support detected for stderr instead of stdout; supportsColorSt…
- `cmdk` 1.1.1: You should provide a unique value for each Command.Item; if omitted it is inferred from the item's textContent, and val…
- `codemirror` 6.0.2
- `commander` 15.0.0: Commander 15.0.0 (2026-05-29) is ESM only, requires Node.js v22.12.0+, and only a lone --no-* option sets the default t…
- `eslint` 10.14.0 (dev): ESLint 10 removes eslintrc, looks up config from each linted file's directory, errors on eslint-env comments, and adds…
- `execa` 10.2.1: execa 10.0.0 requires Node 22, makes the subprocess a normal promise with Node APIs (.on, .send, .ref, .unref) moved to…
- `fast-glob` 3.3.3: fast-glob returns results in arbitrary order, cwd defaults to process.cwd(), patterns must use forward slashes with bac…
- `gifenc` 1.0.3: gifenc: palette is required for the first frame, delay is in milliseconds, finish() is required before reading bytes();…
- `globals` 17.14.0 (dev)
- `graphology` 0.25.4: addNode throws if the node already exists; mergeNode adds the node or merges attributes into the existing one.
- `graphology-layout-forceatlas2` 0.10.1: forceAtlas2.assign(graph, {iterations, settings}) runs synchronously; the library ships a web-worker layout (with kill(…
- `handlebars` 4.7.10: Handlebars.compile option noEscape: true disables HTML escaping; strict: true makes templates throw rather than silentl…
- `markdownlint-cli2` 0.24.0 (dev): markdownlint-cli2 lints globs given on the command line or in the `globs` config property, is configured via .markdownl…
- `marked` 18.0.5: Marked does not sanitize the output HTML; filter it for XSS with DOMPurify (preferred) or js-xss, sanitize-html or insa…
- `minimatch` 11.0.5: minimatch 11.0 removes makeRe(), Minimatch#regexp, the MMRegExp type, the AST class, debug and matchOne().
- `openai` 7.52.0: Connection errors, 408, 409, 429 and &gt;=500 are retried 2 times by default with short exponential backoff; maxRetries co…
- `ora` 10.0.0: ora 10.0.0's breaking change is requiring Node.js 22; it now erases exactly what the frame covers.
- `pathe` 2.0.3: pathe offers identical exports to node:path but normalizes all paths to '/' so behaviour is consistent POSIX-like on ev…
- `prettier` 3.9.10 (dev): Prettier says to install an exact version because even a patch release can format differently, to use .prettierignore f…
- `react` 19.2.6: From React 19 function components can read ref as a prop, new components no longer need forwardRef, and forwardRef will…
- `react-dom` 19.2.6: React 19 ignores propTypes, removes defaultProps for function components, and removes ReactDOM.render, hydrate, findDOM…
- `sigma` 3.0.3: Sigma v3: kill should be invoked to release all bindings and resources; sigma re-renders automatically on graphology da…
- `tailwindcss` 4.3.0 (dev): Tailwind scans source files as plain text and cannot understand string concatenation or interpolation, so class names m…
- `tsup` 9.0.0 (dev): tsup v9.0.0 drops support for Node versions below 22.18 and removes baseUrl from its tsconfig handling.
- `typescript` 5.9.3 (dev): TypeScript 6.0 defaults types to [] and strict on, deprecates baseUrl, moduleResolution node10, target es5 and esModule…
- `typescript` 6.0.3 (dev): TypeScript 6.0 defaults types to [] and strict on, deprecates baseUrl, moduleResolution node10, target es5 and esModule…
- `typescript-eslint` 8.72.1 (dev): The typescript-eslint config() helper was deprecated in favor of ESLint core's defineConfig(), described as a nearly ex…
- `vite` 6.4.6 (dev): 6.4.6 escapes ids in the virtual-module resolver (GHSA-p4f5-76q4-ffq7, dev server only); 6.4.5 and older are affected.
- `vitest` 5.0.5 (dev): Vitest 5 requires Node 22.12+ and Vite 6.4+, makes vite a required peer dependency, defaults clearMocks to true, fails…
- `vitest` 5.1.0 (dev): Vitest 5 requires Node 22.12+ and Vite 6.4+, makes vite a required peer dependency, defaults clearMocks to true, fails…
- `yaml` 2.9.0: YAML.parse throws on error while parseDocument collects problems in doc.errors (contents likely wrong if non-empty, toS…
- `yaml` 2.9.1: YAML.parse throws on error while parseDocument collects problems in doc.errors (contents likely wrong if non-empty, toS…
- `zustand` 5.0.13: If a selector returns a new reference it may cause infinite loops (Maximum update depth exceeded); use useShallow from…
<!-- paqad:stack:packages:end -->
