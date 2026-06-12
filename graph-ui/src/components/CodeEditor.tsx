import { markdown } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/lang-yaml';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { useEffect, useRef } from 'react';
import { EditorView, minimalSetup } from 'codemirror';

export type CodeEditorLang = 'markdown' | 'yaml' | 'plain';

interface Props {
  value: string;
  onChange: (next: string) => void;
  lang: CodeEditorLang;
  ariaLabel: string;
  minHeight?: number;
}

/** Quiet CodeMirror theme matching the css vars: no line numbers, no chrome. */
const quietTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-canvas-fg)',
    fontSize: '13px',
    borderRadius: '10px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
    padding: '14px 16px',
    caretColor: 'var(--color-canvas-fg)',
  },
  '.cm-cursor': { borderLeftColor: 'var(--color-canvas-fg)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 18%, transparent)',
  },
  '.cm-scroller': { borderRadius: '10px' },
});

function langExtension(lang: CodeEditorLang): Extension {
  if (lang === 'markdown') return markdown();
  if (lang === 'yaml') return yaml();
  return [];
}

/**
 * Thin CodeMirror 6 wrapper for the issue #146 editors. Controlled-ish:
 * external `value` changes replace the document, local typing flows through
 * `onChange` without re-creating the view.
 */
export function CodeEditor({ value, onChange, lang, ariaLabel, minHeight = 320 }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  /** The last value this editor emitted, to ignore echo updates. */
  const emittedRef = useRef(value);

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          minimalSetup,
          EditorView.lineWrapping,
          quietTheme,
          langCompartment.current.of(langExtension(lang)),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const next = update.state.doc.toString();
            emittedRef.current = next;
            onChangeRef.current(next);
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The view is created once; value and lang sync through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: langCompartment.current.reconfigure(langExtension(lang)) });
  }, [lang]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === emittedRef.current) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    emittedRef.current = value;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return (
    <div
      ref={hostRef}
      role="textbox"
      aria-label={ariaLabel}
      className="rounded-[10px]"
      style={{ background: 'var(--color-surface)', minHeight }}
    />
  );
}
