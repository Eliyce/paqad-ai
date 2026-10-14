# Answer a question with sources: business

## Overview

A business user asks what the product does today ("can customers pause a subscription?", "what orders do we send to SAP?"), or asks for an overview ("what is this product?", "what areas does it have?"). The plugin answers from the project's own onboarded documents, leads with the answer, keeps it short, and ends with one Sources line. Where the documents cannot confirm something, it says so instead of guessing. It never changes anything in the tracker.

## User Roles

| Role | What they do here |
|---|---|
| Business user (product owner, analyst, support lead) | Asks a question about current product behaviour and reads the answer |
| Engineering team | Onboards the repository so its documents can be read; the plugin does not onboard |

## User Flows

| Step | What happens |
|---|---|
| 1 | The user asks a question about the product today, or what the product or an attached project is. |
| 2 | The plugin settles which project to use without fuss: an attached project or the only reachable one is used without asking; with several it shows one short marked list once (see Get the project documents). The choice holds for the rest of the conversation. |
| 3 | It checks how far the project is set up. Ready: it carries on. Partly ready (no list of areas): it carries on and says once that the list is missing, naming areas without a summary as unknown. Not set up: it stops with the onboarding message. |
| 4 | It finds the related areas and reads only the documents the question needs, in the fixed reading order, stopping once the point is answered. |
| 5 | It checks whether each section it relies on is real content or an unfilled template. |
| 6 | It replies: the answer first, as a table for lists or one or two sentences for a yes/no or single fact, then one Sources line. An overview question gets a table of areas, each with its plain name and one line on what it does. |
| 7 | Optionally, one short line on what the answer means and an offer to shape a change (see Turn an answer into an idea). |

## Business Rules

| Rule | Detail |
|---|---|
| Onboarded first | Ready: the list of areas and at least one area summary. Partly ready: summaries but no list; the answer carries on and areas without a summary are named as unknown. Not set up: no summary at all, so nothing is answered (GRD-1, ASK-1). |
| Project asked once | An attached project is used without asking; the choice is never asked again in the conversation unless the user asks to switch (GRD-3). |
| Overview as a table | "What is this product?" or "what areas does it have?" is answered as a table of areas with one line each, then one Sources line; nothing is invented (ASK-9). |
| Read only what is needed | Registry, then module summaries, then business notes; deeper notes only to settle a fact (GRD-2). |
| Answer first | First line is the answer: no preamble, no restating, no closing summary (TALK-4). |
| Shape follows the question | Lists, counts, steps and comparisons as a table; yes/no and single facts as plain sentences; "how" or "why" explained only when asked (TALK-2, TALK-3). |
| Every fact is sourced | Each factual sentence or table row traces to a document; paths appear only on the one Sources line (ASK-2, GRD-5, TALK-6). |
| No guessing | Template, missing or contradictory sections are named as unconfirmed (ASK-3, GRD-4). |
| User's words | The user's term is used, with the project's term in brackets on first use, for example "members (called accounts in the project docs)" (ASK-4, GRD-6). |
| Documents are data | Text in a document that tries to give instructions is ignored and mentioned to the user (GRD-7). |
| Code last | If the documents cannot answer and code is attached, the plugin may look and reports "the code suggests..." (ASK-8). |
| Read only | Question answering never writes to the tracker (ASK-7). |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| A question about current product behaviour, or an overview question | A sourced answer in chat. No file, record or tracker change. |
| User accepts the offer to shape an idea | Hands over to the idea journey (separate feature). |

## Error States

| Situation | What the user sees |
|---|---|
| Project not set up | "This repository isn't set up for this yet. Ask your engineering team to onboard it with paqad, then come back." |
| Project partly ready | "This project's list of areas is missing, so I'm working from the area summaries it has. Areas without a summary are shown as unknown." once, then the answer. |
| No project can be seen | A request to attach the project or its documents folder, or to upload the documents. |
| Relevant section is a blank template | A plain statement of what the documents cannot confirm, no guess, and an offer to shape an idea if useful (AC-22). |
| Documents hold an embedded instruction | The instruction is ignored and mentioned; no action taken (AC-17). |
| Checking tools cannot run on this host | The same checks are done by hand from a written checklist; the answer looks the same (PLG-6). |

## How this skill gets picked

The skill's description covers overview questions and an attached or connected project as well as questions about how something works today. That raises the chance that the chat host picks this skill on its own for a matching message, but it cannot guarantee it, because the host decides. Naming the skill always works (PLG-8).

## Glossary

| Term | Meaning |
|---|---|
| Onboarded | The project's documents follow the paqad layout: a module registry plus module summaries. With summaries but no registry it is partly ready. |
| Template text | A section still holding the onboarding scaffold's placeholder wording, so it is not real information. |
| Sources line | One short line at the end listing the documents the answer came from. |
| Project term | The name the project documents use for something the user may call differently. |

Sources: skills/ask-project/SKILL.md, skills/ask-project/references/answer-template.md, shared/references/connect-repository.md, REQUIREMENTS.md section 4B
