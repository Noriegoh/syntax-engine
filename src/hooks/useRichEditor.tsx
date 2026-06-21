import React, { useState, useRef, useEffect } from 'react';
import { EditorView, hoverTooltip, Decoration, DecorationSet, ViewPlugin } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';

// Definition interfaces for custom tooltips
export interface RichTooltipData {
  header: string;
  type: string;
  body: string;
  shortcut?: string;
  headerClass?: string;
}

export interface UseRichEditorOptions {
  /**
   * Custom detector to determine if a word at document position is a definition.
   * Fallback: regex search matching let/const/var/function/class variable names.
   */
  isDefinition?: (word: string, docText: string, pos: number) => boolean;

  /**
   * Custom logic when Ctrl+Click or Go To Definition is triggered.
   * Return true to indicate the Goto action was handled.
   */
  onGotoDefinition?: (word: string, pos: number, view: EditorView) => boolean;

  /**
   * Custom supplier for hover tooltips.
   */
  getCustomTooltip?: (word: string, pos: number, view: EditorView) => RichTooltipData | null;

  /**
   * List of built-in suggestion items for syntax tooltips (e.g., GRAMMAR_SUGGESTIONS).
   */
  builtinSuggestions?: Array<{
    label: string;
    type: string;
    description: string;
  }>;
}

export interface ContextMenuState {
  x: number;
  y: number;
  word: string;
  pos: number;
}

export interface ReferenceItem {
  line: number;
  text: string;
  from: number;
  to: number;
}

export interface ReferencesResultState {
  word: string;
  refs: ReferenceItem[];
}

/**
 * A highly decoupled, premium custom hook that equips any CodeMirror editor
 * with modern IDE features: Hover Tooltips, Go to Definition (Ctrl+Click),
 * Hover Link Underlines, Find All References (F12), and Change All Occurrences (Ctrl+F2).
 */
