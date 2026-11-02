import { describeContract } from '../_helpers/contract.js';

describeContract({
  script:
    'runtime/capabilities/coding/skills/database-design-review/scripts/scan-migration-smells.sh',
  names: [
    'scan-migration-smells help',
    'scan-migration-smells invalid input',
    'scan-migration-smells fixture output',
    'scan-migration-smells idempotency',
    'scan-migration-smells dry run',
    'scan-migration-smells output size',
    'scan-migration-smells secrets',
  ],
  fixture: {
    args: ['{dir}/drop_users.sql'],
    files: { 'drop_users.sql': 'DROP TABLE users;\nALTER TABLE x DROP COLUMN y;' },
    stdout:
      'smell | file:line | excerpt\ndestructive-drop | <dir>/drop_users.sql:1 | DROP TABLE users;\ndestructive-drop | <dir>/drop_users.sql:2 | ALTER TABLE x DROP COLUMN y;\n',
  },
  invalid: { args: [], exit: 2 },
});
