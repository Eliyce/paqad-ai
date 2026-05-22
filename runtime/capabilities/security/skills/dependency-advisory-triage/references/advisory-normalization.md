# Advisory Normalization

## Core Rules

- Key advisories by package, ecosystem, installed version, and advisory identifier.
- Keep source systems so retests can replay the same evidence.
- Prefer one normalized finding per real package issue — deduplicate across native audit + OSV when they report the same advisory.

## Supply Chain Signals (OWASP 2025 A03)

Beyond known CVEs, flag the following as elevated-risk indicators:

### Typosquatting

- Package name is 1–2 characters away from a widely-used package (Levenshtein distance ≤ 2)
- Author account is <3 months old
- <100 weekly downloads despite a name that shadows a well-known package
- Unusual `preinstall` / `postinstall` scripts in packages with minimal functionality

### Dependency Confusion

- An internal or scoped package name (e.g. `@company/utils`) also exists on the public registry at a **higher version number**
- Check `.npmrc` / `pip.conf` / Composer repository priority — verify private registry takes precedence

### Abandoned Packages

- Last publish >18 months ago with unresolved security issues = treat any advisory as exploitable until patched
- Sudden new collaborator added followed by same-day major version publish = potential maintainer compromise

### Lockfile Integrity

- If `package-lock.json` / `composer.lock` / `pnpm-lock.yaml` is gitignored, builds are non-reproducible — record as a supply chain coverage gap
- Flag deep transitive dependency chains (>5 levels) to a single critical package

### SBOM Gap

- If no SBOM artifact (`sbom.json`, CycloneDX, or SPDX) exists, record as a compliance coverage gap (not a finding, but a blocked check)
