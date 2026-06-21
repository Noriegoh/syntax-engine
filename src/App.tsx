import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as acorn from 'acorn';
import { 
  FolderOpen,
  Plus,
  Code2, 
  FileCode,
  AlertCircle,
  CheckCircle2,
  Rocket,
  Terminal,
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
  Download,
  Upload
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import Prism from 'prismjs';
if (typeof window !== 'undefined') {
  (window as any).Prism = Prism;
}
import('prismjs/components/prism-clike');
import('prismjs/components/prism-javascript');
import 'prismjs/themes/prism-tomorrow.css';
import { SyntaxElement, Sort, ParseResult, IncrementalParser, CSTQuery, QueryMatch, ScopeBuilder, LexicalScope, SymbolDefinition, SymbolReference, generateFullCSharp, generateModularCSharp, generateFullTypeScript, wrapASTTransformerWithIncrementalCache, findDiff, Token, DefaultLeadingTrivia, DefaultTrailingTrivia, LiteralMatch, Element, InlinedElement } from './lib/engine';
import { cn } from './lib/utils';
import { runGrammarDiagnostics, Diagnostic } from './lib/diagnostics';
import { ProjectLibraryModal } from './components/ProjectLibraryModal';
import { CSharpExportModal } from './components/CSharpExportModal';
import { TypeScriptExportModal } from './components/TypeScriptExportModal';
import { DEFAULT_CODE, DEFAULT_AST_CODE, DEFAULT_SCOPE_RESOLVER_CODE } from './lib/defaultTemplates';
import { VisualRulesInspector } from './components/VisualRulesInspector';
import { PlaygroundTab } from './components/PlaygroundTab';
import { GrammarCodeMirror } from './components/GrammarCodeMirror';


const workbenchLogo = new URL('./assets/images/workbench_logo_1780160579859.png', import.meta.url).href;

const SyntaxEngineLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M8 6C8 6 5 8 5 12C5 16 8 18 8 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M9 12H11C12.5 12 13 8 15 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M9 12H11C12.5 12 13 16 15 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="17" cy="8" r="2" stroke="currentColor" strokeWidth="2.5"/>
    <circle cx="17" cy="16" r="2.5" fill="currentColor"/>
  </svg>
);

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

const styleNameToIdMap = new Map<string, number>();
for (let i = 0; i < STYLE_ID_TO_NAME.length; i++) {
  styleNameToIdMap.set(STYLE_ID_TO_NAME[i], i);
}

interface SavedProject {
  id: string;
  name: string;
  grammar: string;
  input: string;
  scopeResolver?: string;
  ast?: string;
  updatedAt: number;
}

