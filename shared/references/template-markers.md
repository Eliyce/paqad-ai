# Template markers

These are the onboarding template phrases from both paqad template generations (GRD-4). A
document section that still holds any of these phrases is a blank template, not a real fact, so
detect_placeholder.py marks that section as template and the plugin never presents it as true.

One marker phrase per line. Lines that start with a hash are headings and are ignored by the
loader.

## Current generation (module-scaffold business.md)

Describe the business purpose of the
Document the personas that interact with
Capture the main user journeys for
List the rules and invariants that must hold
Record notifications, jobs, integrations
Describe user-visible failures and recovery guidance
Add domain terms that matter to stakeholders

## Earlier generation

Capture the main journeys for
Enumerate invariants that must hold
Spell out idempotency expectations
