import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/claude-plugin/skills/refine-ticket/scripts/diff_ticket.py',
  names: [
    'diff_ticket help',
    'diff_ticket invalid input',
    'diff_ticket fixture output',
    'diff_ticket idempotency',
    'diff_ticket dry run',
    'diff_ticket output size',
    'diff_ticket secrets',
  ],
  fixture: {
    args: ['--snapshot', 'snapshot.json', '--proposed', 'proposed.json'],
    files: {
      'snapshot.json':
        '{"key":"SHOP-12","fields":{"summary":"Ask for a refund","description":"A shopper asks for a refund.","labels":["refunds"],"parent":"SHOP-1","links":[]},"last_updated":"2026-10-01T10:00:00Z"}\n',
      'proposed.json':
        '{"ticket_key":"SHOP-12","fields":{"summary":"Ask for a refund on a paid order","labels":["refunds","shoppers"]},"new_children":[],"description_mode":"section"}\n',
    },
    stdout:
      '{\n  "ok": true,\n  "conflict": false,\n  "change_set": {\n    "ticket_key": "SHOP-12",\n    "changes": [\n      {\n        "field": "summary",\n        "before": "Ask for a refund",\n        "after": "Ask for a refund on a paid order",\n        "op": "replace"\n      },\n      {\n        "field": "labels",\n        "before": [\n          "refunds"\n        ],\n        "after": [\n          "refunds",\n          "shoppers"\n        ],\n        "op": "replace"\n      }\n    ],\n    "new_children": [],\n    "digest": "cf3eb76a3e7ee7754ef318a423a786f346b46672e40932fe0b8a3b6e21db26a4"\n  },\n  "issues": []\n}\n',
  },
  invalid: {
    args: ['--snapshot', 'missing.json', '--proposed', 'proposed.json'],
    files: {
      'proposed.json':
        '{"ticket_key":"SHOP-12","fields":{"summary":"Ask for a refund on a paid order","labels":["refunds","shoppers"]},"new_children":[],"description_mode":"section"}\n',
    },
    exit: 1,
  },
});
