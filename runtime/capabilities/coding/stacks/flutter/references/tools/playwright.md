# Flutter Playwright Guide

Use Playwright only for Flutter web targets or hybrid flows that expose browser-visible behavior.

## Good Uses

- auth redirects and blocked paths in Flutter web
- storage, cookie, header, and debug-leak checks
- deep-link and browser navigation validation
- release-sensitive happy-path and negative-path flows

## Guardrails

- avoid destructive data mutation unless the environment is explicitly disposable
- use seeded test accounts when possible
- skip Playwright when the change is native-only and no browser surface is involved
