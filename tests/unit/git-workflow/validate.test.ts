import { resolveGitWorkflow } from '@/git-workflow/load.js';

function errorsFor(contents: Parameters<typeof resolveGitWorkflow>[0]) {
  return resolveGitWorkflow(contents).errors.map((e) => ({ file: e.file, path: e.path }));
}

describe('git-workflow cross-file rules', () => {
  it('a type ticket source must exist in tickets.yaml', () => {
    expect(
      errorsFor({
        'branches.yaml': 'types:\n  bugfix:\n    tickets: [servicenow]\ndefault_type: bugfix\n',
      }),
    ).toEqual([{ file: 'branches.yaml', path: 'types.bugfix.tickets' }]);
  });

  it('default_type must name a type', () => {
    expect(errorsFor({ 'branches.yaml': 'default_type: story\n' })).toEqual([
      { file: 'branches.yaml', path: 'default_type' },
    ]);
  });

  it('prefixes are unique across types', () => {
    expect(
      errorsFor({
        'branches.yaml':
          'types:\n  bugfix: { prefix: fix }\n  hotfix: { prefix: fix }\ndefault_type: bugfix\n',
      }),
    ).toEqual([{ file: 'branches.yaml', path: 'types.hotfix.prefix' }]);
  });

  it('every pattern compiles as a JavaScript RegExp', () => {
    expect(
      errorsFor({
        'tickets.yaml': 'sources:\n  proj:\n    tracker: jira\n    pattern: "PROJ-(\\\\d+"\n',
      }),
    ).toEqual([{ file: 'tickets.yaml', path: 'sources.proj.pattern' }]);
  });

  it('a generic source has a pattern', () => {
    expect(errorsFor({ 'tickets.yaml': 'sources:\n  other:\n    tracker: generic\n' })).toEqual([
      { file: 'tickets.yaml', path: 'sources.other.pattern' },
    ]);
  });

  it('require_ticket true needs at least one source', () => {
    expect(errorsFor({ 'tickets.yaml': 'require_ticket: true\n' })).toEqual([
      { file: 'tickets.yaml', path: 'require_ticket' },
    ]);
  });

  it('an invalid config is reported, not replaced: valid is false and the errors name the key', () => {
    const result = resolveGitWorkflow({ 'branches.yaml': 'default_type: story\n' });
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toBe(
      'branches.yaml default_type is "story", but there\'s no branch type with that name.',
    );
  });

  it('a valid cross-file setup has no errors', () => {
    expect(
      errorsFor({
        'tickets.yaml': 'require_ticket: true\nsources:\n  inc: { tracker: servicenow }\n',
        'branches.yaml': 'types:\n  bugfix: { tickets: [inc] }\ndefault_type: bugfix\n',
      }),
    ).toEqual([]);
  });
});
