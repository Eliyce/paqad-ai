import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SHIPPED_RULE_LINES,
  shippedRuleLineStart,
  shippedWorkflowEntryHash,
} from '@/core/shipped-workflow-entries.js';
import {
  KEPT_RULE_WITH_SHIPPED_LINES,
  repairKeptRuleLines,
} from '@/onboarding/obsolete-cleanup.js';

const VIEW = 'docs/instructions/workflows/feature-development.yaml';
const POLICY = 'docs/instructions/workflows/delivery-policy.yaml';
const DELETED = [VIEW, POLICY];
const OLD_STAGE =
  "The definition of these stages lives in `docs/instructions/workflows/feature-development.yaml`, a view paqad generates from its own defaults and the team's `.paqad/configs/feature-development/` files on every session (delivery conventions live in the team's `.paqad/configs/git-workflow/` files). A team changes the workflow in `.paqad/configs/feature-development/`, never in the view: a hand edit is moved there and the view is rebuilt. Load those files and follow them. The stages below are the mandatory sequence; the YAML carries the authoritative per-stage `strictness`, `escalation`, and gate flags. Where the YAML and this rule differ, the YAML wins.";
const OLD_DELIVERY =
  'When the change is delivered, follow `docs/instructions/workflows/delivery-policy.yaml`: branch naming, conventional-commit format with the ticket in scope, PR title/body and ticket linkage, and the CI gate (`wait_for_green`; red CI is `on_red: stop`).';
const SHIPPED = readFileSync(
  resolve(__dirname, '../../../runtime/capabilities/coding/rules/feature-development.md'),
  'utf8',
);
const shippedLine = (start: string) => SHIPPED.split('\n').find((line) => line.startsWith(start))!;
const NEW_STAGE = shippedLine('The definition of these stages is ');
const NEW_DELIVERY = shippedLine('When the change is delivered, follow ');

