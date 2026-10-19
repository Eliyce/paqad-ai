# Lane & Complexity Routing — Business View

> Module: **Feature Development Workflow** (`feature-development-workflow`) · Layer: `agent-workflows` · Feature slug: `routing`

## Overview

Every message is routed before any work starts. Routing answers two questions: is this a change to code (feature development) or something else, and if it is code, how big is it (the fast, graduated or full lane). The lane decides how much ceremony the change gets. This page covers how that routing behaves for the people using it. The technical contract is in [`technical.md`](./technical.md) and the commands are in [`api.md`](./api.md).

## Who uses it

- **The coding agent** reads the hook's route label, checks it against the message, and corrects it when it is wrong.
- **The developer** guides the agent and can see each route on the screen as a `**▸ paqad** ·` line.

## What routing gets right (issue #623)

- **Talking about the work is not a code change.** "Post this as an issue", "update the draft", "link the ticket" or "recheck and reconfirm the plan" go to project question, not feature development. A real code request that mentions a report, a plan or a doc still goes to feature development: "fix the typo in the report" or "add retry logic to the report generator" stay code changes. A message that names a source path, a code verb such as fix or build, or a part of the product such as a page or an endpoint is always treated as code.
- **A subagent's report is not you talking.** When a subagent hands its report back, or a background task posts a notice, paqad does not route it as if you had typed it. This holds wherever the notice banner sits in the message, including when the report comes first.

## Correcting a wrong label

The hook's label is a quick guess. When the agent disagrees, it runs `paqad-ai route set <workflow>` and the route follows the agent.

- **Only your own edits hold you in place.** Once your session has edited source this turn, the route cannot be moved off feature development: a change under way stays governed as a change. Another session working in the same folder no longer blocks your correction.
- **No session id, no block.** If paqad cannot tell which session is asking, it allows the correction and writes why in the route override log, so the skip is on the record.
- **Going back resumes.** If you set the route back to a workflow that was paused, paqad picks that paused change up again, with its plan, spec and lane, and leaves no stray paused copy behind.

## Lanes only go up

`paqad-ai lane set <lane>` records the real lane on the change once the ticket has been read. It can only raise the lane. A request to lower it is refused and reported, so a large change can never be relabelled as a small one.

## Glossary

- **Route**: the workflow a message belongs to, such as feature development or project question.
- **Lane**: how big a code change is (fast, graduated or full), which sets how many stages and checks it gets.
- **Hand-back**: the report a subagent sends back to the main agent when it finishes.
