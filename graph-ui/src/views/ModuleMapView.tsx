import { useCallback, useEffect, useRef, useState } from 'react';

import { CodeEditor } from '../components/CodeEditor';
import { ConflictPanel } from '../components/ConflictPanel';
import { DashboardChrome } from '../components/DashboardChrome';
import { EmptyState } from '../components/EmptyState';
import { OpButton } from '../components/OpButton';
import { OwnershipBadge } from '../components/OwnershipBadge';
import { WhySentence } from '../components/WhySentence';
import { WinLine } from '../components/WinLine';
import { fetchDashboard, fetchModuleMapConfig, putModuleMap } from '../lib/api';
import type {
  ModuleMapConfigResponse,
  ModuleMapModule,
  ValidationIssue,
} from '../lib/dashboard-types';

/**
 * The module map editor (issue #146). One editing surface: the raw YAML in
 * CodeMirror is the editor of record, with a read-only table of the declared
 * modules above it for orientation and the latest drift findings inline so
 * "Reconcile now" is one click away.
 */

const WIN_LINE = 'Saved. The reconciler keeps this truthful from here.';

const SEED_CONTENT = 'modules: []\n';

function ModulesTable({ modules }: { modules: ModuleMapModule[] }) {
  if (modules.length === 0) return null;
  return (
    <div className="mt-4 rounded-[10px] p-4" style={{ background: 'var(--color-surface)' }}>
      <div className="grid grid-cols-[1fr_1.4fr_auto_auto] gap-x-4 gap-y-1.5">
        <div className="text-caption font-medium" style={{ color: 'var(--color-muted)' }}>
          Slug
        </div>
        <div className="text-caption font-medium" style={{ color: 'var(--color-muted)' }}>
          Name
        </div>
        <div
          className="text-caption font-medium text-right"
          style={{ color: 'var(--color-muted)' }}
        >
          Sources
        </div>
        <div
          className="text-caption font-medium text-right"
          style={{ color: 'var(--color-muted)' }}
        >
          Features
        </div>
        {modules.map((module) => (
          <div key={module.slug + module.name} className="contents">
            <div className="truncate font-mono text-secondary">{module.slug || '(no slug)'}</div>
            <div className="truncate text-secondary">{module.name}</div>
            <div className="text-right text-secondary" style={{ color: 'var(--color-muted)' }}>
              {module.sources.length}
            </div>
            <div className="text-right text-secondary" style={{ color: 'var(--color-muted)' }}>
              {module.features.length}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ModuleMapView() {
  const [config, setConfig] = useState<ModuleMapConfigResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [frameworkVersion, setFrameworkVersion] = useState<string | null>(null);
  const [sseLive, setSseLive] = useState(false);

  const [started, setStarted] = useState(false);
  const [text, setText] = useState('');
  const [baseHash, setBaseHash] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveIssues, setSaveIssues] = useState<ValidationIssue[] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ content: string; hash: string | null } | null>(null);
  const [win, setWin] = useState(false);

  const loadConfig = useCallback((): void => {
    fetchModuleMapConfig()
      .then((response) => {
        setConfig(response);
        setBaseHash(response.file.hash);
        if (response.file.exists && response.file.content !== null) {
          setStarted(true);
          setText(response.file.content);
          setResetKey((key) => key + 1);
        }
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    loadConfig();
    fetchDashboard()
      .then((report) => {
        setProjectName(report.projectName);
        setFrameworkVersion(report.frameworkVersion);
      })
      .catch(() => {
        // chrome placeholders are fine
      });
  }, [loadConfig]);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.addEventListener('open', () => setSseLive(true));
    source.addEventListener('error', () => setSseLive(false));
    return () => {
      source.close();
    };
  }, []);

  const save = useCallback(
    (overrideBaseHash?: string | null): void => {
      if (saving || !started) return;
      setSaving(true);
      setSaveIssues(null);
      setSaveError(null);
      putModuleMap({
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
                    modules: outcome.result.modules,
                    file: { ...prev.file, exists: true, content: text, hash: outcome.result.hash },
                  }
                : prev,
            );
            setConflict(null);
            setDirty(false);
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

  const drift = config?.drift ?? null;
  const findings = drift?.findings ?? [];

  return (
    <DashboardChrome
      projectName={projectName}
      frameworkVersion={frameworkVersion}
      sseLive={sseLive}
    >
      <div className="mx-auto w-full max-w-4xl p-6">
        <div className="flex items-center gap-3">
          <h1 className="text-page font-semibold">Module map</h1>
          <OwnershipBadge managedBy="shared" />
        </div>
        <WhySentence>What exists in your codebase, kept truthful automatically.</WhySentence>

        {loadError && (
          <div
            className="mt-4 rounded-[10px] border p-4 text-secondary"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-mod-red)' }}
          >
            Could not load the module map: {loadError}
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
              what="No module map yet."
              why="Declare what exists once and the reconciler keeps it honest against the code."
              actionLabel="Start an empty map"
              onAction={() => {
                setStarted(true);
                setText(SEED_CONTENT);
                setResetKey((key) => key + 1);
                setDirty(true);
              }}
            />
          </div>
        )}

        {config && started && (
          <>
            {findings.length > 0 && (
              <div
                className="mt-4 rounded-[10px] p-4"
                style={{ background: 'var(--color-surface)' }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-body font-medium">
                    The map and the code disagree in {findings.length}{' '}
                    {findings.length === 1 ? 'place' : 'places'}
                  </div>
                  <OpButton
                    action="reconcile"
                    label="Reconcile now"
                    done="Reconciled. Reload to see the fresh findings."
                    onDone={loadConfig}
                  />
                </div>
                <div className="mt-3 flex flex-col gap-1.5">
                  {findings.map((finding, index) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <div
                      key={finding.code + index}
                      className="flex items-baseline gap-2 text-secondary"
                    >
                      <span
                        aria-hidden="true"
                        className="inline-block h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full"
                        style={{ background: 'var(--color-mod-amber)' }}
                      />
                      <span
                        className="shrink-0 font-mono text-caption"
                        style={{ color: 'var(--color-muted)' }}
                      >
                        {finding.code}
                      </span>
                      <span className="min-w-0">{finding.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <ModulesTable modules={config.modules} />

            <div className="mt-6 flex items-center justify-end gap-2.5">
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

            <div className="mt-3">
              <CodeEditor
                key={resetKey}
                value={text}
                onChange={(next) => {
                  setText(next);
                  setDirty(true);
                  setWin(false);
                }}
                lang="yaml"
                ariaLabel="Raw module map YAML"
                minHeight={420}
              />
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
