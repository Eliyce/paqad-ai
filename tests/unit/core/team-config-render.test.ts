import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { FRAMEWORK_CONFIG_SPECS, type FrameworkConfigSpec } from '@/core/framework-config.js';
import {
  NOT_A_SETTING_LINE,
  readTeamConfig,
  renderTeamConfigFile,
  repairTeamConfigText,
  TEAM_CONFIG_HEADER_LINES,
  TEAM_NOTES_LINE,
  teamConfigPath,
} from '@/core/team-config.js';
import { STRUCTURED_TEAM_SETTINGS } from '@/core/team-config-schema.js';
import {
  TEAM_CONFIG_FILE_DESCRIPTIONS,
  TEAM_CONFIG_FILES,
  yamlDefault,
  type OwnTeamConfigFile,
} from '@/core/team-config-values.js';

const VERSION = '9.9.9';
const PAQAD: OwnTeamConfigFile = 'paqad.yaml';
const WORKFLOW: OwnTeamConfigFile = 'feature-development/workflow.yaml';

function render(file: OwnTeamConfigFile, text: string | null = null): string {
  return renderTeamConfigFile(file, text === null ? null : YAML.parseDocument(text), VERSION);
}

function rerender(file: OwnTeamConfigFile, text: string): string {
  return render(file, text);
}

function fresh(file: OwnTeamConfigFile): string {
  return render(file);
}

function edit(text: string, from: string, to: string): string {
  expect(text).toContain(from);
  return text.replace(from, to);
}

function parsed(text: string): unknown {
  const document = YAML.parseDocument(text);
  expect(document.errors).toEqual([]);
  return document.toJS();
}

interface Entry {
  file: OwnTeamConfigFile;
  path: readonly string[];
  note: string;
  value: unknown;
  list: boolean;
}

function entries(): Entry[] {
  const own = new Set<string>(TEAM_CONFIG_FILES);
  return [
    ...FRAMEWORK_CONFIG_SPECS.filter((spec) => own.has(spec.file)).map((spec) => ({
      file: spec.file as OwnTeamConfigFile,
      path: spec.path,
      note: spec.comment,
      value: yamlDefault(spec),
      list: spec.yaml?.list === true,
    })),
    ...STRUCTURED_TEAM_SETTINGS.map((setting) => ({
      file: setting.file,
      path: setting.path,
      note: String(setting.schema.description),
      value: setting.schema.default,
      list: setting.schema.type === 'array',
    })),
  ];
}

function settingLineIndex(lines: string[], path: readonly string[]): number[] {
  const found: number[] = [];
  let from = 0;
  for (let depth = 0; depth < path.length; depth += 1) {
    const prefix = `#${' '.repeat(1 + depth * 2)}${path[depth]}:`;
    const at = lines.findIndex(
      (line, index) => index >= from && (line === prefix || line.startsWith(`${prefix} `)),
    );
    if (at === -1) return [];
    found.push(at);
    from = at + 1;
  }
  return found;
}

function uncomment(text: string, path: readonly string[]): string {
  const lines = text.split('\n');
  const indexes = settingLineIndex(lines, path);
  expect(indexes.length, path.join('.')).toBe(path.length);
  for (const index of indexes) lines[index] = lines[index]!.slice(2);
  return lines.join('\n');
}

function withDefault<T>(key: string, value: FrameworkConfigSpec['default'], run: () => T): T {
  const spec = FRAMEWORK_CONFIG_SPECS.find((row) => row.key === key)! as { default: unknown };
  const before = spec.default;
  spec.default = value;
  try {
    return run();
  } finally {
    spec.default = before;
  }
}

function oldSchemaLine(file: string): string {
  const name = file
    .split('/')
    .pop()!
    .replace(/\.yaml$/u, '');
  const ref = file.includes('/')
    ? `../schemas/${file.split('/')[0]}/${name}.schema.json`
    : `./schemas/${name}.schema.json`;
  return `# yaml-language-server: $schema=${ref}`;
}

