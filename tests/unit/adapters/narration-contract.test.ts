import { AdapterFactory } from '@/adapters';
import {
  buildNarrationContractSection,
  extractNarrationContractSection,
  narrationContractPointerBody,
} from '@/adapters/shared/narration-contract.js';
import {
  buildDecisionPauseContractSection,
  extractDecisionPauseContractSection,
  normalizeProviderEntryContract,
} from '@/adapters/shared/provider-entry-contract.js';
import { ADAPTER_TYPES } from '@/core/types/adapter.js';
import { paqadGlyphLegend } from '@/core/constants/paqad-voice.js';

const CONFIG_CONTEXT = {
  frameworkPath: '.paqad/framework-path.txt',
  rulesPath: 'docs/instructions/rules',
  projectRoot: '/tmp/project',
};

describe('paqad narration contract in provider entry files', () => {
  it('renders an identical narration contract into every generated entry file', async () => {
    const expected = normalizeProviderEntryContract(buildNarrationContractSection());
    for (const adapterType of ADAPTER_TYPES) {
      const adapter = AdapterFactory.create(adapterType);
      const [file] = await adapter.generateConfig(CONFIG_CONTEXT);
      const section = extractNarrationContractSection(file?.content ?? '');

      expect(section, `${adapterType} entry file`).not.toBeNull();
      expect(normalizeProviderEntryContract(section!), `${adapterType} entry file`).toBe(expected);
    }
  });

  it('shares one pointer body across every adapter', async () => {
    const pointer = narrationContractPointerBody();
    for (const adapterType of ADAPTER_TYPES) {
      const adapter = AdapterFactory.create(adapterType);
      const [file] = await adapter.generateConfig(CONFIG_CONTEXT);
      expect(file?.content, adapterType).toContain(pointer);
    }
  });

  it('does not disturb the decision pause contract that follows it', async () => {
    for (const adapterType of ADAPTER_TYPES) {
      const adapter = AdapterFactory.create(adapterType);
      const [file] = await adapter.generateConfig(CONFIG_CONTEXT);
      const decisionPause = extractDecisionPauseContractSection(file?.content ?? '');

      expect(decisionPause, adapterType).not.toBeNull();
      expect(normalizeProviderEntryContract(decisionPause!), adapterType).toBe(
        normalizeProviderEntryContract(buildDecisionPauseContractSection(adapterType)),
      );
    }
  });

  it('carries the cadence, the branded frame, and the shared glyph legend', () => {
    const section = buildNarrationContractSection();
    expect(section).toContain('Handshake (once per session)');
    expect(section).toContain('On a verdict');
    expect(section).toContain('**▸ paqad**');
    // The legend is sourced from paqad-voice — assert it is the same string.
    expect(section).toContain(paqadGlyphLegend());
  });

  it('stays legible with the status glyphs stripped', () => {
    const stripped = buildNarrationContractSection().replace(/[🟢🔴🟡⚪▸]/gu, '');
    // Every status word survives the strip, so meaning never rides on a glyph.
    expect(stripped).toContain('good');
    expect(stripped).toContain('failed');
    expect(stripped).toContain('needs a look');
    expect(stripped).toContain('skipped');
  });

  it('returns null when an entry file has no narration section', () => {
    expect(extractNarrationContractSection('# Heading\n\nNothing here')).toBeNull();
  });

  it('extracts the section even when it reaches end-of-file', () => {
    const content = `${buildNarrationContractSection()}\n`;
    expect(extractNarrationContractSection(content)).toBe(buildNarrationContractSection());
  });
});
