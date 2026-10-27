# Consultant, not questionnaire: API

This feature has no network or HTTP API and no script of its own. It is a conversation rule held once in `shared/references/consulting.md` and copied in
as `references/consulting.md` by `product-discovery` and `ask-project` (`build/skills.yml`). It
has no programmatic interface; the contract is the text the skills consume.

## Contract the skills consume

| Rule | What the skill must do |
|---|---|
| CON-1 | Every question carries a recommendation and two or three choices, asked through the host's choice prompt (TALK-8); "I don't know" gets a labelled default |
| CON-2 | Extract from the documents and the conversation first; one material question at a time |
| CON-3 | Challenge kindly with evidence; the way forward offered as a choice in the choice prompt |
| CON-4, CON-5 | Six expert lenses; a smaller first release or experiment where the idea is large or uncertain |
| CON-6 | Suggestions labelled and offered as choices; only an accepted one is recorded |
| CON-7 to CON-9 | Research on the user's behalf, recommend one of six outcomes, speak in time, cost, risk and effect on users |

## Record blocks it leads to

The stance writes nothing itself. Through the journey it produces `assumptions` entries
(`{id, question, default, why}`, CON-1) and the `outcome` block (`{type, reason, next_action}`,
CON-8), written by `product-discovery` with `record.py update` (see
[record-lifecycle API](../../../discovery-record/features/record-lifecycle/api.md)).
