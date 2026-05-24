import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  FolderOpen,
  Plus,
  Trash2, 
  Play, 
  Code2, 
  Save, 
  X, 
  Settings, 
  Database,
  Cpu,
  Layers,
  FileCode,
  AlertCircle,
  CheckCircle2,
  Rocket,
  Terminal,
  Zap,
  Copy,
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  Maximize,
  ChevronDown,
  ChevronUp,
  Search,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Link,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  ChevronsLeftRight,
  MapPin,
  Check,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactJson from 'react-json-view';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/themes/prism-tomorrow.css';
import { SyntaxElement, ParseResult, IncrementalParser, CSTQuery, QueryMatch, ScopeBuilder, LexicalScope, SymbolDefinition, SymbolReference, generateFullCSharp, generateModularCSharp, wrapASTTransformerWithIncrementalCache, findDiff } from './lib/engine';
import { cn } from './lib/utils';
import { ParserProfiler } from './components/ParserProfiler';

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
    cls = "text-slate-500/30";
  } else if (name.includes("struct") || name.includes("class") || name.includes("interface") || name.includes("cbuffer")) {
    cls = "text-violet-400 font-bold";
  } else if (name.includes("semantics") || name === "semantic" || name.includes("colon")) {
    cls = "text-purple-400";
  } else {
    cls = "text-indigo-200/90";
  }

  if (isInActiveBlock) {
    // Overlay block highlighting styling beautifully
    cls += " bg-indigo-950/40 text-indigo-100 ring-1 ring-indigo-500/15 rounded-sm";
  }

  return cls;
};

interface SavedProject {
  id: string;
  name: string;
  grammar: string;
  input: string;
  scopeResolver?: string;
  ast?: string;
  updatedAt: number;
  workspaceFiles?: Record<string, string>;
  activeFileName?: string;
}

const DEFAULT_CODE = `// Unity ShaderLab & HLSL Parser
// 💡 PRECEDENCE: Use .Prec(level) to resolve ambiguities (higher = priority).
// 💡 GREEDY CHOICE: ExpectsOneOf tries all branches and picks the best one 
//    (highest precedence, then longest consumed match).
// 💡 SELF-HEALING: Use .SelfHeals(...boundaries) on structural blocks to automatically skip typos/errors and synchronize parsing at boundaries.

const ws = new SyntaxElement('ws').ExpectsWhitespace().Hide();
const comment = new SyntaxElement('line_comment').Expects(/\\/\\/.*|\\/\\*[\\s\\S]*?\\*\\//).Hide();
// The noise element matches consecutive whitespaces and comments
const noise = new SyntaxElement('noise').ZeroOrMore(new SyntaxElement('n').ExpectsOneOf(ws, comment)).Hide();

// Helper: skip noise
const s = new SyntaxElement('s').ZeroOrMore(new SyntaxElement('n').ExpectsOneOf(ws, comment)).Hide();

const id = new SyntaxElement("id").Expects(/[a-zA-Z_][a-zA-Z0-9_]*/);
const number = new SyntaxElement("number").Expects(/-?[0-9]*\\.?[0-9]+f?/);
const string = new SyntaxElement("string").Expects(/"[^"]*"/);

// --- HLSL BLOCK ---
const hlslType = new SyntaxElement("hlsl_type").ExpectsOneOf(
  "float4x4", "float4", "float3", "float2", "float",
  "half4", "half3", "half2", "half",
  "fixed4", "fixed3", "fixed2", "fixed",
  "int", "bool", "uint", "sampler2D", "Texture2D", "SamplerState", id
);

const semantic = new SyntaxElement("semantic").Expects(":").Optional(s).Expects(/[a-zA-Z0-9_]+/);

const arraySpec = new SyntaxElement("array_spec").Expects("[").Optional(s).Expects(/[0-9]*/).Optional(s).Expects("]");

const varDecl = new SyntaxElement("variable")
  .Expects(hlslType).Expects(s).Expects(id)
  .Optional(new SyntaxElement("opt_array").Optional(s).Expects(arraySpec))
  .Optional(new SyntaxElement("sem_opt").Optional(s).Expects(semantic))
  .Optional(s).Expects(";")
  .SelfHeals(";");

// Allow structMember to recover on ';' or new line comments
const structMember = new SyntaxElement("struct_member")
  .Unexpects("}")
  .Optional(s).ExpectsOneOf(varDecl, comment).RecoverWith(";", /\\n/)
  .SelfHeals(";", "}");

const structDecl = new SyntaxElement("struct")
  .Expects("struct").Expects(s).Expects(id).Optional(s).Expects("{")
  .ZeroOrMore(structMember)
  .Optional(s).Expects("}").Optional(s).Expects(";")
  .SelfHeals("}", ";");

const param = new SyntaxElement("param")
  .Optional(new SyntaxElement("inout").ExpectsOneOf("inout", "in", "out").Expects(s))
  .Expects(hlslType).Expects(s).Expects(id)
  .Optional(new SyntaxElement("sem_opt").Optional(s).Expects(semantic));

const paramList = new SyntaxElement("param_list")
  .Optional(new SyntaxElement("params").Expects(param).ZeroOrMore(new SyntaxElement("comma_param").Optional(s).Expects(",").Optional(s).Expects(param)));

// Recursive block matcher for func content
const codeBlock = new SyntaxElement("code_block");
codeBlock.Expects("{").ZeroOrMore(new SyntaxElement("block_content").ExpectsOneOf(
    /[^{}]+/, 
    codeBlock
)).Expects("}");

const funcDecl = new SyntaxElement("function")
  .Expects(hlslType).Expects(s).Expects(id).Optional(s).Expects("(").Optional(s).Optional(paramList).Optional(s).Expects(")")
  .Optional(new SyntaxElement("sem_opt").Optional(s).Expects(semantic))
  .Optional(s).Expects(codeBlock)
  .SelfHeals("}");

const directive = new SyntaxElement("directive").Expects(/#[a-zA-Z]+[^\\r\\n]*/);

const hlslContent = new SyntaxElement("hlsl_content")
  .Unexpects("ENDCG").Unexpects("ENDHLSL")
  .ExpectsOneOf(structDecl, funcDecl, varDecl, directive).RecoverWith(";", /\\n/)
  .SelfHeals(";", "}");

const hlslBlock = new SyntaxElement("hlsl_block")
  .ExpectsOneOf("CGPROGRAM", "HLSLPROGRAM").Optional(s)
  .ZeroOrMore(new SyntaxElement("hlsl_entry").Optional(s).Expects(hlslContent))
  .Optional(s).ExpectsOneOf("ENDCG", "ENDHLSL")
  .SelfHeals("ENDCG", "ENDHLSL");

// --- SHADERLAB ---
const propAttr = new SyntaxElement("prop_attr").Expects("[").Optional(s).Expects(id).Optional(s).Expects("]").Optional(s);
const propType = new SyntaxElement("prop_type").ExpectsOneOf("Color", "2D", "Rect", "Cube", "Float", "Int", "Range", "Vector");
const propTypeArgs = new SyntaxElement("prop_type_args").Expects("(").Optional(/[^)]*/).Expects(")");
const propValue = new SyntaxElement("prop_value").ExpectsOneOf(string, number, new SyntaxElement("tuple").Expects("(").Optional(/[^)]*/).Expects(")"), id);

const propBlock = new SyntaxElement("prop_block").Expects("{").Optional(s).Expects("}");

const propDecl = new SyntaxElement("property")
  .Unexpects("}")
  .ZeroOrMore(propAttr)
  .Expects(id).Optional(s).Expects("(").Optional(s).Expects(string).Optional(s).Expects(",").Optional(s).Expects(propType)
  .Optional(propTypeArgs).Optional(s).Expects(")").Optional(s).Expects("=").Optional(s).Expects(propValue)
  .Optional(new SyntaxElement("opt_prop_block").Optional(s).Expects(propBlock))
  .RecoverWith(/\\n/)
  .SelfHeals();

const propertiesBlock = new SyntaxElement("properties_block")
  .Expects("Properties").Optional(s).Expects("{")
  .ZeroOrMore(new SyntaxElement("prop_entry").Optional(s).Expects(propDecl))
  .Optional(s).Expects("}")
  .SelfHeals("}");

const tagEntry = new SyntaxElement("tag_entry").Expects(string).Optional(s).Expects("=").Optional(s).Expects(string);
const tagsBlock = new SyntaxElement("tags_block")
  .Expects("Tags").Optional(s).Expects("{").Optional(s)
  .ZeroOrMore(new SyntaxElement("tag_item").Expects(tagEntry).Optional(s).Optional(new SyntaxElement("c").Expects(",")).Optional(s))
  .Expects("}");

const lodState = new SyntaxElement("lod_state").Expects("LOD").Expects(s).Expects(/[0-9]+/);
const blendState = new SyntaxElement("blend_state").Expects("Blend").Expects(s).Expects(/[a-zA-Z]+/).Expects(s).Expects(/[a-zA-Z]+/);
const zwriteState = new SyntaxElement("zwrite_state").Expects("ZWrite").Expects(s).ExpectsOneOf("On", "Off");
const cullState = new SyntaxElement("cull_state").Expects("Cull").Expects(s).ExpectsOneOf("Back", "Front", "Off");

const passState = new SyntaxElement("pass_state")
  .Unexpects("}")
  .ExpectsOneOf(blendState, zwriteState, cullState, tagsBlock, hlslBlock).RecoverWith(";", /\\n/)
  .SelfHeals(";", "}");

const passBlock = new SyntaxElement("pass_block")
  .Expects("Pass").Optional(s).Expects("{")
  .ZeroOrMore(new SyntaxElement("pass_entry").Optional(s).Expects(passState))
  .Optional(s).Expects("}")
  .SelfHeals("}");

const subshaderState = new SyntaxElement("subshader_state")
  .Unexpects("}")
  .ExpectsOneOf(tagsBlock, blendState, zwriteState, cullState, passBlock, hlslBlock, lodState).RecoverWith("}", /\\n/)
  .SelfHeals("}", "Pass");

const subshaderBlock = new SyntaxElement("subshader_block")
  .Expects("SubShader").Optional(s).Expects("{")
  .ZeroOrMore(new SyntaxElement("subshader_entry").Optional(s).Expects(subshaderState))
  .Optional(s).Expects("}")
  .SelfHeals("}");

const shaderBlock = new SyntaxElement("shader_block")
  .Expects("Shader").Expects(s).Expects(string).Optional(s).Expects("{").Optional(s)
  .Optional(propertiesBlock).Optional(s)
  .ZeroOrMore(subshaderBlock).Optional(s)
  .Expects("}")
  .SelfHeals("}");

const root = new SyntaxElement("_root")
  .Optional(s).Expects(shaderBlock).Optional(s).ExpectsEOF()
  .SelfHeals();`;

const DEFAULT_AST_CODE = `// --- Optional AST Transformer ---
// Map the raw Concrete Syntax Tree (CST) into a clean, custom Abstract Syntax Tree (AST).
// If left as-is or returning null (or if deleted completely), ScopeBuilder, Query, and CodeGen
// will automatically fall back to using the CST directly.

function transform(node) {
  if (!node || typeof node !== 'object') return node;

  // If node is an array, map its items
  if (Array.isArray(node)) {
    return node.map(transform).filter(Boolean);
  }

  // Handle zeroOrMore/oneOrMore/choice wrappers by returning their values
  if (node.type === 'zeroOrMore' || node.type === 'oneOrMore') {
    return transform(node.value);
  }

  // Build a custom clean AST Node
  const cleanNode = {
    type: node.type,
    start: node.start,
    end: node.end
  };

  // Process sub-values recursively
  if (node.value !== undefined) {
    const transformedValue = transform(node.value);
    
    // Flatten children list if it contains elements
    if (Array.isArray(transformedValue)) {
      if (transformedValue.length > 0) {
        cleanNode.children = transformedValue;
      }
    } else if (transformedValue && typeof transformedValue === 'object') {
      cleanNode.data = transformedValue;
    } else if (transformedValue !== null && transformedValue !== undefined) {
      cleanNode.value = transformedValue;
    }
  }

  // If the node ended up with no children, no data, and no value, prune it
  // unless it has a specific type we want to retain (like identifier/id/literals)
  if (
    cleanNode.children === undefined && 
    cleanNode.data === undefined && 
    cleanNode.value === undefined
  ) {
    return null;
  }

  return cleanNode;
}

// Transform the entire Concrete Syntax Tree (CST) 
return transform(cst);
`;

const DEFAULT_SCOPE_RESOLVER_CODE = `// --- Custom Lexical Scope Resolver ---
// Define semantic scopes and symbol bindings using the intuitive ScopeBuilder API.
// Use AST queries to easily map AST nodes to lexical constructs!

const builder = new ScopeBuilder();

// 1. Define Lexical Scopes (containers that hold symbols)
// You can use standard function callbacks, or descriptive string formats like "{name}" or "{node:type}"!
builder.defineScope("struct", "(struct (id @name)) @node", "struct {name}");
builder.defineScope("function", "(function (id @name)) @node", "func {name}");
builder.defineScope("block", "(code_block @node)", "Local Block");

// 2. Define Symbol Declarations (variables, parameters, members)
// Binds patterns matching (variable/param/member) to lexical symbols
builder.defineSymbol("(variable (id @name)) @node", "{name}", "variable", "{node:type}");
builder.defineSymbol("(param (id @name)) @node", "{name}", "parameter", "{node:type}");
builder.defineSymbol("(struct_member (id @name)) @node", "{name}", "member", "{node:type}");

// 3. Define Symbol References (connects identifiers back to their declarations)
builder.defineReference("(id @name)", "{name}");

return builder.build(ast, fullText);
`;

export default function App() {
  const [grammarCode, setGrammarCode] = useState(DEFAULT_CODE);
  const [workspaceFiles, setWorkspaceFiles] = useState<Record<string, string>>(() => {
    return {
      "main.hlsl": [
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
      ].join("\n"),
      "UnityCG.cginc": [
        "// UnityCG.cginc - Common Unity Shader Helper Functions",
        "",
        "float4 UnityObjectToClipPos(float4 pos) {",
        "    // Model-view-projection transform helper",
        "    return mul(UNITY_MATRIX_MVP, pos);",
        "}",
        "",
        "fixed4 tex2D(sampler2D s, float2 uv) {",
        "    // Texture lookup helper",
        "    return fixed4(1, 1, 1, 1);",
        "}"
      ].join("\n")
    };
  });
  const [activeFileName, setActiveFileName] = useState<string>("main.hlsl");

  const [testInput, setTestInput] = useState<string>(() => {
    const initialFiles = {
      "main.hlsl": [
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
      ].join("\n")
    };
    return initialFiles["main.hlsl"];
  });

  // Debounced input states to reduce keystroke latency
  const [debouncedTestInput, setDebouncedTestInput] = useState<string>(testInput);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedTestInput(testInput);
    }, 200); // 200ms debounce for high performance
    return () => clearTimeout(handler);
  }, [testInput]);

  const [isAddingFile, setIsAddingFile] = useState(false);
  const [newFileNameInput, setNewFileNameInput] = useState("");
  const [renamingFileName, setRenamingFileName] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");

  const [rootElement, setRootElement] = useState<SyntaxElement | null>(null);
  const [hierarchy, setHierarchy] = useState<any>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<any>(null);
  const [profileRoot, setProfileRoot] = useState<any>(null);
  const [parseError, setParseError] = useState<{ message: string; ruleId?: number | string; offset?: number } | null>(null);
  const [recoveredErrors, setRecoveredErrors] = useState<{ message: string; offset: number }[]>([]);
  const [isRecoveredErrorsExpanded, setIsRecoveredErrorsExpanded] = useState(false);
  const [projectName, setProjectName] = useState("HLSL Subset");
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);

  // C# Code Export settings
  const [showCSharpModal, setShowCSharpModal] = useState(false);
  const [csNamespace, setCsNamespace] = useState("SyntaxEngine");
  const [csExportMode, setCsExportMode] = useState<'bundle' | 'modular'>('bundle');
  const [csAstSeparate, setCsAstSeparate] = useState(false);
  const [csSelectedFileIndex, setCsSelectedFileIndex] = useState(0);
  const [copiedFileIndex, setCopiedFileIndex] = useState<number | null>(null);
