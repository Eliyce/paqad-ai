import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/claude-plugin/skills/check-tickets/scripts/check_prose.py',
  names: [
    'check_prose help',
    'check_prose invalid input',
    'check_prose fixture output',
    'check_prose idempotency',
    'check_prose dry run',
    'check_prose output size',
    'check_prose secrets',
  ],
  fixture: {
    args: ['--ticket-set', 'ticket-set.json'],
    files: {
      'ticket-set.json':
        '{\n  "run_id": "DR-20261101-AB12",\n  "revision": 1,\n  "digest": "d20c3e8a92591a3dc692eec5ca8a5153cd15dbe64d62ce0998ca4608a7f037a1",\n  "tracker": {\n    "kind": "github",\n    "project_key": "acme/shop",\n    "epic_type": "epic",\n    "story_type": "story"\n  },\n  "epics": [\n    {\n      "ref": "E1",\n      "title": "Refunds for shoppers",\n      "body_markdown": "Shoppers can ask for their money back.",\n      "labels": [\n        "refunds"\n      ],\n      "tickets": [\n        {\n          "ref": "E1-T1",\n          "title": "Ask for a refund",\n          "body_markdown": "## Goal\\nA shopper asks for a refund on a paid order.\\n\\nAs a shopper\\nI want to ask for a refund\\nSo that I get my money back",\n          "done_when": [\n            "Given a paid order  \\nWhen the shopper asks for a refund  \\nThen the request is saved",\n            "Given a saved request  \\nWhen support opens it  \\nThen they see the order"\n          ],\n          "depends_on": [],\n          "assignee_hint": ""\n        },\n        {\n          "ref": "E1-T2",\n          "title": "Approve a refund",\n          "body_markdown": "## Goal\\nSupport approves a refund request.\\n\\nAs a support agent\\nI want to approve a request\\nSo that the shopper is paid back",\n          "done_when": [\n            "Given a saved request  \\nWhen support approves it  \\nThen the shopper is paid back",\n            "Given an approved request  \\nWhen the shopper looks  \\nThen they see it is approved"\n          ],\n          "depends_on": [\n            "E1-T1"\n          ],\n          "assignee_hint": ""\n        }\n      ]\n    }\n  ]\n}',
    },
    stdout: '{\n  "ok": true,\n  "issues": []\n}\n',
  },
  invalid: {
    args: ['--ticket-set', 'ticket-set.json'],
    files: {
      'ticket-set.json':
        '{\n  "run_id": "DR-20261101-AB12",\n  "revision": 1,\n  "digest": "d20c3e8a92591a3dc692eec5ca8a5153cd15dbe64d62ce0998ca4608a7f037a1",\n  "tracker": {\n    "kind": "github",\n    "project_key": "acme/shop",\n    "epic_type": "epic",\n    "story_type": "story"\n  },\n  "epics": [\n    {\n      "ref": "E1",\n      "title": "Refunds for shoppers",\n      "body_markdown": "Shoppers can ask for their money back.",\n      "labels": [\n        "refunds"\n      ],\n      "tickets": [\n        {\n          "ref": "E1-T1",\n          "title": "Ask for a refund \\u2014 via POST /refunds",\n          "body_markdown": "## Goal\\nA shopper asks for a refund on a paid order.\\n\\nAs a shopper\\nI want to ask for a refund\\nSo that I get my money back",\n          "done_when": [\n            "Given a paid order  \\nWhen the shopper asks for a refund  \\nThen the request is saved",\n            "Given a saved request  \\nWhen support opens it  \\nThen they see the order"\n          ],\n          "depends_on": [],\n          "assignee_hint": ""\n        },\n        {\n          "ref": "E1-T2",\n          "title": "Approve a refund",\n          "body_markdown": "## Goal\\nSupport approves a refund request.\\n\\nAs a support agent\\nI want to approve a request\\nSo that the shopper is paid back",\n          "done_when": [\n            "Given a saved request  \\nWhen support approves it  \\nThen the shopper is paid back",\n            "Given an approved request  \\nWhen the shopper looks  \\nThen they see it is approved"\n          ],\n          "depends_on": [\n            "E1-T1"\n          ],\n          "assignee_hint": ""\n        }\n      ]\n    }\n  ]\n}',
    },
    exit: 1,
  },
});
