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
import { buildNarrationContractDocument } from '@/onboarding/narration-contract-writer.js';

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

  it('collapses to the heading plus the one-line pointer, with no inlined spec', () => {
    const section = buildNarrationContractSection();
    expect(section).toBe(`## paqad in your chat\n\n${narrationContractPointerBody()}`);
    // The full voice spec now lives only in the managed doc, not the entry file.
    expect(section).not.toContain('Handshake (once per session)');
    expect(section).not.toContain('On a verdict');
    expect(section).not.toContain('**▸ paqad**');
  });

  it('keeps the full voice spec legible in the managed doc with glyphs stripped', () => {
    const stripped = buildNarrationContractDocument().replace(/[🟢🔴🟡⚪▸]/gu, '');
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
