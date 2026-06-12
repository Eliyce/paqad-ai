import { useCallback, useEffect, useRef, useState } from 'react';
import { parseDocument } from 'yaml';
import type { Document } from 'yaml';

import { DashboardChrome } from '../components/DashboardChrome';
import { EmptyState } from '../components/EmptyState';
import { OwnershipBadge } from '../components/OwnershipBadge';
import { WhySentence } from '../components/WhySentence';
import { WinLine } from '../components/WinLine';
import { fetchDashboard, fetchDeliveryPolicyConfig, putDeliveryPolicy } from '../lib/api';
import type {
  DeliveryPolicyConfigResponse,
  DeliveryPolicyIssue,
  DeliverySectionKey,
} from '../lib/dashboard-types';

/**
 * The delivery-policy editor (issue #146): the RuleBuilder for
 * docs/instructions/workflows/delivery-policy.yaml. Builder edits mutate a
 * YAML document so the user's comments and key order survive; raw mode edits
 * the text directly. Saves run the server's validate-then-write pipeline
 * with optimistic concurrency (409 renders the friendly merge prompt).
 */

const WIN_LINE = 'From now on, releases follow these rules.';

// --- Field model -----------------------------------------------------------

type FieldDef =
  | { key: string; label: string; kind: 'string' | 'boolean' | 'number' | 'list' | 'map' }
  | { key: string; label: string; kind: 'enum'; options: readonly string[] };

const SECTION_ORDER: readonly DeliverySectionKey[] = [
  'ticket',
  'host',
  'branch',
  'commit',
  'pr',
  'ci',
  'intake_decisions',
];

const SECTION_TITLE: Record<DeliverySectionKey, string> = {
  ticket: 'Ticket',
  host: 'Code host',
  branch: 'Branches',
  commit: 'Commits',
  pr: 'Pull requests',
  ci: 'CI',
  intake_decisions: 'Intake decisions',
};

const SECTION_FIELDS: Record<DeliverySectionKey, FieldDef[]> = {
  ticket: [
    {
      key: 'provider',
      label: 'Provider',
      kind: 'enum',
      options: ['jira', 'linear', 'github-issues', 'generic'],
    },
    { key: 'server', label: 'Server', kind: 'string' },
    { key: 'require_ticket', label: 'Require a ticket', kind: 'boolean' },
    {
      key: 'write_back_refined',
      label: 'Write back refinements',
      kind: 'enum',
      options: ['never', 'ask', 'always'],
    },
    { key: 'comment_decisions', label: 'Comment decisions on the ticket', kind: 'boolean' },
  ],
  host: [
    {
      key: 'provider',
      label: 'Provider',
      kind: 'enum',
      options: ['github', 'gitlab', 'bitbucket'],
    },
    { key: 'server', label: 'Server', kind: 'string' },
  ],
  branch: [
    { key: 'template', label: 'Name template', kind: 'string' },
    { key: 'type_map', label: 'Type map', kind: 'map' },
    { key: 'slug_max_length', label: 'Slug max length', kind: 'number' },
    { key: 'base', label: 'Base branch', kind: 'string' },
  ],
  commit: [
    { key: 'template', label: 'Message template', kind: 'string' },
    { key: 'sign_off', label: 'Sign-off', kind: 'boolean' },
  ],
  pr: [
    { key: 'title_template', label: 'Title template', kind: 'string' },
    { key: 'body_template_path', label: 'Body template path', kind: 'string' },
    { key: 'base', label: 'Base branch', kind: 'string' },
    { key: 'draft', label: 'Open as draft', kind: 'boolean' },
    { key: 'reviewers', label: 'Reviewers', kind: 'list' },
    { key: 'labels', label: 'Labels', kind: 'list' },
    { key: 'link_ticket', label: 'Link the ticket', kind: 'boolean' },
    { key: 'transition_on_open', label: 'Ticket transition on open', kind: 'string' },
  ],
  ci: [
    { key: 'gate', label: 'Gate', kind: 'enum', options: ['wait_for_green', 'warn_only', 'off'] },
    { key: 'timeout_minutes', label: 'Timeout minutes', kind: 'number' },
    { key: 'on_red', label: 'On red', kind: 'enum', options: ['stop', 'comment_and_stop'] },
    { key: 'transition_on_green', label: 'Ticket transition on green', kind: 'string' },
  ],
  intake_decisions: [
    { key: 'auto_resolve_from_priors', label: 'Auto resolve from priors', kind: 'boolean' },
    { key: 'auto_resolve_from_rules', label: 'Auto resolve from rules', kind: 'boolean' },
    {
      key: 'confirm_auto_resolutions',
      label: 'Confirm auto resolutions',
      kind: 'enum',
      options: ['always', 'batched', 'never'],
    },
    { key: 'max_options_per_packet', label: 'Max options per packet', kind: 'number' },
    { key: 'fingerprint_scope', label: 'Fingerprint scope', kind: 'list' },
  ],
};

