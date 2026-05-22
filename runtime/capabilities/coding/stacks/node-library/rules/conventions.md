# Node.js Library Conventions

## Public API Surface Design

- Export everything intentionally via `src/index.ts` (or `src/index.js`). Do not rely on consumers importing internal paths.
- Use explicit named exports. Avoid default exports for libraries — they are harder to tree-shake and rename consistently.
- Group exports logically using barrel files (`src/utils/index.ts`, `src/types/index.ts`), but do not create barrel files that re-export everything indiscriminately — this prevents tree-shaking.
- Mark the `exports` field in `package.json` with conditional exports for CJS/ESM dual-build when needed.

## Type Export Patterns

- Ship declaration files (`.d.ts`) alongside compiled output — never rely on consumers having `ts-node` at runtime.
- Use `types` (or `typings`) field in `package.json` to point to the primary `.d.ts` entry.
- Avoid exporting internal implementation types through the public API. Use `@internal` JSDoc tags on types that must be exported for structural reasons but are not intended for consumers.
- When using `tsup`, `rollup`, or `unbuild`, verify the output includes correct source maps and declaration maps.

## Semver Discipline

Breaking changes require a **major version bump**. The following are always breaking:

- Removing or renaming exported functions, classes, or types
- Adding required parameters to public functions
- Changing the return type of a public function
- Removing fields from public interfaces or types
- Changing a synchronous API to async (or vice versa)

Non-breaking additions require a **minor version bump**. Bug fixes require a **patch version bump**.

Use `@changesets/cli` or `semantic-release` to automate changelog generation and version management.

## Peer Dependency Management

- Declare framework/runtime packages as `peerDependencies`, not `dependencies`, to avoid duplication in consumer projects.
- Always declare a `peerDependenciesMeta` entry marking peer deps as optional when the library works without them.
- Test against the full range of declared peer dependency versions in CI.

## Tree-Shaking Readiness

- Set `"sideEffects": false` in `package.json` if the library has no side effects at module evaluation time.
- Avoid top-level `console.log`, `require()` calls, or global mutations in the module scope.
- Publish ESM output (`"type": "module"` or `.mjs` files) to enable static analysis by bundlers.
- Do not use `require()` or `import()` with dynamic, user-controlled paths in library code.

## Bundle Size Awareness

- Track bundle size in CI using `bundlesize`, `size-limit`, or equivalent.
- Avoid bundling large dependencies — prefer marking them as `peerDependencies` or `optionalDependencies`.
- Audit the published package contents using `npm pack --dry-run` and configure the `files` field in `package.json` to exclude tests, fixtures, and source maps from the published artefact.

## Changelog and Release Workflow

- Maintain a `CHANGELOG.md` in the standard Keep a Changelog format.
- Every PR that changes public behaviour must include a changeset entry.
- Automate releases from the main branch using CI to prevent manual version-bumping errors.
- Tag releases in git before publishing to npm.

## Testing Patterns

### Unit Tests

- Write unit tests for every public function and class, testing the public contract, not the implementation.
- Test edge cases at API boundaries: `null`, `undefined`, empty arrays, empty strings, very large inputs.
- Never test private methods directly — refactor if the private implementation needs its own test coverage.

### Integration Tests

- Test complex interactions between public APIs (e.g., composing multiple exported utilities).
- If the library wraps I/O (file system, network, database), write integration tests against the real system, not mocks.

## Security

### Input Validation on Public API Surface

- Validate all arguments on every exported function and method. Do not trust the caller.
- Throw descriptive `TypeError` or `RangeError` for invalid input rather than returning `undefined` silently.
- Sanitize string inputs that will be used in file paths, URLs, or shell commands.

### Prototype Pollution Defense

- Never write to `obj[key]` where `key` comes from untrusted input without checking `key !== '__proto__'`, `key !== 'constructor'`, and `key !== 'prototype'`.
- Use `Object.create(null)` for internal maps that store user-supplied keys.
- Prefer `Map` and `Set` over plain objects for dynamic key storage.

### Unsafe Patterns to Avoid

- Never use `eval()` or the `Function()` constructor with dynamic strings.
- Never use `child_process.exec()` with user-supplied input — use `execFile()` with argument arrays.
- Never deserialize untrusted data with `JSON.parse()` without schema validation.

### Supply Chain Hygiene

- Commit your lockfile (`pnpm-lock.yaml` or `package-lock.json`).
- Run `pnpm audit` in CI and fail on high/critical advisories.
- Minimize the dependency tree — prefer zero-dependency implementations for simple utilities.
- Review all transitive dependencies before publishing a new major version.