export default function App() {
  const [grammarCode, setGrammarCode] = useState(DEFAULT_CODE);
 

  const [testInput, setTestInput] = useState<string>(() => {
    return [
      "Shader \"Custom/MyAwesomeShader\" {",
      "    Properties {",
      "        _Color (\"Main Color\", Color) = (1,1,1,1)",
      "        _MainTex (\"Texture\", 2D) = \"white\" {}",
      "        [HDR] _Emission (\"Emission\", Color) = (0,0,0,1)",
      "    }",
      "    SubShader {",
      "        Tags { \"RenderType\"=\"Opaque\" \"Queue\"=\"Geometry\" }",
      "        LOD 100",
      "        ",
      "        Pass {",
      "            ZWrite On",
      "            Blend SrcAlpha OneMinusSrcAlpha",
      "            Cull Back",
      "",
      "            CGPROGRAM",
      "            #pragma vertex vert",
      "            #pragma fragment frag",
      "            #include \"UnityCG.cginc\"",
      "",
      "            struct appdata {",
      "                float4 vertex : POSITION;",
      "                float2 uv : TEXCOORD0;",
      "            };",
      "",
      "            struct v2f {",
      "                float2 uv : TEXCOORD0;",
      "                float4 vertex : SV_POSITION;",
      "            };",
      "",
      "            sampler2D _MainTex;",
      "            float4 _Color;",
      "",
      "            v2f vert (appdata v) {",
      "                v2f o;",
      "                o.vertex = UnityObjectToClipPos(v.vertex);",
      "                o.uv = v.uv;",
      "                return o;",
      "            }",
      "",
      "            fixed4 frag (v2f i) : SV_Target {",
      "                fixed4 col = tex2D(_MainTex, i.uv) * _Color;",
      "                return col;",
      "            }",
      "            ENDCG",
      "        }",
      "    }",
      "}"
    ].join("\n");
  });

  // Debounced input states to reduce keystroke latency
  const [debouncedTestInput, setDebouncedTestInput] = useState<string>(testInput);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedTestInput(testInput);
    }, 200); // 200ms debounce for high performance
    return () => clearTimeout(handler);
  }, [testInput]);

  const [rootElement, setRootElement] = useState<SyntaxElement | null>(null);
  const grammarDiagnostics = useMemo(() => {
    return runGrammarDiagnostics(rootElement);
  }, [rootElement]);

  const errorsCount = useMemo(() => {
    return grammarDiagnostics.filter(d => d.type === 'error').length;
  }, [grammarDiagnostics]);

  const warningsCount = useMemo(() => {
    return grammarDiagnostics.filter(d => d.type === 'warning').length;
  }, [grammarDiagnostics]);

  const infosCount = useMemo(() => {
    return grammarDiagnostics.filter(d => d.type === 'info').length;
  }, [grammarDiagnostics]);
  const [hierarchy, setHierarchy] = useState<any>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<any>(null);
  const [profileRoot, setProfileRoot] = useState<any>(null);
  const [parseError, setParseError] = useState<{ message: string; ruleId?: number | string; offset?: number } | null>(null);
  const [recoveredErrors, setRecoveredErrors] = useState<{ message: string; offset: number }[]>([]);
  
  const [projectName, setProjectName] = useState("HLSL Subset");
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);

  // C# Code Export settings
  const [showCSharpModal, setShowCSharpModal] = useState(false);
  const [csNamespace, setCsNamespace] = useState("SyntaxEngine");
  const [debouncedCsNamespace, setDebouncedCsNamespace] = useState("SyntaxEngine");

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedCsNamespace(csNamespace);
    }, 400); // 400ms debounce
    return () => clearTimeout(handler);
  }, [csNamespace]);

  const [csExportMode, setCsExportMode] = useState<'bundle' | 'modular'>('bundle');
  const [csAstSeparate, setCsAstSeparate] = useState(false);
  const [csSelectedFileIndex, setCsSelectedFileIndex] = useState(0);
  const [copiedFileIndex, setCopiedFileIndex] = useState<number | null>(null);
  const [lastScopeBuilder, setLastScopeBuilder] = useState<ScopeBuilder | null>(null);
  
  const csGeneratedFiles = useMemo(() => {
    if (!rootElement || !showCSharpModal) return [];
    const rootName = rootElement.name ? String(rootElement.name).replace(/[^a-zA-Z0-9]/g, '') : 'Parser';
    if (csExportMode === 'bundle') {
      const code = generateFullCSharp(rootElement, debouncedCsNamespace, lastScopeBuilder || undefined);
      return [{ name: `${rootName}Bundle.cs`, content: code }];
    } else {
      return generateModularCSharp(rootElement, {
        namespace: debouncedCsNamespace,
        stronglyTypedAstSeparate: csAstSeparate,
        scopeBuilder: lastScopeBuilder || undefined
      });
    }
  }, [rootElement, debouncedCsNamespace, csExportMode, csAstSeparate, lastScopeBuilder, showCSharpModal]);

  // TypeScript Code Export settings
  const [showTSModal, setShowTSModal] = useState(false);
  const [tsSelectedFileIndex, setTsSelectedFileIndex] = useState(0);
  const [tsCopiedFileIndex, setTsCopiedFileIndex] = useState<number | null>(null);

  const tsGeneratedFiles = useMemo(() => {
    if (!rootElement || !showTSModal) return [];
    try {
      const code = generateFullTypeScript(rootElement);
      const rootName = rootElement.name ? String(rootElement.name).replace(/[^a-zA-Z0-9]/g, '') : 'Parser';
      const name = `${rootName}Bundle.ts`;
      return [{ name, content: code }];
    } catch (e) {
      console.error(e);
      return [{ name: "error.ts", content: `// Generation failed: ${e instanceof Error ? e.message : e}` }];
    }
  }, [rootElement, showTSModal]);

  const downloadSingleFile = (name: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAllFiles = () => {
    csGeneratedFiles.forEach((file, index) => {
      setTimeout(() => {
        downloadSingleFile(file.name, file.content);
      }, index * 100);
    });
  };

  const [activeTab, setActiveTab] = useState<'designer' | 'playground'>('designer');
  const [cstViewMode, setCstViewMode] = useState<'json' | 'visual' | 'query' | 'scopes' | 'performance' | 'investigate'>('json');
  const [ruleViewMode, setRuleViewMode] = useState<'list' | 'graph'>('list');
  const [visualizeMode, setVisualizeMode] = useState<'cst' | 'ast'>('cst');
  const [hoveredOffset, setHoveredOffset] = useState<number | null>(null);
  const [pinnedOffset, setPinnedOffset] = useState<number | null>(null);
  const [investigateHoveredNode, setInvestigateHoveredNode] = useState<any | null>(null);
  const [debouncedInvestigateOffset, setDebouncedInvestigateOffset] = useState<number | null>(null);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedInvestigateOffset(hoveredOffset);
    }, 40);
    return () => clearTimeout(handler);
  }, [hoveredOffset]);
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolDefinition | null>(null);
  const [hoveredSymbol, setHoveredSymbol] = useState<SymbolDefinition | null>(null);
  const [selectedReference, setSelectedReference] = useState<SymbolReference | null>(null);
  const [hoveredReference, setHoveredReference] = useState<SymbolReference | null>(null);
  const [selectedScope, setSelectedScope] = useState<LexicalScope | null>(null);
  const [hoveredScope, setHoveredScope] = useState<LexicalScope | null>(null);
  const [scopeSearchQuery, setScopeSearchQuery] = useState<string>("");
  const [scopeResolverCode, setScopeResolverCode] = useState<string>(DEFAULT_SCOPE_RESOLVER_CODE);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [designerEditorTab, setDesignerEditorTab] = useState<'grammar' | 'ast' | 'scope' | 'console'>('grammar');

  const [astCode, setAstCode] = useState<string>(DEFAULT_AST_CODE);
  const [debouncedAstCode, setDebouncedAstCode] = useState<string>(DEFAULT_AST_CODE);
  const [astError, setAstError] = useState<string | null>(null);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedAstCode(astCode);
    }, 400);
    return () => clearTimeout(handler);
  }, [astCode]);

  // Debounced scope resolver code to avoid high execution cost on every keystroke
  const [debouncedScopeResolverCode, setDebouncedScopeResolverCode] = useState<string>(DEFAULT_SCOPE_RESOLVER_CODE);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedScopeResolverCode(scopeResolverCode);
    }, 400); // 400ms debounce for complex script parsing
    return () => clearTimeout(handler);
  }, [scopeResolverCode]);

  const astResult = useMemo(() => {
    if (!parseResult) return null;
    try {
      setAstError(null);
      if (!debouncedAstCode || !debouncedAstCode.trim()) {
        return parseResult;
      }
      const wrappedBody = wrapASTTransformerWithIncrementalCache(debouncedAstCode);
      const customTransform = new Function('cst', 'fullText', wrappedBody);
      const res = customTransform(parseResult, debouncedTestInput);
      return res || parseResult;
    } catch (e: any) {
      console.error(e);
      setAstError(e.message || "Error transforming CST to AST");
      return parseResult; // Fallback to raw CST on error so development flow isn't crashed
    }
  }, [parseResult, debouncedTestInput, debouncedAstCode]);



  const [resolverErrorMsg, setResolverErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setScopeError(resolverErrorMsg);
  }, [resolverErrorMsg]);

  // Build local scopes and resolve single-document references
  const scopeChain = useMemo(() => {
    if (!debouncedScopeResolverCode || !rootElement || !astResult) return null;

    try {
      setResolverErrorMsg(null);
      let capturedScopeBuilder: ScopeBuilder | null = null;
      class InterceptedScopeBuilder extends ScopeBuilder {
        constructor() {
          super();
          capturedScopeBuilder = this;
        }
      }
      const customBuildScopeChain = new Function('ast', 'fullText', 'ScopeBuilder', debouncedScopeResolverCode);
      
      const res = customBuildScopeChain(astResult, debouncedTestInput, InterceptedScopeBuilder);
      if (res) {
        res.name = "Global"; // Label global scope
        
        // Annotate scope trees recursively with filename context for navigation/scoping
        const annotateFile = (scope: LexicalScope) => {
          scope.fileName = "main.hlsl";
          if (scope.symbols) {
            for (const sym of scope.symbols) {
              sym.fileName = "main.hlsl";
            }
          }
          if (scope.references) {
            for (const ref of scope.references) {
              ref.fileName = "main.hlsl";
            }
          }
          if (scope.children) {
            for (const child of scope.children) {
              annotateFile(child);
            }
          }
        };
        annotateFile(res);

        if (capturedScopeBuilder) {
          setLastScopeBuilder(capturedScopeBuilder);
        }

        // Collect and wire local references to local symbols
        const syms: SymbolDefinition[] = [];
        const refs: SymbolReference[] = [];
        
        const collectFromScope = (scope: LexicalScope, sList: SymbolDefinition[], rList: SymbolReference[]) => {
          if (scope.symbols) sList.push(...scope.symbols);
          if (scope.references) rList.push(...scope.references);
          if (scope.children) {
            for (const child of scope.children) {
              collectFromScope(child, sList, rList);
            }
          }
        };
        collectFromScope(res, syms, refs);

        for (const ref of refs) {
          if (!ref.resolvedSymbolId) {
            const resolvedSym = syms.find(s => s.name === ref.name);
            if (resolvedSym) {
              ref.resolvedSymbolId = resolvedSym.id;
              if (!resolvedSym.references) {
                resolvedSym.references = [];
              }
              resolvedSym.references.push(ref);
            }
          }
        }

        return res;
      }
    } catch (e: any) {
      console.error("Error inside scope resolution:", e);
      setResolverErrorMsg(e.message || "Error during scope resolution");
    }

    return null;
  }, [astResult, debouncedTestInput, debouncedScopeResolverCode, rootElement]);

  const [queryText, setQueryText] = useState<string>('(struct_decl (identifier) @struct_name)');
  const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({});
  const [cursorPosition, setCursorPosition] = useState({ line: 1, col: 1 });
  const editorScrollContainerRef = useRef<HTMLDivElement>(null);
  const diskFileInputRef = useRef<HTMLInputElement>(null);
  const testEditorRef = useRef<any>(null);

  // Selector to flatten symbols and references for the AST Goto Definition action
  const allSymbolsAndReferences = useMemo(() => {
    if (!scopeChain) return { symbols: [], references: [] };
    const symbols: SymbolDefinition[] = [];
    const references: SymbolReference[] = [];
    const collect = (scope: LexicalScope) => {
      if (scope.symbols) symbols.push(...scope.symbols);
      if (scope.references) references.push(...scope.references);
      if (scope.children) {
        for (const child of scope.children) {
          collect(child);
        }
      }
    };
    collect(scopeChain);
    return { symbols, references };
  }, [scopeChain]);

  const doCopy = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMap(prev => ({ ...prev, [key]: true }));
    setTimeout(() => {
      setCopiedMap(prev => ({ ...prev, [key]: false }));
    }, 1500);
  };

  const scrollToNode = (node: any) => {
    if (!node || typeof node.start !== 'number' || typeof node.end !== 'number') return;
    
    // Focus and select/scroll in CodeMirror if available
    if (testEditorRef.current?.view) {
      testEditorRef.current.view.focus();
      testEditorRef.current.view.dispatch({
        selection: { anchor: node.start, head: node.end },
        scrollIntoView: true
      });
    } else {
      // Legacy textarea fallback
      const textarea = editorScrollContainerRef.current?.querySelector('textarea');
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(node.start, node.end);
      }
    }
    
    // Scroll and position calculation reports
    const textBefore = debouncedTestInput.substring(0, node.start);
    const linesBefore = textBefore.split('\n');
    const line = linesBefore.length;
    const col = linesBefore[linesBefore.length - 1].length + 1;
    
    setCursorPosition({ line, col });

    if (editorScrollContainerRef.current) {
      const container = editorScrollContainerRef.current;
      const targetScrollTop = (line - 1) * 20 - container.clientHeight / 3;
      container.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: 'smooth'
      });
    }

    setSelectedCstNode(node);
  };

  const findSymbolById = (symId: string): SymbolDefinition | null => {
    const searchScope = (scope: LexicalScope): SymbolDefinition | null => {
      for (const sym of scope.symbols) {
        if (sym.id === symId) return sym;
      }
      for (const child of scope.children) {
        const found = searchScope(child);
        if (found) return found;
      }
      return null;
    };

    if (scopeChain) {
      const found = searchScope(scopeChain);
      if (found) return found;
    }
    return null;
  };

  const [useIncremental, setUseIncremental] = useState<boolean>(true);
  const [cacheStats, setCacheStats] = useState<{ hits: number; misses: number; size: number } | null>(null);
  const [parseDuration, setParseDuration] = useState<number>(0);
  const incrementalParserRef = useRef<IncrementalParser | null>(null);
  const pendingEditsRef = useRef<{ editOffset: number; removedLength: number; insertedText: string }[]>([]);
  const latestCSTRef = useRef<any>(null);

  const shiftAstAndStateOffsets = (editOffset: number, removedLength: number, delta: number) => {
    const shiftRedNode = (node: any) => {
      if (!node || typeof node !== 'object') return;
      
      if (typeof node.offset === 'number') {
        if (node.offset >= editOffset + removedLength) {
          node.offset += delta;
        } else if (node.offset >= editOffset) {
          node.offset += delta;
        }
      }

      if (node._valueCache !== undefined && Array.isArray(node._valueCache)) {
        const len = node._valueCache.length;
        for (let i = 0; i < len; i++) {
          shiftRedNode(node._valueCache[i]);
        }
      }
    };

    // Shift AST / Parse Results
    if (parseResult) shiftRedNode(parseResult);
    if (latestCSTRef.current) shiftRedNode(latestCSTRef.current);

    const shiftGeneralObj = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      if (typeof obj.start === 'number') {
        if (obj.start >= editOffset + removedLength) {
          obj.start += delta;
        } else if (obj.start >= editOffset) {
          obj.start += delta;
        }
      }
      if (typeof obj.end === 'number') {
        if (obj.end >= editOffset + removedLength) {
          obj.end += delta;
        } else if (obj.end >= editOffset) {
          obj.end += delta;
        }
      }
      if (Array.isArray(obj.references)) {
        for (const ref of obj.references) {
          shiftGeneralObj(ref);
        }
      }
      if (Array.isArray(obj.referencedBy)) {
        for (const rBy of obj.referencedBy) {
          shiftGeneralObj(rBy);
        }
      }
    };

    // Shift UI states
    if (hoveredScope) shiftGeneralObj(hoveredScope);
    if (selectedScope) shiftGeneralObj(selectedScope);
    if (hoveredSymbol) shiftGeneralObj(hoveredSymbol);
    if (selectedSymbol) shiftGeneralObj(selectedSymbol);
    if (hoveredReference) shiftGeneralObj(hoveredReference);
    if (selectedReference) shiftGeneralObj(selectedReference);
  };

  // Debounced input states to reduce keystroke latency
  const [debouncedGrammarCode, setDebouncedGrammarCode] = useState<string>(grammarCode);



  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedGrammarCode(grammarCode);
    }, 250); // 250ms debounce for grammar definition
    return () => clearTimeout(handler);
  }, [grammarCode]);

  // Layout states for adjustable and collapsible panels
  const [designerEditorWidth, setDesignerEditorWidth] = useState(500);
  const [designerEditorCollapsed, setDesignerEditorCollapsed] = useState(false);
  
  
  
  
  // Visual logic flow layout and selection states
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [explorationHistory, setExplorationHistory] = useState<string[]>([]);
  const [visualFlowCollapsed, setVisualFlowCollapsed] = useState(false);
  const [ruleSearch, setRuleSearch] = useState("");

  const selectElementWithHistory = (id: string | null) => {
    if (id === selectedElementId) return;
    if (selectedElementId) {
      setExplorationHistory(prev => [...prev, selectedElementId]);
    }
    setSelectedElementId(id);
  };

  const goBackHistory = () => {
    if (explorationHistory.length === 0) return;
    const previous = explorationHistory[explorationHistory.length - 1];
    setExplorationHistory(prev => prev.slice(0, -1));
    setSelectedElementId(previous);
  };

  useEffect(() => {
    setExplorationHistory([]);
  }, [debouncedGrammarCode]);

  // Visual CST node hover and click selection states
  const [selectedCstNode, setSelectedCstNode] = useState<any | null>(null);
  const [hoveredCstNode, setHoveredCstNode] = useState<any | null>(null);

  // Resize handler for Designer panel
  const startDesignerResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = designerEditorWidth;

    const doDrag = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = startWidth + deltaX;
      
      if (newWidth < 180) {
        setDesignerEditorCollapsed(true);
        setDesignerEditorWidth(250); // Reset size for clean re-expansion
      } else {
        const constrainedWidth = Math.min(window.innerWidth * 0.75, newWidth);
        setDesignerEditorCollapsed(false);
        setDesignerEditorWidth(constrainedWidth);
      }
    };

    const stopDrag = () => {
      document.removeEventListener('mousemove', doDrag);
      document.removeEventListener('mouseup', stopDrag);
    };

    document.addEventListener('mousemove', doDrag);
    document.addEventListener('mouseup', stopDrag);
  };

  // Load projects from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('syntax_engine_projects');
    if (saved) {
      try {
        setSavedProjects(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load projects", e);
      }
    }
  }, []);

  // Save projects to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('syntax_engine_projects', JSON.stringify(savedProjects));
  }, [savedProjects]);

  const saveProjectToDisk = () => {
    const name = prompt("Project Name:", projectName) || projectName;
    if (!name) return;
    
    const newProject: SavedProject = {
      id: Math.random().toString(36).substring(2, 9),
      name,
      grammar: grammarCode,
      input: testInput,
      scopeResolver: scopeResolverCode,
      ast: astCode,
      updatedAt: Date.now()
    };
    
    // Save locally to localStorage index
    setSavedProjects(prev => {
      const filtered = prev.filter(p => p.name !== name);
      return [newProject, ...filtered];
    });
    setProjectName(name);

    // Trigger local disk file download
    try {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(newProject, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_syntax_project.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } catch (e) {
      console.error("Failed to save project to disk", e);
      alert("Error saving project to disk: " + (e as Error).message);
    }
  };

  const triggerLoadProjectFromDisk = () => {
    diskFileInputRef.current?.click();
  };

  const handleLoadProjectFromDisk = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const project = JSON.parse(content) as SavedProject;
        
        if (!project.name || typeof project.grammar !== 'string') {
          throw new Error("Invalid project file structure. Missing 'name' or 'grammar' text.");
        }

        // Apply loaded states
        setGrammarCode(project.grammar);
        setTestInput(project.input || "");
        setAstCode(project.ast || DEFAULT_AST_CODE);
        setScopeResolverCode(project.scopeResolver || DEFAULT_SCOPE_RESOLVER_CODE);
        setProjectName(project.name);

        // Also add/update in our local memory library
        setSavedProjects(prev => {
          const filtered = prev.filter(p => p.name !== project.name);
          const projectWithId = {
            ...project,
            id: project.id || Math.random().toString(36).substring(2, 9),
            updatedAt: project.updatedAt || Date.now()
          };
          return [projectWithId, ...filtered];
        });

        alert(`Successfully imported and loaded "${project.name}" from disk.`);
      } catch (err) {
        console.error("Failed to parse project file.", err);
        alert("Failed to load project from disk: " + (err as Error).message);
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  };

  const loadProject = (project: SavedProject) => {
    setGrammarCode(project.grammar);
    setTestInput(project.input);
    setAstCode(project.ast || DEFAULT_AST_CODE);
    setScopeResolverCode(project.scopeResolver || DEFAULT_SCOPE_RESOLVER_CODE);
    setProjectName(project.name);
    setShowLibrary(false);
  };

  const deleteProject = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSavedProjects(prev => prev.filter(p => p.id !== id));
  };

  const newProject = () => {
    if (confirm("Clear current grammar and start fresh?")) {
      setGrammarCode("");
      setTestInput("");
      setAstCode(DEFAULT_AST_CODE);
      setScopeResolverCode(DEFAULT_SCOPE_RESOLVER_CODE);
      setProjectName("Untitled Project");
    }
  };

  // Sync Code -> Engine
  useEffect(() => {
    try {
      // Clear previous error
      setCodeError(null);
      
      // Syntactically validate code before execution with acorn to pinpoint the exact line & column
      try {
        acorn.parse(debouncedGrammarCode, { ecmaVersion: 'latest', sourceType: 'module' });
      } catch (acornErr: any) {
        if (acornErr.loc) {
          // Remove raw (1:12) trailing parenthesis from acorn error message, if present
          const cleanMsg = acornErr.message ? acornErr.message.replace(/\s*\(\d+:\d+\)\s*$/, '') : "Syntax Error";
          throw new SyntaxError(`${cleanMsg} (Line ${acornErr.loc.line}, Col ${acornErr.loc.column + 1})`);
        }
        throw acornErr;
      }

      // Reset SyntaxElement static states to avoid leaking previous grammar definitions or default trivias
      SyntaxElement.Reset();
      // Execute the grammar code
      // We provide SyntaxElement and the Sort helper to the execution context
      const codeToRun = `(function(SyntaxElement, Sort, Token, DefaultLeadingTrivia, DefaultTrailingTrivia, LiteralMatch, Element, InlinedElement) {
        ${debouncedGrammarCode}
        return typeof root !== 'undefined' ? root : null;
      })\n//# sourceURL=grammar-code.js`;
      
      const executionFunc = eval(codeToRun);
      const root = executionFunc(SyntaxElement, Sort, Token, DefaultLeadingTrivia, DefaultTrailingTrivia, LiteralMatch, Element, InlinedElement);
      if (root instanceof SyntaxElement) {
        root.autoInjectLoopBoundaries();
        setRootElement(root);
        setHierarchy(root.getHierarchy());
      } else {
        setCodeError("Variable 'root' (SyntaxElement) not found in code.");
      }
    } catch (err: any) {
      console.error("Syntax/Runtime error inside grammar:", err);
      
      let errorMsg = err.message || String(err);
      const stack = err.stack || "";
      
      // Try to find "grammar-code.js:LINE:COL" or similar inside the stack trace
      const match = stack.match(/grammar-code\.js:(\d+)(?::(\d+))?/);
      if (match) {
        const rawLine = parseInt(match[1], 10);
        const col = match[2] ? parseInt(match[2], 10) : null;
        
        // We have 1 wrapper line in codeToRun before user's code, so subtract 1
        const userLine = rawLine - 1;
        if (userLine >= 1) {
          if (col !== null) {
            errorMsg = `${errorMsg} (Line ${userLine}, Col ${col})`;
          } else {
            errorMsg = `${errorMsg} (Line ${userLine})`;
          }
        }
      } else if (err.lineNumber !== undefined) {
        const userLine = err.lineNumber - 1;
        if (userLine >= 1) {
          if (err.columnNumber !== undefined) {
            errorMsg = `${errorMsg} (Line ${userLine}, Col ${err.columnNumber})`;
          } else {
            errorMsg = `${errorMsg} (Line ${userLine})`;
          }
        }
      }

      setCodeError(errorMsg);
      setRootElement(null);
      setHierarchy(null);
    }
  }, [debouncedGrammarCode]);

  // Recursively extract all unique defined elements from the grammar hierarchy
  const allElements = useMemo(() => {
    if (!hierarchy) return [];
    const elementsMap = new Map<string, any>();
    
    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (node.id && node.name && !node.isLoop && !node.isInlineElement) {
        if (!elementsMap.has(node.id)) {
          elementsMap.set(node.id, node);
          node.rules?.forEach((rule: any) => {
            if (rule.type === 'choice' && Array.isArray(rule.value)) {
              rule.value.forEach((val: any) => visit(val));
            } else if (rule.value && typeof rule.value === 'object') {
              visit(rule.value);
            }
          });
        }
      } else if (node.isInlineElement || node.isLoop) {
        node.rules?.forEach((rule: any) => {
          if (rule.type === 'choice' && Array.isArray(rule.value)) {
            rule.value.forEach((val: any) => visit(val));
          } else if (rule.value && typeof rule.value === 'object') {
            visit(rule.value);
          }
        });
      }
    };
    
    visit(hierarchy);
    return Array.from(elementsMap.values());
  }, [hierarchy]);

  const activeGrammarElement = useMemo(() => {
    if (!hierarchy) return null;
    const targetId = selectedElementId || hierarchy.id;
    return allElements.find((e: any) => e.id === targetId) || hierarchy;
  }, [allElements, hierarchy, selectedElementId]);

  const activeElementRelations = useMemo(() => {
    if (!activeGrammarElement || allElements.length === 0) return { references: [], referencedBy: [] };
    
    const elementId = activeGrammarElement.id;
    const referencesMap = new Map<string, any>();
    const referencedByMap = new Map<string, any>();
    
    // Find references of the active element
    activeGrammarElement.rules?.forEach((r: any) => {
      const checkVal = (v: any) => {
        if (!v) return;
        if (v.id && v.name && v.id !== elementId) {
          referencesMap.set(v.id, v);
        }
      };
      
      if (r.type === 'choice' && Array.isArray(r.value)) {
        r.value.forEach(checkVal);
      } else {
        checkVal(r.value);
      }
    });

    // Find who references the active element
    allElements.forEach((el: any) => {
      if (el.id === elementId) return;
      el.rules?.forEach((r: any) => {
        const checkVal = (v: any) => {
          if (!v) return;
          if (v.id === elementId) {
            referencedByMap.set(el.id, el);
          }
        };
        
        if (r.type === 'choice' && Array.isArray(r.value)) {
          r.value.forEach(checkVal);
        } else {
          checkVal(r.value);
        }
      });
    });

    return {
      references: Array.from(referencesMap.values()),
      referencedBy: Array.from(referencedByMap.values())
    };
  }, [activeGrammarElement, allElements]);

  // Sync Input -> CST with optional Incremental Parsing telemetry
  useEffect(() => {
    if (!incrementalParserRef.current) {
      incrementalParserRef.current = new IncrementalParser();
    }
  }, []);

  useEffect(() => {
    if (incrementalParserRef.current) {
      incrementalParserRef.current.clear();
    }
    pendingEditsRef.current = [];
  }, [rootElement]);

  useEffect(() => {
    if (rootElement) {
      const startTime = performance.now();
      const isPerformanceActive = activeTab === 'playground' && cstViewMode === 'performance';
      const context: any = { 
        maxOffset: -1, 
        maxError: null, 
        expectedPaths: [], 
        recoveredErrors: [],
        cacheHits: 0,
        cacheMisses: 0,
        profile: isPerformanceActive,
        profileStack: isPerformanceActive ? [] : undefined
      };

      let result: any;
      if (useIncremental) {
        if (!incrementalParserRef.current) {
          incrementalParserRef.current = new IncrementalParser();
        }
        const edits = [...pendingEditsRef.current];
        pendingEditsRef.current = [];
        result = incrementalParserRef.current.parse(rootElement, debouncedTestInput, context, edits);
      } else {
        result = rootElement.parse(debouncedTestInput, 0, new Map(), context);
      }
      
      const endTime = performance.now();
      setParseDuration(endTime - startTime);
      setRecoveredErrors(context.recoveredErrors || []);
      setProfileRoot(context.profileRoot || null);

      const memoTable = incrementalParserRef.current?.getMemoTable();
      setCacheStats({
        hits: context.cacheHits || 0,
        misses: context.cacheMisses || 0,
        size: memoTable ? memoTable.size : 0
      });

      if (result && !result.error) {
        setParseError(null);
        setParseResult(result.ast);
        latestCSTRef.current = result.ast;
      } else {
        const error = context.maxError || result;
        if (error) {
          const combinedMsg = context.expectedPaths.length > 0 
            ? Array.from(new Set(context.expectedPaths)).join(" OR ")
            : error.error || "Parsing failed";
          
          setParseError({ 
            message: combinedMsg, 
            ruleId: error.ruleId,
            offset: error.newOffset 
          });
          setParseResult(null);
        }
      }
    } else {
      setParseResult(null);
      setParseError(null);
      setRecoveredErrors([]);
      setCacheStats(null);
    }
  }, [debouncedTestInput, rootElement, useIncremental, activeTab, cstViewMode]);

  const getLineAndCol = (text: string, offset: number) => {
    const lines = text.slice(0, Math.min(text.length, offset)).split("\n");
    return { line: lines.length, col: lines[lines.length - 1].length + 1 };
  };

  const generateCSharp = () => {
    if (!rootElement) return;
    setCsSelectedFileIndex(0);
    setShowCSharpModal(true);
  };

  const generateTypeScript = () => {
    if (!rootElement) return;
    setTsSelectedFileIndex(0);
    setShowTSModal(true);
  };

  return (
    <div className="h-screen bg-slate-950 text-slate-200 flex flex-col font-sans overflow-hidden relative">
      {/* Mesh Gradient Background Layers */}
      <div className="absolute inset-0 z-0 opacity-40 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-600 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-sky-600 blur-[120px] rounded-full"></div>
        <div className="absolute top-[20%] right-[10%] w-[30%] h-[30%] bg-emerald-600 blur-[100px] rounded-full"></div>
      </div>

      {/* Header */}
      <header className="relative z-10 h-16 border-b border-white/10 backdrop-blur-md bg-white/5 px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <SyntaxEngineLogo className="text-white w-5 h-5" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-lg font-semibold tracking-tight text-white uppercase italic leading-none">
                Syntax<span className="text-indigo-400 font-light">//Engine</span>
              </h1>
              <span className="font-mono text-[9px] text-slate-500/80 leading-none mt-1">
                v1.0.4-LATEST
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex bg-white/5 rounded-lg border border-white/10 p-1">
            <button 
              onClick={() => setActiveTab('designer')}
              className={cn(
                "px-4 py-1 text-[10px] font-bold transition-all rounded",
                activeTab === 'designer' ? "bg-white/10 text-white shadow-sm" : "text-slate-400 hover:text-white"
              )}
            >
              DESIGNER
            </button>
            <button 
              onClick={() => setActiveTab('playground')}
              className={cn(
                "px-4 py-1 text-[10px] font-bold transition-all rounded",
                activeTab === 'playground' ? "bg-white/10 text-white shadow-sm" : "text-slate-400 hover:text-white"
              )}
            >
              PLAYGROUND
            </button>
          </div>

          <div className="flex bg-white/5 rounded-lg border border-white/10 p-1">
            <button 
              onClick={newProject}
              className="px-2 py-1 text-slate-400 hover:text-white transition-colors flex items-center gap-1.5"
              title="New Project"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button 
              onClick={() => setShowLibrary(true)}
              className="px-2 py-1 text-slate-400 hover:text-white transition-colors flex items-center gap-1.5 border-l border-white/10"
              title="Open Library"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
            <button 
              onClick={saveProjectToDisk}
              className="px-2 py-1 text-slate-400 hover:text-white transition-colors flex items-center gap-1.5 border-l border-white/10"
              title="Save Project to Disk"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button 
              onClick={triggerLoadProjectFromDisk}
              className="px-2 py-1 text-slate-400 hover:text-white transition-colors flex items-center gap-1.5 border-l border-white/10"
              title="Load Project from Disk"
            >
              <Upload className="w-3.5 h-3.5" />
            </button>

            <input 
              type="file"
              ref={diskFileInputRef}
              onChange={handleLoadProjectFromDisk}
              accept=".json"
              style={{ display: 'none' }}
            />
          </div>

          <div className="flex bg-white/5 rounded-lg border border-white/10 p-1">
            <button 
              onClick={generateCSharp}
              className="px-3 py-1 text-[10px] font-bold text-slate-400 hover:text-white transition-colors flex items-center gap-1.5"
            >
              <Code2 className="w-3 h-3 text-indigo-400" /> C#
            </button>
            <button 
              onClick={generateTypeScript}
              className="px-3 py-1 text-[10px] font-bold text-slate-400 hover:text-white transition-colors flex items-center gap-1.5"
            >
              <Code2 className="w-3 h-3 text-orange-400" /> TS
            </button>
          </div>
          <button className="flex items-center gap-2 px-4 py-1.5 bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-semibold rounded-lg shadow-lg shadow-indigo-500/30 transition-colors">
            <Rocket className="w-4 h-4" />
            Deploy Engine
          </button>
        </div>
      </header>

      <main className="relative z-10 flex-1 flex overflow-hidden">
        <AnimatePresence mode="wait">
          {activeTab === 'designer' ? (
            <motion.div 
              key="designer"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 flex overflow-hidden"
            >
              {/* Pillar 1: Code Editor */}
              {!designerEditorCollapsed ? (
                <aside 
                  style={visualFlowCollapsed ? undefined : { width: `${designerEditorWidth}px` }}
                  className={cn(
                    "border-r border-white/10 bg-black/20 backdrop-blur-lg flex flex-col overflow-hidden",
                    visualFlowCollapsed ? "flex-1" : "shrink-0"
                  )}
                >
                  <div className="flex items-center justify-between p-3 border-b border-white/5 shrink-0 bg-[#0e0e11]/85 gap-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setDesignerEditorCollapsed(true)}
                        className="p-1 hover:bg-white/10 rounded-md text-slate-400 hover:text-white transition-colors cursor-pointer mr-1"
                        title="Collapse Editor"
                      >
                        <PanelLeftClose className="w-4 h-4 text-indigo-400" />
                      </button>
                      <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                      <span className="text-[10px] font-bold text-slate-200 uppercase tracking-widest">{projectName}</span>
                      
                      {designerEditorTab === 'grammar' && codeError && (
                        <div className="flex items-center gap-1.5 text-rose-400 text-[10px] font-bold animate-pulse ml-2 border border-rose-500/20 bg-rose-500/5 px-2 py-0.5 rounded-full">
                          <AlertCircle className="w-3 h-3" /> Grammar Error
                        </div>
                      )}
                      {designerEditorTab === 'scope' && scopeError && (
                        <div className="flex items-center gap-1.5 text-rose-400 text-[10px] font-bold animate-pulse ml-2 border border-rose-500/20 bg-rose-500/5 px-2 py-0.5 rounded-full">
                          <AlertCircle className="w-3 h-3" /> Scope Error
                        </div>
                      )}
                    </div>

                    {/* Sub Tab Selection bar inline */}
                    <div className="flex items-center bg-slate-900/60 p-1 gap-1 rounded-xl border border-white/5 shrink-0">
                      <button
                        onClick={() => setDesignerEditorTab('grammar')}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 text-[9px] uppercase tracking-wider font-extrabold rounded-lg border transition-all cursor-pointer shadow-sm",
                          designerEditorTab === 'grammar'
                            ? "bg-indigo-600/15 border-indigo-500/30 text-indigo-300"
                            : "bg-transparent border-transparent text-slate-400 hover:text-slate-300 hover:bg-white/[0.02]"
                        )}
                      >
                        <FileCode className="w-3.5 h-3.5 text-indigo-400" /> Grammar Rules
                      </button>
                      <button
                        onClick={() => setDesignerEditorTab('scope')}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 text-[9px] uppercase tracking-wider font-extrabold rounded-lg border transition-all cursor-pointer shadow-sm",
                          designerEditorTab === 'scope'
                            ? "bg-indigo-600/15 border-indigo-500/30 text-indigo-300"
                            : "bg-transparent border-transparent text-slate-400 hover:text-slate-300 hover:bg-white/[0.02]"
                        )}
                      >
                        <GitBranch className="w-3.5 h-3.5 text-indigo-400" /> Scope Resolver
                      </button>
                      <button
                        id="diag-console-tab-btn"
                        onClick={() => setDesignerEditorTab('console')}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 text-[9px] uppercase tracking-wider font-extrabold rounded-lg border transition-all cursor-pointer shadow-sm relative",
                          designerEditorTab === 'console'
                            ? "bg-indigo-600/15 border-indigo-500/30 text-indigo-300"
                            : "bg-transparent border-transparent text-slate-400 hover:text-slate-300 hover:bg-white/[0.02]"
                        )}
                      >
                        <Terminal className="w-3.5 h-3.5 text-indigo-400" /> Console
                        {grammarDiagnostics.length > 0 && (
                          <div className="absolute -top-1 -right-1 flex gap-0.5 pointer-events-none">
                            {errorsCount > 0 && (
                              <span className="flex h-3.5 min-w-[14px] px-1 items-center justify-center rounded-full text-[8px] font-extrabold text-white shadow-md bg-rose-500 border border-slate-900 leading-none">
                                {errorsCount}
                              </span>
                            )}
                            {warningsCount > 0 && (
                              <span className="flex h-3.5 min-w-[14px] px-1 items-center justify-center rounded-full text-[8px] font-extrabold text-white shadow-md bg-amber-500 border border-slate-900 leading-none">
                                {warningsCount}
                              </span>
                            )}
                            {infosCount > 0 && (
                              <span className="flex h-3.5 min-w-[14px] px-1 items-center justify-center rounded-full text-[8px] font-extrabold text-white shadow-md bg-indigo-500 border border-slate-900 leading-none">
                                {infosCount}
                              </span>
                            )}
                          </div>
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-hidden flex flex-col bg-[#1a1a1a]/55 relative">
                    {designerEditorTab === 'console' ? (
                      <div className="p-4 flex flex-col gap-4 h-full overflow-auto custom-scrollbar bg-[#1e1e24] text-slate-200">
                        <div className="flex items-center justify-between border-b border-white/5 pb-3">
                          <div className="flex items-center gap-2">
                            <Terminal className="w-4 h-4 text-indigo-400" />
                            <span className="text-xs font-bold text-slate-200 tracking-wider uppercase font-sans">
                              Grammar Diagnostics Console
                            </span>
                          </div>
                          <div className="flex gap-1.5">
                            {errorsCount > 0 && (
                              <span className="text-[9px] bg-rose-500/10 text-rose-300 px-2 py-0.5 rounded border border-rose-500/20 uppercase tracking-widest font-extrabold">
                                {errorsCount} Error{errorsCount !== 1 ? 's' : ''}
                              </span>
                            )}
                            {warningsCount > 0 && (
                              <span className="text-[9px] bg-amber-500/10 text-amber-300 px-2 py-0.5 rounded border border-amber-500/20 uppercase tracking-widest font-extrabold">
                                {warningsCount} Warning{warningsCount !== 1 ? 's' : ''}
                              </span>
                            )}
                            {infosCount > 0 && (
                              <span className="text-[9px] bg-indigo-500/10 text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/20 uppercase tracking-widest font-extrabold">
                                {infosCount} Info{infosCount !== 1 ? 's' : ''}
                              </span>
                            )}
                            {grammarDiagnostics.length === 0 && (
                              <span className="text-[9px] bg-emerald-500/10 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/20 uppercase tracking-widest font-extrabold">
                                Pristine
                              </span>
                            )}
                          </div>
                        </div>

                        {grammarDiagnostics.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-12 px-4 border border-emerald-500/10 bg-emerald-500/5 rounded-xl text-center">
                            <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mb-3 shadow-lg shadow-emerald-500/5">
                              <CheckCircle2 className="w-6 h-6 animate-pulse" />
                            </div>
                            <h4 className="text-sm font-bold text-emerald-300 mb-1">Grammar is Pristine!</h4>
                            <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
                              No shadowing, left recursions, empty elements, or scope mismatched diagnostics were detected. Your compiler blueprint is fully optimized!
                            </p>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-3 pb-8">
                            {grammarDiagnostics.map((diag, index) => {
                              const isError = diag.type === 'error';
                              const isWarning = diag.type === 'warning';
                              return (
                                <div 
                                  key={index} 
                                  className={cn(
                                    "p-4 border rounded-xl flex flex-col gap-2.5 transition-all relative overflow-hidden backdrop-blur-md",
                                    isError 
                                      ? "bg-rose-500/5 border-rose-500/20 hover:border-rose-500/35 shadow-sm" 
                                      : isWarning 
                                      ? "bg-amber-500/5 border-amber-500/20 hover:border-amber-500/35 shadow-sm" 
                                      : "bg-blue-500/5 border-blue-500/20 hover:border-blue-500/35 shadow-sm"
                                  )}
                                >
                                  <div className="flex items-center justify-between gap-2 shrink-0">
                                    <div className="flex items-center gap-2">
                                      <span className={cn(
                                        "px-2 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-widest border",
                                        isError 
                                          ? "bg-rose-500/25 text-rose-300 border-rose-500/40" 
                                          : isWarning 
                                          ? "bg-amber-500/25 text-amber-300 border-amber-500/40" 
                                          : "bg-blue-500/25 text-blue-300 border-blue-500/40"
                                      )}>
                                        {diag.type}
                                      </span>
                                      <span className="font-mono text-[9px] text-indigo-300 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 uppercase tracking-wider font-extrabold">
                                        node: {diag.nodeName}
                                      </span>
                                    </div>
                                  </div>

                                  <p className="text-xs text-slate-200 leading-relaxed font-sans">
                                    {diag.message}
                                  </p>

                                  <div className={cn(
                                    "p-3 rounded-lg text-xs leading-relaxed font-sans border flex flex-col gap-1",
                                    isError
                                      ? "bg-rose-500/10 border-rose-500/10 text-rose-200"
                                      : isWarning
                                      ? "bg-amber-500/10 border-amber-500/10 text-amber-200"
                                      : "bg-blue-500/10 border-blue-500/10 text-blue-200"
                                  )}>
                                    <span className="font-extrabold uppercase tracking-wider text-[8px] opacity-80">
                                      Recommendation / Fix:
                                    </span>
                                    <span>
                                      {diag.suggestion}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex-1 flex min-h-0 divide-x divide-white/5 relative items-stretch">
                        <div className="flex-1 overflow-auto custom-scrollbar relative grammar-editor-container">
                          <GrammarCodeMirror
                            value={
                              designerEditorTab === 'grammar' 
                                ? grammarCode 
                                : designerEditorTab === 'ast'
                                ? astCode
                                : scopeResolverCode
                            }
                            onChange={code => {
                              if (designerEditorTab === 'grammar') {
                                setGrammarCode(code);
                              } else if (designerEditorTab === 'ast') {
                                setAstCode(code);
                              } else {
                                setScopeResolverCode(code);
                              }
                            }}
                            isGrammarTab={designerEditorTab === 'grammar'}
                            diagnostics={grammarDiagnostics}
                            codeError={codeError}
                            className="h-full"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {designerEditorTab === 'grammar' && codeError && (
                    <div className="p-4 bg-rose-500/10 border-t border-rose-500/20 text-rose-300 text-xs font-mono">
                      <p className="font-bold opacity-70 mb-1">GRAMMAR_RUNTIME_ERROR:</p>
                      {codeError}
                    </div>
                  )}

                  {designerEditorTab === 'ast' && astError && (
                    <div className="p-4 bg-rose-500/10 border-t border-rose-500/20 text-rose-300 text-xs font-mono">
                      <p className="font-bold opacity-70 mb-1">AST_GENERATION_ERROR:</p>
                      {astError}
                    </div>
                  )}

                  {designerEditorTab === 'scope' && scopeError && (
                    <div className="p-4 bg-rose-500/10 border-t border-rose-500/20 text-rose-300 text-xs font-mono">
                      <p className="font-bold opacity-70 mb-1">SCOPE_RESOLVER_ERROR:</p>
                      {scopeError}
                    </div>
                  )}
                </aside>
              ) : (
                <div className="w-[42px] border-r border-white/10 bg-[#121214]/60 backdrop-blur-lg flex flex-col items-center py-4 gap-6 shrink-0 relative z-30 select-none">
                  <button
                    onClick={() => setDesignerEditorCollapsed(false)}
                    className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer shadow-lg"
                    title="Expand Editor"
                  >
                    <PanelLeftOpen className="w-4 h-4 text-indigo-400" />
                  </button>
                  <div className="flex-1 flex items-center justify-center">
                    <span className="rotate-90 text-[8.5px] font-black tracking-[0.25em] text-slate-500 uppercase whitespace-nowrap">
                      GRAMMAR EDITOR
                    </span>
                  </div>
                </div>
              )}

              {/* Adjust Width Handle for Designer */}
              {!designerEditorCollapsed && !visualFlowCollapsed && (
                <div
                  onMouseDown={startDesignerResize}
                  onDoubleClick={() => setDesignerEditorWidth(500)}
                  className="w-1.5 hover:w-2 bg-white/5 hover:bg-indigo-500/50 active:bg-indigo-500 cursor-col-resize select-none relative z-30 transition-all flex items-center justify-center group shrink-0"
                  title="Drag to resize, Double click to reset"
                >
                  <div className="absolute top-1/2 -translate-y-1/2 w-4 h-[32px] rounded-md bg-slate-900 border border-white/10 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none gap-0.5">
                    <span className="w-0.5 h-1.5 bg-white/40 rounded-full" />
                    <span className="w-0.5 h-1.5 bg-white/40 rounded-full" />
                  </div>
                </div>
              )}

              {/* Pillar 2: Rules Visualizer */}
              <VisualRulesInspector
                hierarchy={hierarchy}
                activeGrammarElement={activeGrammarElement}
                ruleViewMode={ruleViewMode}
                setRuleViewMode={setRuleViewMode}
                visualFlowCollapsed={visualFlowCollapsed}
                setVisualFlowCollapsed={setVisualFlowCollapsed}
                parseError={parseError}
                selectElementWithHistory={selectElementWithHistory}
                ruleSearch={ruleSearch}
                setRuleSearch={setRuleSearch}
                allElements={allElements}
                activeElementRelations={activeElementRelations}
                explorationHistory={explorationHistory}
                goBackHistory={goBackHistory}
              />
            </motion.div>
          ) : (
            <PlaygroundTab
              testInput={testInput}
              setTestInput={setTestInput}
              debouncedTestInput={debouncedTestInput}
              useIncremental={useIncremental}
              setUseIncremental={setUseIncremental}
              parseDuration={parseDuration}
              cacheStats={cacheStats}
              parseError={parseError}
              recoveredErrors={recoveredErrors}
              testEditorRef={testEditorRef}
              editorScrollContainerRef={editorScrollContainerRef}
              pendingEditsRef={pendingEditsRef}
              shiftAstAndStateOffsets={shiftAstAndStateOffsets}
              setCursorPosition={setCursorPosition}
              cursorPosition={cursorPosition}
              getLineAndCol={getLineAndCol}
              allSymbolsAndReferences={allSymbolsAndReferences}
              cstViewMode={cstViewMode}
              setCstViewMode={setCstViewMode}
              visualizeMode={visualizeMode}
              setVisualizeMode={setVisualizeMode}
              astResult={astResult}
              parseResult={parseResult}
              selectedCstNode={selectedCstNode}
              setSelectedCstNode={setSelectedCstNode}
              hoveredCstNode={hoveredCstNode}
              setHoveredCstNode={setHoveredCstNode}
              scrollToNode={scrollToNode}
              queryText={queryText}
              setQueryText={setQueryText}
              copiedMap={copiedMap}
              doCopy={doCopy}
              pinnedOffset={pinnedOffset}
              setPinnedOffset={setPinnedOffset}
              hoveredOffset={hoveredOffset}
              setHoveredOffset={setHoveredOffset}
              investigateHoveredNode={investigateHoveredNode}
              setInvestigateHoveredNode={setInvestigateHoveredNode}
              debouncedInvestigateOffset={debouncedInvestigateOffset}
              scopeSearchQuery={scopeSearchQuery}
              setScopeSearchQuery={setScopeSearchQuery}
              scopeError={scopeError}
              scopeChain={scopeChain}
              selectedScope={selectedScope}
              setSelectedScope={setSelectedScope}
              selectedSymbol={selectedSymbol}
              setSelectedSymbol={setSelectedSymbol}
              setHoveredScope={setHoveredScope}
              selectedReference={selectedReference}
              setSelectedReference={setSelectedReference}
              setHoveredSymbol={setHoveredSymbol}
              setHoveredReference={setHoveredReference}
              findSymbolById={findSymbolById}
              profileRoot={profileRoot}
            />
          )}
        </AnimatePresence>
      </main>

      {/* Footer has been removed and vital stats moved to header */}

      {/* Library Modal Overlay */}
      <ProjectLibraryModal
        showLibrary={showLibrary}
        setShowLibrary={setShowLibrary}
        savedProjects={savedProjects}
        loadProject={loadProject}
        deleteProject={deleteProject}
        newProject={newProject}
        importFromDisk={triggerLoadProjectFromDisk}
      />

      {/* C# Export Modal */}
      <CSharpExportModal
        showCSharpModal={showCSharpModal}
        setShowCSharpModal={setShowCSharpModal}
        csNamespace={csNamespace}
        setCsNamespace={setCsNamespace}
        csExportMode={csExportMode}
        setCsExportMode={setCsExportMode}
        csAstSeparate={csAstSeparate}
        setCsAstSeparate={setCsAstSeparate}
        csGeneratedFiles={csGeneratedFiles}
        csSelectedFileIndex={csSelectedFileIndex}
        setCsSelectedFileIndex={setCsSelectedFileIndex}
        downloadAllFiles={downloadAllFiles}
        downloadSingleFile={downloadSingleFile}
        copiedFileIndex={copiedFileIndex}
        setCopiedFileIndex={setCopiedFileIndex}
      />

      {/* TS Export Modal */}
      <TypeScriptExportModal
        showTSModal={showTSModal}
        setShowTSModal={setShowTSModal}
        tsGeneratedFiles={tsGeneratedFiles}
        tsSelectedFileIndex={tsSelectedFileIndex}
        setTsSelectedFileIndex={setTsSelectedFileIndex}
        downloadSingleFile={downloadSingleFile}
        copiedFileIndex={tsCopiedFileIndex}
        setCopiedFileIndex={setTsCopiedFileIndex}
      />
    </div>
  );
}