type SectionValues = Record<string, unknown>;

/** The `process.<section>` mapping from doc.toJS(), or an empty record. */
function docSection(docJs: unknown, section: DeliverySectionKey): SectionValues {
  if (docJs && typeof docJs === 'object') {
    const process = (docJs as Record<string, unknown>).process;
    if (process && typeof process === 'object') {
      const sec = (process as Record<string, unknown>)[section];
      if (sec && typeof sec === 'object' && !Array.isArray(sec)) return sec as SectionValues;
    }
  }
  return {};
}

function docEnabled(docJs: unknown): boolean | undefined {
  if (docJs && typeof docJs === 'object') {
    const enabled = (docJs as Record<string, unknown>).enabled;
    if (typeof enabled === 'boolean') return enabled;
  }
  return undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = String(v);
  return out;
}

// --- Plain-language previews -----------------------------------------------

const TICKET_PROVIDER_NAME: Record<string, string> = {
  jira: 'Jira',
  linear: 'Linear',
  'github-issues': 'GitHub Issues',
  generic: 'your tracker',
};

const HOST_PROVIDER_NAME: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
};

function previewFor(section: DeliverySectionKey, eff: SectionValues): string {
  switch (section) {
    case 'ticket': {
      const name = TICKET_PROVIDER_NAME[String(eff.provider)] ?? String(eff.provider);
      const lead =
        eff.require_ticket === true
          ? 'Every delivery starts from a ticket in ' + name + '.'
          : 'Tickets live in ' + name + ' and work can start without one.';
      const writeBack =
        eff.write_back_refined === 'always'
          ? ' Refined tickets are written back automatically.'
          : eff.write_back_refined === 'ask'
            ? ' Paqad asks before writing refinements back.'
            : '';
      return lead + writeBack;
    }
    case 'host': {
      const name = HOST_PROVIDER_NAME[String(eff.provider)] ?? String(eff.provider);
      const server = typeof eff.server === 'string' && eff.server !== '' ? ' at ' + eff.server : '';
      return 'Code lives on ' + name + server + '.';
    }
    case 'branch':
      return 'Branches are named ' + String(eff.template) + ' from ' + String(eff.base) + '.';
    case 'commit': {
      const firstLine = String(eff.template).split('\n')[0] ?? '';
      const signOff = eff.sign_off === true ? ' Every commit carries a sign-off.' : '';
      return 'Commits follow ' + firstLine + '.' + signOff;
    }
    case 'pr': {
      const lead = eff.draft === true ? 'PRs open as drafts' : 'PRs open ready for review';
      const reviewers = asStringArray(eff.reviewers);
      const who = reviewers.length > 0 ? ' Review goes to ' + reviewers.join(', ') + '.' : '';
      const link = eff.link_ticket === true ? ' Each PR links its ticket.' : '';
      return lead + ' against ' + String(eff.base) + '.' + who + link;
    }
    case 'ci': {
      if (eff.gate === 'off') return 'CI does not gate releases.';
      if (eff.gate === 'warn_only') return 'Red CI warns but does not block the release.';
      const onRed =
        eff.on_red === 'comment_and_stop'
          ? ' A red build gets a comment and stops the run.'
          : ' A red build stops the run.';
      return 'Releases wait for green CI before moving on.' + onRed;
    }
    case 'intake_decisions': {
      const priors = eff.auto_resolve_from_priors === true;
      const rules = eff.auto_resolve_from_rules === true;
      if (!priors && !rules) return 'Every intake decision waits for you.';
      if (eff.confirm_auto_resolutions === 'always')
        return 'Known decisions resolve themselves and each one is confirmed with you.';
      if (eff.confirm_auto_resolutions === 'never')
        return 'Known decisions resolve themselves without confirmation.';
      return 'Known decisions resolve themselves and you confirm them in batches.';
    }
  }
}