const [lastScopeBuilder, setLastScopeBuilder] = useState<ScopeBuilder | null>(null);
  
  const csGeneratedFiles = useMemo(() => {
    if (!rootElement) return [];
    if (csExportMode === 'bundle') {
      const code = generateFullCSharp(rootElement, csNamespace, lastScopeBuilder || undefined);
      return [{ name: `${rootElement.name ? rootElement.name.replace(/[^a-zA-Z0-9]/g, '') : 'Parser'}Bundle.cs`, content: code }];
    } else {
      return generateModularCSharp(rootElement, {
        namespace: csNamespace,
        stronglyTypedAstSeparate: csAstSeparate,
        scopeBuilder: lastScopeBuilder || undefined
      });
    }
  }, [rootElement, csNamespace, csExportMode, csAstSeparate, lastScopeBuilder]);

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
  const [cstViewMode, setCstViewMode] = useState<'json' | 'visual' | 'query' | 'scopes' | 'performance'>('json');
  const [visualizeMode, setVisualizeMode] = useState<'cst' | 'ast'>('cst');
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolDefinition | null>(null);
  const [hoveredSymbol, setHoveredSymbol] = useState<SymbolDefinition | null>(null);
  const [selectedReference, setSelectedReference] = useState<SymbolReference | null>(null);
  const [hoveredReference, setHoveredReference] = useState<SymbolReference | null>(null);
  const [selectedScope, setSelectedScope] = useState<LexicalScope | null>(null);
  const [hoveredScope, setHoveredScope] = useState<LexicalScope | null>(null);
  const [scopeSearchQuery, setScopeSearchQuery] = useState<string>("");
  const [scopeResolverCode, setScopeResolverCode] = useState<string>(DEFAULT_SCOPE_RESOLVER_CODE);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [designerEditorTab, setDesignerEditorTab] = useState<'grammar' | 'ast' | 'scope'>('grammar');

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

  // Helper to find includes from a given document text
  const getIncludesFromText = (content: string): string[] => {
    const includes: string[] = [];
    const regex = /^\s*#include\s+["<]([^">]+)[">]/gm;
    let match;
    while ((match = regex.exec(content)) !== null) {
      includes.push(match[1]);
    }
    return includes;
  };

  const backgroundAstCacheRef = useRef<Record<string, { content: string; rootElement: any; debouncedAstCode: string; ast: any }>>({});

  // Build ASTs for all workspace files. Reuses the active file's compile result directly
  const computedWorkspaceASTs = useMemo(() => {
    const asts: Record<string, any> = {};
    if (!rootElement) return asts;
    
    for (const [filename, content] of Object.entries(workspaceFiles)) {
      if (filename === activeFileName) {
        asts[filename] = astResult;
        continue;
      }
      
      const cached = backgroundAstCacheRef.current[filename];
      if (
        cached && 
        cached.content === content && 
        cached.rootElement === rootElement && 
        cached.debouncedAstCode === debouncedAstCode
      ) {
        asts[filename] = cached.ast;
        continue;
      }
      
      const context = {
        cacheHits: 0,
        cacheMisses: 0,
        maxError: null as any,
        expectedPaths: [] as string[],
        recoveredErrors: [] as { message: string; offset: number }[]
      };
      
      try {
        const result = rootElement.parse(content, 0, new Map(), context);
        if (result && !result.error) {
          let ast = result.ast;
          if (debouncedAstCode && debouncedAstCode.trim()) {
            const wrappedBody = wrapASTTransformerWithIncrementalCache(debouncedAstCode);
            const customTransform = new Function('cst', 'fullText', wrappedBody);
            ast = customTransform(result.ast, content) || result.ast;
          }
          asts[filename] = ast;
          
          backgroundAstCacheRef.current[filename] = {
            content,
            rootElement,
            debouncedAstCode,
            ast
          };
        } else {
          asts[filename] = null;
        }
      } catch (e) {
        console.error(`Error parsing background file ${filename}:`, e);
        asts[filename] = null;
      }
    }
    return asts;
  }, [workspaceFiles, activeFileName, astResult, rootElement, debouncedAstCode]);

  const [resolverErrorMsg, setResolverErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setScopeError(resolverErrorMsg);
  }, [resolverErrorMsg]);

  const backgroundScopesCacheRef = useRef<Record<string, { ast: any; content: string; debouncedScopeResolverCode: string; scope: LexicalScope }>>({});

  // Build local scopes and resolve cross-file references on top of workspace ASTs
  const resolvedWorkspaceScopes = useMemo(() => {
    const scopes: Record<string, LexicalScope> = {};
    if (!debouncedScopeResolverCode || !rootElement) return scopes;

    const cloneLexicalScope = (scope: LexicalScope): LexicalScope => {
      const cloned: LexicalScope = {
        id: scope.id,
        name: scope.name,
        type: scope.type,
        start: scope.start,
        end: scope.end,
        node: scope.node,
        parentId: scope.parentId,
        fileName: scope.fileName,
        children: [],
        symbols: [],
        references: []
      };

      if (scope.symbols) {
        cloned.symbols = scope.symbols.map(sym => ({
          id: sym.id,
          name: sym.name,
          kind: sym.kind,
          datatype: sym.datatype,
          start: sym.start,
          end: sym.end,
          node: sym.node,
          scopeId: sym.scopeId,
          fileName: sym.fileName,
          references: []
        }));
      }

      if (scope.references) {
        cloned.references = scope.references.map(ref => ({
          id: ref.id,
          name: ref.name,
          start: ref.start,
          end: ref.end,
          node: ref.node,
          scopeId: ref.scopeId,
          resolvedSymbolId: ref.resolvedSymbolId,
          fileName: ref.fileName
        }));
      }

      if (scope.children) {
        cloned.children = scope.children.map(child => {
          const clonedChild = cloneLexicalScope(child);
          clonedChild.parentId = cloned.id;
          return clonedChild;
        });
      }

      return cloned;
    };

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
      
      // 1. Build local scope tree for each file & annotate fileNames
      for (const [filename, ast] of Object.entries(computedWorkspaceASTs)) {
        if (!ast) continue;
        const content = workspaceFiles[filename] || "";

        const cached = backgroundScopesCacheRef.current[filename];
        if (
          cached && 
          cached.ast === ast && 
          cached.content === content && 
          cached.debouncedScopeResolverCode === debouncedScopeResolverCode
        ) {
          scopes[filename] = cloneLexicalScope(cached.scope);
          continue;
        }

        try {
          const res = customBuildScopeChain(ast, content, InterceptedScopeBuilder);
          if (res) {
            res.name = filename; // Label global scope
            
            // Annotate scope trees recursively with filename context for navigation/scoping
            const annotateFile = (scope: LexicalScope) => {
              scope.fileName = filename;
              if (scope.symbols) {
                for (const sym of scope.symbols) {
                  sym.fileName = filename;
                }
              }
              if (scope.references) {
                for (const ref of scope.references) {
                  ref.fileName = filename;
                }
              }
              if (scope.children) {
                for (const child of scope.children) {
                  annotateFile(child);
                }
              }
            };
            annotateFile(res);
            scopes[filename] = res;

            backgroundScopesCacheRef.current[filename] = {
              ast,
              content,
              debouncedScopeResolverCode,
              scope: res
            };
          }
        } catch (e: any) {
          console.error(`Error building local scope for ${filename}:`, e);
          if (filename === activeFileName) {
            setResolverErrorMsg(e.message || `Error building local scope for ${filename}`);
          }
        }
      }

      if (capturedScopeBuilder) {
        setLastScopeBuilder(capturedScopeBuilder);
      }

      // Collect helper
      const collectFromScope = (scope: LexicalScope, syms: SymbolDefinition[], refs: SymbolReference[]) => {
        if (scope.symbols) syms.push(...scope.symbols);
        if (scope.references) refs.push(...scope.references);
        if (scope.children) {
          for (const child of scope.children) {
            collectFromScope(child, syms, refs);
          }
        }
      };

      // Helper to search in recursively included files
      const findSymbolInIncludes = (fileName: string, name: string, visited = new Set<string>()): SymbolDefinition | null => {
        if (visited.has(fileName)) return null;
        visited.add(fileName);

        const content = workspaceFiles[fileName] || "";
        const includes = getIncludesFromText(content);

        // Search direct includes
        for (const include of includes) {
          const targetScope = scopes[include];
          if (targetScope && targetScope.symbols) {
            const found = targetScope.symbols.find(s => s.name === name);
            if (found) return found;
          }
        }

        // Search transitively
        for (const include of includes) {
          const found = findSymbolInIncludes(include, name, visited);
          if (found) return found;
        }

        return null;
      };

      // 2. Perform cross-document resolution
      for (const [filename, fileScope] of Object.entries(scopes)) {
        const syms: SymbolDefinition[] = [];
        const refs: SymbolReference[] = [];
        collectFromScope(fileScope, syms, refs);

        // Remove duplicates and cross-file leftovers to prevent bloating
        for (const sym of syms) {
          if (sym.references) {
            sym.references = sym.references.filter(r => r.scopeId && r.scopeId.startsWith(fileScope.id));
          }
        }

        for (const ref of refs) {
          if (!ref.resolvedSymbolId) {
            const resolvedSym = findSymbolInIncludes(filename, ref.name);
            if (resolvedSym) {
              ref.resolvedSymbolId = resolvedSym.id;
              if (!resolvedSym.references) {
                resolvedSym.references = [];
              }
              resolvedSym.references.push(ref);
            }
          }
        }
      }
    } catch (e: any) {
      console.error("Error inside cross-document scope resolution:", e);
      setResolverErrorMsg(e.message || "Error during cross-document scope resolution");
    }

    return scopes;
  }, [computedWorkspaceASTs, workspaceFiles, debouncedScopeResolverCode, rootElement, activeFileName]);

  const scopeChain = useMemo(() => {
    return resolvedWorkspaceScopes[activeFileName] || null;
  }, [resolvedWorkspaceScopes, activeFileName]);

  const [queryText, setQueryText] = useState<string>('(struct_decl (identifier) @struct_name)');
  const [hoveredQueryNode, setHoveredQueryNode] = useState<any | null>(null);
  const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({});
  const [cursorPosition, setCursorPosition] = useState({ line: 1, col: 1 });
  const transformComponentRef = useRef<any>(null);
  const editorScrollContainerRef = useRef<HTMLDivElement>(null);

  const doCopy = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMap(prev => ({ ...prev, [key]: true }));
    setTimeout(() => {
      setCopiedMap(prev => ({ ...prev, [key]: false }));
    }, 1500);
  };

  const scrollToNode = (node: any) => {
    if (!node || typeof node.start !== 'number' || typeof node.end !== 'number') return;
    
    // Focus the editor's textarea
    const textarea = editorScrollContainerRef.current?.querySelector('textarea');
    if (textarea) {
      textarea.focus();
      textarea.setSelectionRange(node.start, node.end);
    }
    
    // Smooth scroll inside parent container
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

    for (const scope of Object.values(resolvedWorkspaceScopes) as LexicalScope[]) {
      if (scope) {
        const found = searchScope(scope);
        if (found) return found;
      }
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

  // Debounce syncing testInput back to workspaceFiles on pause to prevent excessive parent state mutations
  useEffect(() => {
    const handler = setTimeout(() => {
      setWorkspaceFiles(prev => {
        if (prev[activeFileName] === testInput) return prev;
        return { ...prev, [activeFileName]: testInput };
      });
    }, 250);
    return () => clearTimeout(handler);
  }, [testInput, activeFileName]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedGrammarCode(grammarCode);
    }, 250); // 250ms debounce for grammar definition
    return () => clearTimeout(handler);
  }, [grammarCode]);

  const errorLines = useMemo(() => {
    const lines = new Set<number>();
    const len = recoveredErrors.length;
    for (let i = 0; i < len; i++) {
      const err = recoveredErrors[i];
      if (err && typeof err.offset === 'number') {
        try {
          lines.add(getLineAndCol(debouncedTestInput, err.offset).line);
        } catch {}
      }
    }
    return lines;
  }, [recoveredErrors, debouncedTestInput]);

  const fatalErrorLine = useMemo(() => {
    if (parseError && typeof parseError.offset === 'number') {
      try {
        return getLineAndCol(debouncedTestInput, parseError.offset).line;
      } catch {}
    }
    return -1;
  }, [parseError, debouncedTestInput]);

  // Layout states for adjustable and collapsible panels
  const [designerEditorWidth, setDesignerEditorWidth] = useState(500);
  const [designerEditorCollapsed, setDesignerEditorCollapsed] = useState(false);
  const [playgroundCstWidth, setPlaygroundCstWidth] = useState(500);
  const [playgroundCstCollapsed, setPlaygroundCstCollapsed] = useState(false);
  const [playgroundInputCollapsed, setPlaygroundInputCollapsed] = useState(false);
  
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

  // Resize handler for Playground CST panel
  const startPlaygroundResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = playgroundCstWidth;

    const doDrag = (moveEvent: MouseEvent) => {
      // Dragging left (smaller clientX) increases right panel width
      const deltaX = startX - moveEvent.clientX;
      const newWidth = startWidth + deltaX;
      
      if (newWidth < 180) {
        setPlaygroundCstCollapsed(true);
        setPlaygroundCstWidth(250); // Reset size for clean re-expansion
      } else {
        const constrainedWidth = Math.min(window.innerWidth * 0.75, newWidth);
        setPlaygroundCstCollapsed(false);
        setPlaygroundCstWidth(constrainedWidth);
      }
    };

    const stopDrag = () => {
      document.removeEventListener('mousemove', doDrag);
      document.removeEventListener('mouseup', stopDrag);
    };

    document.addEventListener('mousemove', doDrag);
    document.addEventListener('mouseup', stopDrag);
  };

  const handleEditorSelectionChange = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const start = textarea.selectionStart;
    const textBefore = textarea.value.slice(0, start);
    const lines = textBefore.split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    setCursorPosition({ line, col });
  };

  const resetTransform = () => {
    if (transformComponentRef.current) {
      transformComponentRef.current.resetTransform();
    }
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

  const saveProject = () => {
    const name = prompt("Project Name:", projectName) || projectName;
    const newProject: SavedProject = {
      id: Math.random().toString(36).substring(2, 9),
      name,
      grammar: grammarCode,
      input: testInput,
      scopeResolver: scopeResolverCode,
      ast: astCode,
      updatedAt: Date.now(),
      workspaceFiles: workspaceFiles,
      activeFileName: activeFileName
    };
    
    setSavedProjects(prev => {
      // If a project with same name exists, update it or keep it?
      // For simplicity, just add new one
      return [newProject, ...prev];
    });
    setProjectName(name);
    alert(`Project "${name}" saved!`);
  };

  const loadProject = (project: SavedProject) => {
    setGrammarCode(project.grammar);
    if (project.workspaceFiles) {
      setWorkspaceFiles(project.workspaceFiles);
      const active = project.activeFileName || Object.keys(project.workspaceFiles)[0] || "main.hlsl";
      setActiveFileName(active);
      setTestInput(project.workspaceFiles[active] || "");
    } else {
      const defaultWorkspace = {
        "main.hlsl": project.input,
        "UnityCG.cginc": [
          "// UnityCG.cginc - Common Unity Shader Helper Functions",
          "",
          "float4 UnityObjectToClipPos(float4 pos) {",
          "    // Model-view-projection transform helper",
          "    return mul(UNITY_MATRIX_MVP, pos);",
          "}",
          "",
          "fixed4 tex2D(sampler2D s, float2 uv) {",
          "    // Texture lookup helper",
          "    return fixed4(1, 1, 1, 1);",
          "}"
        ].join("\n")
      };
      setWorkspaceFiles(defaultWorkspace);
      setActiveFileName("main.hlsl");
      setTestInput(project.input);
    }
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
      const defaultWorkspace = {
        "main.hlsl": "",
        "UnityCG.cginc": [
          "// UnityCG.cginc - Common Unity Shader Helper Functions",
          "",
          "float4 UnityObjectToClipPos(float4 pos) {",
          "    // Model-view-projection transform helper",
          "    return mul(UNITY_MATRIX_MVP, pos);",
          "}",
          "",
          "fixed4 tex2D(sampler2D s, float2 uv) {",
          "    // Texture lookup helper",
          "    return fixed4(1, 1, 1, 1);",
          "}"
        ].join("\n")
      };
      setWorkspaceFiles(defaultWorkspace);
      setActiveFileName("main.hlsl");
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
      
      // Execute the grammar code
      // We provide SyntaxElement to the execution context
      const executionFunc = new Function('SyntaxElement', `
        ${debouncedGrammarCode}
        return typeof root !== 'undefined' ? root : null;
      `);
      
      const root = executionFunc(SyntaxElement);
      if (root instanceof SyntaxElement) {
        setRootElement(root);
        setHierarchy(root.getHierarchy());
      } else {
        setCodeError("Variable 'root' (SyntaxElement) not found in code.");
      }
    } catch (err: any) {
      setCodeError(err.message);
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
      if (node.id && node.name && !node.isLoop) {
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
  }, [rootElement, activeFileName]);

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

  const highlightWithCST = (code: string) => {
    const charStyles = new Int32Array(code.length);

    // 1. Pre-populate basic common tokens to guarantee robust basic highlighting on failure to parse
    const commentsRegex = /\/\/.*|\/\*[\s\S]*?\*\//g;
    let match;
    while ((match = commentsRegex.exec(code)) !== null) {
      const matchLen = match[0].length;
      const startIndex = match.index;
      for (let i = 0; i < matchLen; i++) {
        charStyles[startIndex + i] = STYLE_COMMENT_ID;
      }
    }

    const stringRegex = /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/g;
    while ((match = stringRegex.exec(code)) !== null) {
      const matchLen = match[0].length;
      const startIndex = match.index;
      for (let i = 0; i < matchLen; i++) {
        charStyles[startIndex + i] = STYLE_STRING_ID;
      }
    }

    const numberRegex = /\b\d+(?:\.\d+)?\b/g;
    while ((match = numberRegex.exec(code)) !== null) {
      const matchLen = match[0].length;
      const startIndex = match.index;
      for (let i = 0; i < matchLen; i++) {
        charStyles[startIndex + i] = STYLE_NUMBER_ID;
      }
    }

    const keywordsRegex = /\b(struct|cbuffer|return|void|float[1-4]|int[1-4]|fixed[1-4]|half[1-4]|bool|float|int|fixed|half|double|sampler2D|Texture2D|SamplerState|PASS|Pass|VertexShader|PixelShader|Pixel|Vertex|layout|uniform)\b/g;
    while ((match = keywordsRegex.exec(code)) !== null) {
      const start = match.index;
      const end = match.index + match[0].length;
      // Pre-populate keywords but respect already-identified comments
      for (let i = start; i < end; i++) {
        const existing = charStyles[i];
        if (existing !== STYLE_COMMENT_ID) {
          charStyles[i] = STYLE_KEYWORD_ID;
        }
      }
    }

    // 2. Walk the parsed CST to layer high-fidelity semantic highlighting on top
    // Delay high-fidelity walking if the editor content differs from the debounced AST state.
    // If the user is typing, standard AST offsets will be shifted relative to the actual code.
    // Skipping during active edits prevents offset mismatch flickering during typing epochs.
    const ast = (code === debouncedTestInput) ? (parseResult || latestCSTRef.current) : null;
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
              // Respect pre-populated comments, strings, numbers, and keywords
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

    const activeBlock = hoveredScope || selectedScope;
    const hasActiveBlock = !!(activeBlock && activeBlock.type !== 'global' && (!activeBlock.fileName || activeBlock.fileName === activeFileName));
    const activeBlockStart = hasActiveBlock ? activeBlock.start : -1;
    const activeBlockEnd = hasActiveBlock ? activeBlock.end : -1;

    const activeSym = selectedSymbol || hoveredSymbol;
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

    const activeRef = selectedReference || hoveredReference;
    if (activeRef && (!activeRef.fileName || activeRef.fileName === activeFileName)) {
      const refStart = Math.max(0, activeRef.start);
      const refEnd = Math.min(code.length, activeRef.end);
      for (let i = refStart; i < refEnd; i++) {
        charStyles[i] = STYLE_REF_DIRECT_ID;
      }
    }

    // 3. Render charStyles to styled HTML spans using highly optimized run-length encoding and native text slicing
    let html = "";
    let prevStyleId = -1;
    let runStart = 0;

    const escapeHtml = (text: string): string => {
      return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    };

    const codeLen = code.length;
    for (let i = 0; i < codeLen; i++) {
      const styleId = charStyles[i];
      const itemInActive = hasActiveBlock && i >= activeBlockStart && i < activeBlockEnd;
      const prevInActive = hasActiveBlock && (i - 1) >= activeBlockStart && (i - 1) < activeBlockEnd;

      const isSameStyle = (i > 0) && (styleId === prevStyleId && itemInActive === prevInActive);

      if (!isSameStyle) {
        if (i > runStart) {
          const spanText = code.slice(runStart, i);
          const cls = getStyleClass(prevStyleId, prevInActive);
          html += `<span class="${cls}">${escapeHtml(spanText)}</span>`;
        }
        prevStyleId = styleId;
        runStart = i;
      }
    }

    if (codeLen > runStart) {
      const spanText = code.slice(runStart, codeLen);
      const lastInActive = hasActiveBlock && (codeLen - 1) >= activeBlockStart && (codeLen - 1) < activeBlockEnd;
      const cls = getStyleClass(prevStyleId, lastInActive);
      html += `<span class="${cls}">${escapeHtml(spanText)}</span>`;
    }

    return html;
  };

  const generateCSharp = () => {
    if (!rootElement) return;
    setCsSelectedFileIndex(0);
    setShowCSharpModal(true);
  };

  const renderCSTVisualNode = (node: any, depth: number = 0, isLast: boolean = true, path: string = "root"): React.ReactNode => {
    if (!node) return null;
    
    // Handle primitive nodes (strings/numbers) directly
    if (typeof node !== 'object') {
      return (
        <div key={path} className="ml-12 mt-3 p-2 px-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl text-[11px] font-mono text-emerald-300/90 inline-block shadow-sm">
           {String(node)}
        </div>
      );
    }

    let type = node.type;
    let value = node.value;
    if (value === undefined && node.children !== undefined) {
      value = node.children;
    } else if (value === undefined && node.data !== undefined) {
      value = node.data;
    }
    
    if (!type && !value) {
      const keys = Object.keys(node).filter(k => k !== 'ruleId');
      if (keys.length === 1) {
        type = keys[0];
        value = node[keys[0]];
      }
    }

    if (type === 'error_node') {
      const isSelected = selectedCstNode === node;
      const isHovered = hoveredCstNode === node;

      return (
        <motion.div 
          key={path} 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedCstNode(node);
          }}
          onMouseEnter={(e) => {
            e.stopPropagation();
            setHoveredCstNode(node);
          }}
          onMouseLeave={() => {
            setHoveredCstNode(null);
          }}
          className={cn(
            "ml-12 mt-3 p-3 bg-red-500/10 border rounded-xl flex items-start gap-3 max-w-[400px] shadow-lg shadow-red-500/5 relative group cursor-pointer transition-all",
            isSelected ? "border-red-500 ring-2 ring-red-500/30" : "border-red-500/40 hover:border-red-500/80",
            isHovered ? "bg-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.2)]" : ""
          )}
        >
          <div className="absolute -left-5 top-0 bottom-0 w-px bg-red-500/20 group-hover:bg-red-500/40 transition-colors">
            <div className="absolute top-5 left-0 w-5 h-px bg-red-500/20 group-hover:bg-red-500/40 transition-colors" />
          </div>
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <div className="flex flex-col">
            <span className="text-[8px] font-black uppercase tracking-widest text-red-400 mb-1">RECOVERED ERROR NODE</span>
            <span className="text-[11px] font-mono text-red-100/80 leading-relaxed italic">
              {node.message}
            </span>
            <span className="text-[8px] font-bold text-red-400/50 mt-2 uppercase tracking-tighter">
              Panic Recovery from offset {node.start} to {node.end}
            </span>
          </div>
        </motion.div>
      );
    }

    const isArray = Array.isArray(value);
    const isLeaf = !isArray && typeof value !== 'object';
    const isSelected = selectedCstNode === node;
    const isHovered = hoveredCstNode === node;
    
    return (
      <motion.div 
        key={path} 
        initial={{ opacity: 0, x: -5 }}
        animate={{ opacity: 1, x: 0 }}
        className={cn(
          "relative select-none",
          depth > 0 ? "ml-8 mt-3 pb-1" : ""
        )}
      >
        {/* Connector lines with curved edges */}
        {depth > 0 && (
          <div className={cn(
            "absolute -left-5 top-0 w-px bg-white/10",
            isLast ? "h-5" : "bottom-0"
          )}>
            {/* Horizontal branch line */}
            <div className={cn(
              "absolute top-5 left-0 w-5 h-px bg-white/10",
              isLast && "rounded-bl-lg"
            )} />
          </div>
        )}

        <div 
          onClick={(e) => {
            e.stopPropagation();
            setSelectedCstNode(node);
          }}
          onMouseEnter={(e) => {
            e.stopPropagation();
            setHoveredCstNode(node);
          }}
          onMouseLeave={() => {
            setHoveredCstNode(null);
          }}
          className={cn(
            "inline-flex items-center gap-3 px-3 py-2 rounded-xl transition-all border group shadow-sm relative z-10 cursor-pointer",
            isLeaf ? "bg-emerald-500/10 border-emerald-500/20" : "bg-white/5 border-white/10 hover:bg-white/[0.08]",
            isSelected ? "ring-2 ring-indigo-500 bg-indigo-500/10 border-indigo-400" : "hover:border-indigo-500/40",
            isHovered ? "border-indigo-400 bg-white/10 shadow-[0_0_12px_rgba(99,102,241,0.25)]" : ""
          )}
        >
          <div className={cn(
            "w-2 h-2 rounded-full ring-4 ring-black/20",
            isLeaf ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]" : "bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.4)]"
          )} />
          
          <div className="flex flex-col min-w-[40px]">
            <span className={cn(
              "text-[7.5px] font-black uppercase tracking-[0.2em] leading-none mb-1 opacity-50",
              isLeaf ? "text-emerald-400" : "text-indigo-400"
            )}>
              {type}
            </span>
            {isLeaf ? (
              <span className="text-[11px] font-mono text-white/90 break-all max-w-[280px]">
                {value !== undefined ? String(value) : "null"}
              </span>
            ) : isArray ? (
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tight">
                {value.length} {value.length === 1 ? 'branch' : 'branches'}
              </span>
            ) : null}
          </div>
        </div>

        {/* Recurse on array value */}
        {isArray && value.length > 0 && (
          <div className="flex flex-col">
            {value.map((child: any, idx: number) => 
               renderCSTVisualNode(child, depth + 1, idx === value.length - 1, `${path}-${idx}`)
            )}
          </div>
        )}

        {/* Recurse on single object value */}
        {!isArray && typeof value === 'object' && value !== null && (
          <div className="flex flex-col">
            {renderCSTVisualNode(value, depth + 1, true, `${path}-sub`)}
          </div>
        )}
      </motion.div>
    );
  };

  const renderVisualNode = (node: any, level: number = 0) => {
    if (!node) return null;
    if (node.isLoop) {
       return (
         <div key={node.id + "-loop"} className="py-2 px-4 mb-4 bg-indigo-500/10 border border-dashed border-indigo-500/30 rounded-lg text-[10px] text-indigo-300 font-mono flex items-center justify-center self-stretch">
            ↻ Recursive Call to {node.name}
         </div>
       );
    }
    return (
      <div key={node.id} className="space-y-4 w-full max-w-xl">
        <div className="flex flex-col items-center">
           <div className="flex items-center gap-2 mb-4">
             <div className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-[10px] font-bold text-slate-500 uppercase tracking-widest">
               {node.name}
             </div>
             {node.precedence !== 0 && (
               <div className="px-2 py-0.5 bg-indigo-500/20 border border-indigo-500/40 rounded-md text-[8px] font-black text-indigo-400 uppercase tracking-tighter">
                 PREC: {node.precedence}
               </div>
             )}
           </div>
           
           <div className="w-full space-y-0">
             {node.rules?.map((rule: any, idx: number) => (
                <div key={rule.id} className="flex items-center group relative">
                  <div className="w-10 flex flex-col items-center flex-shrink-0 self-stretch">
                    <div className={cn(
                      "w-2.5 h-2.5 rounded-full z-10 transition-all",
                      rule.type === 'not' ? "bg-rose-500 ring-4 ring-rose-500/20" : "bg-indigo-500",
                      parseError?.ruleId === rule.id && "bg-red-500 ring-8 ring-red-500/10 animate-pulse"
                    )}></div>
                    {idx < node.rules.length - 1 && (
                      <div className={cn(
                        "w-0.5 flex-grow my-1",
                        rule.type !== 'not' ? "bg-indigo-500/30" : "bg-slate-700"
                      )}></div>
                    )}
                  </div>

                  <div className={cn(
                    "flex-1 mb-4 p-4 bg-white/5 border border-white/10 backdrop-blur-md rounded-2xl flex items-center gap-4 transition-all hover:border-indigo-500/50 shadow-sm",
                    rule.type === 'not' && "bg-rose-500/5 border-rose-500/40",
                    parseError?.ruleId === rule.id && "border-red-500 shadow-lg shadow-red-500/10"
                  )}>
                    <span className={cn(
                      "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-tighter",
                      rule.type === 'literal' && "bg-sky-500/20 text-sky-400",
                      rule.type === 'regex' && "bg-emerald-500/20 text-emerald-400",
                      rule.type === 'element' && "bg-indigo-500/20 text-indigo-400",
                      rule.type === 'whitespace' && "bg-amber-500/20 text-amber-400",
                      rule.type === 'not' && "bg-rose-500/20 text-rose-400",
                      rule.type === 'choice' && "bg-fuchsia-500/20 text-fuchsia-400",
                      rule.type === 'optional' && "bg-teal-500/20 text-teal-400",
                      rule.type === 'zeroOrMore' && "bg-cyan-500/20 text-cyan-400",
                      rule.type === 'oneOrMore' && "bg-blue-500/20 text-blue-400",
                      rule.type === 'eof' && "bg-zinc-500/20 text-zinc-400"
                    )}>
                      {rule.type === 'not' ? 'Unexpects' : rule.type === 'element' ? 'Call' : rule.type === 'whitespace' ? 'Space' : rule.type === 'choice' ? 'OneOf' : rule.type === 'optional' ? 'Opt' : rule.type === 'zeroOrMore' ? 'Any' : rule.type === 'oneOrMore' ? 'Some' : rule.type === 'eof' ? 'End' : 'Expects'}
                    </span>
                    
                    <code className={cn(
                      "text-sm font-mono leading-none truncate max-w-[200px]",
                      rule.type === 'regex' ? "text-emerald-400" : 
                      rule.type === 'eof' ? "text-zinc-500" :
                      rule.type === 'not' ? "text-rose-300" :
                      rule.type === 'element' ? "text-indigo-300" : "text-white"
                    )}>
                      {rule.type === 'whitespace' ? 'WS' : 
                      rule.type === 'choice' ? `[ ${(rule.value as any[]).map(v => typeof v === 'string' ? `"${v}"` : v instanceof RegExp ? `Regex` : v?.name || 'Element').join(' | ')} ]` :
                      rule.type === 'regex' ? `Regex("${rule.value?.source}")` : 
                      rule.type === 'eof' ? 'EOF' :
                      (rule.value as any)?.name ? `${(rule.value as any).name}` :
                      `"${rule.value}"`}
                    </code>

                    {rule.type === 'element' && level < 2 && (
                      <div className="ml-auto opacity-30 hover:opacity-100 transition-opacity">
                         <span className="text-[9px] uppercase font-bold text-slate-500">Recursion allowed</span>
                      </div>
                    )}
                  </div>
                </div>
             ))}
           </div>
        </div>
        {node.rules?.filter((r: any) => r.type === 'element' && level < 1).map((r: any) => renderVisualNode(r.value, level + 1))}
      </div>
    );
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
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Zap className="text-white w-5 h-5 font-bold" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-white uppercase italic">
              Syntax<span className="text-indigo-400 font-light">//Engine</span>
            </h1>
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
              onClick={saveProject}
              className="px-2 py-1 text-slate-400 hover:text-white transition-colors flex items-center gap-1.5 border-l border-white/10"
              title="Save Project"
            >
              <Save className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex bg-white/5 rounded-lg border border-white/10 p-1">
            <button 
              onClick={generateCSharp}
              className="px-3 py-1 text-[10px] font-bold text-slate-400 hover:text-white transition-colors flex items-center gap-2"
            >
              <Code2 className="w-3 h-3" /> C#
            </button>
            <button className="px-3 py-1 text-[10px] font-bold bg-white/10 text-white rounded shadow-sm border border-white/10">RUST</button>
            <button className="px-3 py-1 text-[10px] font-bold text-slate-400 hover:text-white transition-colors">TS</button>
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
                  <div className="flex items-center justify-between p-4 border-b border-white/5 shrink-0 bg-white/[0.02]">
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
                    </div>
                    {designerEditorTab === 'grammar' && codeError && (
                      <div className="flex items-center gap-1.5 text-rose-400 text-[10px] font-bold animate-pulse">
                        <AlertCircle className="w-3 h-3" /> Grammar Error
                      </div>
                    )}
                    {designerEditorTab === 'scope' && scopeError && (
                      <div className="flex items-center gap-1.5 text-rose-400 text-[10px] font-bold animate-pulse">
                        <AlertCircle className="w-3 h-3" /> Scope Error
                      </div>
                    )}
                  </div>

                  {/* Sub Tab Selection bar inside Editor Column */}
                  <div className="flex border-b border-white/5 bg-slate-900/40 p-1.5 gap-1.5 shrink-0">
                    <button
                      onClick={() => setDesignerEditorTab('grammar')}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[9px] uppercase tracking-wider font-extrabold rounded-lg border transition-all cursor-pointer shadow-sm",
                        designerEditorTab === 'grammar'
                          ? "bg-indigo-600/15 border-indigo-500/30 text-indigo-300"
                          : "bg-transparent border-transparent text-slate-400 hover:text-slate-300 hover:bg-white/[0.02]"
                      )}
                    >
                      <FileCode className="w-3.5 h-3.5 text-indigo-400" /> Grammar Rules
                    </button>
                    <button
                      onClick={() => setDesignerEditorTab('ast')}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[9px] uppercase tracking-wider font-extrabold rounded-lg border transition-all cursor-pointer shadow-sm",
                        designerEditorTab === 'ast'
                          ? "bg-indigo-600/15 border-indigo-500/30 text-indigo-300"
                          : "bg-transparent border-transparent text-slate-400 hover:text-slate-300 hover:bg-white/[0.02]"
                      )}
                    >
                      <Layers className="w-3.5 h-3.5 text-indigo-400" /> AST Gen
                    </button>
                    <button
                      onClick={() => setDesignerEditorTab('scope')}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[9px] uppercase tracking-wider font-extrabold rounded-lg border transition-all cursor-pointer shadow-sm",
                        designerEditorTab === 'scope'
                          ? "bg-indigo-600/15 border-indigo-500/30 text-indigo-300"
                          : "bg-transparent border-transparent text-slate-400 hover:text-slate-300 hover:bg-white/[0.02]"
                      )}
                    >
                      <GitBranch className="w-3.5 h-3.5 text-indigo-400" /> Scope Resolver
                    </button>
                  </div>
                           <div className="flex-1 overflow-auto custom-scrollbar bg-[#1a1a1a]/50 relative">
                    <Editor
                      value={
                        designerEditorTab === 'grammar' 
                          ? grammarCode 
                          : designerEditorTab === 'ast'
                          ? astCode
                          : scopeResolverCode
                      }
                      onValueChange={code => {
                        if (designerEditorTab === 'grammar') {
                          setGrammarCode(code);
                        } else if (designerEditorTab === 'ast') {
                          setAstCode(code);
                        } else {
                          setScopeResolverCode(code);
                        }
                      }}
                      highlight={code => Prism.highlight(code, Prism.languages.javascript, 'javascript')}
                      padding={20}
                      style={{
                        fontFamily: '"Fira Code", monospace',
                        fontSize: 13,
                        minHeight: '100%',
                      }}
                      className="outline-none"
                    />
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
              {visualFlowCollapsed ? (
                <div className="w-[42px] border-l border-white/10 bg-[#121214]/60 backdrop-blur-lg flex flex-col items-center py-4 gap-6 shrink-0 relative z-30 select-none">
                  <button
                    onClick={() => {
                      setVisualFlowCollapsed(false);
                    }}
                    className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer shadow-lg"
                    title="Expand Logic Flow"
                  >
                    <Layers className="w-4 h-4 text-indigo-400" />
                  </button>
                  <div className="flex-1 flex items-center justify-center">
                    <span className="-rotate-90 text-[8.5px] font-black tracking-[0.25em] text-slate-500 uppercase whitespace-nowrap">
                      VISUAL LOGIC FLOW
                    </span>
                  </div>
                </div>
              ) : (
                <section className="flex-1 bg-[#09090c] flex flex-col overflow-hidden relative border-l border-white/5">
                  <div className="p-4 border-b border-white/5 bg-white/[0.02] flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setVisualFlowCollapsed(true)}
                        className="p-1 hover:bg-white/10 rounded-md text-slate-400 hover:text-white transition-colors cursor-pointer mr-2"
                        title="Collapse Logic Flow"
                      >
                        <PanelRightClose className="w-4 h-4 text-indigo-400" />
                      </button>
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 animate-fade">
                        <Layers className="w-3.5 h-3.5" /> Visual Rules Inspector
                      </span>
                    </div>
                  </div>

                  {hierarchy ? (
                    <div className="flex-1 flex overflow-hidden">
                      {/* Left side rule selector rail inside panel */}
                      <aside className="w-56 border-r border-white/5 bg-slate-950/25 flex flex-col shrink-0 overflow-hidden">
                        {/* Search header container */}
                        <div className="p-3 border-b border-white/5 bg-white/[0.01]">
                          <div className="relative group">
                            <div className="absolute inset-y-0 left-2.5 flex items-center pointer-events-none text-slate-500 group-focus-within:text-indigo-400 transition-colors">
                              <Search className="w-3 h-3" />
                            </div>
                            <input 
                              type="text"
                              value={ruleSearch}
                              onChange={(e) => setRuleSearch(e.target.value)}
                              placeholder="Search grammar rules..."
                              className="w-full bg-slate-900/50 border border-white/5 rounded-lg py-1.5 pl-8 pr-3 text-[11px] text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/30 focus:ring-1 focus:ring-indigo-500/10 transition-all font-sans"
                            />
                          </div>
                        </div>

                        {/* Rules Lists */}
                        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar bg-black/10">
                          {(() => {
                            const filtered = allElements.filter((el: any) => el.name.toLowerCase().includes(ruleSearch.toLowerCase().trim()));
                            if (filtered.length === 0) {
                              return (
                                <div className="text-center py-8 text-slate-600 font-mono text-[10px] italic">
                                  No rules found
                                </div>
                              );
                            }
                            return filtered.map((el: any) => {
                              const isActive = activeGrammarElement?.id === el.id;
                              return (
                                <button
                                  key={el.id}
                                  onClick={() => selectElementWithHistory(el.id)}
                                  className={cn(
                                    "w-full text-left p-2 px-2.5 rounded-xl text-[11px] font-medium transition-all flex items-center justify-between border select-none cursor-pointer relative group",
                                    isActive 
                                      ? "bg-indigo-500/10 border-indigo-500/30 text-white font-bold" 
                                      : "bg-transparent border-transparent text-slate-400 hover:bg-white/5 hover:text-white"
                                  )}
                                >
                                  {isActive && (
                                    <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-indigo-500 rounded-r-full" />
                                  )}
                                  <span className="truncate pr-1 font-mono tracking-tight text-slate-300 group-hover:text-white">{el.name}</span>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {el.precedence > 0 && (
                                      <span className="text-[8px] bg-indigo-500/10 text-indigo-400 font-black px-1 rounded border border-indigo-500/20">
                                        P{el.precedence}
                                      </span>
                                    )}
                                    <span className="text-[9px] bg-slate-855 text-slate-500 group-hover:bg-slate-700 font-mono px-1.5 py-0.5 rounded-full border border-white/5">
                                      {el.rules?.length || 0}
                                    </span>
                                  </div>
                                </button>
                              );
                            });
                          })()}
                        </div>
                      </aside>

                      {/* Main diagram workspace */}
                      <div className="flex-1 flex flex-col overflow-hidden bg-slate-950/20">
                        {activeGrammarElement ? (
                          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                            {/* Grammar Detail Info Card */}
                            <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-4 space-y-3 shadow-md">
                              <div className="flex flex-wrap items-center justify-between gap-4">
                                <div>
                                  <div className="flex items-center gap-3 mb-1.5">
                                    {explorationHistory.length > 0 && (
                                      <button
                                        onClick={goBackHistory}
                                        className="px-2 py-0.5 text-[10px] font-bold bg-white/5 hover:bg-white/10 text-indigo-400 hover:text-indigo-300 border border-white/10 rounded-lg flex items-center gap-1 transition-all cursor-pointer shadow-sm shrink-0"
                                        title={`Go back (stack: ${explorationHistory.length})`}
                                      >
                                        <ArrowLeft className="w-3 h-3 text-indigo-400" />
                                        <span>Back</span>
                                      </button>
                                    )}
                                    <h2 className="text-sm font-black tracking-tight text-white font-mono uppercase">
                                      {activeGrammarElement.name}
                                    </h2>
                                    {activeGrammarElement.precedence > 0 && (
                                      <span className="bg-indigo-500/20 border border-indigo-500/40 rounded px-1.5 py-0.5 text-[8.5px] font-black text-indigo-300 uppercase tracking-tighter">
                                        PRECEDENCE: {activeGrammarElement.precedence}
                                      </span>
                                    )}
                                    {activeGrammarElement.isHidden ? (
                                      <span className="bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5 text-[8.5px] font-extrabold text-amber-400/80 uppercase tracking-widest leading-none">
                                        Hidden Node
                                      </span>
                                    ) : (
                                      <span className="bg-emerald-500/10 border border-emerald-500/30 rounded px-1.5 py-0.5 text-[8.5px] font-extrabold text-emerald-400/80 uppercase tracking-widest leading-none">
                                        CST Producer
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[10.5px] text-slate-400 font-medium font-mono">
                                    {activeGrammarElement.name === '_root' 
                                      ? "Project entry-point. Parser starts here."
                                      : `Defines matching structure for parser token class '${activeGrammarElement.name}'.`}
                                  </p>
                                </div>

                                <div className="flex items-center gap-3 bg-white/5 border border-white/10 px-2.5 py-1 rounded-lg text-[9.5px] text-[#868e96] font-medium font-mono">
                                  <span className="flex items-center gap-1.5">
                                    <Database className="w-3 h-3 text-indigo-400" /> Memoized: <strong className="text-emerald-400">Yes</strong>
                                  </span>
                                  {activeGrammarElement.isAutoHealing && (
                                    <>
                                      <span className="text-slate-700">|</span>
                                      <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
                                        <Zap className="w-3 h-3 text-emerald-400" /> Self-Healing Active
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Tree Relationships Row */}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-white/5 text-[9.5px]">
                                <div>
                                  <span className="text-slate-500 uppercase font-black tracking-widest block mb-1">Referenced By (Callers)</span>
                                  {activeElementRelations.referencedBy.length === 0 ? (
                                    <span className="text-slate-600 font-mono italic">None (Root element)</span>
                                  ) : (
                                    <div className="flex flex-wrap gap-1">
                                      {activeElementRelations.referencedBy.map((el: any) => (
                                        <button
                                          key={el.id}
                                          onClick={() => selectElementWithHistory(el.id)}
                                          className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 hover:border-indigo-500/30 hover:bg-indigo-500/10 text-slate-300 hover:text-white transition-all font-mono text-[9px] cursor-pointer"
                                        >
                                          {el.name}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                <div>
                                  <span className="text-slate-500 uppercase font-black tracking-widest block mb-1 font-sans">References (Callees)</span>
                                  {activeElementRelations.references.length === 0 ? (
                                    <span className="text-slate-600 font-mono italic">None (Leaf parser node)</span>
                                  ) : (
                                    <div className="flex flex-wrap gap-1">
                                      {activeElementRelations.references.map((el: any) => (
                                        <button
                                          key={el.id}
                                          onClick={() => selectElementWithHistory(el.id)}
                                          className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 hover:border-indigo-500/30 hover:bg-indigo-500/10 text-slate-300 hover:text-white transition-all font-mono text-[9px] cursor-pointer"
                                        >
                                          {el.name}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Execution timeline tracker of sequence tracks */}
                            <div className="space-y-4 max-w-2xl">
                              {activeGrammarElement.rules?.length === 0 ? (
                                <div className="text-center py-4 text-slate-500 italic text-[11px] font-mono">
                                  No rules defined in this syntax element yet.
                                </div>
                              ) : (
                                activeGrammarElement.rules?.map((rule: any, idx: number) => {
                                  const isErrorHighlight = parseError?.ruleId === rule.id;
                                  return (
                                    <div key={rule.id} className="flex relative group">
                                      {/* Connector timeline track line */}
                                      <div className="w-8 flex flex-col items-center flex-shrink-0 relative">
                                        <div className={cn(
                                          "w-2 h-2 rounded-full z-10 transition-all border mt-4",
                                          rule.type === 'not' ? "bg-rose-500 border-rose-400 ring-2 ring-rose-500/15" : "bg-indigo-500 border-indigo-400 ring-2 ring-indigo-500/15",
                                          isErrorHighlight && "bg-red-500 border-red-400 ring-4 ring-red-500/15 animate-pulse"
                                        )} />
                                        {idx < activeGrammarElement.rules.length - 1 && (
                                          <div className="absolute top-4 bottom-0 w-px bg-white/5 group-hover:bg-indigo-500/20 transition-all" />
                                        )}
                                      </div>

                                      <div className={cn(
                                        "flex-1 p-4 bg-white/[0.02] border border-white/5 backdrop-blur-md rounded-2xl flex flex-col gap-2.5 transition-all hover:bg-white/[0.04] hover:border-white/10 shadow-sm",
                                        rule.type === 'not' && "bg-rose-500/5 border-rose-500/15 hover:border-rose-500/30",
                                        isErrorHighlight && "border-red-500/30 bg-red-500/5"
                                      )}>
                                        <div className="flex items-center justify-between gap-4 shrink-0">
                                          <div className="flex items-center gap-2">
                                            <span className="text-[9px] font-bold text-slate-500 font-mono uppercase tracking-wider">
                                              Step {idx + 1}
                                            </span>
                                            <span className={cn(
                                              "px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter leading-none shrink-0",
                                              rule.type === 'literal' && "bg-sky-500/10 text-sky-400 border border-sky-500/20",
                                              rule.type === 'regex' && "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
                                              rule.type === 'element' && "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20",
                                              rule.type === 'whitespace' && "bg-amber-500/10 text-amber-400 border border-amber-500/20",
                                              rule.type === 'not' && "bg-rose-500/10 text-rose-400 border border-rose-500/20",
                                              rule.type === 'choice' && "bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20",
                                              rule.type === 'optional' && "bg-teal-500/10 text-teal-400 border border-teal-500/20",
                                              rule.type === 'zeroOrMore' && "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20",
                                              rule.type === 'oneOrMore' && "bg-blue-500/10 text-blue-400 border border-blue-500/20",
                                              rule.type === 'eof' && "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20"
                                            )}>
                                              {rule.type === 'not' ? 'Not matched' : rule.type === 'element' ? 'Rule Call' : rule.type === 'whitespace' ? 'Whitespace' : rule.type === 'choice' ? 'OneOf Choice' : rule.type === 'optional' ? 'Optional' : rule.type === 'zeroOrMore' ? 'Any Count' : rule.type === 'oneOrMore' ? 'Some Count' : rule.type === 'eof' ? 'EOF Boundary' : 'Expects Match'}
                                            </span>
                                          </div>
                                        </div>

                                        <div className="flex items-center gap-3">
                                          {rule.type === 'whitespace' ? (
                                            <span className="text-[11px] font-mono text-amber-300 bg-amber-500/5 px-2 py-0.5 rounded border border-amber-500/10">
                                              Skip Whitespace &amp; Comments [\\s\\r\\n\\t]
                                            </span>
                                          ) : rule.type === 'eof' ? (
                                            <span className="text-[11px] font-mono text-slate-500 bg-slate-500/5 px-2 py-0.5 rounded border border-slate-500/10">
                                              EOF (End Of File)
                                            </span>
                                          ) : rule.type === 'regex' ? (
                                            <code className="text-[11px] font-mono text-emerald-400 bg-emerald-500/5 px-2 py-0.5 rounded border border-emerald-500/10">
                                              Regex("/{rule.value instanceof RegExp ? rule.value.source : String(rule.value)}/")
                                            </code>
                                          ) : rule.type === 'literal' ? (
                                            <code className="text-[11px] font-mono text-sky-300 bg-sky-500/5 px-2 py-0.5 rounded border border-sky-500/10">
                                              "{String(rule.value)}"
                                            </code>
                                          ) : rule.type === 'element' ? (
                                            <div className="flex items-center gap-2">
                                              <span className="text-[11px] font-mono text-indigo-300 bg-indigo-500/5 px-2 py-0.5 rounded border border-indigo-500/10">
                                                {rule.value?.name || 'anonymous'}
                                              </span>
                                              <button
                                                onClick={() => {
                                                  if (rule.value?.id) selectElementWithHistory(rule.value.id);
                                                }}
                                                className="p-0.5 px-1.5 rounded hover:bg-white/10 text-indigo-400 hover:text-white text-[9.5px] font-bold flex items-center gap-1 transition-colors border border-white/5 cursor-pointer lowercase"
                                              >
                                                Explore &rarr;
                                              </button>
                                            </div>
                                          ) : rule.type === 'choice' ? (
                                            <div className="flex flex-col gap-1 w-full">
                                              <div className="flex flex-wrap gap-1">
                                                {(rule.value as any[]).map((branch, bIdx) => {
                                                  const isElement = branch && branch.id && branch.name;
                                                  return (
                                                    <div 
                                                      key={bIdx}
                                                      className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/30 border border-white/5 text-[10.5px] font-mono"
                                                    >
                                                      <span className="text-[#ecc94b] font-bold">#{bIdx + 1}</span>
                                                      <span className={isElement ? "text-indigo-300" : "text-slate-400"}>
                                                        {isElement ? branch.name : String(branch)}
                                                      </span>
                                                      {isElement && (
                                                        <button
                                                          onClick={() => selectElementWithHistory(branch.id)}
                                                          className="w-3.5 h-3.5 rounded hover:bg-white/10 text-indigo-400 flex items-center justify-center text-[9px] cursor-pointer"
                                                        >
                                                          &rarr;
                                                        </button>
                                                      )}
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                            </div>
                                          ) : (
                                            <div className="flex flex-col gap-1 w-full">
                                              <div className="flex items-center gap-1.5">
                                                {(() => {
                                                  const val = rule.value;
                                                  const isObj = val && typeof val === 'object';
                                                  const isRegExp = val instanceof RegExp || (isObj && val.constructor?.name === 'RegExp');
                                                  const isHierarchicalElement = isObj && 'name' in val && 'id' in val;

                                                  if (isHierarchicalElement) {
                                                    return (
                                                      <div className="flex items-center gap-2">
                                                        <span className="text-[11px] font-mono text-indigo-300 bg-indigo-500/5 px-2 py-0.5 rounded border border-indigo-500/10">
                                                          {val.name}
                                                        </span>
                                                        <button
                                                          onClick={() => selectElementWithHistory(val.id)}
                                                          className="px-1.5 py-0.5 rounded hover:bg-white/10 text-indigo-400 hover:text-indigo-300 text-[10px] font-bold border border-white/5 cursor-pointer flex items-center gap-1"
                                                        >
                                                          Explore &rarr;
                                                        </button>
                                                      </div>
                                                    );
                                                  } else if (isRegExp) {
                                                    const source = val.source || String(val);
                                                    return (
                                                      <code className="text-[11px] font-mono text-emerald-400 bg-emerald-500/5 px-2 py-0.5 rounded border border-emerald-500/10">
                                                        Regex("/{source}/")
                                                      </code>
                                                    );
                                                  } else {
                                                    return (
                                                      <code className="text-[11px] font-mono text-sky-300 bg-sky-500/5 px-2 py-0.5 rounded border border-sky-500/10">
                                                        "{String(val)}"
                                                      </code>
                                                    );
                                                  }
                                                })()}
                                              </div>
                                            </div>
                                          )}
                                        </div>

                                        <p className="text-[10px] text-slate-500 font-sans italic">
                                          {rule.type === 'literal' ? "Strict literal: matches the exact character sequence of this token keyword." :
                                           rule.type === 'regex' ? "Regexp scan: matches standard compiler token patterns, identifiers, numbers, etc." :
                                           rule.type === 'element' ? "Sub-element: executes another rule segment to build nested CST syntax nodes." :
                                           rule.type === 'whitespace' ? "Noise filter: parses and skips spaces, comments, and formatting characters dynamically." :
                                           rule.type === 'choice' ? "Precedence branch: tests each alternative branch option and resolves the longest matching path." :
                                           rule.type === 'optional' ? "Zero-to-One: tries to match the rule pattern option, but continues safely if missing." :
                                           rule.type === 'zeroOrMore' ? "Star repetition: iteratively compiles as many matches of this child as are found." :
                                           rule.type === 'oneOrMore' ? "Plus repetition: loops through consecutive matches, requiring at least one successful parse." :
                                           rule.type === 'not' ? "Negative constraint: verifies this token sequence is absent before matching starts." :
                                           rule.type === 'eof' ? "EOF boundary: verifies the parser head has completed parsing the entire code document." : ""}
                                        </p>
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="flex-1 flex flex-col items-center justify-center text-slate-600 gap-3 opacity-50">
                            <Layers className="w-8 h-8 font-extrabold" />
                            <p className="text-xs font-medium">Select a grammar rule to inspect details.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-600 gap-4 opacity-50">
                      <div className="w-16 h-16 rounded-3xl bg-white/5 flex items-center justify-center border border-white/10">
                        <Database className="w-8 h-8" />
                      </div>
                      <p className="text-sm font-medium">Define 'root' in grammar to visualize.</p>
                    </div>
                  )}
                </section>
              )}
            </motion.div>
          ) : (
            <motion.div 
              key="playground"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="flex-1 flex overflow-hidden"
            >
              {/* Optional Collapsed Test Input Selector Bar */}
              {playgroundInputCollapsed ? (
                <div className="w-[42px] border-r border-white/10 bg-[#121214]/60 backdrop-blur-lg flex flex-col items-center py-4 gap-6 shrink-0 relative z-30 select-none">
                  <button
                    onClick={() => setPlaygroundInputCollapsed(false)}
                    className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer shadow-lg"
                    title="Expand Test Input"
                  >
                    <PanelLeftOpen className="w-4 h-4 text-indigo-400" />
                  </button>
                  <div className="flex-1 flex items-center justify-center flex-col gap-1">
                    <span className="rotate-90 text-[8.5px] font-black tracking-[0.25em] text-slate-500 uppercase whitespace-nowrap">
                      TEST INPUT
                    </span>
                  </div>
                </div>
              ) : (
                /* Playground Left: Large Input */
                <section className="flex-1 border-r border-white/10 bg-black/20 flex flex-col overflow-hidden">
                  <div className="p-4 border-b border-white/5 bg-white/[0.02] flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => setPlaygroundInputCollapsed(true)}
                        className="p-1 hover:bg-white/10 rounded-md text-slate-400 hover:text-white transition-colors cursor-pointer mr-1"
                        title="Collapse Test Input"
                      >
                        <PanelLeftClose className="w-4 h-4 text-indigo-400" />
                      </button>
                      <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Test Input</h3>
                      
                      {/* Incremental Toggle */}
                    <div className="flex items-center gap-1 bg-white/5 border border-white/10 p-0.5 rounded-md">
                      <button
                        onClick={() => setUseIncremental(true)}
                        className={cn(
                          "px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-tight rounded transition-all duration-150 flex items-center gap-1 border",
                          useIncremental 
                            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
                            : "border-transparent text-slate-500 hover:text-slate-300"
                        )}
                        title="Incremental parsing only updates altered regions"
                      >
                        <Zap className="w-2.5 h-2.5" /> Incremental ON
                      </button>
                      <button
                        onClick={() => setUseIncremental(false)}
                        className={cn(
                          "px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-tight rounded transition-all duration-150 border",
                          !useIncremental 
                            ? "bg-[#ecc94b]/10 border-[#ecc94b]/20 text-[#ecc94b]" 
                            : "border-transparent text-slate-500 hover:text-slate-300"
                        )}
                        title="Regular Full-parsing re-parses whole document on each edit"
                      >
                        Full Parse
                      </button>
                    </div>

                    {/* Benchmarks & Performance Metrics */}
                    {cacheStats && (
                      <div className="hidden lg:flex items-center gap-3 text-[9px] font-mono text-slate-400 select-none border-l border-white/10 pl-4 leading-none">
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                          <span>Time:</span>
                          <span className={cn(
                            "font-bold",
                            parseDuration < 0.5 ? "text-emerald-400" : parseDuration < 2 ? "text-[#ecc94b]" : "text-rose-400"
                          )}>
                            {parseDuration.toFixed(2)}ms
                          </span>
                        </span>

                        {useIncremental && (
                          <>
                            <span className="text-slate-600">|</span>
                            <span>Reused Nodes (Hits): <strong className="text-emerald-400">{cacheStats.hits}</strong></span>
                            <span className="text-slate-600">|</span>
                            <span>Evaluated (Misses): <strong className="text-amber-400">{cacheStats.misses}</strong></span>
                            <span className="text-slate-600">|</span>
                            <span>Cache Size: <strong className="text-indigo-400">{cacheStats.size}</strong></span>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 px-2 py-0.5 bg-white/5 rounded-full border border-white/10">
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full shadow-[0_0_8px]",
                      parseError ? "bg-red-500 shadow-red-500" : "bg-emerald-500 shadow-emerald-500"
                    )}></div>
                    <span className="text-[8px] text-white font-bold uppercase tracking-tighter">
                      {parseError ? 'Failed' : 'Valid'}
                    </span>
                  </div>
                </div>
                {/* Workspace Files Tabs Bar */}
                <div className="bg-[#121214] border-b border-white/5 flex items-center justify-between px-4 py-1.5 shrink-0 select-none">
                  <div className="flex items-center gap-2 overflow-x-auto scrollbar-none flex-1">
                    <div className="flex items-center gap-1.5 text-slate-500 text-[9px] font-black uppercase tracking-wider border-r border-white/5 pr-3 shrink-0">
                      <FolderOpen className="w-3.5 h-3.5 text-indigo-400/80" />
                      <span>Workspace</span>
                    </div>

                    <div className="flex items-center gap-1">
                      {Object.keys(workspaceFiles).map(filename => {
                        const isActive = filename === activeFileName;
                        const isRenaming = renamingFileName === filename;

                        return (
                          <div
                            key={filename}
                            className={cn(
                              "group flex items-center gap-2 px-3 py-1 text-[11px] font-mono rounded-md border border-transparent transition-all cursor-pointer relative",
                              isActive
                                ? "bg-white/5 text-indigo-300 border-indigo-500/30 shadow-[0_0_12px_rgba(99,102,241,0.05)] font-semibold"
                                : "text-slate-400 hover:text-white hover:bg-white/[0.02]"
                            )}
                            onClick={() => {
                              if (!isRenaming) {
                                setWorkspaceFiles(prev => ({ ...prev, [activeFileName]: testInput }));
                                setActiveFileName(filename);
                                setTestInput(workspaceFiles[filename] || "");
                              }
                            }}
                            onDoubleClick={() => {
                              setRenamingFileName(filename);
                              setRenameInput(filename);
                            }}
                            title="Double-click to rename"
                          >
                            <FileCode className={cn(
                              "w-3.5 h-3.5",
                              isActive ? "text-indigo-400" : "text-slate-500 group-hover:text-slate-300"
                            )} />

                            {isRenaming ? (
                              <input
                                type="text"
                                autoFocus
                                value={renameInput}
                                onChange={e => setRenameInput(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    const newName = renameInput.trim();
                                    if (!newName || newName === filename) {
                                      setRenamingFileName(null);
                                      return;
                                    }
                                    if (workspaceFiles[newName] !== undefined) {
                                      alert("A file with this name already exists!");
                                      setRenamingFileName(null);
                                      return;
                                    }
                                    setWorkspaceFiles(prev => {
                                      const copy = { ...prev };
                                      const content = copy[filename];
                                      delete copy[filename];
                                      copy[newName] = content;
                                      return copy;
                                    });
                                    if (activeFileName === filename) {
                                      setActiveFileName(newName);
                                    }
                                    setRenamingFileName(null);
                                  } else if (e.key === 'Escape') {
                                    setRenamingFileName(null);
                                  }
                                }}
                                onBlur={() => {
                                  const newName = renameInput.trim();
                                  if (!newName || newName === filename) {
                                    setRenamingFileName(null);
                                    return;
                                  }
                                  if (workspaceFiles[newName] !== undefined) {
                                    alert("A file with this name already exists!");
                                    setRenamingFileName(null);
                                    return;
                                  }
                                  setWorkspaceFiles(prev => {
                                    const copy = { ...prev };
                                    const content = copy[filename];
                                    delete copy[filename];
                                    copy[newName] = content;
                                    return copy;
                                  });
                                  if (activeFileName === filename) {
                                    setActiveFileName(newName);
                                  }
                                  setRenamingFileName(null);
                                }}
                                className="bg-[#18181b] border border-indigo-500/40 rounded px-1.5 py-0.5 text-[10px] text-white focus:outline-none font-sans font-normal"
                                onClick={e => e.stopPropagation()}
                              />
                            ) : (
                              <span>{filename}</span>
                            )}

                            {filename !== "main.hlsl" && !isRenaming && (
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  if (confirm(`Delete ${filename}?`)) {
                                    setWorkspaceFiles(prev => {
                                      const copy = { ...prev };
                                      delete copy[filename];
                                      return copy;
                                    });
                                    if (activeFileName === filename) {
                                      setActiveFileName("main.hlsl");
                                      setTestInput(workspaceFiles["main.hlsl"] || "");
                                    }
                                  }
                                }}
                                className="ml-1 text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-rose-500/10 rounded"
                                title="Delete file"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            )}
                          </div>
                        );
                      })}

                      {isAddingFile ? (
                        <div className="flex items-center gap-1.5 px-2 bg-white/5 rounded-md border border-indigo-500/30">
                          <input
                            type="text"
                            autoFocus
                            placeholder="filename.hlsl"
                            value={newFileNameInput}
                            onChange={e => setNewFileNameInput(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                const name = newFileNameInput.trim();
                                if (!name) {
                                  setIsAddingFile(false);
                                  return;
                                }
                                if (workspaceFiles[name] !== undefined) {
                                  alert("A file with this name already exists!");
                                  return;
                                }
                                setWorkspaceFiles(prev => ({ ...prev, [name]: `// ${name}\n` }));
                                setActiveFileName(name);
                                setTestInput(`// ${name}\n`);
                                setIsAddingFile(false);
                                setNewFileNameInput("");
                              } else if (e.key === 'Escape') {
                                setIsAddingFile(false);
                                setNewFileNameInput("");
                              }
                            }}
                            onBlur={() => {
                              const name = newFileNameInput.trim();
                              if (name && workspaceFiles[name] === undefined) {
                                setWorkspaceFiles(prev => ({ ...prev, [name]: `// ${name}\n` }));
                                setActiveFileName(name);
                                setTestInput(`// ${name}\n`);
                              }
                              setIsAddingFile(false);
                              setNewFileNameInput("");
                            }}
                            className="bg-transparent text-[11px] font-mono text-white placeholder-slate-500 focus:outline-none py-0.5 w-24"
                          />
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setIsAddingFile(true);
                            setNewFileNameInput("");
                          }}
                          className="p-1 hover:bg-white/5 rounded text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
                          title="Create new file"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div ref={editorScrollContainerRef} className="flex-1 overflow-auto custom-scrollbar bg-[#161618] relative flex flex-row">
                  {/* Line Numbers Gutter */}
                  <div className="sticky left-0 self-start select-none text-right pr-2 pl-3 pt-[20px] pb-[20px] bg-[#121214] border-r border-white/5 pointer-events-none z-10 flex flex-col items-end leading-[20px]">
                    {testInput.split('\n').map((_, index) => {
                      const lineNum = index + 1;
                      const isCurrentLine = lineNum === cursorPosition.line;
                      
                      // Check for recovered errors on this exact line using constant-time Set lookup
                      const hasRecovered = errorLines.has(lineNum);

                      // Check for fatal errors on this exact line
                      const hasFatal = lineNum === fatalErrorLine;

                      return (
                        <div 
                          key={index} 
                          className={cn(
                            "h-[20px] min-w-[28px] pr-1 flex items-center justify-end font-mono select-none text-[10px] rounded transition-all duration-150 relative",
                            isCurrentLine ? "text-emerald-400 font-extrabold bg-white/5 shadow-sm" : "text-slate-600/50",
                            hasFatal ? "text-red-400 font-bold bg-red-500/15 border-r-2 border-red-500" : "",
                            hasRecovered && !hasFatal ? "text-amber-400 font-bold bg-amber-500/15 border-r-2 border-amber-500" : ""
                          )}
                        >
                          <span>{lineNum}</span>
                        </div>
                      );
                    })}
                  </div>
                  {/* Editor Wrapper */}
                  <div className="flex-1 min-w-0">
                    <Editor
                      value={testInput}
                      onValueChange={code => {
                        let edit: { editOffset: number; removedLength: number; insertedText: string } | undefined;
                        
                        // Grab the last edit recorded by onBeforeInput/onPaste/onCut
                        if (pendingEditsRef.current.length > 0) {
                          edit = pendingEditsRef.current[pendingEditsRef.current.length - 1];
                        } else {
                          // Fallback to findDiff if the browser/event did not capture it in time
                          edit = findDiff(testInput, code);
                          pendingEditsRef.current.push(edit);
                        }

                        if (edit) {
                          const delta = edit.insertedText.length - edit.removedLength;
                          if (delta !== 0 || edit.removedLength > 0) {
                            shiftAstAndStateOffsets(edit.editOffset, edit.removedLength, delta);
                          }
                        }

                        setTestInput(code);
                        // Update cursor position directly when text changes to capture accurate cursor line metrics
                        const activeEl = document.activeElement;
                        if (activeEl && activeEl.tagName === 'TEXTAREA') {
                          const textarea = activeEl as HTMLTextAreaElement;
                          const start = textarea.selectionStart;
                          const textBefore = textarea.value.slice(0, start);
                          const lines = textBefore.split('\n');
                          const line = lines.length;
                          const col = lines[lines.length - 1].length + 1;
                          setCursorPosition({ line, col });
                        }
                      }}
                      onBeforeInput={e => {
                        const textarea = e.currentTarget as HTMLTextAreaElement;
                        if (!textarea) return;

                        const start = textarea.selectionStart;
                        const end = textarea.selectionEnd;
                        const inputType = (e as any).inputType;
                        const data = (e as any).data;

                        let editOffset = start;
                        let removedLength = end - start;
                        let insertedText = "";

                        if (inputType === 'insertLineBreak') {
                          insertedText = "\n";
                        } else if (inputType === 'deleteContentBackward') {
                          if (removedLength === 0 && start > 0) {
                            editOffset = start - 1;
                            removedLength = 1;
                          }
                        } else if (inputType === 'deleteContentForward') {
                          if (removedLength === 0 && start < textarea.value.length) {
                            editOffset = start;
                            removedLength = 1;
                          }
                        } else if (inputType === 'insertText' || inputType === 'insertCompositionText') {
                          insertedText = data || "";
                        } else {
                          return;
                        }

                        pendingEditsRef.current.push({
                          editOffset,
                          removedLength,
                          insertedText
                        });
                      }}
                      onPaste={e => {
                        const textarea = e.currentTarget as HTMLTextAreaElement;
                        if (!textarea) return;

                        const start = textarea.selectionStart;
                        const end = textarea.selectionEnd;
                        const text = e.clipboardData.getData('text');

                        pendingEditsRef.current.push({
                          editOffset: start,
                          removedLength: end - start,
                          insertedText: text
                        });
                      }}
                      onCut={e => {
                        const textarea = e.currentTarget as HTMLTextAreaElement;
                        if (!textarea) return;

                        const start = textarea.selectionStart;
                        const end = textarea.selectionEnd;

                        pendingEditsRef.current.push({
                          editOffset: start,
                          removedLength: end - start,
                          insertedText: ""
                        });
                      }}
                      highlight={code => highlightWithCST(code)}
                      padding={20}
                      onKeyUp={handleEditorSelectionChange}
                      onClick={handleEditorSelectionChange}
                      onFocus={handleEditorSelectionChange}
                      style={{
                        fontFamily: '"Fira Code", monospace',
                        fontSize: 13,
                        lineHeight: '20px',
                        minHeight: '100%',
                        whiteSpace: 'pre',
                      }}
                      className="outline-none"
                    />
                  </div>
                </div>
                {/* Editor Status Bar */}
                <div className="shrink-0 bg-black/40 border-t border-white/5 py-1.5 px-4 text-[11px] font-mono text-slate-500 flex items-center justify-between select-none">
                  {/* Left Side: Stats */}
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-400">{testInput.split('\n').length}</span> lines
                    </span>
                    <span className="text-slate-700">|</span>
                    <span className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-400">{testInput.length}</span> chars
                    </span>
                  </div>

                  {/* Right Side: cursor location */}
                  <div className="flex items-center gap-4">
                    <div className="px-2 py-0.5 bg-white/5 border border-white/10 rounded-md text-emerald-400 font-bold flex items-center gap-1.5 shadow-[0_1px_5px_rgba(0,0,0,0.2)]">
                      <span>Ln {cursorPosition.line}</span>
                      <span className="text-slate-600 font-normal">,</span>
                      <span>Col {cursorPosition.col}</span>
                    </div>
                    <span className="text-slate-700">|</span>
                    <span className="text-slate-400">Spaces: 4</span>
                    <span className="text-slate-700">|</span>
                    <span className="text-slate-400">UTF-8</span>
                  </div>
                </div>
                {parseError && (
                  <div className="p-6 bg-rose-500/10 border-t border-rose-500/20 text-rose-300 text-xs font-mono">
                    <div className="flex gap-3">
                      <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-500" />
                      <div>
                        <p className="font-bold text-rose-400 mb-1 tracking-tighter uppercase">Fatal Parsing Failure</p>
                        <p className="opacity-90 leading-relaxed max-w-2xl">{parseError.message}</p>
                        {parseError.offset !== undefined && (
                          <div className="mt-3 flex items-center gap-4">
                            <span className="text-indigo-400 font-bold px-2 py-0.5 bg-indigo-500/10 rounded border border-indigo-500/20">
                              Line {getLineAndCol(debouncedTestInput, parseError.offset).line}, Col {getLineAndCol(debouncedTestInput, parseError.offset).col}
                            </span>
                            <span className="text-slate-500 text-[10px]">RULE: {parseError.ruleId}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {recoveredErrors.length > 0 && (
                  <div className="bg-amber-500/10 border-t border-amber-500/20 text-amber-200 text-xs font-mono shrink-0">
                    <button 
                      onClick={() => setIsRecoveredErrorsExpanded(!isRecoveredErrorsExpanded)}
                      className="w-full flex items-center justify-between p-4 hover:bg-amber-500/5 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Zap className="w-5 h-5 flex-shrink-0 text-amber-500" />
                        <span className="font-bold text-amber-400 tracking-tighter uppercase">
                          Recovered Errors ({recoveredErrors.length})
                        </span>
                      </div>
                      {isRecoveredErrorsExpanded ? (
                        <ChevronDown className="w-4 h-4 text-amber-500/70" />
                      ) : (
                        <ChevronUp className="w-4 h-4 text-amber-500/70" />
                      )}
                    </button>
                    <AnimatePresence>
                      {isRecoveredErrorsExpanded && (
                        <motion.div 
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="p-4 pt-0 max-h-64 overflow-y-auto custom-scrollbar">
                            <div className="space-y-3">
                              {recoveredErrors.map((err, i) => (
                                <div key={i} className="flex items-start justify-between p-2.5 bg-black/20 rounded border border-white/5 gap-3">
                                  <span className="opacity-80 break-words whitespace-pre-wrap flex-1 leading-relaxed" title={err.message}>{err.message}</span>
                                  <span className="text-amber-500/60 font-bold shrink-0 text-[11px]">L{getLineAndCol(debouncedTestInput, err.offset).line}:C{getLineAndCol(debouncedTestInput, err.offset).col}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </section>
            )}

              {/* Adjust Width Handle for Playground CST */}
              {!playgroundCstCollapsed && !playgroundInputCollapsed && (
                <div
                  onMouseDown={startPlaygroundResize}
                  onDoubleClick={() => setPlaygroundCstWidth(500)}
                  className="w-1.5 hover:w-2 bg-white/5 hover:bg-indigo-500/50 active:bg-indigo-500 cursor-col-resize select-none relative z-30 transition-all flex items-center justify-center group shrink-0"
                  title="Drag to resize, Double click to reset"
                >
                  <div className="absolute top-1/2 -translate-y-1/2 w-4 h-[32px] rounded-md bg-slate-900 border border-white/10 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none gap-0.5">
                    <span className="w-0.5 h-1.5 bg-white/40 rounded-full" />
                    <span className="w-0.5 h-1.5 bg-white/40 rounded-full" />
                  </div>
                </div>
              )}

              {/* Playground Right: Huge CST Inspector */}
              {!playgroundCstCollapsed ? (
                <aside 
                  style={playgroundInputCollapsed ? undefined : { width: `${playgroundCstWidth}px` }}
                  className={cn(
                    "bg-black/40 backdrop-blur-xl flex flex-col overflow-hidden",
                    playgroundInputCollapsed ? "flex-1" : "shrink-0"
                  )}
                >
                  <div className="px-4 py-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => setPlaygroundCstCollapsed(true)}
                        className="p-1 hover:bg-white/10 rounded-md text-slate-400 hover:text-white transition-colors cursor-pointer mr-1"
                        title="Collapse CST Panel"
                      >
                        <PanelRightClose className="w-4 h-4 text-indigo-400" />
                      </button>
                      <div className="flex bg-white/5 rounded-md border border-white/10 p-0.5 font-mono">
                        <button
                          onClick={() => setVisualizeMode('cst')}
                          className={cn(
                            "px-2 py-0.5 text-[8px] font-bold transition-all rounded uppercase flex items-center gap-1 border",
                            visualizeMode === 'cst' 
                              ? "bg-indigo-600/20 border-indigo-500/30 text-indigo-300 font-extrabold"
                              : "bg-transparent border-transparent text-slate-500 hover:text-slate-300"
                          )}
                        >
                          <FileCode className="w-3 h-3" /> CST
                        </button>
                        <button
                          onClick={() => setVisualizeMode('ast')}
                          className={cn(
                            "px-2 py-0.5 text-[8px] font-bold transition-all rounded uppercase flex items-center gap-1 border",
                            visualizeMode === 'ast' 
                              ? "bg-indigo-600/20 border-indigo-500/30 text-indigo-300 font-extrabold"
                              : "bg-transparent border-transparent text-slate-500 hover:text-slate-300"
                          )}
                        >
                          <Layers className="w-3 h-3" /> AST
                        </button>
                      </div>
                    
                    <div className="flex bg-white/5 rounded-md border border-white/10 p-0.5 font-mono">
                      <button 
                        onClick={() => setCstViewMode('json')}
                        className={cn(
                          "px-1.5 py-0.5 text-[8px] font-bold transition-all rounded",
                          cstViewMode === 'json' ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"
                        )}
                      >
                        JSON
                      </button>
                      <button 
                        onClick={() => setCstViewMode('visual')}
                        className={cn(
                          "px-1.5 py-0.5 text-[8px] font-bold transition-all rounded",
                          cstViewMode === 'visual' ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"
                        )}
                      >
                        VISUAL
                      </button>
                      <button 
                        onClick={() => setCstViewMode('query')}
                        className={cn(
                          "px-1.5 py-0.5 text-[8px] font-bold transition-all rounded",
                          cstViewMode === 'query' ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"
                        )}
                      >
                        QUERY
                      </button>
                      <button 
                        onClick={() => setCstViewMode('scopes')}
                        className={cn(
                          "px-1.5 py-0.5 text-[8px] font-bold transition-all rounded",
                          cstViewMode === 'scopes' ? "bg-indigo-500 text-white" : "text-slate-500 hover:text-slate-300"
                        )}
                      >
                        SCOPES
                      </button>
                      <button 
                        onClick={() => setCstViewMode('performance')}
                        className={cn(
                          "px-1.5 py-0.5 text-[8px] font-bold transition-all rounded flex items-center gap-0.5",
                          cstViewMode === 'performance' ? "bg-orange-600/20 text-orange-400 border border-orange-500/25 font-black shadow-sm" : "text-slate-500 hover:text-slate-300"
                        )}
                      >
                        ⚡ PERF
                      </button>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        const targetData = visualizeMode === 'ast' ? astResult : parseResult;
                        navigator.clipboard.writeText(JSON.stringify(targetData, null, 2));
                        alert(`${visualizeMode.toUpperCase()} JSON copied!`);
                      }}
                      className="text-[9px] font-bold p-1.5 hover:bg-white/5 rounded border border-white/10 text-indigo-400 hover:text-white transition-all uppercase tracking-widest flex items-center gap-1.5 shadow-sm"
                    >
                      <Copy className="w-3 h-3" /> Copy JSON
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-hidden p-0 custom-scrollbar relative bg-[#0a0a0a] bg-[radial-gradient(#ffffff05_1px,transparent_1px)] [background-size:20px_20px]">
                  {parseResult ? (
                    cstViewMode === 'json' ? (
                      <div className="ast-view-container font-mono text-[12px] h-full overflow-auto p-6 custom-scrollbar">
                        <ReactJson 
                          src={visualizeMode === 'ast' ? astResult : parseResult} 
                          theme="ocean" 
                          style={{ background: 'transparent', fontSize: '11px' }}
                          displayDataTypes={false}
                          displayObjectSize={true}
                          enableClipboard={false}
                          name={false}
                          collapsed={2}
                          iconStyle="square"
                          indentWidth={4}
                        />
                      </div>
                    ) : cstViewMode === 'visual' ? (
                      <div className="h-full flex flex-col overflow-hidden relative group/canvas">
                        <TransformWrapper
                          ref={transformComponentRef}
                          initialScale={0.8}
                          initialPositionX={50}
                          initialPositionY={50}
                          centerOnInit={false}
                          minScale={0.1}
                          maxScale={4}
                          limitToBounds={false}
                          doubleClick={{ disabled: false, mode: "reset" }}
                        >
                          {({ zoomIn, zoomOut, resetTransform }: any) => (
                            <>
                              <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
                                <div className="flex bg-black/60 backdrop-blur-md rounded-lg border border-white/10 p-1 shadow-2xl">
                                  <button 
                                    onClick={() => zoomIn()}
                                    className="p-1.5 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors"
                                    title="Zoom In"
                                  >
                                    <ZoomIn className="w-3.5 h-3.5" />
                                  </button>
                                  <button 
                                    onClick={() => zoomOut()}
                                    className="p-1.5 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors"
                                    title="Zoom Out"
                                  >
                                    <ZoomOut className="w-3.5 h-3.5" />
                                  </button>
                                  <div className="w-px h-4 bg-white/10 mx-1 self-center" />
                                  <button 
                                    onClick={() => resetTransform()}
                                    className="p-1.5 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors"
                                    title="Reset View"
                                  >
                                    <Maximize className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                              
                              <div className="absolute bottom-4 right-4 z-50 text-[10px] font-bold text-slate-600 uppercase tracking-widest pointer-events-none opacity-0 group-hover/canvas:opacity-100 transition-opacity">
                                drag to pan • scroll to zoom
                              </div>

                              <TransformComponent
                                wrapperStyle={{ width: '100%', height: '100%' }}
                                contentStyle={{ width: '100%', height: '100%' }}
                              >
                                <div className="p-12 min-h-full min-w-full">
                                  {renderCSTVisualNode(visualizeMode === 'ast' ? astResult : parseResult)}
                                </div>
                              </TransformComponent>
                            </>
                          )}
                        </TransformWrapper>

                        {/* Floating Node Details Panel */}
                        {(() => {
                          const activeNode = hoveredCstNode || selectedCstNode;
                          if (!activeNode) return null;
                          
                          let nodeText = "";
                          if (typeof activeNode === 'object' && activeNode !== null) {
                            if (typeof activeNode.start === 'number' && typeof activeNode.end === 'number') {
                              nodeText = debouncedTestInput.substring(Math.max(0, activeNode.start), Math.min(debouncedTestInput.length, activeNode.end));
                            } else if (activeNode.value !== undefined) {
                              nodeText = String(activeNode.value);
                            }
                          } else {
                            nodeText = String(activeNode);
                          }
                          const isPinned = !!selectedCstNode;

                          return (
                            <div className="absolute bottom-4 left-4 z-50 w-80 bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl flex flex-col gap-3 max-h-[75%] overflow-y-auto custom-scrollbar transition-all">
                              <div className="flex items-center justify-between border-b border-white/5 pb-2">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                                  <FileCode className="w-3.5 h-3.5 text-indigo-400" /> Node Inspector
                                </span>
                                <div className="flex items-center gap-2">
                                  {isPinned && hoveredCstNode && hoveredCstNode !== selectedCstNode && (
                                    <span className="text-[8px] bg-indigo-500/20 text-indigo-300 px-1 border border-indigo-500/30 rounded font-bold uppercase tracking-widest">
                                      Hover Preview
                                    </span>
                                  )}
                                  <button
                                    onClick={() => {
                                      setSelectedCstNode(null);
                                      setHoveredCstNode(null);
                                    }}
                                    className="p-1 text-slate-400 hover:text-white hover:bg-white/5 rounded transition-all cursor-pointer"
                                    title="Clear Selection"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>

                              <div className="space-y-3.5 text-xs">
                                <div className="flex flex-col gap-1">
                                  <span className="text-[8.5px] font-black uppercase tracking-[0.2em] text-indigo-400 leading-none">Rule Name / Type</span>
                                  <span className="text-sm font-black text-rose-300 font-mono tracking-tight bg-white/5 px-2 py-0.5 rounded border border-white/10 inline-block align-middle self-start">
                                    {activeNode.type || activeNode.ruleId || 'Token'}
                                  </span>
                                </div>

                                {typeof activeNode.start === 'number' && typeof activeNode.end === 'number' && (
                                  <div className="grid grid-cols-2 gap-2 text-slate-400 font-mono text-[10px]">
                                    <div className="bg-white/[0.02] p-1.5 rounded border border-white/5">
                                      <span className="block text-[8px] text-slate-600 font-black uppercase tracking-widest mb-0.5">Offset Range</span>
                                      <span className="text-white font-bold">{activeNode.start} &ndash; {activeNode.end}</span>
                                    </div>
                                    <div className="bg-white/[0.02] p-1.5 rounded border border-white/5">
                                      <span className="block text-[8px] text-slate-600 font-black uppercase tracking-widest mb-0.5">Length (chars)</span>
                                      <span className="text-indigo-300 font-bold">{activeNode.end - activeNode.start}</span>
                                    </div>
                                    <div className="bg-white/[0.02] p-1.5 rounded border border-white/5 col-span-2">
                                      <span className="block text-[8px] text-slate-600 font-black uppercase tracking-widest mb-0.5">Match Location</span>
                                      <span className="text-emerald-400 font-bold">
                                        Line {getLineAndCol(debouncedTestInput, activeNode.start).line}, Col {getLineAndCol(debouncedTestInput, activeNode.start).col}
                                      </span>
                                    </div>
                                  </div>
                                )}

                                <div className="flex flex-col gap-1.5">
                                  <span className="text-[8.5px] font-black uppercase tracking-[0.2em] text-indigo-400 leading-none">Matched Source Code</span>
                                  <div className="bg-black/50 p-2.5 rounded-lg border border-white/5 max-h-36 overflow-y-auto font-mono text-[11px] whitespace-pre-wrap text-emerald-300 break-all leading-normal custom-scrollbar bg-[#161618]">
                                    {nodeText || <span className="text-slate-500 italic">Empty match</span>}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    ) : cstViewMode === 'query' ? (
                      <div className="h-full flex flex-col overflow-hidden bg-slate-950/20">
                        <div className="p-4 border-b border-white/5 bg-white/[0.02]">
                          <div className="relative group">
                            <div className="absolute top-2.5 left-3 flex items-center pointer-events-none text-slate-500 group-focus-within:text-indigo-400 transition-colors">
                              <Search className="w-3.5 h-3.5" />
                            </div>
                            <textarea 
                              value={queryText}
                              onChange={(e) => setQueryText(e.target.value)}
                              placeholder="Enter S-expression query (e.g.&#10;(struct_decl&#10;  (id @name)))"
                              rows={4}
                              className="w-full bg-slate-900/50 border border-white/10 rounded-lg py-2.5 pl-9 pr-4 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all font-mono resize-y min-h-[90px] custom-scrollbar"
                            />
                            <div className="absolute right-3 bottom-2.5 flex gap-1 pointer-events-none">
                               <div className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[8px] font-bold text-slate-500 uppercase tracking-tighter">S-Expr Parser</div>
                            </div>
                          </div>
                          
                          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] text-slate-500 font-medium select-none">Examples:</span>
                            <button 
                              onClick={() => setQueryText('(struct_decl (identifier) @struct_name)')}
                              className="text-[10px] bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/15 rounded px-1.5 py-0.5 font-mono cursor-pointer transition-colors"
                              title="Click to load direct child query"
                            >
                              Direct Child
                            </button>
                            <button 
                              onClick={() => setQueryText('(hlsl_func_decl .. param @p)')}
                              className="text-[10px] bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/15 rounded px-1.5 py-0.5 font-mono cursor-pointer transition-colors"
                              title="Click to load descendant query searching params inside any function"
                            >
                              .. Descendant Params
                            </button>
                            <button 
                              onClick={() => setQueryText('(struct_decl .. (var_decl (identifier) @field))')}
                              className="text-[10px] bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/15 rounded px-1.5 py-0.5 font-mono cursor-pointer transition-colors"
                              title="Click to load descendant query searching fields nested inside a struct"
                            >
                              .. Nested Fields
                            </button>
                          </div>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-0">
                          {(() => {
                            try {
                              const query = new CSTQuery(queryText);
                              const matches = query.run(visualizeMode === 'ast' ? astResult : parseResult);
                              
                              const getNodeText = (node: any): string => {
                                if (!node) return "";
                                if (typeof node.start === 'number' && typeof node.end === 'number') {
                                  return debouncedTestInput.substring(node.start, node.end);
                                }
                                if (Array.isArray(node)) {
                                  return node.map(getNodeText).join("");
                                }
                                if (node.value !== undefined) {
                                  if (typeof node.value === 'string') return node.value;
                                  if (Array.isArray(node.value)) return node.value.map(getNodeText).join("");
                                  return getNodeText(node.value);
                                }
                                if (node.children !== undefined) {
                                  return getNodeText(node.children);
                                }
                                return String(node);
                              };

                              const renderNodeCard = (node: any, titleStr: string, badgeColor: string, copyKey: string) => {
                                if (!node) return null;
                                const matchedText = getNodeText(node);
                                const startCoords = typeof node.start === 'number' ? getLineAndCol(debouncedTestInput, node.start) : { line: 1, col: 1 };
                                const endCoords = typeof node.end === 'number' ? getLineAndCol(debouncedTestInput, node.end) : { line: 1, col: 1 };
                                const isCopied = copiedMap[copyKey];

                                return (
                                  <div 
                                    className={cn(
                                      "flex flex-col gap-2 p-3.5 rounded-xl border transition-all text-slate-300 relative select-text",
                                      hoveredQueryNode === node 
                                        ? "bg-indigo-500/15 border-indigo-500/40 shadow-[0_4px_16px_rgba(99,102,241,0.15)]" 
                                        : "bg-black/40 border-white/5 hover:border-white/10"
                                    )}
                                    onMouseEnter={() => {
                                      setHoveredQueryNode(node);
                                      setHoveredCstNode(node);
                                    }}
                                    onMouseLeave={() => {
                                      setHoveredQueryNode(null);
                                      setHoveredCstNode(null);
                                    }}
                                    onClick={() => {
                                      setSelectedCstNode(node);
                                    }}
                                    onDoubleClick={(e) => {
                                      e.stopPropagation();
                                      scrollToNode(node);
                                    }}
                                    title="Double-click to navigate inside the editor"
                                  >
                                    <div className="flex items-center justify-between select-none">
                                      <div className="flex items-center gap-1.5 overflow-hidden">
                                        <span className={cn("text-[8px] font-extrabold uppercase tracking-tighter px-2 py-0.5 rounded border antialiased shrink-0", badgeColor)}>
                                          {titleStr}
                                        </span>
                                        <span className="text-[9px] font-mono text-slate-400 bg-white/5 px-1.5 py-0.5 rounded border border-white/5 truncate max-w-[150px]">
                                          {node.type || 'Rule'}
                                        </span>
                                      </div>
                                      
                                      <div className="flex items-center gap-1 shrink-0">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            scrollToNode(node);
                                          }}
                                          title="Locate details in editor (Double-click card)"
                                          className="p-1 rounded text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10 transition-all active:scale-95"
                                        >
                                          <MapPin className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            doCopy(copyKey, matchedText);
                                          }}
                                          title="Copy matched text"
                                          className="p-1 rounded text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all active:scale-95"
                                        >
                                          {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                        </button>
                                      </div>
                                    </div>
                                    
                                    <pre className="text-[11px] font-mono text-emerald-300 bg-[#0c0c0e] p-2.5 rounded-lg border border-white/5 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-52 overflow-y-auto custom-scrollbar select-text selection:bg-indigo-500/30">
                                      {matchedText || <span className="text-slate-600 italic">Empty match</span>}
                                    </pre>
                                    
                                    <div className="flex flex-wrap items-center justify-between text-[8px] font-bold text-slate-500 bg-white/[0.01] px-2 py-1 rounded border border-white/[0.02] select-none">
                                      <span className="text-slate-400 flex items-center gap-1">
                                        <span className="text-[10px] text-indigo-400/50">📍</span>
                                        Ln {startCoords.line}, Col {startCoords.col} &rarr; Ln {endCoords.line}, Col {endCoords.col}
                                      </span>
                                      <div className="flex gap-2">
                                        <span>LEN: {typeof node.end === 'number' && typeof node.start === 'number' ? (node.end - node.start) : matchedText.length} chars</span>
                                        {typeof node.start === 'number' && <span>OFFSET: {node.start}-{node.end}</span>}
                                      </div>
                                    </div>
                                  </div>
                                );
                              };

                              if (matches.length === 0) {
                                return (
                                  <div className="flex flex-col items-center justify-center p-12 text-slate-600 opacity-40 text-center gap-2">
                                    <Search className="w-8 h-8 mb-2" />
                                    <p className="text-xs font-bold uppercase tracking-widest">No matches found</p>
                                    <p className="text-[10px]">Try a different query or adjust your code.</p>
                                  </div>
                                );
                              }

                              return (
                                <div className="divide-y divide-white/5">
                                  <div className="px-4 py-2.5 bg-indigo-500/5 border-b border-white/5 flex items-center justify-between">
                                    <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest">{matches.length} matches found</span>
                                    <span className="text-[8px] font-semibold text-slate-500 uppercase tracking-tight">Double-click match to locate</span>
                                  </div>
                                  {matches.map((match, mIdx) => (
                                    <div key={mIdx} className="p-4 hover:bg-white/[0.01] transition-colors group">
                                      <div className="flex items-center justify-between mb-3 select-none">
                                        <div className="flex items-center gap-2">
                                          <div className="w-5 h-5 rounded bg-indigo-500/15 flex items-center justify-center text-[10px] font-extrabold text-indigo-400 border border-indigo-500/25">
                                            {mIdx + 1}
                                          </div>
                                          <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Match</span>
                                        </div>
                                      </div>
                                      
                                      <div className="space-y-3">
                                        {/* Render matched root node */}
                                        {match.node && renderNodeCard(
                                          match.node,
                                          "Whole Match",
                                          "bg-indigo-500/10 border-indigo-500/20 text-indigo-400",
                                          `root-${mIdx}`
                                        )}
                                        
                                        {/* Render Named Captures if they exist */}
                                        {match.captures && match.captures.length > 0 ? (
                                          <div className="pt-1.5 space-y-2">
                                            <div className="px-1 text-[9px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5 select-none">
                                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/60" />
                                              Captures ({match.captures.length})
                                            </div>
                                            {match.captures.map((cap, cIdx) => (
                                              <div key={cIdx}>
                                                {renderNodeCard(
                                                  cap.node,
                                                  `@${cap.name}`,
                                                  "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
                                                  `cap-${mIdx}-${cIdx}`
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        ) : (
                                          <div className="text-[8px] font-semibold text-slate-500 italic px-1 pt-1 select-none">
                                            No named captures in query. Displaying root matched node above.
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              );
                            } catch (e) {
                              return (
                                <div className="p-6 text-rose-400 bg-rose-400/5 m-4 rounded-xl border border-rose-400/20">
                                  <div className="flex items-center gap-2 mb-2">
                                    <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                                    <span className="text-[10px] font-black uppercase tracking-widest">Query Syntax Error</span>
                                  </div>
                                  <p className="text-[11px] font-mono break-words">{(e as any).message}</p>
                                </div>
                              );
                            }
                          })()}
                        </div>
                      </div>
                    ) : cstViewMode === 'scopes' ? (
                      <div className="h-full flex flex-row overflow-hidden text-slate-300 bg-slate-950/20">
                        {/* 1. Left Sidebar: Scopes Tree & Search */}
                        <div className="w-[45%] border-r border-white/5 flex flex-col overflow-hidden bg-black/80">
                          <div className="p-3 border-b border-white/5 bg-white/[0.01] space-y-2">
                            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                              Lexical Scopes
                            </div>
                            <div className="relative">
                              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                              <input
                                type="text"
                                placeholder="Search symbols..."
                                value={scopeSearchQuery}
                                onChange={(e) => setScopeSearchQuery(e.target.value)}
                                className="w-full bg-slate-900/50 border border-white/10 rounded-lg py-1.5 pl-8 pr-3 text-[11px] text-white focus:outline-none focus:border-indigo-500/50 transition-all font-mono"
                              />
                            </div>
                          </div>

                          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                            {scopeError ? (
                              <div className="p-4 m-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 font-mono text-center">
                                <div className="flex items-center justify-center gap-1.5 text-[10px] font-black uppercase text-rose-400 mb-1.5 animate-pulse">
                                  <AlertCircle className="w-3.5 h-3.5" /> Resolver Error
                                </div>
                                <div className="text-[11px] text-left leading-relaxed max-h-[300px] overflow-auto custom-scrollbar font-normal p-1 bg-black/30 rounded border border-white/5 select-text">
                                  {scopeError}
                                </div>
                                <div className="mt-3 text-[9px] text-slate-400">
                                  Please check the custom code under <strong className="text-indigo-400">Designer &gt; Scope Resolver</strong> to fix this error.
                                </div>
                              </div>
                            ) : scopeChain ? (
                              (() => {
                                const renderScope = (scope: LexicalScope, depth: number = 0): React.ReactNode => {
                                  const isSelected = selectedScope?.id === scope.id || (!selectedScope && scope.id === 'global');
                                  const symbolMatchCount = scope.symbols.filter(s => 
                                    (s.name || "").toString().toLowerCase().includes(scopeSearchQuery.toLowerCase()) ||
                                    (s.datatype || "").toString().toLowerCase().includes(scopeSearchQuery.toLowerCase())
                                  ).length;

                                  const showMatchBadge = scopeSearchQuery.length > 0 && symbolMatchCount > 0;

                                  return (
                                    <div key={scope.id} className="space-y-0.5">
                                      <div 
                                        onClick={() => {
                                          setSelectedScope(scope);
                                          setSelectedSymbol(null);
                                        }}
                                        onMouseEnter={() => {
                                          setHoveredScope(scope);
                                        }}
                                        onMouseLeave={() => {
                                          setHoveredScope(null);
                                        }}
                                        className={cn(
                                          "flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all border",
                                          isSelected 
                                            ? "bg-indigo-500/15 border-indigo-500/30 text-white font-semibold" 
                                            : "border-transparent bg-transparent hover:bg-white/[0.02] text-slate-400 hover:text-white"
                                        )}
                                        style={{ paddingLeft: `${Math.max(8, depth * 16 + 8)}px` }}
                                      >
                                        <div className="flex items-center gap-2 overflow-hidden">
                                          <div className={cn(
                                            "w-1.5 h-1.5 rounded-full",
                                            scope.type === 'global' ? "bg-purple-400" :
                                            scope.type === 'struct' ? "bg-amber-400" :
                                            scope.type === 'function' ? "bg-emerald-400" : "bg-sky-400"
                                          )} />
                                          <span className="text-[10px] font-mono truncate">{scope.name}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                          {showMatchBadge && (
                                            <span className="px-1 text-[8px] bg-indigo-500/30 text-indigo-200 border border-indigo-500/50 font-black rounded uppercase">
                                              {symbolMatchCount} Match
                                            </span>
                                          )}
                                          <span className="text-[8px] font-mono opacity-50 px-1 py-0.5 rounded bg-black/40 border border-white/5">
                                            ({scope.symbols.length}s / {scope.references.length}r)
                                          </span>
                                        </div>
                                      </div>
                                      {scope.children.map(child => renderScope(child, depth + 1))}
                                    </div>
                                  );
                                };
                                return renderScope(scopeChain);
                              })()
                            ) : (
                              <div className="p-4 text-center text-slate-500 italic text-[11px]">
                                No scopes resolved.
                              </div>
                            )}
                          </div>
                        </div>

                        {/* 2. Right Detail Panel */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 bg-slate-950/40">
                          {(() => {
                            const currentScope = selectedScope || scopeChain || { name: 'None', symbols: [], references: [], type: 'global', id: 'global' };
                            
                            const filteredSymbols = currentScope.symbols.filter(s => 
                              (s.name || "").toString().toLowerCase().includes(scopeSearchQuery.toLowerCase()) ||
                              (s.datatype || "").toString().toLowerCase().includes(scopeSearchQuery.toLowerCase())
                            );

                            return (
                              <div className="space-y-4">
                                <div className="p-3 bg-white/[0.02] border border-white/10 rounded-xl space-y-1">
                                  <div className="flex items-center gap-2">
                                    <span className={cn(
                                      "px-1.5 py-0.5 rounded text-[8px] font-bold tracking-widest uppercase border",
                                      currentScope.type === 'global' ? "bg-purple-500/10 text-purple-300 border-purple-500/30" :
                                      currentScope.type === 'struct' ? "bg-amber-500/10 text-amber-300 border-amber-500/30" :
                                      currentScope.type === 'function' ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" :
                                      "bg-sky-500/10 text-sky-300 border-sky-500/30"
                                    )}>
                                      {currentScope.type} SCOPE
                                    </span>
                                    <span className="text-[11px] font-mono text-slate-300 truncate font-bold">
                                      {currentScope.name}
                                    </span>
                                  </div>
                                  <div className="text-[9px] font-mono text-slate-500 flex items-center gap-3 pt-1">
                                    <span>Offset: {currentScope.start} - {currentScope.end}</span>
                                    <span>Symbols: {currentScope.symbols.length}</span>
                                    <span>Usages: {currentScope.references.length}</span>
                                  </div>
                                </div>

                                <div className="space-y-4">
                                  <div>
                                    <div className="text-[9px] font-black tracking-widest text-slate-500 uppercase mb-2">
                                      Declared Symbols ({filteredSymbols.length})
                                    </div>
                                    {filteredSymbols.length === 0 ? (
                                      <div className="p-3 bg-white/[0.01] border border-white/5 border-dashed rounded-lg text-slate-500 text-[10px] italic font-mono">
                                        No symbols declared in this scope boundary{scopeSearchQuery ? " matching search" : ""}.
                                      </div>
                                    ) : (
                                      <div className="grid grid-cols-1 gap-2">
                                        {filteredSymbols.map(sym => {
                                          const isActive = selectedSymbol?.id === sym.id;
                                          return (
                                            <div 
                                              key={sym.id}
                                              onClick={() => setSelectedSymbol(sym)}
                                              onMouseEnter={() => setHoveredSymbol(sym)}
                                              onMouseLeave={() => setHoveredSymbol(null)}
                                              className={cn(
                                                "p-3 rounded-xl border cursor-pointer transition-all flex flex-col gap-1.5 font-mono",
                                                isActive 
                                                  ? "bg-indigo-500/15 border-indigo-500/40 shadow-lg" 
                                                  : "bg-black/40 border-white/5 hover:border-white/10"
                                              )}
                                            >
                                              <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                  <span className="text-[9px] font-black text-rose-300 font-mono bg-white/5 px-1.5 py-0.5 rounded border border-white/5 uppercase">
                                                    {sym.kind}
                                                  </span>
                                                  <span className="text-[11px] font-mono font-bold text-white">
                                                    {sym.name}
                                                  </span>
                                                </div>
                                                <div className="text-[9.5px] font-mono text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded-md border border-indigo-500/20">
                                                  {sym.datatype}
                                                </div>
                                              </div>
                                              <div className="text-[8px] font-mono text-slate-500 flex items-center gap-3">
                                                <span>Range: {sym.start}-{sym.end}</span>
                                                <span className="text-emerald-400 font-bold">{sym.references.length} references</span>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>

                                  {selectedSymbol && (
                                    <motion.div 
                                      initial={{ opacity: 0, y: 5 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      className="p-4 bg-indigo-950/20 border border-indigo-500/20 rounded-xl space-y-3 font-mono"
                                    >
                                      <div className="flex items-center justify-between pb-1.5 border-b border-indigo-500/10">
                                        <div className="flex items-center gap-2">
                                          <GitBranch className="w-4 h-4 text-indigo-400" />
                                          <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest">
                                            Symbol Details & Graph
                                          </span>
                                        </div>
                                        <button 
                                          onClick={() => setSelectedSymbol(null)}
                                          className="text-[9px] text-slate-400 hover:text-white"
                                        >
                                          Reset
                                        </button>
                                      </div>

                                      <div className="space-y-3 text-[11px] font-mono text-slate-300">
                                        <div className="space-y-1.5 bg-black/50 p-3 rounded-lg border border-white/5">
                                          <span className="block text-[8px] text-slate-500 font-bold uppercase tracking-wider mb-1">Lexical Resolve Path</span>
                                          <div className="flex flex-col gap-1 text-[10px]">
                                            <div className="flex items-center gap-1.5 text-slate-400">
                                              <div className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                                              <span>Scope: {selectedSymbol.scopeId} ({currentScope.type})</span>
                                            </div>
                                            <div className="pl-3 border-l-2 border-dashed border-indigo-500/40 text-rose-300 font-bold flex items-center gap-1.5">
                                              <span>↳ Declared Node: <b>{selectedSymbol.name}</b> as <b>{selectedSymbol.datatype}</b> in <span className="text-rose-400 font-mono text-[10px] bg-white/5 px-1 py-0.5 rounded">{selectedSymbol.fileName || activeFileName}</span></span>
                                            </div>
                                            {selectedSymbol.references.map((r, ri) => (
                                              <div key={r.id} className="pl-3 border-l-2 border-dashed border-indigo-500/40 text-emerald-400 flex items-center gap-1.5">
                                                <span>↳ Ref #{ri+1} ({r.fileName || activeFileName}): at Offset {r.start} resolved to declaration symbol</span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>

                                        <div className="space-y-1">
                                          <span className="block text-[8px] text-slate-500 font-bold uppercase tracking-wider">Symbol Snippet Source</span>
                                          <pre className="p-2.5 rounded bg-black/60 border border-indigo-500/20 text-[10px] text-emerald-400 leading-relaxed overflow-x-auto truncate">
                                            {(workspaceFiles[selectedSymbol.fileName || activeFileName] || "").substring(selectedSymbol.start, selectedSymbol.end) || "Empty Definition Match"}
                                          </pre>
                                        </div>

                                        <div className="space-y-1.5">
                                          <span className="block text-[8px] text-slate-500 font-bold uppercase tracking-wider">Code usages / references ({selectedSymbol.references.length})</span>
                                          {selectedSymbol.references.length === 0 ? (
                                            <div className="text-[10px] italic text-slate-500">No active usages analyzed.</div>
                                          ) : (
                                            <div className="flex flex-wrap gap-1.5">
                                              {selectedSymbol.references.map((r, ri) => {
                                                const rFile = r.fileName || activeFileName;
                                                const rContent = workspaceFiles[rFile] || "";
                                                const rLoc = getLineAndCol(rContent, r.start);
                                                return (
                                                  <div 
                                                    key={r.id}
                                                    onClick={() => {
                                                      setWorkspaceFiles(prev => ({ ...prev, [activeFileName]: testInput }));
                                                      setActiveFileName(rFile);
                                                      setTestInput(workspaceFiles[rFile] || "");
                                                    }}
                                                    className="p-1.5 px-2 bg-emerald-500/5 hover:bg-indigo-500/20 border border-emerald-500/20 hover:border-indigo-500/40 rounded text-[10px] text-emerald-300 transition-all flex items-center gap-1.5 cursor-pointer"
                                                    title={`Click to jump to ${rFile} line ${rLoc.line}`}
                                                  >
                                                    <Link className="w-3 h-3 text-emerald-400/80" />
                                                    <span>Ref #{ri+1} ({rFile}: Line {rLoc.line}, Col {rLoc.col})</span>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </motion.div>
                                  )}

                                  <div>
                                    <div className="text-[9px] font-black tracking-widest text-slate-500 uppercase mb-2">
                                      Referenced Identifiers in Scope ({currentScope.references.length})
                                    </div>
                                    {currentScope.references.length === 0 ? (
                                      <div className="p-3 bg-white/[0.01] border border-white/5 border-dashed rounded-lg text-slate-500 text-[10px] italic">
                                        No symbol references used inside this scope.
                                      </div>
                                    ) : (
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px]">
                                        {currentScope.references.map(ref => {
                                          const isActive = selectedReference?.id === ref.id;
                                          return (
                                            <div 
                                              key={ref.id}
                                              onClick={() => {
                                                setSelectedReference(ref);
                                                if (ref.resolvedSymbolId) {
                                                  const sym = findSymbolById(ref.resolvedSymbolId);
                                                  if (sym) {
                                                    setSelectedSymbol(sym);
                                                  }
                                                } else {
                                                  setSelectedSymbol(null);
                                                }
                                              }}
                                              onMouseEnter={() => {
                                                setHoveredReference(ref);
                                                if (ref.resolvedSymbolId) {
                                                  const sym = findSymbolById(ref.resolvedSymbolId);
                                                  if (sym) {
                                                    setHoveredSymbol(sym);
                                                  }
                                                }
                                              }}
                                              onMouseLeave={() => {
                                                setHoveredReference(null);
                                                setHoveredSymbol(null);
                                              }}
                                              onDoubleClick={(e) => {
                                                e.stopPropagation();
                                                scrollToNode(ref);
                                              }}
                                              title="Double-click to locate this reference in the editor"
                                              className={cn(
                                                "p-2.5 rounded-lg border flex flex-col gap-1 font-mono cursor-pointer transition-all",
                                                isActive 
                                                  ? "bg-sky-500/15 border-sky-500/40 shadow-[0_4px_16px_rgba(14,165,233,0.15)] text-sky-200" 
                                                  : "bg-black/20 border-white/5 text-slate-300 hover:border-sky-500/25 hover:bg-black/40"
                                              )}
                                            >
                                              <div className="flex items-center justify-between">
                                                <span className="font-bold text-sky-300">{ref.name}</span>
                                                <span className={cn(
                                                  "text-[8px] uppercase px-1 border rounded font-black tracking-tighter",
                                                  ref.resolvedSymbolId 
                                                    ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" 
                                                    : "text-rose-400 bg-rose-500/10 border-rose-500/20"
                                                )}>
                                                  {ref.resolvedSymbolId ? "RESOLVED" : "UNRESOLVED"}
                                                </span>
                                              </div>
                                              <div className="text-[8px] text-slate-500 flex items-center justify-between">
                                                <span>Offset: {ref.start}-{ref.end}</span>
                                                <span>L: {getLineAndCol(debouncedTestInput, ref.start).line} C: {getLineAndCol(debouncedTestInput, ref.start).col}</span>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    ) : (
                      <ParserProfiler 
                        profileRoot={profileRoot} 
                        testInput={testInput} 
                        parseDuration={parseDuration} 
                        cacheStats={cacheStats} 
                      />
                    )
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-4 italic text-sm opacity-40 text-center px-8">
                      <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center border border-white/10 mb-2">
                        <Terminal className="w-8 h-8" />
                      </div>
                      <p>CST will appear here once the input matches your grammar rules perfectly.</p>
                    </div>
                  )}
                </div>
              </aside>
              ) : (
                <div className="w-[42px] border-l border-white/10 bg-[#121214]/60 backdrop-blur-lg flex flex-col items-center py-4 gap-6 shrink-0 relative z-30 select-none">
                  <button
                    onClick={() => setPlaygroundCstCollapsed(false)}
                    className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer shadow-lg animate-pulse"
                    title="Expand CST Panel"
                  >
                    <PanelRightOpen className="w-4 h-4 text-indigo-400" />
                  </button>
                  <div className="flex-1 flex items-center justify-center">
                    <span className="-rotate-90 text-[8.5px] font-black tracking-[0.25em] text-slate-500 uppercase whitespace-nowrap">
                      CST INSPECTOR
                    </span>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer Status */}
      <footer className="h-8 border-t border-white/5 bg-black/20 flex items-center justify-between px-4 text-[10px] font-medium text-slate-500 shrink-0 relative z-10 backdrop-blur-sm">
        <div className="flex gap-6 items-center">
          <span className="flex items-center gap-1.5 uppercase tracking-wider font-bold text-[9px]">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
            Engine: Live
          </span>
          <span className="opacity-60 flex items-center gap-1.5"><Database className="w-3 h-3" /> Memory: 14.2 MB</span>
          <span className="opacity-60 hidden sm:flex items-center gap-1.5"><Settings className="w-3 h-3" /> Backtracking: Off</span>
        </div>
        <div className="flex gap-6 items-center">
          <span className="text-indigo-400 font-bold uppercase tracking-widest text-[9px] flex items-center gap-2">
            <Zap className="w-3 h-3" /> Packrat Memoization Active
          </span>
          <span className="font-mono text-slate-600">v1.0.4-LATEST</span>
        </div>
      </footer>

      {/* Library Modal Overlay */}
      <AnimatePresence>
        {showLibrary && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6"
            onClick={() => setShowLibrary(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-2xl bg-slate-900 border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                 <div className="flex items-center gap-3">
                   <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                     <FolderOpen className="text-indigo-400 w-5 h-5" />
                   </div>
                   <div>
                     <h2 className="text-xl font-bold text-white tracking-tight leading-none mb-1">Project Library</h2>
                     <p className="text-xs text-slate-500 font-medium uppercase tracking-widest">Saved Grammar Engines</p>
                   </div>
                 </div>
                 <button 
                  onClick={() => setShowLibrary(false)}
                  className="w-8 h-8 rounded-full hover:bg-white/5 flex items-center justify-center text-slate-400 transition-colors"
                 >
                   <X className="w-5 h-5" />
                 </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-3">
                {savedProjects.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-slate-600 gap-4 opacity-50">
                    <Database className="w-12 h-12" />
                    <p className="text-sm font-medium">No projects saved yet.</p>
                  </div>
                ) : (
                  savedProjects.map((project) => (
                    <div 
                      key={project.id}
                      onClick={() => loadProject(project)}
                      className="group p-4 bg-white/5 border border-white/10 rounded-2xl hover:border-indigo-500/50 hover:bg-white/[0.08] transition-all cursor-pointer flex items-center justify-between shadow-sm"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:bg-indigo-500/20 group-hover:border-indigo-500/30 transition-all">
                           <FileCode className="w-6 h-6 text-slate-400 group-hover:text-indigo-400" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-200 mb-0.5 group-hover:text-white transition-colors">{project.name}</h3>
                          <div className="flex items-center gap-3 text-[10px] text-slate-500 font-medium uppercase tracking-widest">
                            <span className="flex items-center gap-1"><Terminal className="w-3 h-3" /> {project.grammar.length} chars</span>
                            <span className="flex items-center gap-1"><Settings className="w-3 h-3" /> {new Date(project.updatedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                      <button 
                        onClick={(e) => deleteProject(project.id, e)}
                        className="p-2 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="p-4 border-t border-white/5 bg-white/[0.01] flex justify-center">
                 <button 
                  onClick={newProject}
                  className="px-6 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl text-xs font-bold uppercase tracking-widest border border-white/10 transition-all flex items-center gap-2"
                 >
                   <Plus className="w-4 h-4" /> Start New Project
                 </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* C# Export Modal */}
      <AnimatePresence>
        {showCSharpModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-lg flex items-center justify-center p-6"
            onClick={() => setShowCSharpModal(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="w-full max-w-6xl bg-slate-900 border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col h-[85vh]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                    <Code2 className="text-indigo-400 w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white tracking-tight leading-none mb-1">C# Engine Export</h2>
                    <p className="text-xs text-slate-500 font-medium uppercase tracking-widest font-mono">Compiler Codegen & Export Options</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowCSharpModal(false)}
                  className="w-8 h-8 rounded-full hover:bg-white/5 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Main Split Layout */}
              <div className="flex-1 flex overflow-hidden">
                {/* Left Drawer: Configuration Panel */}
                <div className="w-80 border-r border-white/5 bg-black/10 overflow-y-auto p-6 space-y-6 shrink-0">
                  <div>
                    <label className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-2 font-mono">Namespace</label>
                    <input 
                      type="text" 
                      value={csNamespace}
                      onChange={(e) => setCsNamespace(e.target.value.replace(/[^a-zA-Z0-9_.]/g, ''))}
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-colors font-mono"
                      placeholder="SyntaxEngine"
                    />
                  </div>

                  <div>
                    <span className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-2 font-mono">Export Mode</span>
                    <div className="grid grid-cols-1 gap-2">
                      <button 
                        onClick={() => { setCsExportMode('bundle'); setCsSelectedFileIndex(0); }}
                        className={cn(
                          "p-3 rounded-xl border text-left transition-all cursor-pointer",
                          csExportMode === 'bundle' 
                            ? "bg-indigo-500/10 border-indigo-500 text-white font-bold ring-1 ring-indigo-500/30" 
                            : "bg-slate-950 border-white/5 text-slate-400 hover:border-white/10 hover:text-slate-200"
                        )}
                      >
                        <div className="text-xs mb-1">Single File Bundle</div>
                        <div className="text-[10px] text-slate-400 font-normal leading-relaxed">Everything consolidated in a single C# file. Ready for drag-and-drop.</div>
                      </button>

                      <button 
                        onClick={() => { setCsExportMode('modular'); setCsSelectedFileIndex(0); }}
                        className={cn(
                          "p-3 rounded-xl border text-left transition-all cursor-pointer",
                          csExportMode === 'modular' 
                            ? "bg-indigo-500/10 border-indigo-500 text-white font-bold ring-1 ring-indigo-500/30" 
                            : "bg-slate-950 border-white/5 text-slate-400 hover:border-white/10 hover:text-slate-200"
                        )}
                      >
                        <div className="text-xs mb-1">Modular Core & Engine</div>
                        <div className="text-[10px] text-slate-400 font-normal leading-relaxed">Splits code into Core structures and separate Parser + Nodes files. Ideal for multi-parser projects.</div>
                      </button>
                    </div>
                  </div>

                  {csExportMode === 'modular' && (
                    <div className="pt-2">
                      <span className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400 mb-2 font-mono">AST Nodes Style</span>
                      <div className="grid grid-cols-1 gap-2">
                        <button 
                          onClick={() => { setCsAstSeparate(false); setCsSelectedFileIndex(0); }}
                          className={cn(
                            "p-3 rounded-xl border text-left transition-all cursor-pointer",
                            !csAstSeparate 
                              ? "bg-indigo-500/10 border-indigo-500 text-white font-bold ring-1 ring-indigo-500/30" 
                              : "bg-slate-950 border-white/5 text-slate-400 hover:border-white/10 hover:text-slate-200"
                          )}
                        >
                          <div className="text-xs mb-1">Single AST File</div>
                          <div className="text-[10px] text-slate-400 font-normal leading-relaxed">Contains all strongly-typed AST node classes in SyntaxEngine.AstNodes.cs.</div>
                        </button>

                        <button 
                          onClick={() => { setCsAstSeparate(true); setCsSelectedFileIndex(0); }}
                          className={cn(
                            "p-3 rounded-xl border text-left transition-all cursor-pointer",
                            csAstSeparate 
                              ? "bg-indigo-500/10 border-indigo-500 text-white font-bold ring-1 ring-indigo-500/30" 
                              : "bg-slate-950 border-white/5 text-slate-400 hover:border-white/10 hover:text-slate-200"
                          )}
                        >
                          <div className="text-xs mb-1">Separate Node Files</div>
                          <div className="text-[10px] text-slate-400 font-normal leading-relaxed">Generates individual C# file for every AST element (e.g. ProgramNode.cs, StatementNode.cs) sequentially.</div>
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="pt-4 border-t border-white/5 space-y-3">
                    <span className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-400 font-mono">Engine Enhancements</span>
                    <div className="flex items-start gap-2.5 p-3 bg-slate-950/50 rounded-xl border border-white/5 text-[11px] text-slate-400 leading-relaxed font-sans">
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      <span><strong>Allman Braces</strong>: Every curly brace resides on a clean newline.</span>
                    </div>
                    <div className="flex items-start gap-2.5 p-3 bg-slate-950/50 rounded-xl border border-white/5 text-[11px] text-slate-400 leading-relaxed font-sans">
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      <span><strong>Typed Node Enum</strong>: Fast Enum matching avoids slow runtime string routing.</span>
                    </div>
                    <div className="flex items-start gap-2.5 p-3 bg-slate-950/50 rounded-xl border border-white/5 text-[11px] text-slate-400 leading-relaxed font-sans">
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      <span><strong>String-Free Cache Key</strong>: Hash struct cache lookup bypasses allocations completely!</span>
                    </div>
                  </div>
                </div>

                {/* Right Area: Code Tabs & Content Preview */}
                <div className="flex-1 flex flex-col overflow-hidden bg-slate-950/40">
                  {/* File Tabs Bar */}
                  <div className="flex items-center justify-between border-b border-white/5 px-6 py-2 shrink-0 bg-black/15">
                    <div className="flex items-center gap-2 overflow-x-auto max-w-[65%] pb-1 pt-1.5 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
                      {csGeneratedFiles.map((file, idx) => (
                        <button 
                          key={file.name}
                          onClick={() => setCsSelectedFileIndex(idx)}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-[11px] font-mono font-medium transition-all flex items-center gap-1.5 shrink-0 border cursor-pointer",
                            csSelectedFileIndex === idx 
                              ? "bg-white/10 border-white/10 text-white shadow-md font-bold" 
                              : "bg-transparent border-transparent text-slate-500 hover:text-slate-300"
                          )}
                        >
                          <FileCode className="w-3.5 h-3.5 text-slate-400" />
                          {file.name}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {csGeneratedFiles.length > 1 && (
                        <button 
                          onClick={downloadAllFiles}
                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 hover:shadow-lg hover:shadow-indigo-500/20 text-white text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                          <Rocket className="w-3.5 h-3.5" /> Download All
                        </button>
                      )}
                      <button 
                        onClick={() => {
                          const file = csGeneratedFiles[csSelectedFileIndex];
                          if (file) {
                            navigator.clipboard.writeText(file.content);
                            setCopiedFileIndex(csSelectedFileIndex);
                            setTimeout(() => setCopiedFileIndex(null), 1500);
                          }
                        }}
                        className="px-3 py-1.5 bg-white/5 border border-white/15 hover:bg-white/10 text-slate-200 hover:text-white text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        {copiedFileIndex === csSelectedFileIndex ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedFileIndex === csSelectedFileIndex ? 'Copied' : 'Copy'}
                      </button>
                      <button 
                        onClick={() => {
                          const file = csGeneratedFiles[csSelectedFileIndex];
                          if (file) downloadSingleFile(file.name, file.content);
                        }}
                        className="px-3 py-1.5 bg-white/5 border border-white/15 hover:bg-white/10 text-slate-200 hover:text-white text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <FileCode className="w-3.5 h-3.5 text-indigo-400" /> Download
                      </button>
                    </div>
                  </div>

                  {/* Code Viewer Viewport */}
                  <div className="flex-1 overflow-auto p-6 font-mono text-[11px] text-slate-300 select-text leading-relaxed bg-slate-950/80 custom-scrollbar">
                    {csGeneratedFiles[csSelectedFileIndex] ? (
                      <pre className="whitespace-pre overflow-auto font-mono text-[11px] select-all">
                        <code>{csGeneratedFiles[csSelectedFileIndex].content}</code>
                      </pre>
                    ) : (
                      <div className="flex items-center justify-center h-full text-slate-600">No content available</div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
