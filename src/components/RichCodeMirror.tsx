import React, { useMemo } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { linter, lintGutter, Diagnostic as CMLintDiagnostic } from '@codemirror/lint';
import { EditorView, ViewUpdate } from '@codemirror/view';
import * as acorn from 'acorn';

import { useRichEditor, EditorReferencesPanel, EditorContextMenu, RichTooltipData } from '../hooks/useRichEditor';

export interface RichCodeMirrorProps {
  value: string;
  onChange: (value: string, viewUpdate: ViewUpdate) => void;
  editorRef?: React.RefObject<ReactCodeMirrorRef | null | any>;
  style?: React.CSSProperties;
  className?: string;

  // Custom configurations
  extensions?: any[];
  basicSetup?: any;
  theme?: any;

  // Linter & Diagnostics configs
  enableAcornLint?: boolean;
  diagnostics?: Array<{
    nodeName?: string;
    message: string;
    start?: number;
    end?: number;
    severity?: "error" | "warning" | "info";
  }>;
  codeError?: string | null;

  // Hooks options delegate
  isDefinition?: (word: string, docText: string, pos: number) => boolean;
  onGotoDefinition?: (word: string, pos: number, view: EditorView) => boolean;
  getCustomTooltip?: (word: string, pos: number, view: EditorView) => RichTooltipData | null;
  builtinSuggestions?: Array<{
    label: string;
    type: string;
    description: string;
  }>;
}

/**
 * RichCodeMirror is a highly generic, decoupled base IDE-grade text editor
 * component designed for React/Vite. It bundles hover link underline, autocomplete sources,
 * custom definitions jumping, context menu items, reference markers, change all occurrences triggers,
 * and handles advanced unified visual AST semantic & parser diagnostic squiggles instantly!
 */
export const RichCodeMirror: React.FC<RichCodeMirrorProps> = React.memo(({
  value,
  onChange,
  editorRef,
  style,
  className,
  extensions = [],
  basicSetup = {},
  theme = "none",
  enableAcornLint = false,
  diagnostics = [],
  codeError = null,
  isDefinition,
  onGotoDefinition,
  getCustomTooltip,
  builtinSuggestions,
}) => {
  const {
    editorViewRef,
    contextMenu,
    setContextMenu,
    referencesResult,
    setReferencesResult,
    findReferences,
    jumpToRef,
    handleKeyDownAtReact,
    getRichExtensions,
  } = useRichEditor({
    isDefinition,
    onGotoDefinition,
    getCustomTooltip,
    builtinSuggestions,
  });

  const fullExtensions = useMemo(() => {
    const list: any[] = [
      ...getRichExtensions(),
      ...extensions,
    ];

    // Setup Linter validation mapping
    const hasLinting = enableAcornLint || (diagnostics && diagnostics.length > 0) || codeError;
    if (hasLinting) {
      list.push(lintGutter());
      list.push(
        linter((view) => {
          const code = view.state.doc.toString();
          const cmDiagnostics: CMLintDiagnostic[] = [];

          let parsedAst: any = null;

          // 1. AST Acorn validation & semantic mapping
          if (enableAcornLint) {
            try {
              parsedAst = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
            } catch (acornErr: any) {
              if (acornErr && typeof acornErr.pos === 'number') {
                const from = Math.max(0, Math.min(acornErr.pos, code.length));
                let to = from + 1;
                try {
                  const line = view.state.doc.lineAt(from);
                  to = Math.min(to, line.to);
                } catch (_) {}
                if (to <= from) to = from + 1;
                to = Math.min(to, code.length);

                const cleanMsg = acornErr.message ? acornErr.message.replace(/\s*\(\d+:\d+\)\s*$/, '') : 'Syntax Error';
                cmDiagnostics.push({
                  from,
                  to,
                  severity: 'error',
                  message: cleanMsg,
                });
              }
            }

            // Map high-level grammar diagnostics onto parsed AST nodes
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
                  elementPositions.set(node.id.name, { start: node.id.start, end: node.id.end });
                }

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

              diagnostics.forEach((diag) => {
                if (diag.nodeName) {
                  const pos = elementPositions.get(diag.nodeName);
                  if (pos) {
                    cmDiagnostics.push({
                      from: pos.start,
                      to: pos.end,
                      severity: diag.severity || 'warning',
                      message: diag.message,
                    });
                  }
                }
              });
            }
          }

          // 2. Map direct pixel/offset code diagnostics
          if (diagnostics && diagnostics.length > 0) {
            diagnostics.forEach((diag) => {
              if (typeof diag.start === 'number' && typeof diag.end === 'number' && diag.start < diag.end) {
                const from = Math.max(0, Math.min(diag.start, code.length));
                const to = Math.min(diag.end, code.length);
                cmDiagnostics.push({
                  from,
                  to,
                  severity: diag.severity || 'error',
                  message: diag.message,
                });
              }
            });
          }

          // 3. Parser codeError indicator mapping (Line X, Col Y)
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

                const isDuplicate = cmDiagnostics.some((d) => Math.abs(d.from - from) <= 3);
                if (!isDuplicate) {
                  const cleanMsg = codeError.replace(/\s*\(\s*Line\s+\d+.*$/, '');
                  cmDiagnostics.push({
                    from,
                    to,
                    severity: 'error',
                    message: `${cleanMsg} (Runtime Error)`,
                  });
                }
              } catch (err) {
                console.error('Failed to map codeError to editor position', err);
              }
            }
          }

          return cmDiagnostics;
        })
      );
    }

    if (theme) {
      list.push(theme);
    }

    return list;
  }, [extensions, theme, enableAcornLint, diagnostics, codeError, getRichExtensions]);

  const defaultSetup = useMemo(() => {
    return {
      lineNumbers: true,
      foldGutter: false,
      dropCursor: true,
      allowMultipleSelections: true,
      indentOnInput: true,
      syntaxHighlighting: true,
      bracketMatching: true,
      closeBrackets: true,
      autocompletion: true,
      highlightActiveLineGutter: true,
      highlightActiveLine: true,
      ...basicSetup,
    };
  }, [basicSetup]);

  return (
    <div
      className={`relative w-full h-full flex flex-col ${className || ''}`}
      style={style}
      onKeyDown={handleKeyDownAtReact}
    >
      <div className="flex-1 w-full min-h-0 overflow-auto custom-scrollbar">
        <CodeMirror
          ref={editorRef}
          value={value}
          height="100%"
          theme="none"
          extensions={fullExtensions}
          onChange={onChange}
          basicSetup={defaultSetup}
          className="h-full"
        />
      </div>

      {/* Floating diagnostics or references list */}
      <EditorReferencesPanel
        referencesResult={referencesResult}
        setReferencesResult={setReferencesResult}
        jumpToRef={jumpToRef}
      />

      <EditorContextMenu
        contextMenu={contextMenu}
        setContextMenu={setContextMenu}
        findReferences={findReferences}
        editorViewRef={editorViewRef}
        customGoToDefinition={onGotoDefinition}
      />
    </div>
  );
});

RichCodeMirror.displayName = 'RichCodeMirror';