describe('renderTeamConfigFile: a fresh file', () => {
  it('writes the header lines in order, with the description first and no schema line', () => {
    for (const file of TEAM_CONFIG_FILES) {
      const lines = fresh(file).split('\n');
      expect(lines.slice(0, 5)).toEqual([
        `# ${TEAM_CONFIG_FILE_DESCRIPTIONS[file]}`,
        ...TEAM_CONFIG_HEADER_LINES,
        `paqad_version: "${VERSION}"`,
      ]);
    }
  });

  it('AC-31: lists every setting exactly once, in its own file, with a note line above', () => {
    const texts = new Map(TEAM_CONFIG_FILES.map((file) => [file, fresh(file).split('\n')]));
    for (const entry of entries()) {
      expect(entry.note.trim(), entry.path.join('.')).not.toBe('');
      for (const [file, lines] of texts) {
        const indexes = settingLineIndex(lines, entry.path);
        if (file !== entry.file) {
          if (indexes.length === entry.path.length) {
            const other = entries().some(
              (row) => row.file === file && row.path.join('.') === entry.path.join('.'),
            );
            expect(other, `${entry.path.join('.')} in ${file}`).toBe(true);
          }
          continue;
        }
        expect(indexes.length, `${entry.path.join('.')} in ${file}`).toBe(entry.path.length);
        const at = indexes[indexes.length - 1]!;
        expect(lines[at - 1]!).toMatch(/^#(?: +#)? \S/u);
        expect(lines[at - 1]!).toContain(entry.note);
      }
    }
    for (const [file, lines] of texts) {
      const unwrap = (line: string): string => line.replace(/^[\s#]+/u, '');
      const keyShaped = (line: string): boolean => /^[a-z_]+:/u.test(unwrap(line));
      const notes = lines.filter(
        (line, index) =>
          index > 5 &&
          line.startsWith('#') &&
          !keyShaped(line) &&
          keyShaped(lines[index + 1] ?? ''),
      );
      expect(notes.length, file).toBe(entries().filter((entry) => entry.file === file).length);
    }
  });

  it('AC-6 and INV-1: a file with nothing uncommented parses to only paqad_version', () => {
    for (const file of TEAM_CONFIG_FILES) {
      expect(parsed(fresh(file))).toEqual({ paqad_version: VERSION });
    }
  });

  it('AC-11: removing the # in front of one setting and its groups gives its default', () => {
    for (const entry of entries()) {
      const text = uncomment(fresh(entry.file), entry.path);
      const data = parsed(text) as Record<string, unknown>;
      const expected = entry.value !== undefined ? entry.value : entry.list ? [] : null;
      let value: unknown = data;
      for (const segment of entry.path) value = (value as Record<string, unknown>)[segment];
      expect(value, entry.path.join('.')).toEqual(expected);
      expect(Object.keys(data)).toEqual(['paqad_version', entry.path[0]]);
    }
  });

  it('AC-11: quoted strings, empty strings, colons and # survive the round trip', () => {
    for (const value of ['a: b', 'x # y', '', '"quoted"', 'yes', '1.0', '#start']) {
      withDefault('model_default', value, () => {
        const text = uncomment(fresh('models.yaml'), ['models', 'default']);
        expect(YAML.parseDocument(text).getIn(['models', 'default'])).toBe(value);
      });
    }
  });

  it('writes the no-default and empty-list forms', () => {
    const retrieval = fresh('retrieval.yaml');
    expect(retrieval).toMatch(/^# {3}# .* Not set by default\.\n# {3}provider:$/mu);
    const workflow = fresh(WORKFLOW);
    expect(workflow).toContain('#     read: []\n');
    expect(fresh('feature-development/checks.yaml')).toMatch(
      /# .* Not set by default\.\n# {3}extra:$/mu,
    );
  });

  it('writes a commented line as the live line with # put in at its outermost level', () => {
    const text = fresh(PAQAD);
    expect(text).toContain('\n# updates:\n#   # ');
    expect(text).toContain('\n#   automatic: true\n');
    expect(text).toContain('\n# enabled: true\n');
  });
});

describe('renderTeamConfigFile: live values', () => {
  it('AC-3: a live value and the team comment above it are kept, with no commented copy', () => {
    const team = edit(
      edit(
        edit(fresh(PAQAD), '# updates:', 'updates:'),
        '#   minimum_version: latest',
        '  # pinned for the audit\n  minimum_version: 1.117.0',
      ),
      '#   # The lowest',
      '  # The lowest',
    );
    const text = rerender(PAQAD, team);
    expect(text).toContain(
      'updates:\n  # Pulls newer paqad versions in the background when a session starts.\n  # automatic: true\n',
    );
    expect(text).toMatch(
      /\n {2}# pinned for the audit\n {2}# The lowest[^\n]*\n {2}minimum_version: 1\.117\.0\n/u,
    );
    expect(text).not.toContain('minimum_version: latest');
    expect(parsed(text)).toEqual({
      paqad_version: VERSION,
      updates: { minimum_version: '1.117.0' },
    });
  });

  it('AC-7: a value set on a fresh document leaves one live copy and no commented copy', () => {
    const document = YAML.parseDocument(fresh('retrieval.yaml'));
    document.setIn(['enabled'], true);
    const text = renderTeamConfigFile('retrieval.yaml', document, VERSION);
    expect(text).toContain('\nenabled: true\n');
    expect(text).not.toContain('# enabled: false');
  });

  it('INV-4: rendering a file read back from a render gives the same text', () => {
    const samples: Array<[OwnTeamConfigFile, string]> = [
      [
        PAQAD,
        'paqad_version: "1.0.0"\nenabled: false\nupdates:\n  check_every_hours: 4\nhud:\n  chime: true\n',
      ],
      [
        WORKFLOW,
        'paqad_version: "1.0.0"\nstages:\n  review:\n    instructions:\n      - Check the docs\n  planning:\n    research:\n      market: true\nstage_helpers:\n  on_lanes: [graduated, full]\n',
      ],
      [
        'feature-development/checks.yaml',
        'paqad_version: "1.0.0"\ncommands:\n  extra:\n    lint: pnpm lint\n',
      ],
    ];
    for (const file of TEAM_CONFIG_FILES) samples.push([file, fresh(file)]);
    for (const [file, text] of samples) {
      const once = rerender(file, text);
      expect(rerender(file, once), file).toBe(once);
    }
  });

  it('FR-5: lists and maps render as block YAML', () => {
    const text = rerender(
      'feature-development/checks.yaml',
      'paqad_version: "1.0.0"\ncommands:\n  extra: {lint: pnpm lint}\n  from_project_profile: [test]\n',
    );
    expect(parsed(text)).toEqual({
      paqad_version: VERSION,
      commands: { extra: { lint: 'pnpm lint' }, from_project_profile: ['test'] },
    });
  });

  it('AC-22: only the parents on the path to a live setting are live', () => {
    const text = rerender(
      WORKFLOW,
      'paqad_version: "1.0.0"\nstages:\n  review:\n    instructions:\n      - Read the docs first\n',
    );
    const liveParents = text
      .split('\n')
      .filter((line) => /^\s*[a-z_]+:$/u.test(line))
      .map((line) => line.trim());
    expect(liveParents).toEqual(['stages:', 'review:', 'instructions:']);
    expect(text).toContain('\n  # planning:\n');
    expect(parsed(text)).toEqual({
      paqad_version: VERSION,
      stages: { review: { instructions: ['Read the docs first'] } },
    });
  });

  it('AC-12 and FR-6: a live value equal to the default stays live and fixed', () => {
    const team = edit(
      edit(fresh(PAQAD), '# updates:', 'updates:'),
      '#   automatic: true',
      '  automatic: true',
    );
    const text = withDefault('auto_update', false, () => rerender(PAQAD, team));
    expect(text).toContain('\n  automatic: true\n');
    expect(parsed(text)).toMatchObject({ updates: { automatic: true } });
  });

  it('AC-5: a commented default shows the new default after it changes', () => {
    const before = withDefault('version_check_interval_hours', 6, () => fresh(PAQAD));
    expect(before).toContain('#   check_every_hours: 6\n');
    const after = rerender(PAQAD, before);
    expect(after).toContain('#   check_every_hours: 12\n');
    expect(after).not.toContain('check_every_hours: 6');
  });

  it('AC-28: commenting the last live setting and its group gives a commented default with no duplicate', () => {
    const live = rerender(PAQAD, 'paqad_version: "1.0.0"\nupdates:\n  automatic: false\n');
    const back = edit(
      edit(live, 'updates:\n', '# updates:\n'),
      '  automatic: false',
      '#   automatic: false',
    );
    const commentedAgain = back
      .replace(/\n {2}# /gu, '\n#   # ')
      .replace(/\n {2}([a-z])/gu, '\n#   $1');
    const text = rerender(PAQAD, commentedAgain);
    expect(text).toBe(fresh(PAQAD));
  });
});

describe('renderTeamConfigFile: lines paqad does not own', () => {
  it('AC-4 and AC-15: an unknown live key moves to the end with its group', () => {
    const text = rerender(
      PAQAD,
      'paqad_version: "1.0.0"\nupdates:\n  automatc: false\nlegacy: 1\n',
    );
    expect(text).toContain('\n# updates:\n');
    expect(
      text.trimEnd().endsWith(`${NOT_A_SETTING_LINE}\nupdates:\n  automatc: false\nlegacy: 1`),
    ).toBe(true);
    expect(rerender(PAQAD, text)).toBe(text);
  });

  it('AC-16: an unknown key in a group with a live setting stays last in the group', () => {
    const text = rerender(
      PAQAD,
      'paqad_version: "1.0.0"\nupdates:\n  automatc: false\n  minimum_version: 1.117.0\n',
    );
    expect(text).toMatch(
      new RegExp(
        `\\n {2}minimum_version: 1\\.117\\.0\\n(?: {2}#[^\\n]*\\n)*? {2}${escape(NOT_A_SETTING_LINE)}\\n {2}automatc: false\\n`,
        'u',
      ),
    );
    expect(parsed(text)).toEqual({
      paqad_version: VERSION,
      updates: { minimum_version: '1.117.0', automatc: false },
    });
    expect(rerender(PAQAD, text)).toBe(text);
  });

  it('AC-17: a key under the line moves into place when paqad adds the setting', () => {
    const text = rerender(PAQAD, 'paqad_version: "1.0.0"\nhud:\n  chime: true\n');
    const moved = `${fresh(PAQAD)}\n${NOT_A_SETTING_LINE}\nhud:\n  chime: true\n`;
    expect(rerender(PAQAD, moved)).toBe(text);
  });

  it('AC-4: a commented setting paqad no longer knows is dropped with its note', () => {
    const text = edit(
      fresh(PAQAD),
      '#   check_every_hours: 12\n',
      '#   check_every_hours: 12\n#   # An old note.\n#   old_setting: 3\n',
    );
    expect(rerender(PAQAD, text)).toBe(fresh(PAQAD));
  });

  it('FR-8: a team note directly above a commented group moves to the notes, it is not dropped', () => {
    const paqad = rerender(
      PAQAD,
      edit(fresh(PAQAD), '\n# updates:\n', '\n# why we keep updates on\n# updates:\n'),
    );
    expect(paqad).toContain('\n# updates:\n');
    expect(paqad.trimEnd().endsWith(`${TEAM_NOTES_LINE}\n# why we keep updates on`)).toBe(true);
    expect(rerender(PAQAD, paqad)).toBe(paqad);
    const workflow = rerender(
      WORKFLOW,
      edit(fresh(WORKFLOW), '\n# stages:\n', '\n# stage notes from the team\n# stages:\n'),
    );
    expect(workflow.trimEnd().endsWith(`${TEAM_NOTES_LINE}\n# stage notes from the team`)).toBe(
      true,
    );
    expect(rerender(WORKFLOW, workflow)).toBe(workflow);
  });

  it('AC-13: loose team notes move to the end in order and stay there', () => {
    const team = edit(
      fresh(PAQAD),
      '\n# site_map:',
      '\n# a note between groups\n\n# site_map:',
    ).replace(/\n$/u, '\n\n# a note at the end\n');
    const text = rerender(PAQAD, team);
    expect(
      text.trimEnd().endsWith(`${TEAM_NOTES_LINE}\n# a note between groups\n# a note at the end`),
    ).toBe(true);
    expect(rerender(PAQAD, text)).toBe(text);
  });

  it('AC-14: a comment above a live group key and an inline comment stay in place', () => {
    const text = rerender(
      PAQAD,
      'paqad_version: "1.0.0"\n# we pin for the audit\nupdates:\n  minimum_version: 1.117.0 # pinned\n',
    );
    expect(text).toContain('\n# we pin for the audit\nupdates:\n');
    expect(text).toContain('\n  minimum_version: 1.117.0 # pinned\n');
    expect(rerender(PAQAD, text)).toBe(text);
  });

  it("FR-7: in a header-only 1.117.0 file every comment above a live setting is the team's", () => {
    const old = [
      oldSchemaLine(PAQAD),
      `# ${TEAM_CONFIG_FILE_DESCRIPTIONS[PAQAD]}`,
      "# Only settings this team changed live here; everything else uses paqad's default.",
      '# See every setting, its value and where it comes from: paqad-ai config show',
      'paqad_version: "1.117.0"',
      '# off until the pilot ends',
      'enabled: false',
      '',
    ].join('\n');
    const text = rerender(PAQAD, old);
    expect(text).toContain('\n# off until the pilot ends\n# Turns paqad on');
    expect(text).not.toContain('Only settings this team changed');
    expect(text).not.toContain(TEAM_NOTES_LINE);
  });

  it('keeps inline comments inside a live list and moves the comment lines in it to the notes', () => {
    const text = rerender(
      WORKFLOW,
      'paqad_version: "1.0.0"\nstages:\n  review:\n    instructions:\n      - one # first\n      # between\n      - two\n',
    );
    expect(text).toContain('\n      - one # first\n      - two\n');
    expect(text.trimEnd().endsWith(`${TEAM_NOTES_LINE}\n# between`)).toBe(true);
    expect(rerender(WORKFLOW, text)).toBe(text);
  });

  it('FR-7: a changed note replaces the old one above a live setting', () => {
    const text = edit(
      rerender(PAQAD, 'paqad_version: "1.0.0"\nenabled: false\n'),
      '# Turns paqad on or off for this project, and false lets you work without paqad.',
      '# An older wording of the note.',
    );
    expect(rerender(PAQAD, text)).toBe(rerender(PAQAD, 'paqad_version: "1.0.0"\nenabled: false\n'));
  });

  it('FR-12: an empty file or one with only comments is rendered fresh', () => {
    expect(rerender(PAQAD, '')).toBe(fresh(PAQAD));
    expect(rerender(PAQAD, '# just a note\n')).toBe(
      `${fresh(PAQAD)}\n${TEAM_NOTES_LINE}\n# just a note\n`,
    );
  });
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

describe('AC-1, AC-24 and AC-27: the values read back are the same', () => {
  let root: string | undefined;
  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  function writeAll(files: Partial<Record<OwnTeamConfigFile, string>>): void {
    for (const [file, text] of Object.entries(files)) {
      const path = teamConfigPath(root!, file as OwnTeamConfigFile);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text!, 'utf8');
    }
  }

  it('reads the same settings from the sparse files and from their render', () => {
    root = mkdtempSync(join(tmpdir(), 'team-config-render-'));
    const sparse: Partial<Record<OwnTeamConfigFile, string>> = {
      'paqad.yaml':
        'paqad_version: "1.117.0"\nenabled: false\nupdates:\n  minimum_version: 1.117.0\n',
      'retrieval.yaml':
        'paqad_version: "1.117.0"\nenabled: true\nembeddings:\n  provider: openai\n  model: text-embedding-3-small\n',
      'feature-development/workflow.yaml':
        'paqad_version: "1.117.0"\nstage_helpers:\n  on_lanes: [graduated, full]\nstages:\n  review:\n    effort: medium\n',
    };
    writeAll(sparse);
    const before = readTeamConfig(root);
    const rendered: Partial<Record<OwnTeamConfigFile, string>> = {};
    for (const file of TEAM_CONFIG_FILES) {
      rendered[file] = render(file, sparse[file] ?? `paqad_version: "1.117.0"\n`);
    }
    writeAll(rendered);
    const after = readTeamConfig(root);
    expect([...after.merged]).toEqual([...before.merged]);
    expect(after.issues).toEqual(before.issues);
    for (const file of TEAM_CONFIG_FILES) {
      const plain = YAML.parse(rendered[file]!) as Record<string, unknown>;
      const original = YAML.parse(sparse[file] ?? 'paqad_version: x\n') as Record<string, unknown>;
      delete plain.paqad_version;
      delete original.paqad_version;
      expect(plain, file).toEqual(original);
    }
  });
});

describe('repairTeamConfigText (FR-11)', () => {
  it('AC-19: reads a setting whose commented group line is still commented', () => {
    const text = edit(fresh(PAQAD), '#   minimum_version: latest', '  minimum_version: 1.117.0');
    const { text: repaired, repairs } = repairTeamConfigText(PAQAD, text);
    expect(parsed(repaired)).toEqual({
      paqad_version: VERSION,
      updates: { minimum_version: '1.117.0' },
    });
    expect(repairs).toHaveLength(1);
    expect(repairs[0]!.message).toContain('paqad.yaml line');
    expect(repairs[0]!.message).toContain('remove the # in front of updates:');
    const next = rerender(PAQAD, repaired);
    expect(next).toContain('\nupdates:\n');
    expect(repairTeamConfigText(PAQAD, next).repairs).toEqual([]);
  });

  it('AC-20: reads a setting where only the # was removed at its own column', () => {
    const text = edit(fresh(PAQAD), '# enabled: true', ' enabled: false');
    const { text: repaired, repairs } = repairTeamConfigText(PAQAD, text);
    expect(parsed(repaired)).toEqual({ paqad_version: VERSION, enabled: false });
    expect(repairs).toHaveLength(1);
    expect(rerender(PAQAD, repaired)).toContain('\nenabled: false\n');
  });

  it('repairs both at once inside a commented group, and nested groups', () => {
    const text = edit(fresh(PAQAD), '#   minimum_version: latest', '   minimum_version: 1.117.0');
    expect(parsed(repairTeamConfigText(PAQAD, text).text)).toEqual({
      paqad_version: VERSION,
      updates: { minimum_version: '1.117.0' },
    });
    const live = rerender(
      WORKFLOW,
      'paqad_version: "1.0.0"\nstages:\n  planning:\n    effort: low\n',
    );
    const nested = edit(live, '  #   effort: high\n', '    effort: medium\n');
    const repaired = repairTeamConfigText(WORKFLOW, nested);
    expect(repaired.repairs).toHaveLength(1);
    expect(parsed(repaired.text)).toMatchObject({
      stages: { planning: { effort: 'low' }, specification: { effort: 'medium' } },
    });
  });

  it('leaves a rendered file and an unknown key alone', () => {
    for (const file of TEAM_CONFIG_FILES) {
      expect(repairTeamConfigText(file, fresh(file))).toEqual({ text: fresh(file), repairs: [] });
    }
    const unknown = `${fresh(PAQAD)}\n${NOT_A_SETTING_LINE}\n legacy: 1\n`;
    expect(repairTeamConfigText(PAQAD, unknown).repairs).toEqual([]);
  });
});
