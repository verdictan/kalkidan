import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  RangeSet,
  StateEffect,
  StateField,
  type ChangeSet,
  type Extension,
  type Text,
} from '@codemirror/state';
import {
  EditorView,
  GutterMarker,
  drawSelection,
  gutter,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';

/** A change that comes from the disk (a reload), not from the user. */
export const fromDisk = Annotation.define<boolean>();
/** Sets the lines that the agent changed (1-based). */
export const setAgentLines = StateEffect.define<number[]>();
export const languageSlot = new Compartment();

class OwnerMark extends GutterMarker {
  constructor(readonly owner: 'agent' | 'you') {
    super();
  }
  eq(other: OwnerMark) {
    return other.owner === this.owner;
  }
  toDOM() {
    const bar = document.createElement('div');
    bar.className = 'code-owner-bar';
    bar.dataset.owner = this.owner;
    return bar;
  }
}
const agentMark = new OwnerMark('agent');
const yourMark = new OwnerMark('you');

function lineStarts(doc: Text, lines: Iterable<number>, mark: OwnerMark) {
  const ranges = [];
  for (const line of new Set(lines))
    if (line >= 1 && line <= doc.lines) ranges.push(mark.range(doc.line(line).from));
  return RangeSet.of(ranges, true);
}

function hasMark(set: RangeSet<GutterMarker>, at: number) {
  let found = false;
  set.between(at, at, (from) => {
    if (from !== at) return;
    found = true;
    return false;
  });
  return found;
}

/** The lines that a change wrote, in the new document. A new line before or after is not one. */
export function writtenLines(changes: ChangeSet, doc: Text) {
  const lines = new Set<number>();
  changes.iterChanges((_fromA, _toA, fromB, toB, inserted) => {
    let start = doc.lineAt(fromB).number;
    let end = doc.lineAt(toB).number;
    const text = inserted.toString();
    if (start < end && text.startsWith('\n') && fromB === doc.line(start).to) start += 1;
    if (start < end && text.endsWith('\n') && toB === doc.line(end).from) end -= 1;
    for (let line = start; line <= end; line++) lines.add(line);
  });
  return lines;
}

const agentLines = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects)
      if (effect.is(setAgentLines))
        next = lineStarts(transaction.state.doc, effect.value, agentMark);
    return next;
  },
});

const yourLines = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, transaction) {
    if (!transaction.docChanged) return value;
    if (transaction.annotation(fromDisk)) return RangeSet.empty;
    const doc = transaction.state.doc;
    const lines = writtenLines(transaction.changes, doc);
    const starts = new Set([...lines].map((line) => doc.line(line).from));
    return value.map(transaction.changes).update({
      add: [...starts].map((from) => yourMark.range(from)),
      sort: true,
      filter: (from) => !starts.has(from),
    });
  },
});

/** The 1-based lines that you changed in this document. */
export function yourLineNumbers(state: EditorState) {
  const lines: number[] = [];
  state.field(yourLines).between(0, state.doc.length, (from) => {
    lines.push(state.doc.lineAt(from).number);
  });
  return lines;
}

// Who changed each line: a 2px bar at the gutter edge. Your lines win over agent lines. Empty
// lines show no bar.
const ownerGutter = gutter({
  class: 'code-owner-gutter',
  lineMarker(view, line) {
    if (hasMark(view.state.field(yourLines), line.from)) return yourMark;
    if (line.length > 0 && hasMark(view.state.field(agentLines), line.from)) {
      const text = view.state.doc.sliceString(line.from, line.to);
      return text.trim() ? agentMark : null;
    }
    return null;
  },
  lineMarkerChange: (update) =>
    update.docChanged ||
    update.startState.field(agentLines) !== update.state.field(agentLines) ||
    update.startState.field(yourLines) !== update.state.field(yourLines),
  initialSpacer: () => yourMark,
});

const highlight = HighlightStyle.define([
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.moduleKeyword,
      tags.operatorKeyword,
      tags.definitionKeyword,
      tags.modifier,
      tags.bool,
      tags.null,
      tags.self,
      tags.tagName,
    ],
    color: 'var(--code-keyword)',
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp, tags.character, tags.number],
    color: 'var(--code-string)',
  },
  { tag: [tags.comment, tags.meta], color: 'var(--muted-foreground)' },
  { tag: [tags.heading, tags.strong], fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, textDecoration: 'underline' },
  { tag: tags.invalid, color: 'var(--destructive)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12px', backgroundColor: 'var(--background)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '20px' },
  '.cm-content': { padding: '4px 0', caretColor: 'var(--foreground)' },
  '.cm-line': { padding: '0 16px 0 8px' },
  '.cm-gutters': {
    backgroundColor: 'var(--background)',
    border: 'none',
    color: 'var(--chat-faint)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '30px',
    padding: '0 6px 0 4px',
    textAlign: 'right',
  },
  '.code-owner-gutter .cm-gutterElement': { width: '2px', position: 'relative' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--fill, #f5f5f5)' },
  '.cm-activeLineGutter': { color: 'var(--chat-faint)' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '1.5px solid var(--foreground)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    { backgroundColor: 'var(--code-selection)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--fill-strong, #ededed)',
    outline: 'none',
  },
});

/** Calls the handler of the view that owns the update. The editor sets it on each mount. */
export const viewHandlers = new WeakMap<EditorView, (update: ViewUpdate) => void>();
const relay = EditorView.updateListener.of((update) => viewHandlers.get(update.view)?.(update));

const base: Extension = [
  lineNumbers(),
  ownerGutter,
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  drawSelection(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  bracketMatching(),
  highlightActiveLine(),
  syntaxHighlighting(highlight),
  keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
  agentLines,
  yourLines,
  theme,
  relay,
  EditorView.contentAttributes.of({ 'aria-label': 'File text' }),
];

/** A new editor document with the agent lines. */
export function createDocument(text: string, agent: number[]) {
  const state = EditorState.create({ doc: text, extensions: [base, languageSlot.of([])] });
  return state.update({ effects: setAgentLines.of(agent) }).state;
}

/** Replaces the text with the text on disk. Your lines go; the agent lines are new. */
export function reloadDocument(state: EditorState, text: string, agent: number[]) {
  const head = Math.min(state.selection.main.head, text.length);
  return state.update({
    changes: { from: 0, to: state.doc.length, insert: text },
    selection: EditorSelection.cursor(head),
    effects: setAgentLines.of(agent),
    annotations: fromDisk.of(true),
  }).state;
}

/** Puts the cursor at the start of a line (1-based), or at a column of it. */
export function lineSelection(state: EditorState, line: number, column = 1) {
  const target = state.doc.line(Math.max(1, Math.min(line, state.doc.lines)));
  return EditorSelection.single(Math.min(target.from + Math.max(column - 1, 0), target.to));
}
