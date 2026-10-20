export function WhySentence({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 truncate text-secondary font-normal" style={{ color: 'var(--color-muted)' }}>
      {children}
    </p>
  );
}
