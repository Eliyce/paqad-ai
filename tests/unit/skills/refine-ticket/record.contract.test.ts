import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/claude-plugin/skills/refine-ticket/scripts/record.py',
  names: [
    'record help',
    'record invalid input',
    'record fixture output',
    'record idempotency',
    'record dry run',
    'record output size',
    'record secrets',
  ],
  fixture: {
    args: ['update', '--path', 'record.json', '--expect-revision', '0', '--patch', 'patch.json'],
    files: {
      'record.json':
        '{\n  "run": {\n    "run_id": "DR-20261101-AB12",\n    "revision": 0,\n    "step": 0,\n    "updated_at": "2026-11-01T22:00:42.801357+00:00",\n    "mode": "build"\n  },\n  "setup": {},\n  "idea": {},\n  "glossary": [],\n  "today": [],\n  "playback": {},\n  "decisions": [],\n  "assumptions": [],\n  "outcome": {},\n  "ticket_set_ref": {},\n  "readiness": {},\n  "posted": {},\n  "existing": [],\n  "changes": {},\n  "sizing": {},\n  "sprint_plan": {},\n  "stale": [],\n  "approval": null\n}\n',
      'patch.json': '{"setup": {"tracker": "github", "project": "acme/shop"}}',
    },
    stdout: '{"revision": 1, "step": 0, "status": "updated"}\n',
  },
  invalid: {
    args: ['update', '--path', 'record.json', '--expect-revision', '3', '--patch', 'patch.json'],
    files: {
      'record.json':
        '{\n  "run": {\n    "run_id": "DR-20261101-AB12",\n    "revision": 0,\n    "step": 0,\n    "updated_at": "2026-11-01T22:00:42.801357+00:00",\n    "mode": "build"\n  },\n  "setup": {},\n  "idea": {},\n  "glossary": [],\n  "today": [],\n  "playback": {},\n  "decisions": [],\n  "assumptions": [],\n  "outcome": {},\n  "ticket_set_ref": {},\n  "readiness": {},\n  "posted": {},\n  "existing": [],\n  "changes": {},\n  "sizing": {},\n  "sprint_plan": {},\n  "stale": [],\n  "approval": null\n}\n',
      'patch.json': '{"setup": {"tracker": "github", "project": "acme/shop"}}',
    },
    exit: 1,
  },
  writes: ['record.json'],
  rerun: 'fresh-dir',
});
