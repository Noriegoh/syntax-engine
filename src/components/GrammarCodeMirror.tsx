import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { autocompletion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { SuggestionItem, GRAMMAR_SUGGESTIONS } from '../lib/syntax-element';

export const grammarTheme = EditorView.theme({
  "&": {
    color: "#e2e8f0",
    backgroundColor: "transparent"
  },
  ".cm-content": {
    caretColor: "#6366f1"
  },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "#6366f1"
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "rgba(99, 102, 241, 0.25)"
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "#475569",
    border: "none"
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(255, 255, 255, 0.04)"
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(255, 255, 255, 0.04)"
  }
});

export const grammarHighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: '#64748b', fontStyle: 'italic' },
  { tag: t.definition(t.name), color: '#38bdf8' }, // sky-400
  { tag: t.variableName, color: '#7dd3fc' }, // sky-300
  { tag: t.keyword, color: '#f472b6', fontWeight: 'bold' }, // pink-400
  { tag: t.string, color: '#fcd34d' }, // amber-300
  { tag: t.number, color: '#22d3ee' }, // cyan-400
  { tag: t.function(t.variableName), color: '#fb923c' }, // orange-400
  { tag: t.propertyName, color: '#34d399' }, // emerald-400
  { tag: t.operator, color: '#818cf8' }, // indigo-400
]);

const grammarBaseTheme = [grammarTheme, syntaxHighlighting(grammarHighlightStyle)];

function createGrammarCompletionSource(): (context: CompletionContext) => CompletionResult | null {
  return (context: CompletionContext): CompletionResult | null => {
    // Find current word before cursor
    const word = context.matchBefore(/\.?[a-zA-Z0-9_$]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;

    const text = word.text;
    const isMethodOnly = text.startsWith('.');
    const searchWord = isMethodOnly ? text.slice(1) : text;
    const from = isMethodOnly ? word.from + 1 : word.from;

    // Dynamically retrieve custom variables defined in this file
    const docText = context.state.doc.toString();
    const customVars: any[] = [];
    try {
      const matchVars = [...docText.matchAll(/(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=/g)];
      const uniqueVars = Array.from(new Set(matchVars.map(m => m[1])));
      uniqueVars.forEach(v => {
        customVars.push({
          label: v,
          type: "variable",
          detail: "SyntaxElement"
        });
      });
    } catch (_) {}

    const rawSuggestions = [
      ...GRAMMAR_SUGGESTIONS.map(s => ({
        label: s.label,
        type: s.type === 'method' ? 'function' : s.type === 'class' ? 'class' : 'keyword',
        info: s.description,
        apply: s.insertText
      })),
      ...customVars
    ];

    let options = rawSuggestions;
    if (isMethodOnly) {
      options = options.filter(o => o.type === 'function');
    }

    // Filter suggestions matching the typed prefix
    options = options.filter(o => o.label.toLowerCase().startsWith(searchWord.toLowerCase()));

    return {
      from: from,
      options: options
    };
  };
}

interface GrammarCodeMirrorProps {
  value: string;
  onChange: (value: string) => void;
  style?: React.CSSProperties;
  className?: string;
  isGrammarTab?: boolean;
}

export const GrammarCodeMirror: React.FC<GrammarCodeMirrorProps> = React.memo(({
  value,
  onChange,
  style,
  className,
  isGrammarTab = false
}) => {
  const extensions = useMemo(() => {
    const list: any[] = [
      javascript(),
      ...grammarBaseTheme
    ];
    if (isGrammarTab) {
      list.push(
        autocompletion({
          override: [createGrammarCompletionSource()],
          defaultKeymap: true,
        })
      );
    }
    return list;
  }, [isGrammarTab]);

  return (
    <div className={`w-full h-full text-[13px] font-mono leading-relaxed overflow-auto custom-scrollbar ${className || ''}`} style={style}>
      <CodeMirror
        value={value}
        height="100%"
        theme="none"
        extensions={extensions}
        onChange={(val) => onChange(val)}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          dropCursor: true,
          allowMultipleSelections: false,
          indentOnInput: true,
          syntaxHighlighting: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: isGrammarTab,
          highlightActiveLineGutter: true,
          highlightActiveLine: true,
        }}
        className="h-full"
      />
    </div>
  );
});

GrammarCodeMirror.displayName = "GrammarCodeMirror";
