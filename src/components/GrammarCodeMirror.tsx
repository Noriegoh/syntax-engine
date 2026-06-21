import React, { useMemo, useState, useRef, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { autocompletion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { EditorView, hoverTooltip, Decoration, DecorationSet, ViewPlugin } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { linter, lintGutter, Diagnostic as CMLintDiagnostic } from '@codemirror/lint';
import * as acorn from 'acorn';
import { SuggestionItem, GRAMMAR_SUGGESTIONS, SyntaxElement } from '../lib/syntax-element';

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
        detail: s.type,
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
  diagnostics?: any[];
  codeError?: string | null;
}

export const GrammarCodeMirror: React.FC<GrammarCodeMirrorProps> = React.memo(({
  value,
  onChange,
  style,
  className,
  isGrammarTab = false,
  diagnostics = [],
  codeError = null
}) => {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    word: string;
    pos: number;
  } | null>(null);

  const [referencesResult, setReferencesResult] = useState<{
    word: string;
    refs: Array<{ line: number; text: string; from: number; to: number }>;
  } | null>(null);

  const editorViewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    window.addEventListener('contextmenu', closeMenu);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('contextmenu', closeMenu);
    };
  }, [contextMenu]);

  const findReferences = (word: string) => {
    if (!word || !editorViewRef.current) return;
    const view = editorViewRef.current;
    const docText = view.state.doc.toString();
    const regex = new RegExp(`\\b${word}\\b`, 'g');
    const refs: Array<{ line: number; text: string; from: number; to: number }> = [];
    let match;
    while ((match = regex.exec(docText)) !== null) {
      try {
        const lineObj = view.state.doc.lineAt(match.index);
        refs.push({
          line: lineObj.number,
          text: lineObj.text,
          from: match.index,
          to: match.index + word.length
        });
      } catch (e) {
        // guard against out-of-bounds
      }
    }
    setReferencesResult({ word, refs });
  };

  const jumpToRef = (from: number, to: number) => {
    const view = editorViewRef.current;
    if (!view) return;
    view.dispatch({
      selection: { anchor: from, head: to },
      scrollIntoView: true
    });
    view.focus();
  };

  const getWordAtCursor = (): { word: string; from: number; to: number } | null => {
    const view = editorViewRef.current;
    if (!view) return null;
    const { from, to } = view.state.selection.main;
    if (from !== to) {
      const word = view.state.sliceDoc(from, to).trim();
      if (word && /^\w+$/.test(word)) {
        return { word, from, to };
      }
    }
    const pos = from;
    try {
      const line = view.state.doc.lineAt(pos);
      let start = pos;
      let end = pos;
      while (start > line.from && /\w/.test(view.state.sliceDoc(start - 1, start))) start--;
      while (end < line.to && /\w/.test(view.state.sliceDoc(end, end + 1))) end++;
      if (start === end) return null;
      const word = view.state.sliceDoc(start, end);
      return { word, from: start, to: end };
    } catch (_) {
      return null;
    }
  };

  const triggerChangeAllOccurrences = () => {
    const wordObj = getWordAtCursor();
    if (!wordObj) return;
    const { word } = wordObj;
    const view = editorViewRef.current;
    if (!view) return;
    const ranges: any[] = [];
    let match;
    const regex = new RegExp(`\\b${word}\\b`, 'g');
    const dText = view.state.doc.toString();
    while ((match = regex.exec(dText)) !== null) {
      ranges.push(EditorSelection.range(match.index, match.index + word.length));
    }
    if (ranges.length > 0) {
      view.dispatch({
        selection: EditorSelection.create(ranges)
      });
      view.focus();
    }
  };

  const triggerFindAllReferences = () => {
    const wordObj = getWordAtCursor();
    if (!wordObj) return;
    findReferences(wordObj.word);
  };

  const handleKeyDownAtReact = (e: React.KeyboardEvent) => {
    const isCtrlOrMeta = e.ctrlKey || e.metaKey;
    if (isCtrlOrMeta && e.key === 'F2') {
      e.preventDefault();
      triggerChangeAllOccurrences();
    } else if (e.key === 'F12') {
      e.preventDefault();
      triggerFindAllReferences();
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const view = editorViewRef.current;
    if (!view) return;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos === null) return;
    try {
      const line = view.state.doc.lineAt(pos);
      let start = pos;
      let end = pos;
      while (start > line.from && /\w/.test(view.state.sliceDoc(start - 1, start))) start--;
      while (end < line.to && /\w/.test(view.state.sliceDoc(end, end + 1))) end++;
      if (start < end) {
        const word = view.state.sliceDoc(start, end);
        view.dispatch({
          selection: { anchor: start, head: end }
        });
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          word,
          pos
        });
      } else {
        setContextMenu(null);
      }
    } catch (_) {
      setContextMenu(null);
    }
  };

  const extensions = useMemo(() => {
    const list: any[] = [
      javascript(),
      ...grammarBaseTheme
    ];

    // Ref saver plugin
    list.push(
      ViewPlugin.fromClass(class {
        constructor(public view: EditorView) {
          editorViewRef.current = view;
        }
        destroy() {
          if (editorViewRef.current === this.view) {
            editorViewRef.current = null;
          }
        }
      })
    );
    if (isGrammarTab) {
      list.push(lintGutter());
      list.push(
        autocompletion({
          override: [createGrammarCompletionSource()],
          defaultKeymap: true,
        })
      );

      // Interactive Hover Tooltips with method descriptions and Go to Definition notices
      list.push(
        hoverTooltip((view, pos, side) => {
          const { from, to, text } = view.state.doc.lineAt(pos);
          let start = pos;
          let end = pos;
          while (start > from && /\w/.test(view.state.sliceDoc(start - 1, start))) start--;
          while (end < to && /\w/.test(view.state.sliceDoc(end, end + 1))) end++;
          if (start === end) return null;
          const word = view.state.sliceDoc(start, end);

          // 1. Check if word matches a built-in grammar suggestion
          const suggestion = GRAMMAR_SUGGESTIONS.find(s => s.label === word);
          if (suggestion) {
            return {
              pos: start,
              end: end,
              above: true,
              create: () => {
                const dom = document.createElement("div");
                dom.innerHTML = `
                  <div class="cm-hover-header">
                    <span class="text-indigo-400 font-mono">${suggestion.label}</span>
                    <span class="cm-hover-type">${suggestion.type}</span>
                  </div>
                  <div class="cm-hover-body">${suggestion.description}</div>
                `;
                return { dom };
              }
            };
          }

          // 2. Check if the hovered word is a defined variable/element in the blueprint
          const docText = view.state.doc.toString();
          const regex = new RegExp(`(?:const|let|var|function|class)\\s+${word}\\b`);
          const definitionMatch = docText.match(regex);
          if (definitionMatch) {
            return {
              pos: start,
              end: end,
              above: true,
              create: () => {
                const dom = document.createElement("div");
                dom.innerHTML = `
                  <div class="cm-hover-header">
                    <span class="text-sky-400 font-mono">${word}</span>
                    <span class="cm-hover-type">variable</span>
                  </div>
                  <div class="cm-hover-body">SyntaxElement reference or local variable defined in this grammar blueprint.</div>
                  <div class="cm-hover-shortcut">⚡ Cmd+Click / Ctrl+Click to jump to definition</div>
                `;
                return { dom };
              }
            };
          }

          return null;
        })
      );

      // Interactive Go-to-Definition Event Handlers for Ctrl+Click / Cmd+Click on variables
      list.push(
        EditorView.domEventHandlers({
          click(event, view) {
            if (event.ctrlKey || event.metaKey) {
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos === null) return;
              
              const line = view.state.doc.lineAt(pos);
              let start = pos;
              let end = pos;
              while (start > line.from && /\w/.test(view.state.sliceDoc(start - 1, start))) start--;
              while (end < line.to && /\w/.test(view.state.sliceDoc(end, end + 1))) end++;
              if (start === end) return;
              const word = view.state.sliceDoc(start, end);

              const docText = view.state.doc.toString();
              const regex = new RegExp(`(?:const|let|var|function|class)\\s+${word}\\b`);
              const match = docText.match(regex);
              if (match && typeof match.index === 'number') {
                view.dispatch({
                  selection: { anchor: match.index, head: match.index },
                  scrollIntoView: true
                });
                event.preventDefault();
                event.stopPropagation();
              }
            }
          }
        })
      );

      // Interactive IDE-style Cmd/Ctrl Goto Definition underline and cursor pointer support
      list.push(
        ViewPlugin.fromClass(class {
          decorations: DecorationSet;
          mousePos: number | null = null;
          modifierDown = false;
          activeRange: { start: number, end: number } | null = null;

          constructor(public view: EditorView) {
            this.decorations = Decoration.none;
            window.addEventListener('keydown', this.handleKeyDown);
            window.addEventListener('keyup', this.handleKeyUp);
            view.dom.addEventListener('mousemove', this.handleMouseMove);
            view.dom.addEventListener('mouseleave', this.handleMouseLeave);
          }

          destroy() {
            window.removeEventListener('keydown', this.handleKeyDown);
            window.removeEventListener('keyup', this.handleKeyUp);
            this.view.dom.removeEventListener('mousemove', this.handleMouseMove);
            this.view.dom.removeEventListener('mouseleave', this.handleMouseLeave);
          }

          handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Control' || e.key === 'Meta') {
              this.modifierDown = true;
              this.updateDecorations();
            }
          };

          handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === 'Control' || e.key === 'Meta') {
              this.modifierDown = false;
              this.updateDecorations();
            }
          };

          handleMouseMove = (e: MouseEvent) => {
            const isMod = e.ctrlKey || e.metaKey;
            this.modifierDown = isMod;
            const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
            this.mousePos = pos;
            this.updateDecorations();
          };

          handleMouseLeave = () => {
            this.mousePos = null;
            this.updateDecorations();
          };

          updateDecorations() {
            let nextRange: { start: number, end: number } | null = null;
            let decos: any[] = [];
            if (this.modifierDown && this.mousePos !== null) {
              const state = this.view.state;
              if (this.mousePos >= 0 && this.mousePos <= state.doc.length) {
                try {
                  const line = state.doc.lineAt(this.mousePos);
                  let start = this.mousePos;
                  let end = this.mousePos;
                  while (start > line.from && /\w/.test(state.sliceDoc(start - 1, start))) start--;
                  while (end < line.to && /\w/.test(state.sliceDoc(end, end + 1))) end++;

                  if (start < end) {
                    const word = state.sliceDoc(start, end);
                    // Match variables/classes/functions definition
                    const docText = state.doc.toString();
                    const regex = new RegExp(`(?:const|let|var|function|class)\\s+${word}\\b`);
                    if (regex.test(docText)) {
                      nextRange = { start, end };
                      decos.push(Decoration.mark({
                        class: 'cm-goto-link'
                      }).range(start, end));
                    }
                  }
                } catch (err) {
                  // Guard against any out-of-bounds line error
                }
              }
            }

            const changed = (!this.activeRange && nextRange) ||
                            (this.activeRange && !nextRange) ||
                            (this.activeRange && nextRange && (this.activeRange.start !== nextRange.start || this.activeRange.end !== nextRange.end));

            if (changed) {
              this.activeRange = nextRange;
              this.decorations = Decoration.set(decos);
              this.view.dispatch({});
            }
          }
        }, {
          decorations: v => v.decorations
        })
      );

      // Simple, elegant, high-performance AST linter to provide error/warning squiggles
      list.push(
        linter((view) => {
          const code = view.state.doc.toString();
          const cmDiagnostics: CMLintDiagnostic[] = [];

          let parsedAst: any = null;
          try {
            parsedAst = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
          } catch (acornErr: any) {
            if (acornErr && typeof acornErr.pos === 'number') {
              const from = Math.max(0, Math.min(acornErr.pos, code.length));
              let to = from + 1;
              const line = view.state.doc.lineAt(from);
              to = Math.min(to, line.to);
              if (to <= from) to = from + 1;
              to = Math.min(to, code.length);

              const cleanMsg = acornErr.message ? acornErr.message.replace(/\s*\(\d+:\d+\)\s*$/, '') : "Syntax Error";
              cmDiagnostics.push({
                from,
                to,
                severity: "error",
                message: cleanMsg
              });
            }
          }

          // Parse external codeError from prop to display runtime/reference/acorn errors as squiggles
          if (codeError) {
            let errorLineNum = -1;
            let errorColNum = -1;

            const lineColMatch = codeError.match(/\(Line\s+(\d+),\s+Col\s+(\d+)\)/i);
            const lineOnlyMatch = codeError.match(/\(Line\s+(\d+)\)/i);

            if (lineColMatch) {
              errorLineNum = parseInt(lineColMatch[1], 10);
              errorColNum = parseInt(lineColMatch[2], 10);
            } else if (lineOnlyMatch) {
              errorLineNum = parseInt(lineOnlyMatch[1], 10);
            }

            if (errorLineNum >= 1) {
              try {
                const lineCount = view.state.doc.lines;
                const safeLineNum = Math.min(errorLineNum, lineCount);
                const lineObj = view.state.doc.line(safeLineNum);
                
                const colShift = errorColNum >= 1 ? Math.min(errorColNum - 1, lineObj.length) : 0;
                const from = lineObj.from + colShift;
                let to = lineObj.to;
                if (errorColNum >= 1) {
                  const lineText = lineObj.text.substring(colShift);
                  const wordMatch = lineText.match(/^[a-zA-Z_0-9]+/);
                  if (wordMatch) {
                    to = from + wordMatch[0].length;
                  } else {
                    to = Math.min(from + 1, lineObj.to);
                  }
                }
                if (to <= from) {
                  to = from + 1;
                }
                to = Math.min(to, view.state.doc.length);

                // Make sure we don't duplicate if Acorn/grammar base already caught it
                const isDuplicate = cmDiagnostics.some(d => Math.abs(d.from - from) <= 3);
                if (!isDuplicate) {
                  const cleanMsg = codeError.replace(/\s*\(\s*Line\s+\d+.*$/, '');
                  cmDiagnostics.push({
                    from,
                    to,
                    severity: "error",
                    message: `${cleanMsg} (Grammar Runtime Error)`
                  });
                }
              } catch (err) {
                console.error("Failed to map codeError to editor position", err);
              }
            }
          }

          if (parsedAst && diagnostics && diagnostics.length > 0) {
            const elementPositions = new Map<string, { start: number, end: number }>();

            const traverseAST = (node: any) => {
              if (!node || typeof node !== 'object') return;

              // Match Element("Name") or SyntaxElement("Name")
              if (
                node.type === 'CallExpression' &&
                node.callee &&
                node.callee.type === 'Identifier' &&
                (node.callee.name === 'Element' || node.callee.name === 'SyntaxElement')
              ) {
                if (node.arguments && node.arguments[0] && node.arguments[0].type === 'Literal') {
                  const val = node.arguments[0].value;
                  if (typeof val === 'string') {
                    elementPositions.set(val, { start: node.start, end: node.end });
                  }
                }
              }

              // Match variable declarators
              if (node.type === 'VariableDeclarator' && node.id && node.id.type === 'Identifier') {
                const varName = node.id.name;
                elementPositions.set(varName, { start: node.id.start, end: node.id.end });
              }

              // Traverse properties
              for (const key in node) {
                if (Object.prototype.hasOwnProperty.call(node, key)) {
                  const child = node[key];
                  if (Array.isArray(child)) {
                    for (const item of child) {
                      traverseAST(item);
                    }
                  } else if (child && typeof child === 'object' && typeof child.type === 'string') {
                    traverseAST(child);
                  }
                }
              }
            };

            traverseAST(parsedAst);

            // Connect high-level semantic grammar diagnostics
            diagnostics.forEach(diag => {
              if (diag.nodeName) {
                const pos = elementPositions.get(diag.nodeName);
                if (pos) {
                  const from = Math.max(0, Math.min(pos.start, code.length));
                  const to = Math.max(from, Math.min(pos.end, code.length));
                  const message = diag.suggestion 
                    ? `${diag.message}\nSuggestion: ${diag.suggestion}`
                    : diag.message;

                  cmDiagnostics.push({
                    from,
                    to,
                    severity: diag.type === 'error' ? 'error' : 'warning',
                    message: message
                  });
                }
              }
            });
          }

          return cmDiagnostics;
        })
      );
    }
    return list;
  }, [isGrammarTab, diagnostics, codeError]);

  return (
    <div 
      className={`relative w-full h-full flex flex-col ${className || ''}`} 
      style={style}
      onKeyDown={handleKeyDownAtReact}
      onContextMenu={handleContextMenu}
    >
      <div className="flex-1 w-full min-h-0 overflow-auto custom-scrollbar">
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
            allowMultipleSelections: true,
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

      {/* References bottom drawer */}
      {referencesResult && (
        <div className="bg-[#0b0f19] border-t border-slate-700/60 h-[190px] flex flex-col z-[50]" id="references-panel">
          <div className="flex items-center justify-between px-4 py-2 bg-[#0e1624] border-b border-slate-800/80">
            <div className="flex items-center gap-2 text-slate-300 pr-4">
              <span className="text-emerald-400 font-semibold text-xs py-0.5 px-2 bg-emerald-500/10 rounded-md">🔗 References</span>
              <span className="text-[12px] font-medium font-sans">
                Found {referencesResult.refs.length} occurrences of <code className="text-pink-400 font-mono bg-slate-800 py-0.5 px-1 rounded">"{referencesResult.word}"</code>
              </span>
            </div>
            <button 
              onClick={() => setReferencesResult(null)}
              className="p-1 hover:bg-slate-800 rounded-md text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              title="Close Panel"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
            {referencesResult.refs.length === 0 ? (
              <div className="text-slate-500 text-xs text-center py-6 font-sans">No occurrences found.</div>
            ) : (
              referencesResult.refs.map((ref, i) => (
                <div 
                  key={i}
                  onClick={() => jumpToRef(ref.from, ref.to)}
                  className="flex items-center gap-4 px-3 py-1.5 hover:bg-slate-800/70 rounded-md cursor-pointer transition-colors group select-none text-[12px]"
                >
                  <span className="text-[11px] font-mono text-indigo-400 bg-indigo-500/5 px-2 py-0.5 rounded border border-indigo-500/10 min-w-[50px] text-center font-semibold">
                    Line {ref.line}
                  </span>
                  <div className="font-mono text-slate-300 truncate max-w-[80vw] flex-1">
                    {/* Highlight the match in line preview */}
                    {(() => {
                      const idx = ref.text.indexOf(referencesResult.word);
                      if (idx === -1) return <span>{ref.text}</span>;
                      const before = ref.text.substring(0, idx);
                      const matchStr = ref.text.substring(idx, idx + referencesResult.word.length);
                      const after = ref.text.substring(idx + referencesResult.word.length);
                      return (
                        <span className="truncate">
                          <span className="opacity-60">{before}</span>
                          <span className="text-amber-300 font-bold bg-amber-500/15 px-1 py-0.5 rounded border border-amber-500/20">{matchStr}</span>
                          <span className="opacity-60">{after}</span>
                        </span>
                      );
                    })()}
                  </div>
                  <span className="text-[10px] text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity font-sans flex items-center gap-1">
                    Jump to <span>➔</span>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Floating custom context menu */}
      {contextMenu && (
        <div 
          className="fixed z-[99999] bg-[#0b0f19] border border-slate-700/60 rounded-xl shadow-2xl py-1 px-1 w-56 text-slate-200 text-[11.5px] font-sans ring-1 ring-black/40 backdrop-blur-md"
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
        >
          <div className="px-3 py-1.5 text-[9.5px] uppercase font-bold text-slate-500 tracking-wider select-none border-b border-slate-800/80 mb-1 font-mono flex items-center justify-between">
            <span>Identifier</span>
            <span className="text-indigo-400 font-semibold">{contextMenu.word}</span>
          </div>
          
          <button
            onClick={() => {
              const docText = editorViewRef.current?.state.doc.toString() || "";
              const regex = new RegExp(`(?:const|let|var|function|class)\\s+${contextMenu.word}\\b`);
              const match = docText.match(regex);
              if (match && typeof match.index === 'number') {
                editorViewRef.current?.dispatch({
                  selection: { anchor: match.index, head: match.index },
                  scrollIntoView: true
                });
                editorViewRef.current?.focus();
              }
              setContextMenu(null);
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-slate-800/80 rounded-md text-left transition-all duration-100 font-medium cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <span>⚡</span> Go to Definition
            </span>
            <span className="text-[9.5px] text-slate-500 bg-slate-800/80 px-1 rounded-md font-mono">Ctrl+Click</span>
          </button>

          <button
            onClick={() => {
              findReferences(contextMenu.word);
              setContextMenu(null);
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-slate-800/80 rounded-md text-left transition-all duration-100 font-medium cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <span>🔍</span> Find All References
            </span>
            <span className="text-[9.5px] text-slate-500 bg-slate-800/80 px-1 rounded-md font-mono">F12</span>
          </button>

          <button
            onClick={() => {
              const ranges: any[] = [];
              let match;
              const regex = new RegExp(`\\b${contextMenu.word}\\b`, 'g');
              const dText = editorViewRef.current?.state.doc.toString() || "";
              while ((match = regex.exec(dText)) !== null) {
                ranges.push(EditorSelection.range(match.index, match.index + contextMenu.word.length));
              }
              if (ranges.length > 0) {
                editorViewRef.current?.dispatch({
                  selection: EditorSelection.create(ranges)
                });
                editorViewRef.current?.focus();
              }
              setContextMenu(null);
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-slate-800/80 rounded-md text-left transition-all duration-100 font-medium cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <span>✏️</span> Change All Occurrences
            </span>
            <span className="text-[9.5px] text-slate-500 bg-slate-800/80 px-1 rounded-md font-mono">Ctrl+F2</span>
          </button>
        </div>
      )}
    </div>
  );
});

GrammarCodeMirror.displayName = "GrammarCodeMirror";
