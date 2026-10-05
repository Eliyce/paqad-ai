# CI and release workflows: business

## Overview

Three automated workflows are meant to guard every change, check the conversation nightly, and publish releases. Today they are honest stubs: two checks really run on every pull request, and every other check prints "not yet implemented" so nobody mistakes it for protection. Release is manual and the version is fixed at 0.0.0.

## User Roles

| Role | Interest |
|---|---|
| Delivery lead or product owner | Knows exactly which checks protect a change today and which do not |
| Contributor | Sees a pass or fail on each pull request |
| Release owner | Will cut releases through the release workflow once built |

## User Flows

| Workflow | When it runs | What it does today |
|---|---|---|
| Pull request checks | Every pull request, or by hand | Runs all unit tests on Python 3.9 (CI-7, partial) and builds twice to prove identical output (CI-8); lists ten more checks as placeholders |
| Verify | Nightly at 03:00 UTC, or by hand | Placeholders only for running the conversation scenarios (CI-12, CI-13) |
| Release | By hand | Placeholders only for versioning and publishing (CI-14, CI-15) |

## Business Rules

| What is protected today | What is not yet protected |
|---|---|
| Every script and authoring unit test passes | 90% branch coverage; standard-library-only imports (rest of CI-7) |
| The build succeeds, rejects undeclared shared files, and is reproducible | Official plugin validators (CI-9); size budget of 5 MB and 300 files (CI-10); secrets scan (CI-6) |
| Through the unit tests: skill frontmatter and size, vendor names, long dashes, "How to talk" block, entry versus step wording, forbidden folders in the output | These same checks still appear as separate placeholder steps (CI-1 to CI-5, CI-11, CI-20), so the CI page under-reports what is covered |
| | Conversation quality (CI-12, CI-13); versioning, changelog, tagging and publishing (CI-14, CI-15) |

No step claims to enforce a check it does not run.

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Pull request | Pass or fail status; build output written to temporary folders only |
| Release (planned) | Would bump the version in the manifests, update a changelog, tag, attach a zip and push to the distribution repository |

## Error States

| State | Meaning |
|---|---|
| Unit test or build check fails | The pull request check fails |
| Placeholder step | Always passes; it enforces nothing |

## Glossary

| Term | Meaning |
|---|---|
| Placeholder step | A named check that only prints "not yet implemented" |
| Changeset | A small file describing a change and its version bump; none exist yet |
| Distribution repository | Where built output is pushed for hosts to sync |

Sources: .github/workflows/, .changeset/README.md
