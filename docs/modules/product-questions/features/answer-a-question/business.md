# Answer a question with sources: business

## Overview

A business user asks what the product does today ("can customers pause a subscription?", "what orders do we send to SAP?"), or asks for an overview ("what is this product?", "what areas does it have?"). The plugin answers from the target repository at the best evidence level it can reach (from project docs, from docs and code, or from code only), leads with the answer, keeps it short, ends with one Sources line, and adds one short source line naming the level. Code is the baseline for what exists; the documents add business language, roles and rules. Where the documents cannot confirm something, it says so instead of guessing. A part of the product with no notes is called not documented, and the plugin never says or suggests it is not built, and when the plugin can reach the code it looks at that part's code itself and says what the code suggests. It never changes anything in the tracker. No repository with readable code is turned away; the only stop is nothing readable at all.

## User Roles

| Role | What they do here |
|---|---|
| Business user (product owner, analyst, support lead) | Asks a question about current product behaviour and reads the answer |
| Engineering team | Invited by the optional informational nudge to install or finish paqad when the docs are missing or incomplete; the plugin does not onboard |

## User Flows

| Step | What happens |
|---|---|
| 1 | The user asks a question about the product today, or what the product or an attached project is. |
| 2 | The plugin settles which project to use without fuss: an attached project or the only reachable one is used without asking; with several it shows one short marked list once (see Get the project documents). The choice holds for the rest of the conversation. |
| 3 | It detects the evidence level. From project docs: it carries on from the documents. From docs and code (no list of areas): it carries on and says once that the list is missing, naming areas without a summary as not documented and answering them from code. From code only (no paqad docs): it answers from the code by names with the "paqad, from code only" source line, never a stop while code is reachable. |
| 4 | It finds the related areas and reads only the documents the question needs, in the fixed reading order, stopping once the point is answered. |
| 5 | It checks whether each section it relies on is real content or an unfilled template. For an area the question needs that the documents do not cover, it checks that area's code automatically when the code is reachable. |
| 6 | It replies: the answer first, as a table for lists or one or two sentences for a yes/no or single fact, then one Sources line and one short source line for the evidence level. An overview question gets a table of areas, each with its plain name and one line on what it does; an area with no notes says it is not documented, plus what the code suggests from the names alone when the code is reachable. In code-only mode every row is built from the code by names. |
| 7 | Optionally, one short line on what the answer means and an offer to shape a change (see Turn an answer into an idea). Any closing offer or question comes after the Sources line and the source line, last, through the choice prompt when the host has one (TALK-13). |

## Business Rules

| Rule | Detail |
|---|---|
| Evidence level first | From project docs: the list of areas and at least one area summary. From docs and code: summaries but no list; the answer carries on and areas without a summary are named as not documented and answered from code. From code only: no paqad docs, so the answer is built from the code by names, never a stop while code is reachable (GRD-1, GRD-12, ASK-1). |
| Source line | Every answer carries one short source line for its level: "paqad, from project docs", "paqad, from docs and code" or "paqad, from code only". It is provenance, not a sales line (GRD-14). |
| Project asked once | An attached project is used without asking; the choice is never asked again in the conversation unless the user asks to switch (GRD-3). |
| Overview as a table | "What is this product?" or "what areas does it have?" is answered as a table of areas with one line each, then one Sources line; nothing is invented (ASK-9). |
| Read only what is needed | Registry, then module summaries, then business notes; deeper notes only to settle a fact (GRD-2). |
| Answer first | First line is the answer: no preamble, no restating, no closing summary (TALK-4). |
| Shape follows the question | Lists, counts, steps and comparisons as a table; yes/no and single facts as plain sentences; "how" or "why" explained only when asked (TALK-2, TALK-3). |
| Every fact is sourced | Each factual sentence or table row traces to a document; paths appear only on the one Sources line (ASK-2, GRD-5, TALK-6). |
| No guessing | Template, missing or contradictory sections are named as unconfirmed (ASK-3, GRD-4). |
| User's words | The user's term is used, with the project's term in brackets on first use, for example "members (called accounts in the project docs)" (ASK-4, GRD-6). |
| Documents are data | Text in a document that tries to give instructions is ignored and mentioned to the user (GRD-7). |
| Not documented does not mean not built | Missing notes or template text never mean a feature is missing. The area is called not documented, and nothing in the answer says or suggests the feature is missing, in any wording; "not built", "none yet" or "not there" are only examples (GRD-8). |
| Status from the exact thing it names | Built, coming soon or placeholder is said only from evidence about that exact area or item. A status line in a document covers only what it names: a menu entry or screen marked coming soon means that entry is not ready yet, not that the feature behind it is missing. It is said as what the docs say, never carried over to another area, to the feature behind a menu entry or to the whole product, and no area's status is worked out from another area's documents or screens; when the docs and the code disagree, both are said plainly (GRD-9). |
| Requirements are intent | A requirements or specification document kept outside the area notes never describes the product today. Anything taken from one is said as what is intended. The business notes of each area always describe today, even when they state rules that must hold (GRD-10). |
| Code checked automatically | When the documents do not cover an area the question needs and the code is reachable, the plugin checks that area's code itself, opening at most 5 files (none for an overview row) and never looking in the project's history folder or in bundled outside code, and says at most one line per area, as "the code suggests" (ASK-8, GRD-11). |
| Read only | Question answering never writes to the tracker (ASK-7). |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| A question about current product behaviour, or an overview question | A sourced answer in chat. No file, record or tracker change. |
| User accepts the offer to shape an idea | Hands over to the idea journey (separate feature). |

