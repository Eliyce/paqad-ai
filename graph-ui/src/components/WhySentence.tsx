/**
 * The one-line why-sentence under a page or card title (issue #146).
 * 13px, muted, regular weight, truncated to a single line.
 */
export function WhySentence({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 truncate text-secondary font-normal" style={{ color: 'var(--color-muted)' }}>
      {children}
    </p>
  );
}
