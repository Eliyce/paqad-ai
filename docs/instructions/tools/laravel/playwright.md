# Laravel Playwright Guide

Use Playwright for non-destructive browser validation of running Laravel web flows.

## Good Uses

- auth and permission-blocked journeys
- redirects, cookies, headers, and signed-link behavior
- browser-visible error leakage and debug exposure
- critical happy-path and negative-path UI flows

## Guardrails

- do not run destructive or bulk-mutating flows unless the environment is explicitly safe
- prefer seeded test data or disposable accounts
- capture evidence only for flows that changed or are release-sensitive
