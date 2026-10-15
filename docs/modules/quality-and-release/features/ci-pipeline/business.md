# CI and release workflows: business

## Overview

Three automated workflows guard every change, check the conversation nightly, and publish releases. Every named step runs and enforces its check. The steps that need outside tools or write access (the official plugin validators, tagging, and the pushes to the distribution repositories) stay switched off until an owner turns them on, so nothing claims protection it does not give. The current version is 3.2.0.

## User Roles

| Role | Interest |
|---|---|
| Delivery lead or product owner | Knows exactly which checks protect a change and which are switched off |
| Contributor | Sees a pass or fail on each pull request |
| Release owner | Cuts releases and publishes the Claude branch to the public repository the Claude plugin directory reads |

## User Flows

| Workflow | When it runs | What it does |
|---|---|---|
| Pull request checks | Every pull request, or by hand | Runs all unit tests, scans for forbidden content and secrets, checks size budgets and host verdicts, builds twice to prove identical output, and checks 90 percent branch coverage on two Python versions. When switched on, also runs the official Claude plugin validator in strict mode on the Claude branch |
| Verify | Nightly at 03:00 UTC, or by hand | Checks structural parity across entry points and host branches and that the scenarios cover the acceptance list |
| Release | By hand | Bumps the version and rebuilds. When switched on: tags, attaches a zip, pushes to the private distribution repository, builds a directory submission zip, and pushes the Claude branch to the public repository |

## Business Rules

| Rule | Why it matters |
|---|---|
| No step claims to enforce a check it does not run | The CI page can be trusted |
| The Claude validator version is pinned (2.1.300) and runs in strict mode | Older validators reject the directory listing fields; strict mode fails on warnings too, which the directory reviewer would see |
| Only the built Claude branch goes public | Source, tests, docs and the other host branches stay private |
| The public push always lands on `main` and clears old files first | The privacy policy link points at `main`, and removed files never linger |
| Re-running a release is safe | It commits only when something changed and tags only when the tag is new |
| Directory submission stays a manual step | Neither directory has a publish API; the steps are in `hosts/claude.md` |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Pull request | Pass or fail status; build output written to temporary folders only |
| Release with `ENABLE_RELEASE` | Version tag, GitHub release zip, push to the private distribution repository |
| Release with `ENABLE_PUBLIC_RELEASE` | Directory submission zip artifact; the Claude branch pushed to `Eliyce/paqad-product-discovery-plugin` on `main` with a version tag |

## Error States

| State | Meaning |
|---|---|
| A check fails | The pull request check fails |
| Strict validation finds a warning | The CI-9 step fails, same as an error |
| A switched-off step | Skipped; it enforces nothing until an owner turns it on |

## Glossary

| Term | Meaning |
|---|---|
| Switched-off step | A real step guarded by a repository variable, skipped until set |
| Changeset | A small file describing a change and its version bump |
| Distribution repository | Where built output is pushed for hosts to sync |
| Public repository | The repository the Claude plugin directory reads; its root is the Claude branch |

Sources: .github/workflows/, .changeset/README.md, hosts/claude.md