// --- Small controls ----------------------------------------------------------

const inputStyle: React.CSSProperties = {
  background: 'var(--color-canvas)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-canvas-fg)',
};

function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-caption" style={{ color: 'var(--color-muted)' }}>
      {children}
    </label>
  );
}

function TextField({
  id,
  label,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string | undefined;
  placeholder: string;
  onChange: (next: string | undefined) => void;
}) {
  return (
    <div className="min-w-0">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input
        id={id}
        type="text"
        className="mt-1 w-full rounded-[6px] border px-2 py-1 text-secondary"
        style={inputStyle}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
      />
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: number | undefined;
  placeholder: string;
  onChange: (next: number | undefined) => void;
}) {
  return (
    <div className="min-w-0">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input
        id={id}
        type="number"
        className="mt-1 w-full rounded-[6px] border px-2 py-1 text-secondary"
        style={inputStyle}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(event) => {
          const parsed = Number.parseInt(event.target.value, 10);
          onChange(Number.isFinite(parsed) ? parsed : undefined);
        }}
      />
    </div>
  );
}

function SelectField({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  onChange: (next: string) => void;
}) {
  return (
    <div className="min-w-0">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <select
        id={id}
        className="mt-1 w-full rounded-[6px] border px-2 py-1 text-secondary"
        style={inputStyle}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function BoolToggle({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        className="relative inline-flex h-4.5 w-8 shrink-0 items-center rounded-full"
        style={{
          background: checked ? 'var(--color-accent)' : 'var(--color-border)',
          transition: 'background 200ms ease-out',
        }}
        onClick={() => onChange(!checked)}
      >
        <span
          aria-hidden="true"
          className="inline-block h-3.5 w-3.5 rounded-full"
          style={{
            background: 'var(--color-surface)',
            transform: checked ? 'translateX(15px)' : 'translateX(2px)',
            transition: 'transform 200ms ease-out',
          }}
        />
      </button>
    </div>
  );
}

/** Comma-separated list editor with a local text buffer so typing flows. */
function ListField({
  id,
  label,
  initial,
  onCommit,
}: {
  id: string;
  label: string;
  initial: string[];
  onCommit: (next: string[] | undefined) => void;
}) {
  const [text, setText] = useState(() => initial.join(', '));
  return (
    <div className="min-w-0">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input
        id={id}
        type="text"
        className="mt-1 w-full rounded-[6px] border px-2 py-1 text-secondary"
        style={inputStyle}
        value={text}
        placeholder="comma separated"
        onChange={(event) => {
          setText(event.target.value);
          const parsed = event.target.value
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry !== '');
          onCommit(event.target.value.trim() === '' ? undefined : parsed);
        }}
      />
    </div>
  );
}

/** Key/value rows with add and remove, for branch.type_map. */
function MapField({
  id,
  label,
  initial,
  onCommit,
}: {
  id: string;
  label: string;
  initial: Record<string, string>;
  onCommit: (next: Record<string, string> | undefined) => void;
}) {
  const [rows, setRows] = useState<{ k: string; v: string }[]>(() =>
    Object.entries(initial).map(([k, v]) => ({ k, v })),
  );

  const commit = (next: { k: string; v: string }[]): void => {
    setRows(next);
    const record: Record<string, string> = {};
    for (const row of next) {
      if (row.k.trim() !== '') record[row.k.trim()] = row.v;
    }
    onCommit(Object.keys(record).length > 0 ? record : undefined);
  };

  return (
    <div className="min-w-0 sm:col-span-2">
      <FieldLabel>{label}</FieldLabel>
      <div className="mt-1 flex flex-col gap-1.5">
        {rows.map((row, index) => (
          // Index keys are fine here: rows only append and remove in place.
          // eslint-disable-next-line react/no-array-index-key
          <div key={index} className="flex items-center gap-1.5">
            <input
              type="text"
              aria-label={label + ' key ' + (index + 1)}
              className="w-0 flex-1 rounded-[6px] border px-2 py-1 text-secondary"
              style={inputStyle}
              value={row.k}
              placeholder="ticket type"
              onChange={(event) =>
                commit(rows.map((r, i) => (i === index ? { ...r, k: event.target.value } : r)))
              }
            />
            <input
              type="text"
              aria-label={label + ' value ' + (index + 1)}
              className="w-0 flex-1 rounded-[6px] border px-2 py-1 text-secondary"
              style={inputStyle}
              value={row.v}
              placeholder="branch prefix"
              onChange={(event) =>
                commit(rows.map((r, i) => (i === index ? { ...r, v: event.target.value } : r)))
              }
            />
            <button
              type="button"
              aria-label={'Remove ' + label + ' row ' + (index + 1)}
              className="rounded-[6px] px-1.5 py-1 text-caption"
              style={{ color: 'var(--color-muted)' }}
              onClick={() => commit(rows.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          id={id}
          type="button"
          className="self-start rounded-[6px] px-1.5 py-1 text-caption font-medium"
          style={{ color: 'var(--color-accent)' }}
          onClick={() => commit([...rows, { k: '', v: '' }])}
        >
          Add a row
        </button>
      </div>
    </div>
  );
}

function MaintainedToggle({
  section,
  value,
  onChange,
}: {
  section: DeliverySectionKey;
  value: 'auto' | 'manual';
  onChange: (next: 'auto' | 'manual') => void;
}) {
  const segment = (mode: 'auto' | 'manual', label: string) => {
    const active = value === mode;
    return (
      <button
        type="button"
        aria-pressed={active}
        className="rounded-[6px] px-2 py-1 text-caption font-medium"
        style={{
          color: active ? 'var(--color-accent)' : 'var(--color-muted)',
          background: active ? 'var(--color-canvas)' : 'transparent',
          transition: 'background 200ms ease-out',
        }}
        onClick={() => onChange(mode)}
      >
        {label}
      </button>
    );
  };
  return (
    <div
      role="group"
      aria-label={SECTION_TITLE[section] + ' maintenance'}
      className="flex shrink-0 items-center gap-0.5 rounded-[6px] p-0.5"
      style={{ background: 'color-mix(in srgb, var(--color-border) 40%, transparent)' }}
    >
      {segment('auto', 'Paqad keeps this in sync')}
      {segment('manual', 'You own this')}
    </div>
  );
}

// --- Conflict diff -----------------------------------------------------------

function DiffPane({ title, mine, other }: { title: string; mine: string; other: string }) {
  const lines = mine.split('\n');
  const otherLines = other.split('\n');
  return (
    <div className="min-w-0 flex-1">
      <div className="text-caption font-medium" style={{ color: 'var(--color-muted)' }}>
        {title}
      </div>
      <pre
        className="mt-1 max-h-72 overflow-auto rounded-[6px] p-2 text-caption"
        style={{ background: 'var(--color-canvas)', color: 'var(--color-canvas-fg)' }}
      >
        {lines.map((line, index) => (
          // eslint-disable-next-line react/no-array-index-key
          <div
            key={index}
            style={
              line !== (otherLines[index] ?? '')
                ? { background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }
                : undefined
            }
          >
            {line === '' ? ' ' : line}
          </div>
        ))}
      </pre>
    </div>
  );
}

// --- The view ----------------------------------------------------------------

export function DeliveryPolicyView() {
  const [config, setConfig] = useState<DeliveryPolicyConfigResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [frameworkVersion, setFrameworkVersion] = useState<string | null>(null);
  const [sseLive, setSseLive] = useState(false);

  /** The YAML document being edited; mutated in place, mirrored by docJs. */
  const docRef = useRef<Document | null>(null);
  const [docJs, setDocJs] = useState<unknown>(null);
  /** Bumps to remount field components after external content replacement. */
  const [resetKey, setResetKey] = useState(0);
  const [started, setStarted] = useState(false);

  const [mode, setMode] = useState<'builder' | 'raw'>('builder');
  const [rawText, setRawText] = useState('');
  const [rawError, setRawError] = useState<string | null>(null);

  const [baseHash, setBaseHash] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveIssues, setSaveIssues] = useState<DeliveryPolicyIssue[] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ content: string; hash: string | null } | null>(null);
  const [win, setWin] = useState(false);

  useEffect(() => {
    fetchDeliveryPolicyConfig()
      .then((cfg) => {
        setConfig(cfg);
        setBaseHash(cfg.file.hash);
        if (cfg.file.exists && cfg.file.content !== null) {
          setStarted(true);
          const doc = parseDocument(cfg.file.content);
          if (doc.errors.length > 0) {
            // Broken YAML on disk: the builder cannot represent it, so open
            // in raw mode with the parse message inline.
            setMode('raw');
            setRawText(cfg.file.content);
            setRawError(doc.errors[0]?.message ?? 'YAML parse failed');
          } else {
            docRef.current = doc;
            setDocJs(doc.toJS());
          }
        }
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : String(err));
      });
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

  const touch = (): void => {
    setDirty(true);
    setWin(false);
  };

  const setDocValue = (path: (string | number)[], value: unknown): void => {
    const doc = docRef.current;
    if (!doc) return;
    if (value !== null && typeof value === 'object') {
      doc.setIn(path, doc.createNode(value));
    } else {
      doc.setIn(path, value);
    }
    setDocJs(doc.toJS());
    touch();
  };

  const clearDocValue = (path: (string | number)[]): void => {
    const doc = docRef.current;
    if (!doc) return;
    doc.deleteIn(path);
    setDocJs(doc.toJS());
    touch();
  };

  const startFromDefaults = (): void => {
    if (!config) return;
    const doc = parseDocument(config.defaultsYaml);
    docRef.current = doc;
    setDocJs(doc.toJS());
    setStarted(true);
    setMode('builder');
    setResetKey((key) => key + 1);
    touch();
  };

  /** The exact text a save would write right now. */
  const currentContent = (): string =>
    mode === 'raw' ? rawText : (docRef.current?.toString() ?? '');

  const adoptContent = (content: string, hash: string | null): void => {
    setBaseHash(hash);
    const doc = parseDocument(content);
    if (doc.errors.length > 0) {
      docRef.current = null;
      setMode('raw');
      setRawText(content);
      setRawError(doc.errors[0]?.message ?? 'YAML parse failed');
    } else {
      docRef.current = doc;
      setDocJs(doc.toJS());
      setRawText(content);
      setRawError(null);
    }
    setResetKey((key) => key + 1);
  };

  const save = useCallback(
    (overrideBaseHash?: string | null): void => {
      if (saving) return;
      const content = mode === 'raw' ? rawText : (docRef.current?.toString() ?? '');
      if (!started || content === '') return;
      setSaving(true);
      setSaveIssues(null);
      setSaveError(null);
      putDeliveryPolicy({
        content,
        baseHash: overrideBaseHash !== undefined ? overrideBaseHash : baseHash,
      })
        .then((outcome) => {
          if (outcome.status === 'ok') {
            setBaseHash(outcome.hash);
            setConfig((prev) =>
              prev
                ? {
                    ...prev,
                    resolved: outcome.resolved,
                    file: { ...prev.file, exists: true, content, hash: outcome.hash },
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
    [saving, mode, rawText, started, baseHash],
  );

  const saveRef = useRef(save);
  saveRef.current = save;

  // Cmd+S and Ctrl+S save from anywhere on the page.
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

  const switchToRaw = (): void => {
    setRawText(currentContent());
    setRawError(null);
    setMode('raw');
  };

  const switchToBuilder = (): void => {
    const doc = parseDocument(rawText);
    if (doc.errors.length > 0) {
      setRawError(doc.errors[0]?.message ?? 'YAML parse failed');
      return;
    }
    docRef.current = doc;
    setDocJs(doc.toJS());
    setRawError(null);
    setResetKey((key) => key + 1);
    setMode('builder');
  };

  const resolved = config?.resolved ?? null;
  const enabledEffective = docEnabled(docJs) ?? resolved?.enabled ?? true;

  const renderField = (section: DeliverySectionKey, field: FieldDef) => {
    if (!resolved) return null;
    const docValues = docSection(docJs, section);
    const resolvedSection = resolved.process[section] as unknown as SectionValues;
    const docValue = docValues[field.key];
    const resolvedValue = resolvedSection[field.key];
    const id = 'dp-' + section + '-' + field.key;
    const path = ['process', section, field.key];

    switch (field.kind) {
      case 'string':
        return (
          <TextField
            key={field.key}
            id={id}
            label={field.label}
            value={typeof docValue === 'string' ? docValue : undefined}
            placeholder={String(resolvedValue ?? '')}
            onChange={(next) =>
              next === undefined ? clearDocValue(path) : setDocValue(path, next)
            }
          />
        );
      case 'number':
        return (
          <NumberField
            key={field.key}
            id={id}
            label={field.label}
            value={typeof docValue === 'number' ? docValue : undefined}
            placeholder={String(resolvedValue ?? '')}
            onChange={(next) =>
              next === undefined ? clearDocValue(path) : setDocValue(path, next)
            }
          />
        );
      case 'boolean':
        return (
          <BoolToggle
            key={field.key}
            id={id}
            label={field.label}
            checked={typeof docValue === 'boolean' ? docValue : resolvedValue === true}
            onChange={(next) => setDocValue(path, next)}
          />
        );
      case 'enum':
        return (
          <SelectField
            key={field.key}
            id={id}
            label={field.label}
            value={typeof docValue === 'string' ? docValue : String(resolvedValue ?? '')}
            options={field.options}
            onChange={(next) => setDocValue(path, next)}
          />
        );
      case 'list':
        return (
          <ListField
            key={field.key}
            id={id}
            label={field.label}
            initial={asStringArray(docValue ?? resolvedValue)}
            onCommit={(next) =>
              next === undefined ? clearDocValue(path) : setDocValue(path, next)
            }
          />
        );
      case 'map':
        return (
          <MapField
            key={field.key}
            id={id}
            label={field.label}
            initial={asStringRecord(docValue ?? resolvedValue)}
            onCommit={(next) =>
              next === undefined ? clearDocValue(path) : setDocValue(path, next)
            }
          />
        );
    }
  };

  const builder = resolved && (
    <div key={resetKey} className="mt-6 flex flex-col gap-4">
      <div
        className="flex items-center justify-between gap-3 rounded-[10px] p-4"
        style={{ background: 'var(--color-surface)' }}
      >
        <div className="min-w-0">
          <div className="text-body font-medium">Delivery automation</div>
          <div className="mt-1 text-secondary" style={{ color: 'var(--color-muted)' }}>
            {enabledEffective
              ? 'Paqad follows these rules on every delivery.'
              : 'The delivery workflow is off. Nothing ships automatically.'}
          </div>
        </div>
        <BoolToggle
          id="dp-enabled"
          label="On"
          checked={enabledEffective}
          onChange={(next) => setDocValue(['enabled'], next)}
        />
      </div>

      {SECTION_ORDER.map((section) => {
        const docValues = docSection(docJs, section);
        const resolvedSection = resolved.process[section] as unknown as SectionValues;
        const effective: SectionValues = { ...resolvedSection, ...docValues };
        const maintained =
          docValues.maintained === 'manual' || docValues.maintained === 'auto'
            ? docValues.maintained
            : resolved.process[section].maintained;
        return (
          <div
            key={section}
            className="rounded-[10px] p-4"
            style={{ background: 'var(--color-surface)' }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-body font-medium">{SECTION_TITLE[section]}</div>
              <MaintainedToggle
                section={section}
                value={maintained}
                onChange={(next) => setDocValue(['process', section, 'maintained'], next)}
              />
            </div>
            <div className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2">
              {SECTION_FIELDS[section].map((field) => renderField(section, field))}
            </div>
            <div className="mt-3 text-secondary" style={{ color: 'var(--color-muted)' }}>
              {previewFor(section, effective)}
            </div>
          </div>
        );
      })}
    </div>
  );

  const rawEditor = (
    <div className="mt-6">
      <textarea
        aria-label="Raw delivery policy YAML"
        className="w-full rounded-[10px] p-4 font-mono text-secondary"
        style={{
          background: 'var(--color-surface)',
          color: 'var(--color-canvas-fg)',
          minHeight: 420,
          resize: 'vertical',
        }}
        spellCheck={false}
        value={rawText}
        onChange={(event) => {
          setRawText(event.target.value);
          setRawError(null);
          touch();
        }}
      />
      {rawError && (
        <div className="mt-2 text-secondary" style={{ color: 'var(--color-mod-red)' }}>
          {rawError}
        </div>
      )}
    </div>
  );

  return (
    <DashboardChrome
      projectName={projectName}
      frameworkVersion={frameworkVersion}
      sseLive={sseLive}
    >
      <div className="mx-auto w-full max-w-4xl p-6">
        <div className="flex items-center gap-3">
          <h1 className="text-page font-semibold">Delivery policy</h1>
          <OwnershipBadge managedBy="you" />
        </div>
        <WhySentence>What ships on its own, what waits for you.</WhySentence>

        {loadError && (
          <div
            className="mt-4 rounded-[10px] border p-4 text-secondary"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-mod-red)' }}
          >
            Could not load the policy: {loadError}
          </div>
        )}

        {config && config.warnings.length > 0 && (
          <div
            className="mt-4 rounded-[10px] p-4 text-secondary"
            style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}
          >
            {config.warnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
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
              what="No policy file yet."
              why="Start from the framework defaults and make them yours."
              actionLabel="Start from the defaults"
              onAction={startFromDefaults}
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
                onClick={() => (mode === 'raw' ? switchToBuilder() : switchToRaw())}
              >
                Raw YAML
              </button>
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
                  disabled={saving}
                  className="rounded-[6px] px-3.5 py-1.5 text-secondary font-medium disabled:opacity-50"
                  style={{ background: 'var(--color-accent)', color: '#ffffff' }}
                  onClick={() => save()}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            {mode === 'builder' ? builder : rawEditor}

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
              <div
                className="mt-4 rounded-[10px] p-4"
                style={{ background: 'var(--color-surface)' }}
              >
                <div className="text-body font-medium">
                  This file changed since you opened it, likely by an agent. Review the diff.
                </div>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                  <DiffPane title="Your edit" mine={currentContent()} other={conflict.content} />
                  <DiffPane title="On disk now" mine={conflict.content} other={currentContent()} />
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="rounded-[6px] border px-3 py-1.5 text-secondary font-medium"
                    style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}
                    onClick={() => {
                      adoptContent(conflict.content, conflict.hash);
                      setConflict(null);
                      setDirty(false);
                    }}
                  >
                    Load the latest version
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    className="rounded-[6px] border px-3 py-1.5 text-secondary font-medium disabled:opacity-50"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                    onClick={() => save(conflict.hash)}
                  >
                    Keep mine and overwrite
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardChrome>
  );
}
