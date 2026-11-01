import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/claude-plugin/skills/size-work/scripts/compare_sizes.py',
  names: [
    'compare_sizes help',
    'compare_sizes invalid input',
    'compare_sizes fixture output',
    'compare_sizes idempotency',
    'compare_sizes dry run',
    'compare_sizes output size',
    'compare_sizes secrets',
  ],
  fixture: {
    args: ['suggest', '--target', 'target.json', '--pool', 'pool.json', '--scale', 'scale.json'],
    files: {
      'target.json':
        '{"key":"SHOP-30","summary":"Refund a cancelled order","labels":["refunds"]}\n',
      'pool.json':
        '[{"key":"SHOP-10","link":"https://example.test/SHOP-10","size":3,"summary":"Refund a paid order","labels":["refunds"]},{"key":"SHOP-11","link":"https://example.test/SHOP-11","size":3,"summary":"Refund shipping costs","labels":["refunds"]},{"key":"SHOP-12","link":"https://example.test/SHOP-12","size":8,"summary":"Export the catalogue","labels":["catalogue"]}]\n',
      'scale.json': '{"scale":[1,2,3,5,8]}\n',
    },
    stdout:
      '{\n  "ok": true,\n  "suggestion": {\n    "size": 3,\n    "range": null,\n    "drivers": [\n      "Shares order, refund, refunds with SHOP-10",\n      "Shares refund, refunds with SHOP-11"\n    ],\n    "confidence": "medium",\n    "confidence_reason": "Based on 2 comparable finished tickets.",\n    "comparables": [\n      {\n        "key": "SHOP-10",\n        "link": "https://example.test/SHOP-10",\n        "size": 3\n      },\n      {\n        "key": "SHOP-11",\n        "link": "https://example.test/SHOP-11",\n        "size": 3\n      }\n    ],\n    "label": "suggested size"\n  }\n}\n',
  },
  invalid: { args: ['set', '--field-value', '5'], exit: 1 },
});
