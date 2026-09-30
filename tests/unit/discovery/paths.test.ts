import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  DISCOVERY_RUN_FILES,
  discoveryDir,
  discoveryReportPath,
  discoveryRunChangeKey,
  discoveryRunDir,
  discoveryRunFilePath,
  formatDiscoveryRunDirName,
  isDiscoveryRunDirName,
  parseDiscoveryRunDirName,
} from '@/discovery/paths.js';
import { mintDiscoveryRunDirName } from '@/discovery/mint.js';

const ULID = '01M3RWNS7194V0PV2RX340VM50';

describe('discovery paths', () => {
  it('roots every run under .paqad/ledger/delivery (the owner-requested delivery dir)', () => {
    expect(PATHS.DISCOVERY_DIR).toBe('.paqad/ledger/delivery');
    expect(discoveryDir()).toBe('.paqad/ledger/delivery');
    expect(discoveryRunDir(`idea-${ULID}`)).toBe(`.paqad/ledger/delivery/idea-${ULID}`);
  });

  it('resolves posix paths to each rigid run file', () => {
    const dir = `idea-${ULID}`;
    expect(discoveryRunFilePath(dir, 'run')).toBe(`.paqad/ledger/delivery/${dir}/run.json`);
    expect(discoveryRunFilePath(dir, 'sources')).toBe(
      `.paqad/ledger/delivery/${dir}/sources.jsonl`,
    );
    expect(discoveryReportPath(dir)).toBe(`.paqad/ledger/delivery/${dir}/report.html`);
    // report.html is a projection, not a rigid file.
    expect(Object.values(DISCOVERY_RUN_FILES)).not.toContain('report.html');
  });

  it('formats a dir name with and without an issue prefix', () => {
    expect(formatDiscoveryRunDirName({ issue: null, slug: 'idea', ulid: ULID })).toBe(
      `idea-${ULID}`,
    );
    expect(formatDiscoveryRunDirName({ issue: '597', slug: 'bulk-invoices', ulid: ULID })).toBe(
      `597-bulk-invoices-${ULID}`,
    );
    expect(formatDiscoveryRunDirName({ issue: 'PQD-12', slug: 'idea', ulid: ULID })).toBe(
      `PQD-12-idea-${ULID}`,
    );
  });

  it('rejects an unsafe slug, malformed ULID, or malformed issue', () => {
    expect(() => formatDiscoveryRunDirName({ issue: null, slug: 'Bad Slug', ulid: ULID })).toThrow(
      /Unsafe/,
    );
    expect(() =>
      formatDiscoveryRunDirName({ issue: null, slug: 'idea', ulid: 'not-a-ulid' }),
    ).toThrow(/ULID/);
    expect(() => formatDiscoveryRunDirName({ issue: 'nope!', slug: 'idea', ulid: ULID })).toThrow(
      /issue/,
    );
  });

  it('round-trips format -> parse for both shapes', () => {
    const withIssue = formatDiscoveryRunDirName({
      issue: '597',
      slug: 'bulk-invoices',
      ulid: ULID,
    });
    expect(parseDiscoveryRunDirName(withIssue)).toEqual({
      issue: '597',
      slug: 'bulk-invoices',
      ulid: ULID,
    });
    const noIssue = formatDiscoveryRunDirName({ issue: null, slug: 'idea', ulid: ULID });
    expect(parseDiscoveryRunDirName(noIssue)).toEqual({ issue: null, slug: 'idea', ulid: ULID });
  });

  it('parses null for a non-run dir name', () => {
    expect(parseDiscoveryRunDirName('not a run')).toBeNull();
    expect(parseDiscoveryRunDirName('_session')).toBeNull();
    expect(isDiscoveryRunDirName(`idea-${ULID}`)).toBe(true);
    expect(isDiscoveryRunDirName('nope')).toBe(false);
  });

  it('change key is the trailing ULID, else the name verbatim', () => {
    expect(discoveryRunChangeKey(`597-bulk-invoices-${ULID}`)).toBe(ULID);
    expect(discoveryRunChangeKey('unparseable')).toBe('unparseable');
  });
});

describe('discovery run mint', () => {
  it('mints a slug-and-ULID dir with a detected github issue', () => {
    const minted = mintDiscoveryRunDirName({ title: 'Bulk invoice export #597', ulid: ULID });
    expect(minted.issue).toBe('597');
    expect(minted.slug).toContain('bulk');
    expect(minted.dirName.endsWith(ULID)).toBe(true);
    expect(isDiscoveryRunDirName(minted.dirName)).toBe(true);
  });

  it('honours an explicit issue and an explicit null issue', () => {
    expect(mintDiscoveryRunDirName({ title: 'Idea', issue: 'PQD-9', ulid: ULID }).issue).toBe(
      'PQD-9',
    );
    expect(
      mintDiscoveryRunDirName({ title: '#42 idea', issue: null, ulid: ULID }).issue,
    ).toBeNull();
  });

  it('falls back to the untitled slug for an empty title', () => {
    const minted = mintDiscoveryRunDirName({ title: '   ', ulid: ULID });
    expect(minted.slug).toBe('discovery');
    expect(minted.issue).toBeNull();
  });

  it('normalises a leading # off a detected github ref', () => {
    const minted = mintDiscoveryRunDirName({ title: 'Ship #100 faster', ulid: ULID });
    expect(minted.issue).toBe('100');
  });

  it('mints a unique ULID each call without a seam', () => {
    const a = mintDiscoveryRunDirName({ title: 'Idea one' });
    const b = mintDiscoveryRunDirName({ title: 'Idea two' });
    expect(a.ulid).not.toBe(b.ulid);
  });
});
