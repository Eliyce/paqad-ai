# Ticket template

Every ticket is a user story. Use this layout for `body_markdown`, in this order. Each ticket sits
under exactly one epic. The rules (specific role, real value, Given/When/Then criteria, API or UI,
permissions, the silent self-audit, refusal) and the line-break rule are in
`references/user-stories.md`: every line inside a block except its last ends with two trailing
spaces. Keep it in plain business words and follow `references/writing-rules.md`.

## Layout

```
**Implementation Target:** API | UI
**Module Name:** `<plain module name>`
**Feature Name:** `<feature name>`            (optional; omit the line when not given)
**Roadmap Reference:** <roadmap reference>    (optional; omit the line when not given)
**Epic:** <epic ref and title>

**As a** <specific role>,
**I want** <capability in plain words>,
**So that** <real outcome>.

**Acceptance Criteria**
- **Given** <starting state>,
  **When** <action>,
  **Then** <observable outcome>,
  **And** <more of the same outcome>.

**Depends on:** E1-T1, ABC-12    (or "**Depends on:** none")

**What exists today**
Only the part relevant to this ticket, including the unknowns. A line from existing tickets keeps
"the tickets say" and its issue keys, and is never written as built. The repository wins a
disagreement with the tickets.

**Not included**
Required.

**Open questions**
Optional.

**Sources**
The document paths, then the run label and item reference, for example DR-20261005-7K2Q / E1-T2.
```

## How it maps to ticket-set.json

| Ticket part | ticket-set.json field |
|---|---|
| Title: a verb plus the outcome, at most 80 characters | `title` |
| Each acceptance criterion, its lines joined by two trailing spaces and a newline | one `done_when` item, 2 to 8 |
| Depends on | `depends_on` refs |
| The whole layout above | `body_markdown` |
| A person the author names | `assignee_hint` |

The first time the author's term appears, the other term follows in brackets with where it came
from: "(called entry gate in the project docs)" or "(called entry gate in the tickets)". Write the
ticket in the language the tracker project's existing tickets use when they were read, otherwise in
the author's language, unless the author asks for another. The field labels and section headings
above stay as written.

The ref stays E<n>-T<n>; the preview shows "E1-T1: title". Assignee is left empty unless the
author names a person, who is then looked up through the tracker connector.
