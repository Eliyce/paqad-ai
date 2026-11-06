# High-Level Design Sign-off

> **Layer:** `agent-workflows` &nbsp;·&nbsp; **Confidence:** `medium` &nbsp;·&nbsp; **Slug:** `design-sign-off`

## Purpose

After a change's spec is frozen, team leads and solution architects get a short,
business-language design of the change in the team's tracker or approval channel and sign it
off before any code is written. The chat final review of the spec stays as it is; this is a
second, team-facing stop. Off by default.

## Config

`.paqad/configs/git-workflow/design-sign-off.yaml`, the sixth git-workflow file, team-wide
with no personal override. Defaults: `enabled: false`, `lanes: [graduated, full]`,
`approval_channel` empty (post to the change's ticket), `format.summary_max_words: 200`,
`format.detail_max_words: 800`, `wait_for_approval: true`, `approve_by: either`,
`approve_words: [approved, lgtm, "sign off"]`, `approvers: []` (anyone except the change's
developer), `move_to_on_post: ""`, `approved_status: ""`, `allow_skip_with_reason: true`.
`paqad-ai update` adds the file with its defaults when it is missing, even while the other
git-workflow files are on hold.

## Where it posts

The tracker comes from the ticket link the developer pasted first; with no link, from
`tickets.yaml`. An empty `approval_channel` means the tracker itself. A post moves the ticket
with the delivery ticket-move `on_hld_post` when `move_to_on_post` is set.

## Flow

1. `paqad-ai spec freeze` prints `> - 🟡 next: write the high-level design. Run paqad-ai hld brief.`
   when sign-off is on and the change's lane is listed.
2. The `high-level-design` skill writes the design from `assets/hld.template.md`.
3. `paqad-ai hld check <file>` checks word limits, sections, code words, jargon and em dashes.
4. The agent posts with its own connector tool, following a destination profile (Jira,
   Microsoft Teams, Slack, GitHub), and records `paqad-ai hld posted` or `hld not-posted`.
5. The first code edit waits until `hld.json` is `approved`, `skipped` or `not_posted`.
6. `paqad-ai hld check-approval --replies <file> [--status <status>]` decides approved,
   changes requested (raises a `spec.change` decision) or still waiting.

## Verbs

| Verb | What it does |
|---|---|
| `paqad-ai hld brief` | Template, frozen inputs, destination, profile and version to post. |
| `paqad-ai hld check <file>` | The deterministic design check; exit 1 with each problem and its line. |
| `paqad-ai hld posted` | Records a post (`--target --link --id --at --author-id --file`), v2 on a changed design, the ticket move `on_hld_post`. |
| `paqad-ai hld not-posted` | Saves `hld.md`, records `not_posted`, prints the not-connected line. The change is not parked. |
| `paqad-ai hld check-approval` | Decides sign-off from the replies and status; removes a replies file under `.paqad/tmp`. |
| `paqad-ai hld skip --reason` | Builds before sign-off when the team allows it; shown in the PR body and the receipt. |

## Session hooks, PR body and receipt

SessionStart prints a waiting line for each design still awaiting sign-off, and
UserPromptSubmit resumes the change on its own once `check-approval` finds it approved. The
PR body and the receipt each carry one line with the sign-off state, link or skip reason.

## Bundle files

The feature bundle holds `hld.json` (the state) and `hld.md` (the design as posted or, when
not posted, as saved).

## hld.json

Written only by the `hld` verbs. Fields: `state` (`awaiting_sign_off`, `approved`,
`changes_requested`, `skipped`, `not_posted`), `ref`, `version`, `digest`, `posts[]`
(`target`, `link`, `id`, `at`, `version`, `digest`, `author_digest`, `detail_posted`,
`move_failed`), `approved_at`, `approval_link`, `skip_reason`. No names, emails, author ids or
reply text: only a sha256 digest of the developer's author id. Waiting refs are also kept in
`.paqad/session/hld-waiting.json` so SessionStart and UserPromptSubmit stay cheap.

## Approval rule

Only replies after the latest post's destination time count. The developer's own replies and
reactions, and bot replies, never count. A reply with an approve word (whole word, not
negated, not a question) or a ✅ or 👍 reaction approves, from anyone in `approvers` or, when
that list is empty, anyone except the developer. A status equal to `approved_status` approves
when `approve_by` is `status` or `either`. A clear request for changes sends the spec back;
any other reply keeps the design waiting.

## Sources

- `src/hld`
- `src/cli/commands/hld.ts`
- `runtime/base/skills/high-level-design`