export function useRichEditor(options: UseRichEditorOptions = {}) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [referencesResult, setReferencesResult] = useState<ReferencesResultState | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);

  // Close context menu when clicking outside
  useEffect(() => {
    if (!contextMenu) return;
    let active = true;
    const closeMenu = () => {
      if (active) setContextMenu(null);
    };
    const timer = setTimeout(() => {
      window.addEventListener('click', closeMenu);
      window.addEventListener('contextmenu', closeMenu);
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('contextmenu', closeMenu);
    };
  }, [contextMenu]);

  // Helper: Find all occurrences of a word and display the bottom references drawer
  const findReferences = (word: string) => {
    if (!word || !editorViewRef.current) return;
    const view = editorViewRef.current;
    const docText = view.state.doc.toString();
    const regex = new RegExp(`\\b${word}\\b`, 'g');
    const refs: ReferenceItem[] = [];
    let match;
    while ((match = regex.exec(docText)) !== null) {
      try {
        const lineObj = view.state.doc.lineAt(match.index);
        refs.push({
          line: lineObj.number,
          text: lineObj.text,
          from: match.index,
          to: match.index + word.length,
        });
      } catch (e) {
        // Guard against internal index errors
      }
    }
    setReferencesResult({ word, refs });
  };

  // Helper: Jump cursor & scroll to an offset in CodeMirror
  const jumpToRef = (from: number, to: number) => {
    const view = editorViewRef.current;
    if (!view) return;
    view.dispatch({
      selection: { anchor: from, head: to },
      scrollIntoView: true,
    });
    view.focus();
  };

  // Helper: Read the word under the currently selected main cursor
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
        selection: EditorSelection.create(ranges),
      });
      view.focus();
    }
  };

  const triggerFindAllReferences = () => {
    const wordObj = getWordAtCursor();
    if (!wordObj) return;
    findReferences(wordObj.word);
  };

  // Keyboard events listener for global F2/F12 key intercepts
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

  // Shared checker to determine if word is declared as definition
  const checkIsDefinition = (word: string, docText: string, pos: number): boolean => {
    if (options.isDefinition) {
      return options.isDefinition(word, docText, pos);
    }
    const regex = new RegExp(`(?:const|let|var|function|class)\\s+${word}\\b`);
    return regex.test(docText);
  };

  // Handles Goto Definition targeting
  const handleGoToDefinition = (word: string, pos: number, view: EditorView, event?: any) => {
    // 1. Give option delegate priority
    if (options.onGotoDefinition && options.onGotoDefinition(word, pos, view)) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      return true;
    }

    // 2. Default definition navigation regex search
    const docText = view.state.doc.toString();
    const regex = new RegExp(`(?:const|let|var|function|class)\\s+${word}\\b`);
    const match = docText.match(regex);
    if (match && typeof match.index === 'number') {
      view.dispatch({
        selection: { anchor: match.index, head: match.index },
        scrollIntoView: true,
      });
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      view.focus();
      return true;
    }
    return false;
  };

  // Generates complete package of CodeMirror extensions
  const getRichExtensions = () => {
    const list: any[] = [];

    // Ref registry plugin
    list.push(
      ViewPlugin.fromClass(
        class {
          constructor(public view: EditorView) {
            editorViewRef.current = view;
          }
          destroy() {
            if (editorViewRef.current === this.view) {
              editorViewRef.current = null;
            }
          }
        }
      )
    );

    // Hover Tooltip Extension
    list.push(
      hoverTooltip((view, pos) => {
        try {
          const { from, to } = view.state.doc.lineAt(pos);
          let start = pos;
          let end = pos;
          while (start > from && /\w/.test(view.state.sliceDoc(start - 1, start))) start--;
          while (end < to && /\w/.test(view.state.sliceDoc(end, end + 1))) end++;
          if (start === end) return null;
          const word = view.state.sliceDoc(start, end);

          // 1. Option-defined tooltips
          if (options.getCustomTooltip) {
            const data = options.getCustomTooltip(word, pos, view);
            if (data) {
              return {
                pos: start,
                end: end,
                above: true,
                create: () => {
                  const dom = document.createElement('div');
                  dom.innerHTML = `
                    <div class="cm-hover-header ${data.headerClass || ''}">
                      <span class="text-indigo-400 font-mono">${data.header}</span>
                      <span class="cm-hover-type">${data.type}</span>
                    </div>
                    <div class="cm-hover-body">${data.body}</div>
                    ${data.shortcut ? `<div class="cm-hover-shortcut">${data.shortcut}</div>` : ''}
                  `;
                  return { dom };
                },
              };
            }
          }

          // 2. Builtin suggestions matching
          if (options.builtinSuggestions) {
            const suggestion = options.builtinSuggestions.find((s) => s.label === word);
            if (suggestion) {
              return {
                pos: start,
                end: end,
                above: true,
                create: () => {
                  const dom = document.createElement('div');
                  dom.innerHTML = `
                    <div class="cm-hover-header">
                      <span class="text-indigo-400 font-mono">${suggestion.label}</span>
                      <span class="cm-hover-type">${suggestion.type}</span>
                    </div>
                    <div class="cm-hover-body">${suggestion.description}</div>
                  `;
                  return { dom };
                },
              };
            }
          }

          // 3. Fallback variable definition checking
          const docText = view.state.doc.toString();
          if (checkIsDefinition(word, docText, pos)) {
            return {
              pos: start,
              end: end,
              above: true,
              create: () => {
                const dom = document.createElement('div');
                dom.innerHTML = `
                  <div class="cm-hover-header">
                    <span class="text-sky-400 font-mono">${word}</span>
                    <span class="cm-hover-type">variable</span>
                  </div>
                  <div class="cm-hover-body">SyntaxElement reference or local variable defined in this scope.</div>
                  <div class="cm-hover-shortcut">⚡ Cmd+Click / Ctrl+Click to jump to definition</div>
                `;
                return { dom };
              },
            };
          }
        } catch (_) {
          // ignore
        }
        return null;
      })
    );

    // Event handlers extension for Click, Right Click, and Context Menu inside DOM
    list.push(
      EditorView.domEventHandlers({
        click(event, view) {
          if (event.ctrlKey || event.metaKey) {
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos === null) return;

            try {
              const line = view.state.doc.lineAt(pos);
              let start = pos;
              let end = pos;
              while (start > line.from && /\w/.test(view.state.sliceDoc(start - 1, start))) start--;
              while (end < line.to && /\w/.test(view.state.sliceDoc(end, end + 1))) end++;
              if (start === end) return;
              const word = view.state.sliceDoc(start, end);

              handleGoToDefinition(word, pos, view, event);
            } catch (_) {
              // ignore
            }
          }
        },
        contextmenu(event, view) {
          event.preventDefault();
          event.stopPropagation();
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
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
                selection: { anchor: start, head: end },
              });
              setContextMenu({
                x: event.clientX,
                y: event.clientY,
                word,
                pos,
              });
            } else {
              setContextMenu(null);
            }
          } catch (_) {
            setContextMenu(null);
          }
        },
      })
    );

    // IDE Underline linkages highlights
    list.push(
      ViewPlugin.fromClass(
        class {
          decorations: DecorationSet;
          mousePos: number | null = null;
          modifierDown = false;
          activeRange: { start: number; end: number } | null = null;

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
            let nextRange: { start: number; end: number } | null = null;
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
                    if (checkIsDefinition(word, state.doc.toString(), this.mousePos)) {
                      nextRange = { start, end };
                      decos.push(
                        Decoration.mark({
                          class: 'cm-goto-link',
                        }).range(start, end)
                      );
                    }
                  }
                } catch (err) {
                  // Guard safely
                }
              }
            }

            const changed =
              (!this.activeRange && nextRange) ||
              (this.activeRange && !nextRange) ||
              (this.activeRange &&
                nextRange &&
                (this.activeRange.start !== nextRange.start || this.activeRange.end !== nextRange.end));

            if (changed) {
              this.activeRange = nextRange;
              this.decorations = Decoration.set(decos);
              this.view.dispatch({});
            }
          }
        },
        {
          decorations: (v) => v.decorations,
        }
      )
    );

    return list;
  };

  return {
    editorViewRef,
    contextMenu,
    setContextMenu,
    referencesResult,
    setReferencesResult,
    findReferences,
    jumpToRef,
    getWordAtCursor,
    triggerChangeAllOccurrences,
    triggerFindAllReferences,
    handleKeyDownAtReact,
    handleGoToDefinition,
    getRichExtensions,
  };
}

