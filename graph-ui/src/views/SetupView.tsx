import { useCallback, useEffect, useState } from 'react';

import { DashboardChrome } from '../components/DashboardChrome';
import { EmptyState } from '../components/EmptyState';
import { OpButton } from '../components/OpButton';
import { SchemaForm } from '../components/SchemaForm';
import { WhyDrawer } from '../components/WhyDrawer';
import { WhySentence } from '../components/WhySentence';
import { WinLine } from '../components/WinLine';
import {
  fetchDashboard,
  fetchInventory,
  fetchPacks,
  fetchProfileConfig,
  installPack,
  putProfile,
  removePack,
  setCapability,
} from '../lib/api';
import { PAGE_WHY, WHY_DRAWER, type WhyDrawerCopy } from '../lib/copy';
import type {
  DashboardPack,
  InventoryItem,
  ProfileConfigResponse,
  ValidationIssue,
} from '../lib/dashboard-types';

import { ItemCard } from './AreaView';

/**
 * The Setup area page (issue #146, spec 5.7): the project profile as a
 * schema-driven form, capability toggles, the pack list with install and
 * remove, the operations row, and the area's evidence cards at the bottom.
 */

const AGENT_PICKUP_LINE = 'Saved. Every agent picks this up automatically on its next session.';

const CAPABILITY_WHY: Record<string, string> = {
  content: 'Writing and documentation workflows for every project.',
  coding: 'Code workflows, verification gates, and the module map.',
  planning: 'Plans that survive interruptions and sessions.',
  security: 'Pentest workflows and security rules on every change.',
};

const REMOVE_PACK_CONFIRM =
  'Removing this pack removes its rules from every future change. Existing code is untouched.';

