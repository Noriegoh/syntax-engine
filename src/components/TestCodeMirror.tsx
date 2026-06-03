import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { ViewPlugin, DecorationSet, Decoration, ViewUpdate, EditorView } from '@codemirror/view';
import { Range } from '@codemirror/state';

const STYLE_PLAIN_ID = 0;
const STYLE_COMMENT_ID = 1;
const STYLE_STRING_ID = 2;
const STYLE_NUMBER_ID = 3;
const STYLE_KEYWORD_ID = 4;
const STYLE_ACTIVE_DECL_ID = 5;
const STYLE_ACTIVE_REF_ID = 6;
const STYLE_REF_DIRECT_ID = 7;

const STYLE_ID_TO_NAME = [
  "",
  "comment",
  "string",
  "number",
  "keyword",
  "active-symbol-declaration",
  "active-symbol-reference",
  "active-reference-direct"
];

const extraStyleIdMap = new Map<string, number>();
const styleIdToNameList = [...STYLE_ID_TO_NAME];

const styleNameToIdMap = new Map<string, number>();
for (let i = 0; i < STYLE_ID_TO_NAME.length; i++) {
  styleNameToIdMap.set(STYLE_ID_TO_NAME[i], i);
}

const getStyleIdForName = (name: string | undefined): number => {
  if (!name) return 0;
  
  const cachedId = styleNameToIdMap.get(name);
  if (cachedId !== undefined) return cachedId;
  
  let dynamicId = extraStyleIdMap.get(name);
  if (dynamicId === undefined) {
    dynamicId = styleIdToNameList.length;
    extraStyleIdMap.set(name, dynamicId);
    styleIdToNameList.push(name);
  }
  return dynamicId;
};

const getStyleClass = (styleId: number, isInActiveBlock: boolean): string => {
  if (styleId === 0) return "plain-code text-slate-300" + (isInActiveBlock ? " bg-indigo-950/40 text-indigo-100 ring-1 ring-indigo-500/15 rounded-sm" : "");
  
  const name = styleIdToNameList[styleId] || "";
  let cls = "";
  
  if (name === 'active-symbol-declaration') {
    cls = "bg-indigo-500/40 text-indigo-200 font-extrabold ring-1 ring-indigo-400 px-0.5 rounded shadow-[0_0_12px_rgba(99,102,241,0.6)]";
  } else if (name === 'active-symbol-reference') {
    cls = "bg-emerald-500/35 text-emerald-200 font-bold border-b-2 border-dashed border-emerald-400/80 px-0.5 rounded";
  } else if (name === 'active-reference-direct') {
    cls = "bg-sky-500/40 text-sky-200 font-extrabold ring-1 ring-sky-400 px-0.5 rounded shadow-[0_0_12px_rgba(14,165,233,0.6)]";
  } else if (name.includes("keyword") || name === "kw" || name === "key" || name === "modifier") {
    cls = "text-pink-400 font-bold";
  } else if (name.includes("comment") || name === "noise") {
    cls = "text-slate-500/80 italic";
  } else if (name.includes("string") || name === "str" || name === "char") {
    cls = "text-amber-300";
  } else if (name.includes("number") || name === "num" || name === "float" || name === "int" || name === "digit" || name === "val" || name === "value") {
    cls = "text-cyan-400";
  } else if (name.includes("id") || name === "identifier") {
    cls = "text-sky-300";
  } else if (name.includes("type") || name === "typename" || name === "decl_type" || name === "structname") {
    cls = "text-teal-300 font-medium";
  } else if (name.includes("func") || name === "fn" || name === "method" || name === "call" || name === "vert" || name === "frag") {
    cls = "text-emerald-400 font-semibold";
  } else if (name.includes("operator") || name === "op" || name === "punctuation" || name === "equals" || name === "plus" || name === "minus" || name === "mul" || name === "div") {
    cls = "text-indigo-300";
  } else if (name === "error_node" || name.includes("error")) {
    cls = "text-rose-400 bg-rose-500/10 underline decoration-rose-500/80 decoration-wavy";
  } else if (name.includes("whitespace") || name === "ws") {
    cls = "";
  }
  
  if (isInActiveBlock) {
    cls += " bg-indigo-950/40 text-indigo-100 ring-1 ring-indigo-500/15 rounded-sm";
  }
  return cls;
};

