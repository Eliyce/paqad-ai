import { useCallback, useEffect, useRef, useState } from 'react';

import { CodeEditor } from '../components/CodeEditor';
import { ConflictPanel } from '../components/ConflictPanel';
import { DashboardChrome } from '../components/DashboardChrome';
import { EmptyState } from '../components/EmptyState';
import { OwnershipBadge } from '../components/OwnershipBadge';
import { WhySentence } from '../components/WhySentence';
import { WinLine } from '../components/WinLine';
import { fetchDashboard, fetchDesignTokensConfig, putDesignTokens } from '../lib/api';
import type { DesignTokensConfigResponse, ValidationIssue } from '../lib/dashboard-types';

/**
 * The design tokens editor (issue #146). The raw JSON text is the source of
 * truth; the swatch grid and scalar list are structured views over it that
 * write back through the same text, so the two surfaces can never disagree.
 * Saving regenerates the derived design-system docs and reports the count.
 */

const HEX_PATTERN = /^#([0-9a-fA-F]{3,8})$/;

interface TokenLeaf {
  /** Object path segments down to the scalar. */
  path: string[];
  value: string | number | boolean;
}

/** Every scalar in the document, colors and otherwise, in document order. */
function collectLeaves(node: unknown, path: string[], out: TokenLeaf[]): void {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out.push({ path: [...path, key], value });
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      collectLeaves(value, [...path, key], out);
    }
  }
}

/** Display path: dots, with the W3C `$value` suffix trimmed for readability. */
function displayPath(path: string[]): string {
  const joined = path.join('.');
  return joined.endsWith('.$value') ? joined.slice(0, -'.$value'.length) : joined;
}

function setAtPath(root: Record<string, unknown>, path: string[], value: unknown): void {
  let node: Record<string, unknown> = root;
  for (const segment of path.slice(0, -1)) {
    const next = node[segment];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) return;
    node = next as Record<string, unknown>;
  }
  const last = path[path.length - 1];
  if (last !== undefined) node[last] = value;
}

/** Scalars worth listing: skip `$`-meta keys, keep `$value` leaves. */
function isListable(leaf: TokenLeaf): boolean {
  const last = leaf.path[leaf.path.length - 1] ?? '';
  return !last.startsWith('$') || last === '$value';
}

function PreviewPane({ colors }: { colors: string[] }) {
  const accent = colors[0] ?? 'var(--color-accent)';
  const secondary = colors[1] ?? 'var(--color-muted)';
  const muted = colors[2] ?? 'var(--color-muted)';
  return (
    <div
      className="rounded-[10px] p-5"
      style={{ background: 'var(--color-surface)' }}
      aria-label="Token preview"
    >
      <div className="text-caption font-medium" style={{ color: 'var(--color-muted)' }}>
        Preview
      </div>
      <div className="mt-3 rounded-[10px] p-4" style={{ background: 'var(--color-canvas)' }}>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: secondary }}
          />
          <div className="text-page font-semibold" style={{ color: accent }}>
            A heading in your brand
          </div>
        </div>
        <div className="mt-2 text-body" style={{ color: 'var(--color-canvas-fg)' }}>
          Body copy at 15px so you can judge contrast against the canvas.
        </div>
        <div className="mt-1 text-secondary" style={{ color: muted }}>
          Secondary copy at 13px in your third color.
        </div>
        <button
          type="button"
          className="mt-4 rounded-[6px] px-3.5 py-1.5 text-secondary font-medium"
          style={{ background: accent, color: '#ffffff' }}
        >
          A primary button
        </button>
      </div>
    </div>
  );
}

