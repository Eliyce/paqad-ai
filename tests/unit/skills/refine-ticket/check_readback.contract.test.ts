import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/claude-plugin/skills/refine-ticket/scripts/check_readback.py',
  names: [
    'check_readback help',
    'check_readback invalid input',
    'check_readback fixture output',
    'check_readback idempotency',
    'check_readback dry run',
    'check_readback output size',
    'check_readback secrets',
  ],
  fixture: {
    args: ['--approved', 'ticket-set.json', '--created', 'created.json'],
    files: {
      'ticket-set.json':
        '{\n  "run_id": "DR-20261101-AB12",\n  "revision": 1,\n  "digest": "d20c3e8a92591a3dc692eec5ca8a5153cd15dbe64d62ce0998ca4608a7f037a1",\n  "tracker": {\n    "kind": "github",\n    "project_key": "acme/shop",\n    "epic_type": "epic",\n    "story_type": "story"\n  },\n  "epics": [\n    {\n      "ref": "E1",\n      "title": "Refunds for shoppers",\n      "body_markdown": "Shoppers can ask for their money back.",\n      "labels": [\n        "refunds"\n      ],\n      "tickets": [\n        {\n          "ref": "E1-T1",\n          "title": "Ask for a refund",\n          "body_markdown": "## Goal\\nA shopper asks for a refund on a paid order.\\n\\nAs a shopper\\nI want to ask for a refund\\nSo that I get my money back",\n          "done_when": [\n            "Given a paid order  \\nWhen the shopper asks for a refund  \\nThen the request is saved",\n            "Given a saved request  \\nWhen support opens it  \\nThen they see the order"\n          ],\n          "depends_on": [],\n          "assignee_hint": ""\n        },\n        {\n          "ref": "E1-T2",\n          "title": "Approve a refund",\n          "body_markdown": "## Goal\\nSupport approves a refund request.\\n\\nAs a support agent\\nI want to approve a request\\nSo that the shopper is paid back",\n          "done_when": [\n            "Given a saved request  \\nWhen support approves it  \\nThen the shopper is paid back",\n            "Given an approved request  \\nWhen the shopper looks  \\nThen they see it is approved"\n          ],\n          "depends_on": [\n            "E1-T1"\n          ],\n          "assignee_hint": ""\n        }\n      ]\n    }\n  ]\n}',
      'created.json':
        '[\n {\n  "ref": "E1",\n  "title": "Refunds for shoppers",\n  "type": "epic",\n  "parent": null,\n  "labels": [\n   "refunds"\n  ],\n  "links": [],\n  "sources_ref": "DR-20261101-AB12 / E1",\n  "body": "Shoppers can ask for their money back."\n },\n {\n  "ref": "E1-T1",\n  "title": "Ask for a refund",\n  "type": "story",\n  "parent": "E1",\n  "labels": [],\n  "links": [],\n  "sources_ref": "DR-20261101-AB12 / E1-T1",\n  "body": "## Goal\\nA shopper asks for a refund on a paid order.\\n\\nAs a shopper\\nI want to ask for a refund\\nSo that I get my money back"\n },\n {\n  "ref": "E1-T2",\n  "title": "Approve a refund",\n  "type": "story",\n  "parent": "E1",\n  "labels": [],\n  "links": [\n   {\n    "target": "E1-T1"\n   }\n  ],\n  "sources_ref": "DR-20261101-AB12 / E1-T2",\n  "body": "## Goal\\nSupport approves a refund request.\\n\\nAs a support agent\\nI want to approve a request\\nSo that the shopper is paid back"\n }\n]',
    },
    stdout: '{\n  "ok": true,\n  "status": "match",\n  "differences": []\n}\n',
  },
  invalid: {
    args: ['--approved', 'ticket-set.json', '--created', 'created.json'],
    files: {
      'ticket-set.json':
        '{\n  "run_id": "DR-20261101-AB12",\n  "revision": 1,\n  "digest": "d20c3e8a92591a3dc692eec5ca8a5153cd15dbe64d62ce0998ca4608a7f037a1",\n  "tracker": {\n    "kind": "github",\n    "project_key": "acme/shop",\n    "epic_type": "epic",\n    "story_type": "story"\n  },\n  "epics": [\n    {\n      "ref": "E1",\n      "title": "Refunds for shoppers",\n      "body_markdown": "Shoppers can ask for their money back.",\n      "labels": [\n        "refunds"\n      ],\n      "tickets": [\n        {\n          "ref": "E1-T1",\n          "title": "Ask for a refund",\n          "body_markdown": "## Goal\\nA shopper asks for a refund on a paid order.\\n\\nAs a shopper\\nI want to ask for a refund\\nSo that I get my money back",\n          "done_when": [\n            "Given a paid order  \\nWhen the shopper asks for a refund  \\nThen the request is saved",\n            "Given a saved request  \\nWhen support opens it  \\nThen they see the order"\n          ],\n          "depends_on": [],\n          "assignee_hint": ""\n        },\n        {\n          "ref": "E1-T2",\n          "title": "Approve a refund",\n          "body_markdown": "## Goal\\nSupport approves a refund request.\\n\\nAs a support agent\\nI want to approve a request\\nSo that the shopper is paid back",\n          "done_when": [\n            "Given a saved request  \\nWhen support approves it  \\nThen the shopper is paid back",\n            "Given an approved request  \\nWhen the shopper looks  \\nThen they see it is approved"\n          ],\n          "depends_on": [\n            "E1-T1"\n          ],\n          "assignee_hint": ""\n        }\n      ]\n    }\n  ]\n}',
      'created.json':
        '[{"ref": "E1", "title": "Refunds for shoppers", "type": "epic", "parent": null, "labels": ["refunds"], "links": [], "sources_ref": "DR-20261101-AB12 / E1", "body": "Shoppers can ask for their money back."}, {"ref": "E1-T1", "title": "Something else", "type": "story", "parent": "E1", "labels": [], "links": [], "sources_ref": "DR-20261101-AB12 / E1-T1", "body": "## Goal\\nA shopper asks for a refund on a paid order.\\n\\nAs a shopper\\nI want to ask for a refund\\nSo that I get my money back"}, {"ref": "E1-T2", "title": "Approve a refund", "type": "story", "parent": "E1", "labels": [], "links": [{"target": "E1-T1"}], "sources_ref": "DR-20261101-AB12 / E1-T2", "body": "## Goal\\nSupport approves a refund request.\\n\\nAs a support agent\\nI want to approve a request\\nSo that the shopper is paid back"}]',
    },
    exit: 1,
  },
});