const buildCstDecorations = (code: string, parserState: any): DecorationSet => {
  const {
    debouncedTestInput,
    parseResult,
    hoveredScope,
    selectedScope,
    hoveredSymbol,
    selectedSymbol,
    hoveredReference,
    selectedReference,
  } = parserState;

  const activeBlock = hoveredScope || selectedScope;
  const hasActiveBlock = !!(activeBlock && activeBlock.type !== 'global');
  const activeBlockStart = hasActiveBlock ? activeBlock.start : -1;
  const activeBlockEnd = hasActiveBlock ? activeBlock.end : -1;

  const activeSym = selectedSymbol || hoveredSymbol;
  const activeSymStart = activeSym ? activeSym.start : -1;
  const activeSymEnd = activeSym ? activeSym.end : -1;

  const activeRef = selectedReference || hoveredReference;
  const activeRefStart = activeRef ? activeRef.start : -1;
  const activeRefEnd = activeRef ? activeRef.end : -1;

  const charStyles = new Int32Array(code.length);

  // 1. Pre-populate basic comments
  const commentsRegex = /\/\/.*|\/\*[\s\S]*?\*\//g;
  let match;
  while ((match = commentsRegex.exec(code)) !== null) {
    const matchLen = match[0].length;
    const startIndex = match.index;
    for (let i = 0; i < matchLen; i++) {
      charStyles[startIndex + i] = STYLE_COMMENT_ID;
    }
  }

  // 2. Pre-populate basic strings
  const stringRegex = /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/g;
  while ((match = stringRegex.exec(code)) !== null) {
    const matchLen = match[0].length;
    const startIndex = match.index;
    for (let i = 0; i < matchLen; i++) {
      charStyles[startIndex + i] = STYLE_STRING_ID;
    }
  }

  // 3. Pre-populate basic numbers
  const numberRegex = /\b\d+(?:\.\d+)?\b/g;
  while ((match = numberRegex.exec(code)) !== null) {
    const matchLen = match[0].length;
    const startIndex = match.index;
    for (let i = 0; i < matchLen; i++) {
      charStyles[startIndex + i] = STYLE_NUMBER_ID;
    }
  }

  // 4. Pre-populate keywords
  const keywordsRegex = /\b(struct|cbuffer|return|void|float[1-4]|int[1-4]|fixed[1-4]|half[1-4]|bool|float|int|fixed|half|double|sampler2D|Texture2D|SamplerState|PASS|Pass|VertexShader|PixelShader|Pixel|Vertex|layout|uniform)\b/g;
  while ((match = keywordsRegex.exec(code)) !== null) {
    const start = match.index;
    const end = match.index + match[0].length;
    for (let i = start; i < end; i++) {
      if (charStyles[i] !== STYLE_COMMENT_ID) {
        charStyles[i] = STYLE_KEYWORD_ID;
      }
    }
  }

  // 5. Walk parsed CST to apply semantic overlay
  const ast = (code === debouncedTestInput) ? parseResult : null;
  if (ast) {
    const isContainer = (name: string) => {
      const n = name.toLowerCase();
      return n === "program" || n === "noise" || n === "ws" || n === "whitespaces" || n === "eof" || n === "s" || n === "n" || 
             n === "zeroormore" || n === "oneormore" || n === "optional" || n === "choice" ||
             n.includes("block") || n.includes("list") || n.includes("entry") || n.includes("item") || 
             n === "_root" || n === "opt_properties" || n === "opt_prop_block" || n === "opt_array" || 
             n === "sem_opt" || n === "params" || n === "comma_param";
    };

    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        const len = node.length;
        for (let i = 0; i < len; i++) {
          walk(node[i]);
        }
        return;
      }

      if (typeof node.start === 'number' && typeof node.end === 'number') {
        const styleName = node.type || node.ruleId;
        if (styleName && !isContainer(styleName)) {
          const start = Math.max(0, node.start);
          const end = Math.min(code.length, node.end);
          const nodeStyleId = getStyleIdForName(styleName);

          for (let i = start; i < end; i++) {
            const currStyle = charStyles[i];
            if (currStyle === STYLE_PLAIN_ID || 
                (currStyle !== STYLE_COMMENT_ID && 
                 currStyle !== STYLE_STRING_ID && 
                 currStyle !== STYLE_NUMBER_ID && 
                 currStyle !== STYLE_KEYWORD_ID)) {
              charStyles[i] = nodeStyleId;
            }
          }
        }
      }

      if (node.value !== undefined) {
        if (Array.isArray(node.value)) {
          const len = node.value.length;
          for (let i = 0; i < len; i++) {
            walk(node.value[i]);
          }
        } else {
          walk(node.value);
        }
      }
    };

    walk(ast);
  }

  // 6. Layer active symbol and reference declarations on top
  if (activeSym) {
    const declStart = Math.max(0, activeSym.start);
    const declEnd = Math.min(code.length, activeSym.end);
    for (let i = declStart; i < declEnd; i++) {
      charStyles[i] = STYLE_ACTIVE_DECL_ID;
    }
    if (activeSym.references) {
      const refs = activeSym.references;
      const len = refs.length;
      for (let r = 0; r < len; r++) {
        const ref = refs[r];
        const refStart = Math.max(0, ref.start);
        const refEnd = Math.min(code.length, ref.end);
        for (let i = refStart; i < refEnd; i++) {
          charStyles[i] = STYLE_ACTIVE_REF_ID;
        }
      }
    }
  }

  if (activeRef) {
    const refStart = Math.max(0, activeRef.start);
    const refEnd = Math.min(code.length, activeRef.end);
    for (let i = refStart; i < refEnd; i++) {
      charStyles[i] = STYLE_REF_DIRECT_ID;
    }
  }

  // 7. Accumulate decorations
  const decorations: Range<Decoration>[] = [];
  let runStart = 0;
  let prevStyleId = -1;
  const len = code.length;

  for (let i = 0; i < len; i++) {
    const styleId = charStyles[i];
    const itemInActive = hasActiveBlock && i >= activeBlockStart && i < activeBlockEnd;
    const prevInActive = hasActiveBlock && (i - 1) >= activeBlockStart && (i - 1) < activeBlockEnd;

    const isSameStyle = (i > 0) && (styleId === prevStyleId && itemInActive === prevInActive);

    if (!isSameStyle) {
      if (i > runStart) {
        const cls = getStyleClass(prevStyleId, prevInActive);
        if (cls) {
          decorations.push(Decoration.mark({ class: cls }).range(runStart, i));
        }
      }
      prevStyleId = styleId;
      runStart = i;
    }
  }

  if (len > runStart) {
    const lastInActive = hasActiveBlock && (len - 1) >= activeBlockStart && (len - 1) < activeBlockEnd;
    const cls = getStyleClass(prevStyleId, lastInActive);
    if (cls) {
      decorations.push(Decoration.mark({ class: cls }).range(runStart, len));
    }
  }

  return Decoration.set(decorations, true);
};

