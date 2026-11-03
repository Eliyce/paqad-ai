import { useCallback, useEffect, useRef, useState } from 'react';

import { CodeEditor } from '../components/CodeEditor';
import { ConflictPanel } from '../components/ConflictPanel';
import { DashboardChrome } from '../components/DashboardChrome';
import { OwnershipBadge } from '../components/OwnershipBadge';
import { WhySentence } from '../components/WhySentence';
import { WinLine } from '../components/WinLine';
import { fetchDashboard, fetchGitWorkflowConfig, putGitWorkflowFile } from '../lib/api';
import type {
  GitWorkflowConfigResponse,
  GitWorkflowFileName,
  ValidationIssue,
} from '../lib/dashboard-types';
import {
  changedOutsideMessage,
  GIT_WORKFLOW_TABS,
  issuesForFile,
  tabStatus,
  type GitWorkflowTabStatus,
} from '../lib/git-workflow';

const WIN_LINE = 'Saved. paqad checks the next turn, commit and pull request against it.';

const STATUS_COLOR: Record<GitWorkflowTabStatus, string> = {
  error: 'var(--color-mod-red)',
  warning: 'var(--color-mod-amber)',
  'changed-outside': 'var(--color-mod-amber)',
  ok: 'transparent',
};

type FileMap<T> = Partial<Record<GitWorkflowFileName, T>>;

function IssueList({ issues, color }: { issues: ValidationIssue[]; color: string }) {
  if (issues.length === 0) return null;
  return (
    <div className="mt-4 flex flex-col gap-1.5">
      {issues.map((issue) => (
        <div key={issue.path + issue.message} className="flex items-baseline gap-2 text-secondary">
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full"
            style={{ background: color }}
          />
          <span>{issue.message}</span>
        </div>
      ))}
    </div>
  );
}

