import { layoutBand, rowText } from '../../../../runtime/claude-plugin/mod/band.ts';
import { parseSnapshot } from '../../../../runtime/claude-plugin/mod/model.ts';
import type { BandBlock, BandLayout } from '../../../../runtime/claude-plugin/mod/shell.ts';
import { NOW, fileText } from '../../../../runtime/claude-plugin/mod/test/fixtures.ts';

export function blockLines(block: BandBlock): string[] {
  const lines = [rowText(block.title)];
  if (block.cells.length > 0) {
    lines.push(block.cells.map((cell) => cell.top.text).join(' '));
    lines.push(block.cells.map((cell) => cell.bottom.text).join(' '));
  }
  if (block.note) lines.push(rowText(block.note));
  return lines;
}

export function layoutLines(layout: BandLayout): string[] {
  if (layout.kind === 'none') return [];
  if (layout.kind === 'line') return [rowText(layout.row)];
  const lines = [`${rowText(layout.header.left)} | ${rowText(layout.header.right)}`];
  for (const block of layout.blocks) lines.push(...blockLines(block));
  if (layout.footer) lines.push(`${rowText(layout.footer.left)} | ${rowText(layout.footer.right)}`);
  return lines;
}

export function bandOf(
  raw: Record<string, unknown> | null,
  columns = 120,
  maxRows = 12,
  surface: 'terminal' | 'desktop' = 'terminal',
): BandLayout {
  return layoutBand(
    raw ? parseSnapshot(fileText(raw)) : null,
    { columns, maxRows },
    {
      now: NOW,
      surface,
    },
  );
}

export function bandLines(
  raw: Record<string, unknown> | null,
  columns = 120,
  maxRows = 12,
): string[] {
  return layoutLines(bandOf(raw, columns, maxRows));
}

export function blockOf(layout: BandLayout, key: string): BandBlock | undefined {
  return layout.kind === 'card' ? layout.blocks.find((block) => block.key === key) : undefined;
}
