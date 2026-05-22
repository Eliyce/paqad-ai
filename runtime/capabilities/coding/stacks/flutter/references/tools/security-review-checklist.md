# Flutter Security Review Checklist

Use this checklist before approval for security-sensitive or release-sensitive work.

## Validate

- server-side authorization exists for protected actions
- sensitive values are not embedded in source, logs, or local defaults
- storage choices match the data sensitivity
- external input is validated and rendered safely
- dependency changes do not introduce obvious high-risk packages without mitigation

## When Web Is In Scope

- validate browser-visible storage, cookies, headers, redirects, and debug exposure
- use `docs/tools/flutter/playwright.md` for the browser check path

Critical or high-severity failures block approval until fixed.
