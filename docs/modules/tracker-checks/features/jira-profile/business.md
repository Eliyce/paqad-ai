# Jira tracker profile: business

## Overview

Every Jira site is set up a little differently, and the tools that connect to Jira name the same action in different ways. The Jira profile tells the plugin what it needs to do (create an issue, link two issues, read an issue back) and leaves it to find the matching tool in whatever connector the user has. It also lists what to learn about the project at the start and the labels every created issue carries so work can be traced back to its discovery run.

## User Roles

| Role | How they meet this feature |
|---|---|
| Business user | Connects the tracker at step 0; is told once that run labels build up in the site's label list |
| Admin | Enables the connector and write permissions; the plugin never handles credentials |

## User Flows

| Step | What happens |
|---|---|
| 1 | At step 0 the plugin reads the project key, issue types, epic and story types, required fields, link types, and the size and sprint fields |
| 2 | It checks a usable create action exists for the user in that project |
| 3 | If not, it stops before drafting and offers the export instead |
| 4 | When writing, it picks the connector tool that performs each action |
| 5 | Every created issue gets the shared label, the run label and its item reference |

## Business Rules

| Rule | Detail |
|---|---|
| Discover, don't hard-code | Tool names, size field and sprint field are found per site (PUB-1) |
| Known variants | Link creation and link-type listing each have two known tool names (PUB-1, AC-18) |
| Links only through the link action | An issue edit that sets links has been reported to succeed without creating them (PUB-3) |
| Traceability labels | "paqad-discovery", the run label in lowercase, and the item reference in Sources (PUB-4) |
| Tell once about labels | Run labels accumulate in the site's label list; the user hears this once at step 0 |
| Jira is the tracker, not a host | Naming Jira does not break the provider-neutral rule |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Step 0 | Setup details stored in the discovery record's setup block |
| Posting, refining, sizing or sprint work | Tracker writes through the resolved actions, only after the user approves |

## Error States

| State | Handling |
|---|---|
| No usable create action | Stop before drafting; offer the Markdown and CSV export |
| A tool name is not one of the known variants | The skill must find the action from the connector's own tool list |
| Size or sprint field cannot be found | Not covered by this profile; the sizing and sprint skills handle it |

## Glossary

| Term | Meaning |
|---|---|
| Action | Something the plugin needs the tracker to do, independent of tool name |
| Run label | The discovery run ID in lowercase, added to every issue the run creates |
| Custom field | A site-specific field such as story points or sprint, whose ID differs per site |

Sources: shared/references/tracker-profiles-jira.md
