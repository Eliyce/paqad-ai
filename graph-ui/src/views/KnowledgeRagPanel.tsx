import { useCallback, useEffect, useState } from 'react';

import { OpButton } from '../components/OpButton';
import { WhySentence } from '../components/WhySentence';
import { WinLine } from '../components/WinLine';
import { fetchRagConfig, putRagConfig } from '../lib/api';
import type { RagConfigResponse, ValidationIssue } from '../lib/dashboard-types';

/**
 * The retrieval panel on the Knowledge area page (issue #146): the live
 * index status, the handful of RAG settings worth a form, and the three
 * index operations. Rendered by AreaView through its `extra` slot.
 */

const WIN_LINE = 'Saved. Every agent picks this up automatically on its next session.';

const RAG_CLEAR_CONFIRM =
  'Clearing deletes the semantic index. The AI falls back to filename search until you rebuild.';

interface Draft {
  rag_enabled: boolean;
  embedding_provider: string;
  embedding_model: string;
  rag_similarity_threshold: string;
  rag_top_n: string;
}

const inputStyle: React.CSSProperties = {
  background: 'var(--color-canvas)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-canvas-fg)',
};

function draftFrom(config: RagConfigResponse): Draft {
  const intelligence = config.intelligence ?? {};
  const read = (key: string): unknown => intelligence[key];
  return {
    rag_enabled: read('rag_enabled') === true,
    embedding_provider: typeof read('embedding_provider') === 'string' ? String(read('embedding_provider')) : '',
    embedding_model: typeof read('embedding_model') === 'string' ? String(read('embedding_model')) : '',
    rag_similarity_threshold:
      typeof read('rag_similarity_threshold') === 'number'
        ? String(read('rag_similarity_threshold'))
        : '',
    rag_top_n: typeof read('rag_top_n') === 'number' ? String(read('rag_top_n')) : '',
  };
}