describe('repairing the shipped lines in a kept rule', () => {
  let root: string;
  const rulePath = () => join(root, KEPT_RULE_WITH_SHIPPED_LINES);

  function place(content: string | Buffer, relative = KEPT_RULE_WITH_SHIPPED_LINES): void {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-kept-rule-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('holds five shipped lines, and the real shipped rule has one replacement for each start', () => {
    expect(Object.keys(SHIPPED_RULE_LINES)).toHaveLength(5);
    expect(new Set(Object.values(SHIPPED_RULE_LINES)).size).toBe(2);
    for (const start of Object.values(SHIPPED_RULE_LINES)) {
      expect(SHIPPED.split('\n').filter((line) => line.startsWith(start))).toHaveLength(1);
    }
    expect(SHIPPED).not.toContain(VIEW);
    expect(SHIPPED).not.toContain(POLICY);
  });

  it('matches a shipped line whatever its whitespace and marker', () => {
    expect(shippedRuleLineStart(OLD_DELIVERY)).toBe('When the change is delivered, follow ');
    expect(
      shippedRuleLineStart(`  ${OLD_DELIVERY.replace(' ', '   ')}  <!-- @rule RL-abcd -->`),
    ).toBe('When the change is delivered, follow ');
    expect(shippedRuleLineStart('A line the team wrote')).toBeNull();
    expect(SHIPPED_RULE_LINES[shippedWorkflowEntryHash(OLD_STAGE)]).toBeDefined();
  });

  it('AC-3: replaces only the shipped lines in a plain file, and a second run writes nothing', () => {
    place(`# Rule\n\n${OLD_STAGE}\n\nTeam edit.\n${OLD_DELIVERY}\nEnd.\n`);
    const result = repairKeptRuleLines(root, SHIPPED, DELETED);
    expect(readFileSync(rulePath(), 'utf8')).toBe(
      `# Rule\n\n${NEW_STAGE}\n\nTeam edit.\n${NEW_DELIVERY}\nEnd.\n`,
    );
    expect(result).toEqual({
      lines: [],
      repaired: [KEPT_RULE_WITH_SHIPPED_LINES],
      texts: [],
    });
    expect(repairKeptRuleLines(root, SHIPPED, DELETED)).toEqual({
      lines: [],
      repaired: [],
      texts: [],
    });
  });

  it.each([
    ['CRLF', `a\r\n${OLD_DELIVERY}\r\nb\r\n`, `a\r\n${NEW_DELIVERY}\r\nb\r\n`],
    [
      'mixed line ends',
      `a\r\nb\n${OLD_DELIVERY}\r\nc\nd\r\n`,
      `a\r\nb\n${NEW_DELIVERY}\r\nc\nd\r\n`,
    ],
    ['no final newline', `a\n${OLD_DELIVERY}`, `a\n${NEW_DELIVERY}`],
    ['trailing spaces elsewhere', `a  \n${OLD_DELIVERY}\n  b  \n`, `a  \n${NEW_DELIVERY}\n  b  \n`],
    ['trailing spaces on the line', `a\n${OLD_DELIVERY}   \nb\n`, `a\n${NEW_DELIVERY}\nb\n`],
    ['a BOM on the first line', `\uFEFF${OLD_DELIVERY}\nb\n`, `\uFEFF${NEW_DELIVERY}\nb\n`],
  ])('AC-3: keeps every other byte with %s', (_name, before, after) => {
    place(before);
    repairKeptRuleLines(root, SHIPPED, DELETED);
    expect(readFileSync(rulePath()).equals(Buffer.from(after, 'utf8'))).toBe(true);
  });

  it('AC-3: keeps an invalid UTF-8 byte elsewhere in the file, and the file mode', () => {
    const invalid = Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]);
    place(Buffer.concat([invalid, Buffer.from(`${OLD_DELIVERY}\n`, 'utf8')]));
    chmodSync(rulePath(), 0o640);
    const mode = statSync(rulePath()).mode;
    repairKeptRuleLines(root, SHIPPED, DELETED);
    expect(
      readFileSync(rulePath()).equals(
        Buffer.concat([invalid, Buffer.from(`${NEW_DELIVERY}\n`, 'utf8')]),
      ),
    ).toBe(true);
    expect(statSync(rulePath()).mode).toBe(mode);
  });

  it('AC-4: leaves a line the team wrote, names it on every run and writes nothing', () => {
    const team = 'We also read `docs/instructions/workflows/delivery-policy.yaml` on Fridays.\n';
    place(team);
    const expected = `${KEPT_RULE_WITH_SHIPPED_LINES} still mentions ${POLICY}, which paqad removed. Update that line by hand.`;
    expect(repairKeptRuleLines(root, SHIPPED, DELETED).lines).toEqual([expected]);
    expect(repairKeptRuleLines(root, SHIPPED, DELETED)).toEqual({
      lines: [expected],
      repaired: [],
      texts: [],
    });
    expect(readFileSync(rulePath(), 'utf8')).toBe(team);
  });

  it('AC-5: leaves and names a hash hit with no shipped line or with more than one', () => {
    place(`${OLD_DELIVERY}\n`);
    const named = `${KEPT_RULE_WITH_SHIPPED_LINES} still mentions ${POLICY}, which paqad removed. Update that line by hand.`;
    expect(repairKeptRuleLines(root, null, DELETED).lines).toEqual([named]);
    expect(repairKeptRuleLines(root, 'no such line\n', DELETED).lines).toEqual([named]);
    const twice = `${NEW_DELIVERY}\n${NEW_DELIVERY}\n`;
    expect(repairKeptRuleLines(root, twice, DELETED).lines).toEqual([named]);
    expect(readFileSync(rulePath(), 'utf8')).toBe(`${OLD_DELIVERY}\n`);
  });

  it('AC-5: changes nothing for a hash hit in another file or in a fenced example', () => {
    const fenced = `\`\`\`md\n${OLD_DELIVERY}\n\`\`\`\n`;
    place(fenced);
    place(`${OLD_DELIVERY}\n`, 'docs/instructions/rules/coding/other.md');
    const result = repairKeptRuleLines(root, SHIPPED, DELETED);
    expect(result.repaired).toEqual([]);
    expect(readFileSync(rulePath(), 'utf8')).toBe(fenced);
    expect(readFileSync(join(root, 'docs/instructions/rules/coding/other.md'), 'utf8')).toBe(
      `${OLD_DELIVERY}\n`,
    );
    expect(result.lines).toEqual([
      `docs/instructions/rules/coding/feature-development.md still mentions ${POLICY}, which paqad removed. Update that line by hand.`,
      `docs/instructions/rules/coding/other.md still mentions ${POLICY}, which paqad removed. Update that line by hand.`,
    ]);
  });

  it('AC-2: names a non-markdown file under the rules folder and leaves it unchanged', () => {
    const text = `note: ${VIEW}\n`;
    place(text, 'docs/instructions/rules/notes.yml');
    expect(repairKeptRuleLines(root, SHIPPED, DELETED).lines).toEqual([
      `docs/instructions/rules/notes.yml still mentions ${VIEW}, which paqad removed. Update that line by hand.`,
    ]);
    expect(readFileSync(join(root, 'docs/instructions/rules/notes.yml'), 'utf8')).toBe(text);
  });

  it('does not name the rule-script map, which paqad owns', () => {
    place(`text: ${VIEW}\n`, 'docs/instructions/rules/rule-script-map.yml');
    expect(repairKeptRuleLines(root, SHIPPED, DELETED).lines).toEqual([]);
  });

  it('keeps the marker on a repaired line and reports the new text', () => {
    place(`${OLD_DELIVERY} <!-- @rule RL-ab12 -->\n`);
    const result = repairKeptRuleLines(root, SHIPPED, DELETED);
    expect(readFileSync(rulePath(), 'utf8')).toBe(`${NEW_DELIVERY} <!-- @rule RL-ab12 -->\n`);
    expect(result.texts).toEqual([{ id: 'RL-ab12', text: NEW_DELIVERY }]);
  });
});
