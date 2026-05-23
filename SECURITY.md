# Security Policy

## Supported versions

We support security fixes for the latest minor release of `paqad-ai`.

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

If you are running an older version, please upgrade before reporting a
vulnerability — it may already be fixed.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

If you believe you have found a security vulnerability in `paqad-ai`, report it
privately through one of the following channels:

1. **Preferred — GitHub Security Advisory.** Open a draft advisory at
   <https://github.com/Eliyce/paqad-ai/security/advisories/new>. This is
   end-to-end encrypted and only visible to the maintainers.
2. **Email.** Send a report to **haider@eliyce.com** with the subject line
   `[paqad-ai security]`. Include enough detail for us to reproduce the issue.

## What to include in a report

- A description of the vulnerability and the impact it could have.
- Steps to reproduce, including any required environment, configuration, or
  payloads.
- The version of `paqad-ai` affected (`paqad-ai --version`).
- Your Node.js version and operating system.
- Any suggested mitigation or patch, if you have one.

## What to expect

- We will acknowledge your report within **3 business days**.
- We will provide an initial assessment within **7 business days**.
- We aim to ship a fix for confirmed high-severity issues within **30 days** of
  the initial report, sometimes faster.
- We will credit you in the security advisory and the changelog unless you ask
  us not to.

## Out of scope

The following are explicitly out of scope and should not be reported as
vulnerabilities:

- Issues in third-party dependencies that already have a public CVE — file
  those upstream and we will pick up the fix via Dependabot.
- Issues in user-provided AI provider keys leaking via misconfigured logging in
  the consumer's own environment.
- Social engineering of maintainers.

Thank you for helping keep `paqad-ai` and its users safe.