export function KnowledgeRagPanel() {
  const [config, setConfig] = useState<RagConfigResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveIssues, setSaveIssues] = useState<ValidationIssue[] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [win, setWin] = useState(false);

  const load = useCallback((): void => {
    fetchRagConfig()
      .then((response) => {
        setConfig(response);
        setDraft((prev) => prev ?? draftFrom(response));
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const edit = (patch: Partial<Draft>): void => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
    setWin(false);
  };

  const save = (): void => {
    if (saving || draft === null) return;
    setSaving(true);
    setSaveIssues(null);
    setSaveError(null);
    const patch: Record<string, unknown> = { rag_enabled: draft.rag_enabled };
    if (draft.embedding_provider !== '') patch.embedding_provider = draft.embedding_provider;
    if (draft.embedding_model !== '') patch.embedding_model = draft.embedding_model;
    if (draft.rag_similarity_threshold !== '') {
      patch.rag_similarity_threshold = Number(draft.rag_similarity_threshold);
    }
    if (draft.rag_top_n !== '') patch.rag_top_n = Number(draft.rag_top_n);
    putRagConfig(patch)
      .then((outcome) => {
        if (outcome.status === 'ok') {
          setDirty(false);
          setWin(true);
          setConfig(null);
          setDraft(null);
          load();
          return;
        }
        if (outcome.status === 'invalid') {
          setSaveIssues(outcome.issues);
          return;
        }
        setSaveError(outcome.error);
      })
      .catch((err: unknown) => {
        setSaveError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setSaving(false));
  };

  const status = config?.status ?? null;

  return (
    <section className="mt-8">
      <h2 className="text-section font-medium">Retrieval</h2>
      <WhySentence>Your code and docs, indexed so agents cite the real thing.</WhySentence>

      {loadError && (
        <div className="mt-3 text-secondary" style={{ color: 'var(--color-mod-red)' }}>
          Could not load the retrieval settings: {loadError}
        </div>
      )}

      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div className="rounded-[10px] p-4" style={{ background: 'var(--color-surface)' }}>
          <div className="text-body font-medium">Index status</div>
          {status === null ? (
            <div className="mt-2 text-secondary" style={{ color: 'var(--color-muted)' }}>
              Loading…
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-1 text-secondary">
              <div>
                <span style={{ color: 'var(--color-muted)' }}>Retrieval </span>
                {status.enabled ? 'on' : 'off'}
              </div>
              <div>
                <span style={{ color: 'var(--color-muted)' }}>Provider </span>
                {status.provider ?? 'not set'}
              </div>
              <div>
                <span style={{ color: 'var(--color-muted)' }}>Model </span>
                {status.model ?? 'not set'}
              </div>
              <div>
                <span style={{ color: 'var(--color-muted)' }}>Index </span>
                {status.indexPresent
                  ? status.indexAgeDays === null
                    ? 'present'
                    : status.indexAgeDays === 0
                      ? 'present, refreshed today'
                      : 'present, ' +
                        status.indexAgeDays +
                        (status.indexAgeDays === 1 ? ' day old' : ' days old')
                  : 'not built yet'}
              </div>
            </div>
          )}
          <div className="mt-4 flex flex-col items-start gap-2.5">
            <OpButton
              action="rag-rebuild"
              label="Rebuild the index"
              done="Rebuilt. Answers cite the fresh index now."
              onDone={() => {
                setConfig(null);
                load();
              }}
            />
            <OpButton
              action="rag-clear"
              label="Clear the index"
              confirm={RAG_CLEAR_CONFIRM}
              done="Cleared. Rebuild whenever you want retrieval back."
              onDone={() => {
                setConfig(null);
                setDraft(null);
                load();
              }}
            />
            <OpButton
              action="refresh-context"
              label="Refresh the context index"
              done="Refreshed. The context index matches the code again."
            />
          </div>
        </div>

        <div className="rounded-[10px] p-4" style={{ background: 'var(--color-surface)' }}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-body font-medium">Settings</div>
            <div className="flex items-center gap-2.5">
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
                disabled={saving || draft === null}
                className="rounded-[6px] px-3 py-1.5 text-secondary font-medium disabled:opacity-50"
                style={{ background: 'var(--color-accent)', color: '#ffffff' }}
                onClick={save}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>

          {draft === null ? (
            <div className="mt-2 text-secondary" style={{ color: 'var(--color-muted)' }}>
              Loading…
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="rag-enabled"
                  className="text-caption"
                  style={{ color: 'var(--color-muted)' }}
                >
                  Retrieval on
                </label>
                <button
                  id="rag-enabled"
                  type="button"
                  role="switch"
                  aria-checked={draft.rag_enabled}
                  className="relative inline-flex h-4.5 w-8 shrink-0 items-center rounded-full"
                  style={{
                    background: draft.rag_enabled ? 'var(--color-accent)' : 'var(--color-border)',
                    transition: 'background 200ms ease-out',
                  }}
                  onClick={() => edit({ rag_enabled: !draft.rag_enabled })}
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-3.5 w-3.5 rounded-full"
                    style={{
                      background: 'var(--color-surface)',
                      transform: draft.rag_enabled ? 'translateX(15px)' : 'translateX(2px)',
                      transition: 'transform 200ms ease-out',
                    }}
                  />
                </button>
              </div>
              <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <label
                    htmlFor="rag-provider"
                    className="block text-caption"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    Embedding provider
                  </label>
                  <input
                    id="rag-provider"
                    type="text"
                    className="mt-1 w-full rounded-[6px] border px-2 py-1 text-secondary"
                    style={inputStyle}
                    value={draft.embedding_provider}
                    onChange={(event) => edit({ embedding_provider: event.target.value })}
                  />
                </div>
                <div className="min-w-0">
                  <label
                    htmlFor="rag-model"
                    className="block text-caption"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    Embedding model
                  </label>
                  <input
                    id="rag-model"
                    type="text"
                    className="mt-1 w-full rounded-[6px] border px-2 py-1 text-secondary"
                    style={inputStyle}
                    value={draft.embedding_model}
                    onChange={(event) => edit({ embedding_model: event.target.value })}
                  />
                </div>
                <div className="min-w-0">
                  <label
                    htmlFor="rag-threshold"
                    className="block text-caption"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    Similarity threshold (0 to 1)
                  </label>
                  <input
                    id="rag-threshold"
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    className="mt-1 w-full rounded-[6px] border px-2 py-1 text-secondary"
                    style={inputStyle}
                    value={draft.rag_similarity_threshold}
                    onChange={(event) => edit({ rag_similarity_threshold: event.target.value })}
                  />
                </div>
                <div className="min-w-0">
                  <label
                    htmlFor="rag-top-n"
                    className="block text-caption"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    Results per lookup
                  </label>
                  <input
                    id="rag-top-n"
                    type="number"
                    min={1}
                    step={1}
                    className="mt-1 w-full rounded-[6px] border px-2 py-1 text-secondary"
                    style={inputStyle}
                    value={draft.rag_top_n}
                    onChange={(event) => edit({ rag_top_n: event.target.value })}
                  />
                </div>
              </div>
            </div>
          )}

          {saveIssues && saveIssues.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5">
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
            <div className="mt-3 text-secondary" style={{ color: 'var(--color-mod-red)' }}>
              {saveError}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
