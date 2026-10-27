# Manual host verification: business

## Overview

The plugin is built once and installed on three hosts: claude.ai, ChatGPT web and Codex. Several things that decide whether it works on a host cannot be tested from this repository, such as whether scripts run there or whether the tracker connector can link issues. For each host there is a written install guide and a table of these open questions, each with how to check it, a verdict, evidence, and the fallback if it fails. Support can only be claimed for a host once its verdicts are recorded. Today every verdict is pending.

## User Roles

| Role | Interest |
|---|---|
| Delivery lead or product owner | Knows which hosts can honestly be called supported |
| Tester or release owner | Installs the plugin on each host, runs the checks, records verdicts and evidence |
| Org or workspace admin | Follows the install steps for their host |

## User Flows

| Step | What happens |
|---|---|
| 1 | Build the plugin and push the output to the distribution repository |
| 2 | Install on the host following that host's steps |
| 3 | Start a question and an idea to confirm the real skills load |
| 4 | Work through each open question for that host and record verdict and evidence |
| 5 | Where a check fails, apply the listed fallback |

## Business Rules

| Rule | Detail |
|---|---|
| No automated verdicts | Every verdict starts as "pending" and is filled in by a person after installing |
| Not shipped | These guides are for people; the plugin itself describes behaviour by capability, never by host (PLG-7) |
| Claim only what is verified | Support state per release is packaged, installed or verified, and release notes claim only verified hosts (CI-19) |
| Every failure has a fallback | For example: checklist instead of scripts, dependencies written as text, export instead of posting, plan given as a list to apply by hand |

| Host | Open questions | Recorded |
|---|---|---|
| claude.ai | 9 | 0 |
| ChatGPT web | 13 | 0 |
| Codex | 10 | 0 |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| A release, or a first install on a host | Verdicts and evidence recorded in the host's guide |

## Error States

| State | Meaning |
|---|---|
| All verdicts pending | No host can be called verified; support cannot be claimed |
| A check fails | The listed fallback becomes the path on that host |

## Glossary

| Term | Meaning |
|---|---|
| Host | A product where the plugin is installed: claude.ai, ChatGPT web or Codex |
| Unknown (U-n) | An open question about a host to be proven by installing |
| Verdict | The recorded result of checking an unknown |

Sources: hosts/claude.md, hosts/chatgpt.md, hosts/codex.md
