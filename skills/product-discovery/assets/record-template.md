# Discovery record template

The record is one JSON object per run, the plugin's only memory. Create it once from this template
and write it to a file where the host can create files, silently: it is never offered or named to
the user; it is given as a resume file only when the user asks to stop and come back later. Every
write names the revision it expects; a write against an older revision is refused. The record
never holds credentials, connector tokens or personal data the run does not need.

Each block below shows its fields. A block is empty until the step that owns it fills it.

```json
{
  "run": {
    "run_id": "DR-20261005-7K2Q",
    "revision": 0,
    "step": 0,
    "updated_at": "<ISO 8601 timestamp>",
    "mode": "build"
  },
  "setup": {
    "repository": "",
    "repository_state": "",
    "evidence_level": "",
    "tracker_kind": "jira",
    "project_key": "ABC",
    "epic_type": "Epic",
    "story_type": "Story",
    "issue_types": [],
    "required_fields": {},
    "link_types": [],
    "size_field_id": null,
    "sprint_field_id": null,
    "can_create": false,
    "run_label": "dr-20261005-7k2q"
  },
  "idea": {
    "goal": "",
    "who_benefits": "",
    "success": "",
    "constraints": ""
  },
  "glossary": [
    { "user_term": "", "project_term": "" }
  ],
  "today": [
    { "area": "", "source_path": "", "evidence_level": "project-docs", "section_status": { "roles": "real", "rules": "template" } },
    { "area": "", "source_path": "", "evidence_level": "code-only", "section_status": { "summary": "missing" }, "code_suggests": "", "code_source_path": "" }
  ],
  "playback": {
    "goal_first_playback": "",
    "lenses": [],
    "options": [],
    "smaller_first_step": "",
    "recommendation": ""
  },
  "decisions": [
    { "id": "", "question": "", "choice": "", "by": "", "why": "" }
  ],
  "assumptions": [
    { "id": "", "question": "", "default": "", "why": "" }
  ],
  "outcome": {
    "type": "build",
    "reason": "",
    "next_action": ""
  },
  "ticket_set_ref": {
    "path": "",
    "digest": "",
    "revision": 0
  },
  "readiness": {
    "status": "open",
    "checks": [],
    "reviewer": "",
    "notes": ""
  },
  "posted": {
    "issues": [
      { "ref": "", "issue_key": "", "status": "created" }
    ],
    "read_back": {}
  },
  "existing": [
    { "key": "", "last_updated": "" }
  ],
  "changes": {
    "ticket_key": "",
    "changes": [],
    "new_children": []
  },
  "sizing": {
    "suggestion": {}
  },
  "sprint_plan": {
    "sprint": "",
    "goal": "",
    "chosen": []
  }
}
```

## Field notes

- run.run_id follows the pattern DR-YYYYMMDD-XXXX. run.revision starts at 0 and rises by one on
  every change. run.step is the current journey step, 0 to 6. run.mode defaults to build.
- setup comes from the step 0 tracker and project discovery (PUB-1). run_label is the run id in
  lowercase.
- setup.repository is the chosen repository's name as the tool or attachment shows it (empty when
  none is shown), and setup.repository_state is ready or partly-ready. setup.evidence_level is the
  level the repository was read at, one of project-docs, docs-and-code or code-only
  (references/evidence-levels.md); project-docs maps to the ready state, docs-and-code to
  partly-ready, and code-only to a repository with reachable code but no paqad docs. get-connected
  sets all three at step 0, or the first docs-reading step sets them in a refine or size run; a
  switch the user asks for patches them. Setup sits outside the go-back chain, so they survive going
  back. None holds credentials (REC-6).
- idea is the step 1 output. glossary pairs the user's term with the project's term (GRD-6).
- today lists each related area, its source path, its evidence_level and per section whether it is
  real or template (GRD-4). The per-entry evidence_level (project-docs, docs-and-code or code-only)
  is the provenance of that entry, so a code-only or docs-and-code line keeps its level into playback
  and tickets. playback is the step 3 output; its outcome type is one of build, experiment, already
  exists, process change, defer or stop (CON-8).
- An entry for an area the documents do not cover may add code_suggests, one plain line that itself
  contains "the code suggests", and code_source_path, the code folder it came from (GRD-11); its
  evidence_level is code-only or docs-and-code. source_path then names where the area was found
  (docs/modules/<area>/ when the folder exists, otherwise the modules list or the code folder). Both
  code fields are left out when the code was not checked.
- decisions records each settled choice with who decided and why. assumptions holds accepted
  defaults, each labelled an assumption.
- ticket_set_ref.digest is the sha256 of the canonical ticket set with the digest field excluded.
  Each approval is bound to that digest and any later edit voids it.
- readiness.status is passed or open. posted.issues status is one of created, uncertain or not
  applied; posted.read_back is an object keyed by issue reference. A fresh record seeds posted as an
  empty object and step 6 is not satisfied until a real posting fills it, so an untouched record is
  never read as already posted.
- existing, changes, sizing and sprint_plan are the existing-work blocks (refine, size and plan
  modes). They are empty in a fresh build-mode record and only required in their own mode. The
  shapes above mirror what record.py seeds.
