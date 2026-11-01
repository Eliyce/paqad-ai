import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/session-resume/scripts/load-resume-bundle.sh',
  names: [
    'load-resume-bundle help',
    'load-resume-bundle invalid input',
    'load-resume-bundle fixture output',
    'load-resume-bundle idempotency',
    'load-resume-bundle dry run',
    'load-resume-bundle output size',
    'load-resume-bundle secrets',
  ],
  fixture: {
    args: [],
    files: {
      '.paqad/onboarding-manifest.json':
        '{"projectSlug":"demo","projectName":"Demo","domain":"coding","detectedStack":"node","extraField":"ignored"}',
      '.paqad/project-profile.yaml':
        'slug: demo\ndomain: coding\nprimary_stack: node\nlane: graduated\nstrictness: standard\n',
      '.paqad/session/handoff.md': '# handoff body\nphase: implementation',
    },
    stdout:
      '=== handoff ===\n# handoff body\nphase: implementation\n=== project ===\nslug: demo\ndomain: coding\nprimary_stack: node\nlane: graduated\nstrictness: standard\n\n=== manifest ===\n{\n  "projectSlug": "demo",\n  "projectName": "Demo",\n  "domain": "coding",\n  "detectedStack": "node"\n}\n',
  },
  invalid: { args: [], exit: 1 },
});