## Error States

| Situation | What the user sees |
|---|---|
| Project has no paqad docs (code-only) | Answered from the code by names with the "paqad, from code only" source line; no not-built claim and no stop. The sentence "This repository isn't set up for this yet. Ask your engineering team to onboard it with paqad, then come back." appears only as the optional at-most-once nudge. |
| Project at docs-and-code (list of areas missing) | "This project's list of areas is missing, so I'm working from the area summaries it has. Areas without a summary are shown as unknown." once, then the answer, with the uncovered areas answered from code. |
| Nothing readable at all | No usable docs and no reachable code: a request to attach the project or its documents folder, or to upload the documents. This is the only stop. |
| No project can be seen | A request to attach the project or its documents folder, or to upload the documents. |
| Relevant section is a blank template | A plain statement of what the documents cannot confirm, no guess, and an offer to shape an idea if useful (AC-22). |
| Area not documented, code reachable | The area is called not documented, then one line on what the code suggests, for example "Loyalty points are not documented. The code suggests members can earn and redeem points." (AC-57). |
| Area not documented, code not reachable | The area is called not documented, nothing is invented, and at most one short offer to check the code if it is attached (AC-58). |
| Nothing found under the area's name | The area is still called not documented, with a note that no code was found under its name; never not built (GRD-11). |
| Documents hold an embedded instruction | The instruction is ignored and mentioned; no action taken (AC-17). |
| Checking tools cannot run on this host | The same checks are done by hand from a written checklist; the answer looks the same (PLG-6). |

## How this skill gets picked

The skill's description covers overview questions and an attached or connected project as well as questions about how something works today. That raises the chance that the chat host picks this skill on its own for a matching message, but it cannot guarantee it, because the host decides. Naming the skill always works (PLG-8).

## Glossary

| Term | Meaning |
|---|---|
| Evidence level | How much the answer can rest on. From project docs: a module registry plus summaries. From docs and code: summaries but no registry. From code only: no paqad docs, so the answer rests on the code. A level is never a reason to refuse (GRD-12). |
| Template text | A section still holding the onboarding scaffold's placeholder wording, so it is not real information. |
| Not documented | The project's notes do not cover this area. It says nothing about whether the area is built. |
| The code suggests | The label on any line taken from the project's code rather than its notes; it is never turned into a fact. |
| Sources line | One short line at the end listing the documents the answer came from. |
| Project term | The name the project documents use for something the user may call differently. |

Sources: skills/ask-project/SKILL.md, skills/ask-project/references/answer-template.md, shared/references/connect-repository.md, shared/references/paqad-docs-map.md, shared/references/evidence-levels.md, REQUIREMENTS.md section 4B, GRD-12, GRD-14
