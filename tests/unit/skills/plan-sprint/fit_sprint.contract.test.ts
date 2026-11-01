import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/claude-plugin/skills/plan-sprint/scripts/fit_sprint.py',
  names: [
    'fit_sprint help',
    'fit_sprint invalid input',
    'fit_sprint fixture output',
    'fit_sprint idempotency',
    'fit_sprint dry run',
    'fit_sprint output size',
    'fit_sprint secrets',
  ],
  fixture: {
    args: [
      'plan',
      '--sprint-field',
      'customfield_10020',
      '--candidates',
      'candidates.json',
      '--history',
      'history.json',
    ],
    files: {
      'candidates.json':
        '{"sprints":[{"id":"Sprint 7","state":"future","settable":true}],"candidates":[{"ref":"SHOP-10","priority":1,"size":3,"checks_pass":true,"dependencies":[]},{"ref":"SHOP-11","priority":2,"size":5,"checks_pass":true,"dependencies":[{"ref":"SHOP-10","done":false,"in_sprint":false}]},{"ref":"SHOP-12","priority":3,"size":8,"checks_pass":false,"dependencies":[]}]}\n',
      'history.json':
        '{"sprints":[{"id":"Sprint 4","delivered":8},{"id":"Sprint 5","delivered":10},{"id":"Sprint 6","delivered":9}]}\n',
    },
    stdout:
      '{\n  "ok": true,\n  "sprint": "Sprint 7",\n  "capacity": {\n    "value": 9,\n    "derived_from": [\n      {\n        "sprint": "Sprint 4",\n        "count": 8\n      },\n      {\n        "sprint": "Sprint 5",\n        "count": 10\n      },\n      {\n        "sprint": "Sprint 6",\n        "count": 9\n      }\n    ]\n  },\n  "goal": "Deliver the top 1 ready item(s) for Sprint 7 within a capacity of 9.",\n  "chosen": [\n    "SHOP-10"\n  ],\n  "stretch": [],\n  "left_out": [],\n  "total": 3,\n  "risks": [\n    "2 candidate(s) are not ready and were excluded."\n  ],\n  "not_ready": [\n    {\n      "ref": "SHOP-11",\n      "needs": [\n        "dependency SHOP-10 done or in the sprint"\n      ]\n    },\n    {\n      "ref": "SHOP-12",\n      "needs": [\n        "its checks to pass"\n      ]\n    }\n  ],\n  "by_hand": false,\n  "digest": "5ed948ef3005982d9403ea7ee374f0acba7a08bfdc7cecf2251d2dae8362e121"\n}\n',
  },
  invalid: {
    args: [
      'plan',
      '--sprint-field',
      'customfield_10020',
      '--candidates',
      'missing.json',
      '--history',
      'history.json',
    ],
    files: {
      'history.json':
        '{"sprints":[{"id":"Sprint 4","delivered":8},{"id":"Sprint 5","delivered":10},{"id":"Sprint 6","delivered":9}]}\n',
    },
    exit: 1,
  },
});
