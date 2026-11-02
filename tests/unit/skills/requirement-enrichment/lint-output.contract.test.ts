import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/requirement-enrichment/scripts/lint-output.sh',
  names: [
    'lint-output help',
    'lint-output invalid input',
    'lint-output fixture output',
    'lint-output idempotency',
    'lint-output dry run',
    'lint-output output size',
    'lint-output secrets',
  ],
  fixture: {
    args: [],
    stdin:
      '{"questions":[{"business_text":"Today, an export includes the archived invoices too. Keep including them, or leave them out?","why_it_matters":"It changes what every downstream reader sees in the exported file.","options":["Keep the archived invoices in the export","Leave the archived invoices out of the export"],"grounded_in":"docs/modules/exports/overview.md","technical_note":"archived == status:archived rows in the export serializer"},{"business_text":"When the export can\'t be delivered, what should happen?","why_it_matters":"It decides whether a stuck export fails loudly or waits.","options":["Keep trying quietly for an hour, then notify someone","Fail straight away and tell the user"],"grounded_in":null}]}',
    stdout: 'ok\n',
  },
  invalid: { args: ['/no/such/file'], exit: 2 },
});
