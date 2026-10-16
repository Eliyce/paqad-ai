# Understand the idea: business

## Overview

Step 1 of the idea journey ("Your idea"). The plugin works out what the idea really is: the goal, who benefits, what success looks like and the constraints. It uses what the user and the documents already said, then asks one question at a time about what is still missing, each with a recommendation. It runs only when the journey directs it.

## User Roles

| Role | What they do here |
|---|---|
| Business user | Answers short questions, picks a choice, or says "I don't know" |

## User Flows

| Step | What happens |
|---|---|
| 1 | The plugin reads the first message and the documents. If goal, who benefits and success are already clear, it does not ask them again (AC-3). |
| 2 | For each gap, it asks one question with a recommendation and two or three short choices through the host's choice prompt, the recommended one first and marked (a short list in the reply only when the host has none). |
| 3 | If the user cannot say what success looks like, it offers two or three suggested measures through the choice prompt, each labelled a suggestion, and keeps only the one accepted (AC-25). |
| 4 | "I don't know" is accepted: a sensible default is offered and recorded as an assumption. |
| 5 | Where the user's word differs from the project's, the pair is noted so later steps show both. |

## Business Rules

| Rule | Detail |
|---|---|
| Extract before asking | Ask only about the material gap (CON-2). |
| One at a time | One question per turn, never a batch (AC-4). |
| Bring a recommendation | Every question has a recommendation and two or three choices, asked through the choice prompt (CON-1, TALK-8). |
| Suggest, never invent | Suggested measures are labelled; none is recorded unless accepted (CON-6). |
| No made-up numbers | Never invent a target number, date or percentage; if no measure is accepted, record "to be measured after release" (TKT-5). |
| Keep the user's words | Note user-term and project-term pairs for the glossary (GRD-6). |

## Triggers and Side Effects

| Trigger | Side effect |
|---|---|
| Step 0 finishes | Fills the idea part of the record; may add assumptions and glossary pairs |

## Error States

| Situation | What happens |
|---|---|
| User does not know | A default is offered, labelled as an assumption and recorded (AC-29) |
| User accepts no suggested measure | Success is recorded as "to be measured after release" |

## Glossary

| Term | Meaning |
|---|---|
| Goal | Who gets what value |
| Success | A measure the user accepts for knowing the change worked |
| Constraints | Limits such as time, cost, rules or systems to respect |
| Assumption | A default the user accepted when they did not know, kept separate from decisions |

Sources: skills/understand-idea/SKILL.md, skills/understand-idea/references/question-bank.md, skills/understand-idea/references/success-prompts.md