const inputStyle: React.CSSProperties = {
  background: 'var(--color-canvas)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-canvas-fg)',
};

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {issues.map((issue) => (
        <div key={issue.path + issue.message} className="flex items-baseline gap-2 text-secondary">
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
  );
}

// --- Profile -----------------------------------------------------------------

function ProfileSection() {
  const [config, setConfig] = useState<ProfileConfigResponse | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveIssues, setSaveIssues] = useState<ValidationIssue[] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [win, setWin] = useState(false);

  useEffect(() => {
    fetchProfileConfig()
      .then((response) => {
        setConfig(response);
        setDraft(response.profile);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);

  const save = (): void => {
    if (saving || draft === null) return;
    setSaving(true);
    setSaveIssues(null);
    setSaveError(null);
    putProfile(draft)
      .then((outcome) => {
        if (outcome.status === 'ok') {
          setDraft(outcome.result.profile);
          setDirty(false);
          setWin(true);
          return;
        }
        if (outcome.status === 'invalid') {
          setSaveIssues(outcome.issues);
          return;
        }
        // The profile PUT has no merge story; surface the sentence plainly.
        setSaveError(outcome.error);
      })
      .catch((err: unknown) => setSaveError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSaving(false));
  };

  return (
    <section className="mt-8">
      <h2 className="text-section font-medium">Profile</h2>
      <WhySentence>Paqad tunes its checks to the shape of your project.</WhySentence>

      {loadError && (
        <div className="mt-3 text-secondary" style={{ color: 'var(--color-mod-red)' }}>
          Could not load the profile: {loadError}
        </div>
      )}

      {config && config.profile === null && (
        <div className="mt-3">
          <EmptyState
            what="No project profile yet."
            why="Onboarding interviews the project once and writes the profile every agent reads."
            actionLabel="Copy the onboarding command"
            onAction={() => {
              void navigator.clipboard?.writeText('paqad-ai onboard');
            }}
          />
        </div>
      )}

      {config && draft !== null && (
        <div className="mt-3 rounded-[10px] p-4" style={{ background: 'var(--color-surface)' }}>
          <div className="flex items-center justify-end gap-2.5">
            {win && <WinLine onDone={() => setWin(false)}>{AGENT_PICKUP_LINE}</WinLine>}
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
              onClick={save}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          <div className="mt-3">
            <SchemaForm
              schema={config.schema}
              value={draft}
              onChange={(next) => {
                setDraft(next);
                setDirty(true);
                setWin(false);
              }}
              idPrefix="profile"
            />
          </div>
          {saveIssues && saveIssues.length > 0 && <IssueList issues={saveIssues} />}
          {saveError && (
            <div className="mt-3 text-secondary" style={{ color: 'var(--color-mod-red)' }}>
              {saveError}
            </div>
          )}
        </div>
      )}

      {!config && !loadError && (
        <div className="mt-3 text-secondary" style={{ color: 'var(--color-muted)' }}>
          Loading…
        </div>
      )}
    </section>
  );
}

// --- Capabilities --------------------------------------------------------------

function CapabilitiesSection() {
  const [available, setAvailable] = useState<string[] | null>(null);
  const [active, setActive] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [win, setWin] = useState(false);

  useEffect(() => {
    fetchProfileConfig()
      .then((response) => {
        setAvailable([...response.capabilities.available]);
        setActive(response.capabilities.active);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const toggle = (name: string, enabled: boolean): void => {
    if (busy !== null) return;
    setBusy(name);
    setError(null);
    setWin(false);
    setCapability(name, enabled)
      .then((outcome) => {
        if (outcome.status === 'ok') {
          setActive(outcome.result.active);
          setWin(true);
          return;
        }
        if (outcome.status === 'invalid') {
          setError(outcome.issues[0]?.message ?? outcome.error);
          return;
        }
        setError(outcome.error);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(null));
  };

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-section font-medium">Capabilities</h2>
        {win && <WinLine onDone={() => setWin(false)}>{AGENT_PICKUP_LINE}</WinLine>}
      </div>
      <WhySentence>A clear record of what is switched on and what stays off.</WhySentence>

      {error && (
        <div className="mt-3 text-secondary" style={{ color: 'var(--color-mod-red)' }}>
          {error}
        </div>
      )}

      {available === null && !error && (
        <div className="mt-3 text-secondary" style={{ color: 'var(--color-muted)' }}>
          Loading…
        </div>
      )}

      {available !== null && (
        <div className="mt-3 flex flex-col gap-2">
          {available.map((name) => {
            const on = active.includes(name);
            return (
              <div
                key={name}
                className="flex items-center justify-between gap-3 rounded-[10px] p-4"
                style={{ background: 'var(--color-surface)' }}
              >
                <div className="min-w-0">
                  <div className="text-body font-medium">{name}</div>
                  <div className="mt-0.5 text-secondary" style={{ color: 'var(--color-muted)' }}>
                    {CAPABILITY_WHY[name] ?? 'Workflows and rules for ' + name + '.'}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={'Capability ' + name}
                  disabled={busy !== null}
                  className="relative inline-flex h-4.5 w-8 shrink-0 items-center rounded-full disabled:opacity-50"
                  style={{
                    background: on ? 'var(--color-accent)' : 'var(--color-border)',
                    transition: 'background 200ms ease-out',
                  }}
                  onClick={() => toggle(name, !on)}
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-3.5 w-3.5 rounded-full"
                    style={{
                      background: 'var(--color-surface)',
                      transform: on ? 'translateX(15px)' : 'translateX(2px)',
                      transition: 'transform 200ms ease-out',
                    }}
                  />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// --- Packs ---------------------------------------------------------------------

function PackRow({
  pack,
  onRemoved,
  onError,
}: {
  pack: DashboardPack;
  onRemoved: () => void;
  onError: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);

  const remove = (): void => {
    setRemoving(true);
    removePack({ name: pack.name, scope: pack.source === 'global' ? 'global' : 'project' })
      .then((outcome) => {
        if (outcome.status === 'ok') {
          onRemoved();
          return;
        }
        onError(outcome.error);
      })
      .catch((err: unknown) => onError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setRemoving(false);
        setConfirming(false);
      });
  };

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-[10px] px-4 py-3"
      style={{ background: 'var(--color-surface)' }}
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: pack.valid ? 'var(--color-mod-green)' : 'var(--color-mod-red)' }}
      />
      <span className="min-w-0 truncate text-body font-medium">{pack.name}</span>
      <span className="text-caption" style={{ color: 'var(--color-muted)' }}>
        {pack.source} · v{pack.version} · {pack.valid ? 'valid' : 'invalid'}
      </span>
      <div className="ml-auto">
        {pack.source !== 'built-in' &&
          (confirming ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-secondary">{REMOVE_PACK_CONFIRM}</span>
              <button
                type="button"
                disabled={removing}
                className="rounded-[6px] border px-3 py-1.5 text-secondary font-medium disabled:opacity-50"
                style={{ borderColor: 'var(--color-mod-red)', color: 'var(--color-mod-red)' }}
                onClick={remove}
              >
                Go ahead
              </button>
              <button
                type="button"
                className="rounded-[6px] px-3 py-1.5 text-secondary"
                style={{ color: 'var(--color-muted)' }}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="rounded-[6px] px-3 py-1.5 text-secondary font-medium"
              style={{ color: 'var(--color-muted)' }}
              onClick={() => setConfirming(true)}
            >
              Remove
            </button>
          ))}
      </div>
    </div>
  );
}

function PacksSection() {
  const [packs, setPacks] = useState<DashboardPack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState('');
  const [scope, setScope] = useState<'project' | 'global'>('project');
  const [installing, setInstalling] = useState(false);
  const [win, setWin] = useState<string | null>(null);

  const load = useCallback((): void => {
    fetchPacks()
      .then(setPacks)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const install = (): void => {
    if (installing || source.trim() === '') return;
    setInstalling(true);
    setError(null);
    setWin(null);
    installPack({ source: source.trim(), scope })
      .then((outcome) => {
        if (outcome.status === 'ok') {
          setSource('');
          setWin('Installed ' + outcome.result.name + ' v' + outcome.result.version + '.');
          load();
          return;
        }
        if (outcome.status === 'invalid') {
          setError(outcome.issues[0]?.message ?? outcome.error);
          return;
        }
        setError(outcome.error);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setInstalling(false));
  };

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-section font-medium">Packs</h2>
        {win !== null && <WinLine onDone={() => setWin(null)}>{win}</WinLine>}
      </div>
      <WhySentence>Drop-in rule packs for your stack, ready to enforce.</WhySentence>

      {error && (
        <div className="mt-3 text-secondary" style={{ color: 'var(--color-mod-red)' }}>
          {error}
        </div>
      )}

      {packs === null && !error && (
        <div className="mt-3 text-secondary" style={{ color: 'var(--color-muted)' }}>
          Loading…
        </div>
      )}

      {packs !== null && (
        <div className="mt-3 flex flex-col gap-2">
          {packs.map((pack) => (
            <PackRow key={pack.name + pack.source} pack={pack} onRemoved={load} onError={setError} />
          ))}
          {packs.length === 0 && (
            <div className="text-secondary" style={{ color: 'var(--color-muted)' }}>
              No packs discovered yet.
            </div>
          )}
        </div>
      )}

      <div
        className="mt-3 flex flex-wrap items-center gap-2.5 rounded-[10px] px-4 py-3"
        style={{ background: 'var(--color-surface)' }}
      >
        <input
          type="text"
          aria-label="Pack source"
          placeholder="Registry name, git URL, or path"
          className="w-0 min-w-48 flex-1 rounded-[6px] border px-2 py-1 text-secondary"
          style={inputStyle}
          value={source}
          onChange={(event) => setSource(event.target.value)}
        />
        <select
          aria-label="Install scope"
          className="rounded-[6px] border px-2 py-1 text-secondary"
          style={inputStyle}
          value={scope}
          onChange={(event) => setScope(event.target.value === 'global' ? 'global' : 'project')}
        >
          <option value="project">This project</option>
          <option value="global">Every project</option>
        </select>
        <button
          type="button"
          disabled={installing || source.trim() === ''}
          className="rounded-[6px] px-3 py-1.5 text-secondary font-medium disabled:opacity-50"
          style={{ background: 'var(--color-accent)', color: '#ffffff' }}
          onClick={install}
        >
          {installing ? 'Installing…' : 'Install'}
        </button>
      </div>
    </section>
  );
}

// --- The view --------------------------------------------------------------------

export function SetupView() {
  const [projectName, setProjectName] = useState<string | null>(null);
  const [frameworkVersion, setFrameworkVersion] = useState<string | null>(null);
  const [sseLive, setSseLive] = useState(false);
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [drawer, setDrawer] = useState<{ title: string; copy: WhyDrawerCopy } | null>(null);

  useEffect(() => {
    fetchDashboard()
      .then((report) => {
        setProjectName(report.projectName);
        setFrameworkVersion(report.frameworkVersion);
      })
      .catch(() => {
        // chrome placeholders are fine
      });
    // Keys with a dedicated section above; everything else in the setup
    // area (decision contract, providers, evidence) keeps its card.
    const sectioned = new Set(['profile', 'capabilities', 'packs']);
    fetchInventory()
      .then((report) => {
        setItems(report.items.filter((item) => item.area === 'setup' && !sectioned.has(item.key)));
      })
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.addEventListener('open', () => setSseLive(true));
    source.addEventListener('error', () => setSseLive(false));
    return () => {
      source.close();
    };
  }, []);

  const openWhy = (item: InventoryItem): void => {
    const copy = WHY_DRAWER[item.key] ?? {
      problem: item.why,
      benefit: item.why,
      without: '',
    };
    setDrawer({ title: item.name, copy });
  };

  return (
    <DashboardChrome
      projectName={projectName}
      frameworkVersion={frameworkVersion}
      sseLive={sseLive}
    >
      <div className="mx-auto w-full max-w-4xl p-6">
        <h1 className="text-page font-semibold">Setup</h1>
        <WhySentence>{PAGE_WHY.setup}</WhySentence>

        <ProfileSection />
        <CapabilitiesSection />
        <PacksSection />

        <section className="mt-8">
          <h2 className="text-section font-medium">Operations</h2>
          <WhySentence>Run the framework checks without leaving the dashboard.</WhySentence>
          <div className="mt-3 flex flex-col items-start gap-2.5">
            <OpButton
              action="doctor"
              label="Run a health check"
              done="Healthy or not, the verdict is in the audit log."
            />
            <OpButton
              action="refresh-rules"
              label="Refresh the rules"
              done="Refreshed. The rules match your packs again."
            />
            <OpButton
              action="compliance-check"
              label="Check spec compliance"
              done="Checked. The findings are in the audit log."
            />
          </div>
        </section>

        {items !== null && items.length > 0 && (
          <section className="mt-8">
            <h2 className="text-section font-medium">Also in this area</h2>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {items.map((item) => (
                <ItemCard key={item.key} item={item} onWhy={openWhy} />
              ))}
            </div>
          </section>
        )}
      </div>

      {drawer && (
        <WhyDrawer
          title={drawer.title}
          problem={drawer.copy.problem}
          benefit={drawer.copy.benefit}
          without={drawer.copy.without}
          docsHref={drawer.copy.docsHref}
          onClose={() => setDrawer(null)}
        />
      )}
    </DashboardChrome>
  );
}