export function DesignTokensView() {
  const [config, setConfig] = useState<DesignTokensConfigResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [frameworkVersion, setFrameworkVersion] = useState<string | null>(null);
  const [sseLive, setSseLive] = useState(false);

  const [started, setStarted] = useState(false);
  const [text, setText] = useState('');
  const [baseHash, setBaseHash] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [mode, setMode] = useState<'structured' | 'raw'>('structured');

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveIssues, setSaveIssues] = useState<ValidationIssue[] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ content: string; hash: string | null } | null>(null);
  const [win, setWin] = useState<string | null>(null);
  const [regenWarning, setRegenWarning] = useState<string | null>(null);

  useEffect(() => {
    fetchDesignTokensConfig()
      .then((response) => {
        setConfig(response);
        setBaseHash(response.file.hash);
        const content = response.file.content ?? '{}\n';
        setText(content);
        setResetKey((key) => key + 1);
        if (response.file.exists && !response.placeholder) setStarted(true);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
    fetchDashboard()
      .then((report) => {
        setProjectName(report.projectName);
        setFrameworkVersion(report.frameworkVersion);
      })
      .catch(() => {
        // chrome placeholders are fine
      });
  }, []);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.addEventListener('open', () => setSseLive(true));
    source.addEventListener('error', () => setSseLive(false));
    return () => {
      source.close();
    };
  }, []);

  /** Parsed view of the current text, or null while the JSON is broken. */
  let parsed: Record<string, unknown> | null = null;
  try {
    const candidate: unknown = JSON.parse(text);
    if (candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)) {
      parsed = candidate as Record<string, unknown>;
    }
  } catch {
    parsed = null;
  }

  const leaves: TokenLeaf[] = [];
  if (parsed !== null) collectLeaves(parsed, [], leaves);
  const colorLeaves = leaves.filter(
    (leaf) => typeof leaf.value === 'string' && HEX_PATTERN.test(leaf.value),
  );
  const scalarLeaves = leaves.filter(
    (leaf) =>
      !(typeof leaf.value === 'string' && HEX_PATTERN.test(leaf.value)) && isListable(leaf),
  );
  const previewColors = colorLeaves.slice(0, 3).map((leaf) => String(leaf.value));

  const touch = (): void => {
    setDirty(true);
    setWin(null);
  };

  const updateLeaf = (path: string[], value: unknown): void => {
    if (parsed === null) return;
    const next = JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;
    setAtPath(next, path, value);
    setText(JSON.stringify(next, null, 2) + '\n');
    setResetKey((key) => key + 1);
    touch();
  };

  const save = useCallback(
    (overrideBaseHash?: string | null): void => {
      if (saving || !started) return;
      setSaving(true);
      setSaveIssues(null);
      setSaveError(null);
      setRegenWarning(null);
      putDesignTokens({
        content: text,
        baseHash: overrideBaseHash !== undefined ? overrideBaseHash : baseHash,
      })
        .then((outcome) => {
          if (outcome.status === 'ok') {
            setBaseHash(outcome.result.hash);
            setConfig((prev) =>
              prev
                ? {
                    ...prev,
                    placeholder: false,
                    file: { ...prev.file, exists: true, content: text, hash: outcome.result.hash },
                  }
                : prev,
            );
            setConflict(null);
            setDirty(false);
            const count = outcome.result.regenerated.length;
            setWin(
              count === 0
                ? 'Saved.'
                : 'Saved. ' + count + ' derived ' + (count === 1 ? 'doc' : 'docs') + ' refreshed.',
            );
            if (outcome.result.regenerationError !== undefined) {
              setRegenWarning(
                'Saved, but the derived docs could not be rebuilt: ' +
                  outcome.result.regenerationError,
              );
            }
            return;
          }
          if (outcome.status === 'invalid') {
            setSaveIssues(outcome.issues);
            return;
          }
          setConflict({ content: outcome.conflict.content ?? '', hash: outcome.conflict.hash });
        })
        .catch((err: unknown) => {
          setSaveError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => setSaving(false));
    },
    [saving, started, text, baseHash],
  );

  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const inputStyle: React.CSSProperties = {
    background: 'var(--color-canvas)',
    borderColor: 'var(--color-border)',
    color: 'var(--color-canvas-fg)',
  };

  return (
    <DashboardChrome
      projectName={projectName}
      frameworkVersion={frameworkVersion}
      sseLive={sseLive}
    >
      <div className="mx-auto w-full max-w-4xl p-6">
        <div className="flex items-center gap-3">
          <h1 className="text-page font-semibold">Design tokens</h1>
          <OwnershipBadge managedBy="you" />
        </div>
        <WhySentence>One palette every screen draws from.</WhySentence>

        {loadError && (
          <div
            className="mt-4 rounded-[10px] border p-4 text-secondary"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-mod-red)' }}
          >
            Could not load the tokens: {loadError}
          </div>
        )}

        {!config && !loadError && (
          <div className="mt-6 text-secondary" style={{ color: 'var(--color-muted)' }}>
            Loading…
          </div>
        )}

        {config && !started && (
          <div className="mt-6">
            <EmptyState
              what={
                config.file.exists
                  ? 'Design tokens are still the placeholder.'
                  : 'No design tokens yet.'
              }
              why="Fill them and the AI builds UI that matches your brand."
              actionLabel="Start from the current file"
              onAction={() => {
                setStarted(true);
                setDirty(true);
              }}
            />
          </div>
        )}

        {config && started && (
          <>
            <div className="mt-6 flex items-center justify-between gap-3">
              <button
                type="button"
                aria-pressed={mode === 'raw'}
                className="rounded-[6px] px-2.5 py-1.5 text-secondary font-medium"
                style={{
                  color: mode === 'raw' ? 'var(--color-accent)' : 'var(--color-muted)',
                  background: mode === 'raw' ? 'var(--color-surface)' : 'transparent',
                }}
                onClick={() => setMode((prev) => (prev === 'raw' ? 'structured' : 'raw'))}
              >
                Raw JSON
              </button>
              <div className="flex items-center gap-2.5">
                {win !== null && <WinLine onDone={() => setWin(null)}>{win}</WinLine>}
                {dirty && win === null && (
                  <span
                    title="Unsaved changes"
                    aria-label="Unsaved changes"
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: 'var(--color-accent)' }}
                  />
                )}
                <button
                  type="button"
                  disabled={saving}
                  className="rounded-[6px] px-3.5 py-1.5 text-secondary font-medium disabled:opacity-50"
                  style={{ background: 'var(--color-accent)', color: '#ffffff' }}
                  onClick={() => save()}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            {mode === 'raw' && (
              <div className="mt-4">
                <CodeEditor
                  key={resetKey}
                  value={text}
                  onChange={(next) => {
                    setText(next);
                    touch();
                  }}
                  lang="plain"
                  ariaLabel="Raw design tokens JSON"
                  minHeight={420}
                />
                {parsed === null && (
                  <div className="mt-2 text-secondary" style={{ color: 'var(--color-mod-red)' }}>
                    Not valid JSON yet. The structured view returns once this parses.
                  </div>
                )}
              </div>
            )}

            {mode === 'structured' && (
              <div className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
                <div className="min-w-0">
                  {parsed === null && (
                    <div
                      className="rounded-[10px] p-4 text-secondary"
                      style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}
                    >
                      The file is not valid JSON. Fix it in the raw view first.
                    </div>
                  )}

                  {parsed !== null && colorLeaves.length === 0 && scalarLeaves.length === 0 && (
                    <div
                      className="rounded-[10px] p-4 text-secondary"
                      style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}
                    >
                      No token values yet. Add them in the raw JSON view and the swatches appear
                      here.
                    </div>
                  )}

                  {parsed !== null && colorLeaves.length > 0 && (
                    <div className="rounded-[10px] p-4" style={{ background: 'var(--color-surface)' }}>
                      <div className="text-caption font-medium" style={{ color: 'var(--color-muted)' }}>
                        Colors
                      </div>
                      <div className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
                        {colorLeaves.map((leaf) => {
                          const pathKey = leaf.path.join('.');
                          return (
                            <div key={pathKey} className="flex items-center gap-2.5">
                              <span
                                aria-hidden="true"
                                className="inline-block h-5 w-5 shrink-0 rounded-[6px]"
                                style={{
                                  background: String(leaf.value),
                                  border: '1px solid var(--color-border)',
                                }}
                              />
                              <span
                                className="min-w-0 flex-1 truncate font-mono text-caption"
                                style={{ color: 'var(--color-muted)' }}
                                title={displayPath(leaf.path)}
                              >
                                {displayPath(leaf.path)}
                              </span>
                              <input
                                type="text"
                                aria-label={'Color ' + displayPath(leaf.path)}
                                className="w-24 shrink-0 rounded-[6px] border px-2 py-1 font-mono text-caption"
                                style={inputStyle}
                                value={String(leaf.value)}
                                onChange={(event) => updateLeaf(leaf.path, event.target.value)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {parsed !== null && scalarLeaves.length > 0 && (
                    <div
                      className="mt-4 rounded-[10px] p-4"
                      style={{ background: 'var(--color-surface)' }}
                    >
                      <div className="text-caption font-medium" style={{ color: 'var(--color-muted)' }}>
                        Other values
                      </div>
                      <div className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
                        {scalarLeaves.map((leaf) => {
                          const pathKey = leaf.path.join('.');
                          return (
                            <div key={pathKey} className="flex items-center gap-2.5">
                              <span
                                className="min-w-0 flex-1 truncate font-mono text-caption"
                                style={{ color: 'var(--color-muted)' }}
                                title={displayPath(leaf.path)}
                              >
                                {displayPath(leaf.path)}
                              </span>
                              <input
                                type="text"
                                aria-label={'Value ' + displayPath(leaf.path)}
                                className="w-36 shrink-0 rounded-[6px] border px-2 py-1 font-mono text-caption"
                                style={inputStyle}
                                value={String(leaf.value)}
                                onChange={(event) => {
                                  const raw = event.target.value;
                                  if (typeof leaf.value === 'number') {
                                    const numeric = Number(raw);
                                    updateLeaf(leaf.path, Number.isFinite(numeric) ? numeric : raw);
                                  } else if (typeof leaf.value === 'boolean') {
                                    updateLeaf(leaf.path, raw === 'true');
                                  } else {
                                    updateLeaf(leaf.path, raw);
                                  }
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <PreviewPane colors={previewColors} />
              </div>
            )}

            {regenWarning !== null && (
              <div className="mt-4 text-secondary" style={{ color: 'var(--color-muted)' }}>
                {regenWarning}
              </div>
            )}

            {saveIssues && saveIssues.length > 0 && (
              <div className="mt-4 flex flex-col gap-1.5">
                {saveIssues.map((issue) => (
                  <div
                    key={issue.path + issue.message}
                    className="flex items-baseline gap-2 text-secondary"
                  >
                    <span
                      aria-hidden="true"
                      className="inline-block h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full"
                      style={{ background: 'var(--color-mod-red)' }}
                    />
                    <span style={{ color: 'var(--color-muted)' }}>{issue.path}</span>
                    <span>{issue.message}</span>
                  </div>
                ))}
              </div>
            )}

            {saveError && (
              <div className="mt-4 text-secondary" style={{ color: 'var(--color-mod-red)' }}>
                {saveError}
              </div>
            )}

            {conflict && (
              <ConflictPanel
                mine={text}
                theirs={conflict.content}
                saving={saving}
                onLoadLatest={() => {
                  setText(conflict.content);
                  setBaseHash(conflict.hash);
                  setResetKey((key) => key + 1);
                  setConflict(null);
                  setDirty(false);
                }}
                onKeepMine={() => save(conflict.hash)}
              />
            )}
          </>
        )}
      </div>
    </DashboardChrome>
  );
}
