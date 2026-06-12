import { useState } from 'react';

/**
 * Renders a JSON schema object's properties as a quiet form (issue #146).
 * Strings become text inputs (selects when the schema has an enum), booleans
 * toggles, numbers number inputs, arrays of strings comma-separated inputs,
 * nested objects fieldsets. Anything the form cannot represent faithfully
 * (records with arbitrary keys, arrays of objects) falls back to a small
 * monospace JSON textarea with parse validation, so no value is ever lost.
 */

type JsonSchema = Record<string, unknown>;

interface Props {
  schema: JsonSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** Unique prefix for input ids; defaults to 'sf'. */
  idPrefix?: string;
}

const inputStyle: React.CSSProperties = {
  background: 'var(--color-canvas)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-canvas-fg)',
};

function schemaType(schema: JsonSchema): string | null {
  const type = schema.type;
  if (typeof type === 'string') return type;
  if (Array.isArray(type) && typeof type[0] === 'string') return type[0];
  return null;
}

function isStringArraySchema(schema: JsonSchema): boolean {
  if (schemaType(schema) !== 'array') return false;
  const items = schema.items;
  if (items === null || typeof items !== 'object' || Array.isArray(items)) return false;
  return schemaType(items as JsonSchema) === 'string';
}

function isFormObjectSchema(schema: JsonSchema): boolean {
  if (schemaType(schema) !== 'object') return false;
  const properties = schema.properties;
  return properties !== null && typeof properties === 'object' && !Array.isArray(properties);
}

function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-caption" style={{ color: 'var(--color-muted)' }}>
      {children}
    </label>
  );
}

/** Comma-separated list editor with a local buffer so typing flows. */
function CommaListField({
  id,
  label,
  initial,
  onCommit,
}: {
  id: string;
  label: string;
  initial: string[];
  onCommit: (next: string[]) => void;
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
          onCommit(
            event.target.value
              .split(',')
              .map((entry) => entry.trim())
              .filter((entry) => entry !== ''),
          );
        }}
      />
    </div>
  );
}

/** JSON textarea fallback for subtrees the form cannot represent. */
function JsonField({
  id,
  label,
  initial,
  onCommit,
}: {
  id: string;
  label: string;
  initial: unknown;
  onCommit: (next: unknown) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(initial ?? null, null, 2));
  const [parseError, setParseError] = useState(false);
  return (
    <div className="min-w-0 sm:col-span-2">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <textarea
        id={id}
        className="mt-1 w-full rounded-[6px] border p-2 font-mono text-caption"
        style={{ ...inputStyle, minHeight: 96, resize: 'vertical' }}
        spellCheck={false}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          try {
            onCommit(JSON.parse(event.target.value));
            setParseError(false);
          } catch {
            setParseError(true);
          }
        }}
      />
      {parseError && (
        <div className="mt-1 text-caption" style={{ color: 'var(--color-mod-red)' }}>
          Not valid JSON yet. The last valid value is kept until this parses.
        </div>
      )}
    </div>
  );
}

function Field({
  id,
  label,
  schema,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  schema: JsonSchema;
  value: unknown;
  onCommit: (next: unknown) => void;
}) {
  const type = schemaType(schema);

  if (type === 'string' && Array.isArray(schema.enum)) {
    const options = (schema.enum as unknown[]).map((entry) => String(entry));
    return (
      <div className="min-w-0">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <select
          id={id}
          className="mt-1 w-full rounded-[6px] border px-2 py-1 text-secondary"
          style={inputStyle}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onCommit(event.target.value)}
        >
          {typeof value !== 'string' && <option value="">(unset)</option>}
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (type === 'string') {
    return (
      <div className="min-w-0">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <input
          id={id}
          type="text"
          className="mt-1 w-full rounded-[6px] border px-2 py-1 text-secondary"
          style={inputStyle}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onCommit(event.target.value)}
        />
      </div>
    );
  }

  if (type === 'boolean') {
    const checked = value === true;
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
          onClick={() => onCommit(!checked)}
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

  if (type === 'number' || type === 'integer') {
    return (
      <div className="min-w-0">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <input
          id={id}
          type="number"
          className="mt-1 w-full rounded-[6px] border px-2 py-1 text-secondary"
          style={inputStyle}
          value={typeof value === 'number' ? value : ''}
          onChange={(event) => {
            const parsed =
              type === 'integer'
                ? Number.parseInt(event.target.value, 10)
                : Number.parseFloat(event.target.value);
            if (Number.isFinite(parsed)) onCommit(parsed);
          }}
        />
      </div>
    );
  }

  if (isStringArraySchema(schema)) {
    return (
      <CommaListField
        id={id}
        label={label}
        initial={Array.isArray(value) ? value.map((entry) => String(entry)) : []}
        onCommit={onCommit}
      />
    );
  }

  if (isFormObjectSchema(schema)) {
    const record =
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    return (
      <fieldset className="min-w-0 sm:col-span-2 rounded-[10px] p-4" style={{ background: 'var(--color-canvas)' }}>
        <legend className="text-section font-medium px-1">{label}</legend>
        <SchemaForm
          schema={schema}
          value={record}
          onChange={(next) => onCommit(next)}
          idPrefix={id}
        />
      </fieldset>
    );
  }

  // Records with arbitrary keys, arrays of objects, unions: raw JSON.
  return <JsonField id={id} label={label} initial={value} onCommit={onCommit} />;
}

export function SchemaForm({ schema, value, onChange, idPrefix = 'sf' }: Props) {
  const properties =
    schema.properties !== null &&
    typeof schema.properties === 'object' &&
    !Array.isArray(schema.properties)
      ? (schema.properties as Record<string, unknown>)
      : {};

  const entries = Object.entries(properties).filter(
    (entry): entry is [string, JsonSchema] =>
      entry[1] !== null && typeof entry[1] === 'object' && !Array.isArray(entry[1]),
  );

  return (
    <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
      {entries.map(([key, propSchema]) => (
        <Field
          key={key}
          id={idPrefix + '-' + key}
          label={key.replace(/_/g, ' ')}
          schema={propSchema}
          value={value[key]}
          onCommit={(next) => onChange({ ...value, [key]: next })}
        />
      ))}
    </div>
  );
}