export function GitWorkflowView() {
  const [config, setConfig] = useState<GitWorkflowConfigResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [frameworkVersion, setFrameworkVersion] = useState<string | null>(null);
  const [sseLive, setSseLive] = useState(false);

  const [active, setActive] = useState<GitWorkflowFileName>('tickets.yaml');
  const [texts, setTexts] = useState<FileMap<string>>({});
  const [hashes, setHashes] = useState<FileMap<string | null>>({});
  const [dirty, setDirty] = useState<FileMap<boolean>>({});
  const [resetKey, setResetKey] = useState(0);

  const [saving, setSaving] = useState(false);
  const [saveIssues, setSaveIssues] = useState<ValidationIssue[] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ content: string; hash: string | null } | null>(null);
  const [win, setWin] = useState(false);

  const loadConfig = useCallback((): void => {
    fetchGitWorkflowConfig()
      .then((response) => {
        setConfig(response);
        const nextTexts: FileMap<string> = {};
        const nextHashes: FileMap<string | null> = {};
        for (const file of response.files) {
          nextTexts[file.name] = file.content ?? '';
          nextHashes[file.name] = file.hash;
        }
        setTexts(nextTexts);
        setHashes(nextHashes);
        setDirty({});
        setResetKey((key) => key + 1);
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
      .catch(() => {});
  }, [loadConfig]);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.addEventListener('open', () => setSseLive(true));
    source.addEventListener('error', () => setSseLive(false));
    return () => {
      source.close();
    };
  }, []);

  const text = texts[active] ?? '';

  const save = useCallback(
    (overrideBaseHash?: string | null): void => {
      if (saving || !config) return;
      const file = active;
      const content = texts[file] ?? '';
      setSaving(true);
      setSaveIssues(null);
      setSaveError(null);
      putGitWorkflowFile(file, {
        content,
        baseHash: overrideBaseHash !== undefined ? overrideBaseHash : (hashes[file] ?? null),
      })
        .then((outcome) => {
          if (outcome.status === 'ok') {
            setHashes((prev) => ({ ...prev, [file]: outcome.result.hash }));
            setDirty((prev) => ({ ...prev, [file]: false }));
            setConfig((prev) =>
              prev
                ? {
                    ...prev,
                    resolved: outcome.result.resolved,
                    warnings: outcome.result.warnings,
                    errors: prev.errors.filter((issue) => issue.file !== file),
                    changedOutside: prev.changedOutside.filter((name) => name !== file),
                    files: prev.files.map((entry) =>
                      entry.name === file
                        ? { ...entry, exists: true, content, hash: outcome.result.hash }
                        : entry,
                    ),
                  }
                : prev,
            );
            setConflict(null);
            setWin(true);
            return;
          }
          if (outcome.status === 'invalid') {
            setSaveIssues(outcome.issues);
            return;
          }
          setConflict({ content: outcome.conflict.content ?? '', hash: outcome.conflict.hash });
        })
        .catch((err: unknown) => setSaveError(err instanceof Error ? err.message : String(err)))
        .finally(() => setSaving(false));
    },
    [saving, config, active, texts, hashes],
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

  const switchTab = (file: GitWorkflowFileName): void => {
    setActive(file);
    setSaveIssues(null);
    setSaveError(null);
    setConflict(null);
    setWin(false);
    setResetKey((key) => key + 1);
  };

  const activeTab = GIT_WORKFLOW_TABS.find((tab) => tab.name === active) ?? GIT_WORKFLOW_TABS[0]!;
  const activeFile = config?.files.find((file) => file.name === active) ?? null;

  return (
    <DashboardChrome
      projectName={projectName}
      frameworkVersion={frameworkVersion}
      sseLive={sseLive}
    >
      <div className="mx-auto w-full max-w-4xl p-6">
        <div className="flex items-center gap-3">
          <h1 className="text-page font-semibold">Git workflow</h1>
          <OwnershipBadge managedBy="you" />
        </div>
        <WhySentence>
          This team's rules for tickets, branches, commits, pull requests and how strictly they're
          checked.
        </WhySentence>

        {loadError && (
          <div
            className="mt-4 rounded-[10px] border p-4 text-secondary"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-mod-red)' }}
          >
            Could not load the git workflow: {loadError}
          </div>
        )}

        {!config && !loadError && (
          <div className="mt-6 text-secondary" style={{ color: 'var(--color-muted)' }}>
            Loading…
          </div>
        )}

        {config && (
          <>
            <div role="tablist" aria-label="Git workflow files" className="mt-6 flex gap-1.5">
              {GIT_WORKFLOW_TABS.map((tab) => {
                const status = tabStatus(tab.name, config);
                const selected = tab.name === active;
                return (
                  <button
                    key={tab.name}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    className="flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-secondary"
                    style={{
                      background: selected ? 'var(--color-surface)' : 'transparent',
                      fontWeight: selected ? 600 : 400,
                    }}
                    onClick={() => switchTab(tab.name)}
                  >
                    {tab.label}
                    {(status !== 'ok' || dirty[tab.name]) && (
                      <span
                        aria-hidden="true"
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{
                          background: dirty[tab.name]
                            ? 'var(--color-accent)'
                            : STATUS_COLOR[status],
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 text-secondary" style={{ color: 'var(--color-muted)' }}>
              {activeTab.what}{' '}
              <span className="font-mono">{activeFile?.path ?? activeTab.name}</span>
              {activeFile && !activeFile.exists && ' does not exist yet, so its defaults apply.'}
            </div>

            {config.changedOutside.includes(active) && (
              <IssueList
                issues={[{ path: active, message: changedOutsideMessage(active) }]}
                color="var(--color-mod-amber)"
              />
            )}
            <IssueList issues={issuesForFile(config.errors, active)} color="var(--color-mod-red)" />
            <IssueList
              issues={issuesForFile(config.warnings, active)}
              color="var(--color-mod-amber)"
            />

            <div className="mt-6 flex items-center justify-end gap-2.5">
              {win && <WinLine onDone={() => setWin(false)}>{WIN_LINE}</WinLine>}
              <button
                type="button"
                disabled={saving}
                className="rounded-[6px] px-3.5 py-1.5 text-secondary font-medium disabled:opacity-50"
                style={{ background: 'var(--color-accent)', color: '#ffffff' }}
                onClick={() => save()}
              >
                {saving ? 'Saving…' : `Save ${active}`}
              </button>
            </div>

            <div className="mt-3">
              <CodeEditor
                key={`${active}-${resetKey}`}
                value={text}
                onChange={(next) => {
                  setTexts((prev) => ({ ...prev, [active]: next }));
                  setDirty((prev) => ({ ...prev, [active]: true }));
                  setWin(false);
                }}
                lang="yaml"
                ariaLabel={`${active} YAML`}
                minHeight={420}
              />
            </div>

            {saveIssues && <IssueList issues={saveIssues} color="var(--color-mod-red)" />}

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
                  setTexts((prev) => ({ ...prev, [active]: conflict.content }));
                  setHashes((prev) => ({ ...prev, [active]: conflict.hash }));
                  setDirty((prev) => ({ ...prev, [active]: false }));
                  setResetKey((key) => key + 1);
                  setConflict(null);
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
