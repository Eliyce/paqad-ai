import { marked } from 'marked';
import { useCallback, useEffect, useRef, useState } from 'react';
import YAML from 'yaml';

import { CodeEditor, type CodeEditorLang } from '../components/CodeEditor';
import { ConflictPanel } from '../components/ConflictPanel';
import { DashboardChrome } from '../components/DashboardChrome';
import { EmptyState } from '../components/EmptyState';
import { OwnershipBadge } from '../components/OwnershipBadge';
import { WhySentence } from '../components/WhySentence';
import { WinLine } from '../components/WinLine';
import {
  fetchDashboard,
  fetchInstructionsFile,
  fetchInstructionsTree,
  putInstructionsFile,
} from '../lib/api';
import type {
  InstructionsFileResponse,
  InstructionsTreeNode,
  ValidationIssue,
} from '../lib/dashboard-types';

/**
 * The instructions editor (issue #146): a two-pane view over
 * docs/instructions. Left pane is the file tree; right pane edits the
 * selected file with frontmatter as fields above a CodeMirror body, plus a
 * rendered preview for Markdown. Saves run the shared write pipeline with
 * the friendly merge prompt on 409.
 */

const WIN_LINE = 'Saved. Agents reload this automatically on their next session.';

interface FmEntry {
  key: string;
  text: string;
}

function fmValueText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';
  return YAML.stringify(value).trim();
}

function entriesFromFrontmatter(frontmatter: Record<string, unknown>): FmEntry[] {
  return Object.entries(frontmatter).map(([key, value]) => ({ key, text: fmValueText(value) }));
}

function langForFile(path: string): CodeEditorLang {
  if (path.endsWith('.md')) return 'markdown';
  if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'yaml';
  return 'plain';
}

// --- File tree ---------------------------------------------------------------

function TreeDirectory({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: InstructionsTreeNode;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      {depth > 0 && (
        <button
          type="button"
          className="flex w-full items-center gap-1.5 rounded-[6px] px-2 py-1 text-secondary font-medium"
          style={{ color: 'var(--color-muted)', paddingLeft: depth * 12 + 8 }}
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
            style={{
              transform: open ? 'rotate(90deg)' : 'none',
              transition: 'transform 150ms ease-out',
            }}
          >
            <path d="M3.5 2l3 3-3 3" />
          </svg>
          <span className="truncate">{node.name}</span>
        </button>
      )}
      {open &&
        (node.children ?? []).map((child) =>
          child.type === 'directory' ? (
            <TreeDirectory
              key={child.path}
              node={child}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
            />
          ) : (
            <button
              key={child.path}
              type="button"
              className="block w-full truncate rounded-[6px] px-2 py-1 text-left text-secondary"
              style={{
                paddingLeft: (depth + 1) * 12 + 8,
                color: selected === child.path ? 'var(--color-accent)' : 'var(--color-canvas-fg)',
                background: selected === child.path ? 'var(--color-surface)' : 'transparent',
              }}
              aria-current={selected === child.path ? 'true' : undefined}
              onClick={() => onSelect(child.path)}
            >
              {child.name}
            </button>
          ),
        )}
    </div>
  );
}

// --- The view ----------------------------------------------------------------