/**
 * Decoupled reusable Bottom Drawer Panel showing found occurrences
 */
export const EditorReferencesPanel: React.FC<{
  referencesResult: ReferencesResultState | null;
  setReferencesResult: (val: ReferencesResultState | null) => void;
  jumpToRef: (from: number, to: number) => void;
}> = ({ referencesResult, setReferencesResult, jumpToRef }) => {
  if (!referencesResult) return null;

  return (
    <div className="bg-[#0b0f19] border-t border-slate-700/60 h-[190px] flex flex-col z-[50]" id="references-panel">
      <div className="flex items-center justify-between px-4 py-2 bg-[#0e1624] border-b border-slate-800/80">
        <div className="flex items-center gap-2 text-slate-300 pr-4">
          <span className="text-emerald-400 font-semibold text-xs py-0.5 px-2 bg-emerald-500/10 rounded-md">🔗 References</span>
          <span className="text-[12px] font-medium font-sans">
            Found {referencesResult.refs.length} occurrences of{' '}
            <code className="text-pink-400 font-mono bg-slate-800 py-0.5 px-1 rounded">"{referencesResult.word}"</code>
          </span>
        </div>
        <button
          onClick={() => setReferencesResult(null)}
          className="p-1 hover:bg-slate-800 rounded-md text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
          title="Close Panel"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
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
                {(() => {
                  const idx = ref.text.indexOf(referencesResult.word);
                  if (idx === -1) return <span>{ref.text}</span>;
                  const before = ref.text.substring(0, idx);
                  const matchStr = ref.text.substring(idx, idx + referencesResult.word.length);
                  const after = ref.text.substring(idx + referencesResult.word.length);
                  return (
                    <span className="truncate">
                      <span className="opacity-60">{before}</span>
                      <span className="text-amber-300 font-bold bg-amber-500/15 px-1 py-0.5 rounded border border-amber-500/20">
                        {matchStr}
                      </span>
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
  );
};

/**
 * Decoupled reusable Interactive Context Menu component
 */
export const EditorContextMenu: React.FC<{
  contextMenu: ContextMenuState | null;
  setContextMenu: (val: ContextMenuState | null) => void;
  findReferences: (word: string) => void;
  editorViewRef: React.MutableRefObject<EditorView | null>;
  customGoToDefinition?: (word: string, pos: number, view: EditorView) => boolean;
}> = ({ contextMenu, setContextMenu, findReferences, editorViewRef, customGoToDefinition }) => {
  if (!contextMenu) return null;

  return (
    <div
      className="fixed z-[99999] bg-[#0b0f19] border border-slate-700/60 rounded-xl shadow-2xl py-1 px-1 w-56 text-slate-200 text-[11.5px] font-sans ring-1 ring-black/40 backdrop-blur-md"
      style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1.5 text-[9.5px] uppercase font-bold text-slate-500 tracking-wider select-none border-b border-slate-800/80 mb-1 font-mono flex items-center justify-between">
        <span>Identifier</span>
        <span className="text-indigo-400 font-semibold">{contextMenu.word}</span>
      </div>

      <button
        onClick={() => {
          const view = editorViewRef.current;
          if (view) {
            let handled = false;
            if (customGoToDefinition) {
              handled = customGoToDefinition(contextMenu.word, contextMenu.pos, view);
            }
            if (!handled) {
              const docText = view.state.doc.toString();
              const regex = new RegExp(`(?:const|let|var|function|class)\\s+${contextMenu.word}\\b`);
              const match = docText.match(regex);
              if (match && typeof match.index === 'number') {
                view.dispatch({
                  selection: { anchor: match.index, head: match.index },
                  scrollIntoView: true,
                });
                view.focus();
              }
            }
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
          const view = editorViewRef.current;
          if (view) {
            const ranges: any[] = [];
            let match;
            const regex = new RegExp(`\\b${contextMenu.word}\\b`, 'g');
            const dText = view.state.doc.toString();
            while ((match = regex.exec(dText)) !== null) {
              ranges.push(EditorSelection.range(match.index, match.index + contextMenu.word.length));
            }
            if (ranges.length > 0) {
              view.dispatch({
                selection: EditorSelection.create(ranges),
              });
              view.focus();
            }
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
  );
};
