import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/claude-plugin/skills/refine-ticket/scripts/check_record.py',
  names: [
    'check_record help',
    'check_record invalid input',
    'check_record fixture output',
    'check_record idempotency',
    'check_record dry run',
    'check_record output size',
    'check_record secrets',
  ],
  fixture: {
    args: ['--path', 'record.json'],
    files: {
      'record.json':
        '{\n  "run": {\n    "run_id": "DR-20261101-AB12",\n    "revision": 0,\n    "step": 0,\n    "updated_at": "2026-11-01T22:00:42.801357+00:00",\n    "mode": "build"\n  },\n  "setup": {\n    "tracker": "github",\n    "project": "acme/shop"\n  },\n  "idea": {},\n  "glossary": [],\n  "today": [],\n  "playback": {},\n  "decisions": [],\n  "assumptions": [],\n  "outcome": {},\n  "ticket_set_ref": {},\n  "readiness": {},\n  "posted": {},\n  "existing": [],\n  "changes": {},\n  "sizing": {},\n  "sprint_plan": {},\n  "stale": [],\n  "approval": null\n}',
    },
    stdout: '{\n  "ok": true,\n  "issues": []\n}\n',
  },
  invalid: {
    args: ['--path', 'record.json'],
    files: {
      'record.json':
        '{\n  "run": {\n    "run_id": "DR-20261101-AB12",\n    "revision": 0,\n    "step": 0,\n    "updated_at": "2026-11-01T22:00:42.801357+00:00",\n    "mode": "build"\n  },\n  "setup": {},\n  "idea": {},\n  "glossary": [],\n  "today": [],\n  "playback": {},\n  "decisions": [],\n  "assumptions": [],\n  "outcome": {},\n  "ticket_set_ref": {},\n  "readiness": {},\n  "posted": {},\n  "existing": [],\n  "changes": {},\n  "sizing": {},\n  "sprint_plan": {},\n  "stale": [],\n  "approval": null\n}\n',
    },
    exit: 1,
  },
});