export const testEditorTheme = EditorView.theme({
  "&": {
    color: "#cbd5e1",
    backgroundColor: "transparent"
  },
  ".cm-content": {
    caretColor: "#10b981",
    fontFamily: '"Fira Code", monospace',
    fontSize: "13px"
  },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "#10b981"
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "rgba(16, 185, 129, 0.25)"
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

interface EditDetail {
  editOffset: number;
  removedLength: number;
  insertedText: string;
}

interface TestCodeMirrorProps {
  value: string;
  onChange: (val: string, edit?: EditDetail) => void;
  setCursorPosition: (pos: { line: number; col: number }) => void;
  parserState: {
    debouncedTestInput: string;
    parseResult: any;
    hoveredScope: any;
    selectedScope: any;
    hoveredSymbol: any;
    selectedSymbol: any;
    hoveredReference: any;
    selectedReference: any;
    parseError: any;
    symbols?: any[];
    references?: any[];
  };
  onGotoDefinition?: (definition: any) => void;
  editorRef?: React.RefObject<any>;
  style?: React.CSSProperties;
  className?: string;
}

export const TestCodeMirror: React.FC<TestCodeMirrorProps> = React.memo(({
  value,
  onChange,
  setCursorPosition,
  parserState,
  onGotoDefinition,
  editorRef,
  style,
  className
}) => {
  const extensions = useMemo(() => {
    // Custom CST decoration view-plugin
    const cstViewPlugin = ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: any) {
          this.decorations = buildCstDecorations(view.state.doc.toString(), parserState);
        }
        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = buildCstDecorations(update.view.state.doc.toString(), parserState);
          }
        }
      },
      {
        decorations: (v) => v.decorations,
      }
    );

    // Selections update listener for accurate cursor position reports
    const selectionUpdateListener = EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.docChanged) {
        const pos = update.state.selection.main.head;
        const lineObj = update.state.doc.lineAt(pos);
        const line = lineObj.number;
        const col = pos - lineObj.from + 1;
        setCursorPosition({ line, col });
      }
    });

    // CodeMirror DOM Event Handlers for Ctrl/Cmd Click or Double-Click to Goto Definition
    const domHandlers = EditorView.domEventHandlers({
      dblclick(event, view) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos !== null) {
          const refs = parserState.references || [];
          const syms = parserState.symbols || [];
          const clickedRef = refs.find((r: any) => pos >= r.start && pos <= r.end);
          if (clickedRef && clickedRef.resolvedSymbolId) {
            const definition = syms.find((s: any) => s.id === clickedRef.resolvedSymbolId);
            if (definition) {
              event.preventDefault();
              event.stopPropagation();
              view.dispatch({
                selection: { anchor: definition.start, head: definition.end },
                scrollIntoView: true
              });
              if (onGotoDefinition) {
                onGotoDefinition(definition);
              }
              return true;
            }
          }
        }
        return false;
      },
      click(event, view) {
        if (event.ctrlKey || event.metaKey) {
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos !== null) {
            const refs = parserState.references || [];
            const syms = parserState.symbols || [];
            const clickedRef = refs.find((r: any) => pos >= r.start && pos <= r.end);
            if (clickedRef && clickedRef.resolvedSymbolId) {
              const definition = syms.find((s: any) => s.id === clickedRef.resolvedSymbolId);
              if (definition) {
                event.preventDefault();
                event.stopPropagation();
                view.dispatch({
                  selection: { anchor: definition.start, head: definition.end },
                  scrollIntoView: true
                });
                if (onGotoDefinition) {
                  onGotoDefinition(definition);
                }
                return true;
              }
            }
          }
        }
        return false;
      }
    });

    return [
      cstViewPlugin,
      selectionUpdateListener,
      domHandlers,
      testEditorTheme
    ];
  }, [parserState, setCursorPosition, onGotoDefinition]);

  const handleDocChange = (val: string, viewUpdate: ViewUpdate) => {
    let edit: EditDetail | undefined;
    viewUpdate.changes.iterChanges((from, to, fromB, toB, inserted) => {
      edit = {
        editOffset: from,
        removedLength: to - from,
        insertedText: inserted.toString()
      };
    });
    onChange(val, edit);
  };

  return (
    <div className={`w-full h-full text-[13px] font-mono leading-relaxed overflow-hidden ${className || ''}`} style={style}>
      <CodeMirror
        ref={editorRef}
        value={value}
        height="100%"
        theme="none"
        extensions={extensions}
        onChange={handleDocChange}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          dropCursor: true,
          allowMultipleSelections: false,
          indentOnInput: true,
          syntaxHighlighting: false, // Disables CodeMirror defaults so custom CST markers override it flawlessly
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: false,
          highlightActiveLineGutter: true,
          highlightActiveLine: true,
        }}
        className="h-full"
      />
    </div>
  );
});

TestCodeMirror.displayName = "TestCodeMirror";