export function InstructionsView() {
  const [projectName, setProjectName] = useState<string | null>(null);
  const [frameworkVersion, setFrameworkVersion] = useState<string | null>(null);
  const [sseLive, setSseLive] = useState(false);

  const [tree, setTree] = useState<InstructionsTreeNode | null>(null);
  const [treeExists, setTreeExists] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<InstructionsFileResponse | null>(null);
  const [body, setBody] = useState('');
  const [fmEntries, setFmEntries] = useState<FmEntry[]>([]);
  const [fmDirty, setFmDirty] = useState(false);
  const [dirty, setDirty] = useState(false);
  /** Remount key for the editor after external content replacement. */
  const [resetKey, setResetKey] = useState(0);
  const [preview, setPreview] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveIssues, setSaveIssues] = useState<ValidationIssue[] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ content: string; hash: string | null } | null>(null);
  const [win, setWin] = useState(false);

  /** A file click that is waiting on the unsaved-changes choice. */
  const [pendingSelect, setPendingSelect] = useState<string | null>(null);

  useEffect(() => {
    fetchInstructionsTree()
      .then((response) => {
        setTree(response.tree);
        setTreeExists(response.exists);
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

  const openFile = useCallback((path: string): void => {
    setSelected(path);
    setFile(null);
    setBody('');
    setFmEntries([]);
    setFmDirty(false);
    setDirty(false);
    setPreview(false);
    setSaveIssues(null);
    setSaveError(null);
    setConflict(null);
    setWin(false);
    fetchInstructionsFile(path)
      .then((response) => {
        setFile(response);
        setBody(response.body ?? '');
        setFmEntries(entriesFromFrontmatter(response.frontmatter));
        setResetKey((key) => key + 1);
      })
      .catch((err: unknown) => setSaveError(err instanceof Error ? err.message : String(err)));
  }, []);

  const selectFile = (path: string): void => {
    if (path === selected) return;
    if (dirty) {
      setPendingSelect(path);
      return;
    }
    openFile(path);
  };

  /** The exact text a save would write right now. */
  const currentContent = useCallback((): string => {
    if (!file || file.content === null) return body;
    if (fmEntries.length === 0) return body;
    if (!fmDirty) {
      // Frontmatter untouched: keep the original block byte for byte.
      const originalBody = file.body ?? '';
      const prefix = file.content.slice(0, file.content.length - originalBody.length);
      return prefix + body;
    }
    const rebuilt: Record<string, unknown> = {};
    for (const entry of fmEntries) {
      let value: unknown = entry.text;
      try {
        value = YAML.parse(entry.text);
      } catch {
        // keep the raw text when it is not valid YAML on its own
      }
      rebuilt[entry.key] = value;
    }
    return '---\n' + YAML.stringify(rebuilt) + '---\n' + body;
  }, [file, body, fmEntries, fmDirty]);

  const save = useCallback(
    (overrideBaseHash?: string | null): void => {
      if (saving || !file || selected === null) return;
      setSaving(true);
      setSaveIssues(null);
      setSaveError(null);
      const content = currentContent();
      putInstructionsFile(selected, {
        content,
        baseHash: overrideBaseHash !== undefined ? overrideBaseHash : file.hash,
      })
        .then((outcome) => {
          if (outcome.status === 'ok') {
            setFile((prev) =>
              prev ? { ...prev, exists: true, content, hash: outcome.result.hash, body } : prev,
            );
            setConflict(null);
            setDirty(false);
            setFmDirty(false);
            setWin(true);
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
    [saving, file, selected, currentContent, body],
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

  const touch = (): void => {
    setDirty(true);
    setWin(false);
  };

  const isMarkdown = selected !== null && selected.endsWith('.md');
  const previewHtml = isMarkdown && preview ? (marked.parse(body) as string) : null;

  return (
    <DashboardChrome
      projectName={projectName}
      frameworkVersion={frameworkVersion}
      sseLive={sseLive}
    >
      <div className="mx-auto w-full max-w-5xl p-6">
        <div className="flex items-center gap-3">
          <h1 className="text-page font-semibold">Instructions</h1>
          <OwnershipBadge managedBy="you" />
        </div>
        <WhySentence>
          Your standards, applied to every change without repeating yourself.
        </WhySentence>

        {loadError && (
          <div
            className="mt-4 rounded-[10px] border p-4 text-secondary"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-mod-red)' }}
          >
            Could not load the instructions tree: {loadError}
          </div>
        )}

        {!treeExists && !loadError && (
          <div className="mt-6">
            <EmptyState
              what="No docs/instructions directory yet."
              why="Onboarding creates it, and every agent reads it before touching your code."
              actionLabel="Copy the onboarding command"
              onAction={() => {
                void navigator.clipboard?.writeText('paqad-ai onboard');
              }}
            />
          </div>
        )}

        {tree && (
          <div className="mt-6 flex gap-6">
            <nav
              aria-label="Instruction files"
              className="w-60 shrink-0 self-start overflow-auto rounded-[10px] py-2"
              style={{ background: 'var(--color-surface)', maxHeight: '70vh' }}
            >
              <TreeDirectory node={tree} depth={0} selected={selected} onSelect={selectFile} />
            </nav>

            <div className="min-w-0 flex-1">
              {selected === null && (
                <div className="mt-2 text-secondary" style={{ color: 'var(--color-muted)' }}>
                  Pick a file on the left to edit it.
                </div>
              )}

              {pendingSelect !== null && (
                <div
                  className="mb-4 flex flex-wrap items-center gap-2.5 rounded-[10px] p-4"
                  style={{ background: 'var(--color-surface)' }}
                >
                  <span className="text-secondary">
                    This file has unsaved changes. Switching now loses them.
                  </span>
                  <button
                    type="button"
                    className="rounded-[6px] border px-3 py-1.5 text-secondary font-medium"
                    style={{ borderColor: 'var(--color-mod-red)', color: 'var(--color-mod-red)' }}
                    onClick={() => {
                      const next = pendingSelect;
                      setPendingSelect(null);
                      openFile(next);
                    }}
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    className="rounded-[6px] px-3 py-1.5 text-secondary font-medium"
                    style={{ color: 'var(--color-muted)' }}
                    onClick={() => setPendingSelect(null)}
                  >
                    Stay
                  </button>
                </div>
              )}

              {selected !== null && file && (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div
                      className="min-w-0 truncate text-secondary"
                      style={{ color: 'var(--color-muted)' }}
                    >
                      {file.path}
                    </div>
                    <div className="flex items-center gap-2.5">
                      {isMarkdown && (
                        <button
                          type="button"
                          aria-pressed={preview}
                          className="rounded-[6px] px-2.5 py-1.5 text-secondary font-medium"
                          style={{
                            color: preview ? 'var(--color-accent)' : 'var(--color-muted)',
                            background: preview ? 'var(--color-surface)' : 'transparent',
                          }}
                          onClick={() => setPreview((prev) => !prev)}
                        >
                          Preview
                        </button>
                      )}
                      {win && <WinLine onDone={() => setWin(false)}>{WIN_LINE}</WinLine>}
                      {dirty && !win && (
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

                  {fmEntries.length > 0 && (
                    <div
                      className="mt-4 grid gap-x-4 gap-y-2 rounded-[10px] p-4 sm:grid-cols-2"
                      style={{ background: 'var(--color-surface)' }}
                    >
                      {fmEntries.map((entry, index) => (
                        <div key={entry.key} className="min-w-0">
                          <label
                            htmlFor={'fm-' + entry.key}
                            className="block text-caption"
                            style={{ color: 'var(--color-muted)' }}
                          >
                            {entry.key}
                          </label>
                          <input
                            id={'fm-' + entry.key}
                            type="text"
                            className="mt-1 w-full rounded-[6px] border px-2 py-1 text-secondary"
                            style={{
                              background: 'var(--color-canvas)',
                              borderColor: 'var(--color-border)',
                              color: 'var(--color-canvas-fg)',
                            }}
                            value={entry.text}
                            onChange={(event) => {
                              setFmEntries((prev) =>
                                prev.map((row, i) =>
                                  i === index ? { ...row, text: event.target.value } : row,
                                ),
                              );
                              setFmDirty(true);
                              touch();
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-4">
                    {previewHtml !== null ? (
                      <div
                        className="rounded-[10px] p-5 text-body leading-relaxed [&_a]:underline [&_code]:font-mono [&_code]:text-secondary [&_h1]:text-page [&_h1]:font-semibold [&_h2]:text-section [&_h2]:font-medium [&_h3]:text-body [&_h3]:font-medium [&_li]:ml-5 [&_p]:my-2 [&_ol]:list-decimal [&_pre]:overflow-auto [&_pre]:rounded-[6px] [&_pre]:p-3 [&_table]:text-secondary [&_ul]:list-disc"
                        style={{ background: 'var(--color-surface)' }}
                        // marked output of the file body; instructions files
                        // are project-local and the server allowlists writes.
                        dangerouslySetInnerHTML={{ __html: previewHtml }}
                      />
                    ) : (
                      <CodeEditor
                        key={selected + ':' + resetKey}
                        value={body}
                        onChange={(next) => {
                          setBody(next);
                          touch();
                        }}
                        lang={langForFile(selected)}
                        ariaLabel={'Contents of ' + file.path}
                        minHeight={420}
                      />
                    )}
                  </div>

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
                      mine={currentContent()}
                      theirs={conflict.content}
                      saving={saving}
                      onLoadLatest={() => {
                        setConflict(null);
                        openFile(selected);
                      }}
                      onKeepMine={() => save(conflict.hash)}
                    />
                  )}
                </>
              )}

              {selected !== null && !file && !saveError && (
                <div className="mt-2 text-secondary" style={{ color: 'var(--color-muted)' }}>
                  Loading…
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </DashboardChrome>
  );
}
