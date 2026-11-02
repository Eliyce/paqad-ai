import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/claude-plugin/skills/ask/scripts/detect_placeholder.py',
  names: [
    'detect_placeholder help',
    'detect_placeholder invalid input',
    'detect_placeholder fixture output',
    'detect_placeholder idempotency',
    'detect_placeholder dry run',
    'detect_placeholder output size',
    'detect_placeholder secrets',
  ],
  fixture: {
    args: ['--path', 'doc.md'],
    files: {
      'doc.md':
        '# Billing\n\n## Purpose\nBilling charges shoppers and issues refunds.\n\n## Journeys\nDescribe the business purpose of the billing module.\n',
    },
    stdout:
      '{"sections": [{"heading": "Billing", "status": "real", "markers_hit": []}, {"heading": "Purpose", "status": "real", "markers_hit": []}, {"heading": "Journeys", "status": "template", "markers_hit": ["Describe the business purpose of the"]}]}\n',
  },
  invalid: { args: [], exit: 2 },
});
