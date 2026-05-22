import chalk from 'chalk';

import type { ProviderProgressUpdate } from '@/rag/types.js';

const PANEL_WIDTH = 74;

type RagProgressStepId = 'prepare' | 'scan' | 'embed' | 'finalize';

interface RagProgressStep {
  id: RagProgressStepId;
  number: number;
  title: string;
}

function border(left: string, fill: string, right: string): string {
  return `${left}${fill.repeat(PANEL_WIDTH)}${right}`;
}

function pad(text = ''): string {
  return ` ${text}`.padEnd(PANEL_WIDTH, ' ');
}

function surface(text: string): string {
  return chalk.hex('#FFF7ED')(text);
}

function accent(text: string): string {
  return chalk.hex('#C2410C').bold(text);
}

function muted(text: string): string {
  return chalk.hex('#9A6B55')(text);
}

function highlight(text: string): string {
  return chalk.hex('#7C2D12').bold(text);
}

function progressText(update: ProviderProgressUpdate): string {
  if (update.percent === undefined) {
    return update.message;
  }

  return `${update.percent.toString().padStart(3, ' ')}%  ${update.message}`;
}

function detectStep(update: ProviderProgressUpdate): RagProgressStep {
  const message = update.message.toLowerCase();

  if (update.phase === 'download' || update.phase === 'load') {
    return { id: 'prepare', number: 1, title: 'Preparing embedding runtime' };
  }

  if (
    message.includes('discovering repository files') ||
    message.includes('filtering ') ||
    message.includes('filtered ') ||
    message.includes('eligib') ||
    message.includes('chunking') ||
    message.includes('chunked')
  ) {
    return { id: 'scan', number: 2, title: 'Discovering, filtering, and chunking the codebase' };
  }

  if (message.includes('embedded')) {
    return { id: 'embed', number: 3, title: 'Generating embeddings and vector data' };
  }

  return { id: 'finalize', number: 4, title: 'Finalizing RAG indexes and metadata' };
}

export function renderRagIntroPanel(): string {
  const lines = [
    accent(border('╔', '═', '╗')),
    accent('║') + surface(pad('  OPTIONAL PROJECT INTELLIGENCE')) + accent('║'),
    accent(border('╠', '═', '╣')),
    accent('║') + surface(pad('  Build a semantic RAG layer over this codebase.')) + accent('║'),
    accent('║') +
      muted(pad('  paqad-ai keeps AI suggestions relevant as files, docs, and patterns grow.')) +
      accent('║'),
    accent('║') + surface(pad()) + accent('║'),
    accent('║') +
      highlight(pad('  Retrieval-Augmented Generation (RAG) for your repo')) +
      accent('║'),
    accent('║') + surface(pad()) + accent('║'),
    accent('║') +
      muted(pad('  • Pulls the most relevant code and docs into each task')) +
      accent('║'),
    accent('║') +
      muted(pad('  • Cuts irrelevant context so prompts stay tighter and cheaper')) +
      accent('║'),
    accent('║') +
      muted(pad('  • Keeps completions grounded in your actual project structure')) +
      accent('║'),
    accent(border('╚', '═', '╝')),
    '',
  ];

  return lines.join('\n');
}

export function createRagProgressReporter(
  write: (message: string) => void,
): (update: ProviderProgressUpdate) => void {
  let lastStepId: RagProgressStepId | undefined;

  return (update: ProviderProgressUpdate) => {
    const step = detectStep(update);
    if (step.id !== lastStepId) {
      write(chalk.hex('#C2410C').bold(`[${step.number}/4] ${step.title}`));
      lastStepId = step.id;
    }

    write(`${chalk.hex('#EA580C')('  >')} ${progressText(update)}`);
  };
}
