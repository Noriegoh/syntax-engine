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
  ExternalLink,
  Sparkles,
  MousePointer,
  Download,
  Upload
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactJson from 'react-json-view';
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/themes/prism-tomorrow.css';
import { SyntaxElement, Sort, ParseResult, IncrementalParser, CSTQuery, QueryMatch, ScopeBuilder, LexicalScope, SymbolDefinition, SymbolReference, generateFullCSharp, generateModularCSharp, generateFullTypeScript, wrapASTTransformerWithIncrementalCache, findDiff, Token, DefaultLeadingTrivia, DefaultTrailingTrivia, BeginScope, EndScope } from './lib/engine';
import { cn } from './lib/utils';
import { runGrammarDiagnostics, Diagnostic } from './lib/diagnostics';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ParserProfiler } from './components/ParserProfiler';
import { ProjectLibraryModal } from './components/ProjectLibraryModal';
import { CSharpExportModal } from './components/CSharpExportModal';
import { TypeScriptExportModal } from './components/TypeScriptExportModal';
import { GrammarCodeMirror } from './components/GrammarCodeMirror';
import { TestCodeMirror } from './components/TestCodeMirror';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';

const queryEditorTheme = EditorView.theme({
  "&": {
    color: "#cbd5e1",
    backgroundColor: "transparent",
    outline: "none",
  },
  ".cm-content": {
    caretColor: "#6366f1",
    fontFamily: '"Fira Code", monospace',
    fontSize: "12px",
    padding: "10px 14px",
  },
  "&.cm-focused": {
    outline: "none",
  },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "#6366f1"
  },
  ".cm-gutters": {
    display: "none"
  }
});
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
}

const DEFAULT_CODE = `/* 
Unity ShaderLab Shader Parser Grammar
💡 GREEDY CHOICE: ExpectsOneOf picks the first match. 
💡 AUTOMATED RECOVERY: The parser automatically derives recovery boundaries from ending literals 
   and dynamically heals malformed blocks using active EndScope boundaries!
*/

const ws = new SyntaxElement('ws').ExpectsWhitespace();
const comment = /\\/\\/.*|\\/\\*[\\s\\S]*?\\*\\//;
const lineWs = /[ \\t]+/;

const leadingTrivia = new SyntaxElement('leading_trivia').ZeroOrMore(new SyntaxElement('n').ExpectsOneOf(ws, comment));
const trailingTrivia = new SyntaxElement('trailing_trivia')
  .ZeroOrMore(new SyntaxElement('t_elem').ExpectsOneOf(lineWs, comment))
  .Optional(/\\r?\\n/);

DefaultLeadingTrivia(leadingTrivia);
DefaultTrailingTrivia(trailingTrivia);

// --- Section 10: Primitives ---
const id = Token(/[a-zA-Z_][a-zA-Z0-9_]*/, "id");
const number = Token(/-?(?:[0-9]*\\.[0-9]+(?:[eE][+-]?[0-9]+)?|[0-9]+(?:[eE][+-]?[0-9]+)?|[0-9]+)/, "number");
const integerLiteral = Token(/-?[0-9]+/, "integerLiteral");

const string = Token(new SyntaxElement("string")
  .BeginScope('"')
  .Expects(/([^"\\\\]|\\\\.)*/)
  .EndScope('"'), "string");

const vectorLiteral = new SyntaxElement("vector_literal")
  .AsNode("VectorLiteral")
  .Token("(")
  .Expects(number).As("x")
  .Token(",")
  .Expects(number).As("y")
  .Token(",")
  .Expects(number).As("z")
  .Token(",")
  .Expects(number).As("w")
  .Token(")");

// --- Property Reference ---
const propRef = new SyntaxElement("prop_ref")
  .AsNode("PropertyReference")
  .Token(BeginScope("["))
  .Expects(id).As("name")
  .Token(EndScope("]"));

// --- Section 6: Render State Commands ---

// 6.1 Blend
const blendFactor = new SyntaxElement("blend_factor")
  .AsNode("BlendFactor")
  .ExpectsOneOf(
    propRef,
    Token(/OneMinusSrcColor/i),
    Token(/OneMinusSrcAlpha/i),
    Token(/OneMinusDstColor/i),
    Token(/OneMinusDstAlpha/i),
    Token(/SrcAlphaSaturate/i),
    Token(/SrcColor/i),
    Token(/SrcAlpha/i),
    Token(/DstColor/i),
    Token(/DstAlpha/i),
    Token(/One/i),
    Token(/Zero/i)
  );

const renderTargetIndex = integerLiteral;

const blendCommand = new SyntaxElement("blend_command")
  .AsNode("BlendCommand")
  .Token(/Blend/i)
  .ExpectsOneOf(
    Token(/Off/i),
    new SyntaxElement("blend_args")
      .Inline()
      .Optional(renderTargetIndex).As("rtIndex")
      .Expects(blendFactor).As("src")
      .Expects(blendFactor).As("dst")
      .Optional(
        new SyntaxElement("blend_alpha")
          .Inline()
          .Token(",")
          .Expects(blendFactor).As("srcAlpha")
          .Expects(blendFactor).As("dstAlpha")
      )
  );

// 6.2 BlendOp
const blendOperation = new SyntaxElement("blend_operation")
  .AsNode("BlendOperation")
  .ExpectsOneOf(
    Token(/LogicalAndReverse/i),
    Token(/LogicalAndInverted/i),
    Token(/LogicalOrReverse/i),
    Token(/LogicalOrInverted/i),
    Token(/LogicalCopyInverted/i),
    Token(/LogicalClear/i),
    Token(/LogicalSet/i),
    Token(/LogicalCopy/i),
    Token(/LogicalNoop/i),
    Token(/LogicalInvert/i),
    Token(/LogicalAnd/i),
    Token(/LogicalNand/i),
    Token(/LogicalOr/i),
    Token(/LogicalNor/i),
    Token(/LogicalXor/i),
    Token(/LogicalEquiv/i),
    Token(/Multiply/i),
    Token(/Screen/i),
    Token(/Overlay/i),
    Token(/Darken/i),
    Token(/Lighten/i),
    Token(/ColorDodge/i),
    Token(/ColorBurn/i),
    Token(/HardLight/i),
    Token(/SoftLight/i),
    Token(/Difference/i),
    Token(/Exclusion/i),
    Token(/HSLHue/i),
    Token(/HSLSaturation/i),
    Token(/HSLColor/i),
    Token(/HSLLuminosity/i),
    Token(/RevSub/i),
    Token(/Add/i),
    Token(/Sub/i),
    Token(/Min/i),
    Token(/Max/i)
  );

const blendOpCommand = new SyntaxElement("blend_op_command")
  .AsNode("BlendOpCommand")
  .Token(/BlendOp/i)
  .Optional(renderTargetIndex).As("rtIndex")
  .Expects(blendOperation).As("op")
  .Optional(
    new SyntaxElement("blend_op_alpha")
      .Inline()
      .Token(",")
      .Expects(blendOperation).As("opAlpha")
  );

// 6.3 ZWrite
const onOffValue = new SyntaxElement("on_off_value")
  .AsNode("OnOffValue")
  .ExpectsOneOf(
    propRef,
    Token(/On/i),
    Token(/Off/i)
  );

const zWriteCommand = new SyntaxElement("zwrite_command")
  .AsNode("ZWriteCommand")
  .Token(/ZWrite/i)
  .Expects(onOffValue).As("value");

// 6.4 ZTest
const compareFunction = new SyntaxElement("compare_function")
  .AsNode("CompareFunction")
  .ExpectsOneOf(
    propRef,
    Token(/LEqual/i),
    Token(/GEqual/i),
    Token(/Less/i),
    Token(/Greater/i),
    Token(/Equal/i),
    Token(/NotEqual/i),
    Token(/Always/i),
    Token(/Never/i),
    Token(/Off/i)
  );

const zTestCommand = new SyntaxElement("ztest_command")
  .AsNode("ZTestCommand")
  .Token(/ZTest/i)
  .Expects(compareFunction).As("func");

// 6.5 ZClip
const zClipCommand = new SyntaxElement("zclip_command")
  .AsNode("ZClipCommand")
  .Token(/ZClip/i)
  .Expects(onOffValue).As("value");

// 6.6 Cull
const cullMode = new SyntaxElement("cull_mode")
  .AsNode("CullMode")
  .ExpectsOneOf(
    propRef,
    Token(/Back/i),
    Token(/Front/i),
    Token(/Off/i)
  );

const cullCommand = new SyntaxElement("cull_command")
  .AsNode("CullCommand")
  .Token(/Cull/i)
  .Expects(cullMode).As("mode");

// 6.7 Offset
const offsetValue = new SyntaxElement("offset_value")
  .AsNode("OffsetValue")
  .ExpectsOneOf(
    propRef,
    number
  );

const offsetCommand = new SyntaxElement("offset_command")
  .AsNode("OffsetCommand")
  .Token(/Offset/i)
  .Expects(offsetValue).As("factor")
  .Token(",")
  .Expects(offsetValue).As("units");

// 6.8 ColorMask
const colorMaskChannels = Token(/[RGBA]+/i, "channels");

const colorMaskValue = new SyntaxElement("color_mask_value")
  .AsNode("ColorMaskValue")
  .ExpectsOneOf(
    propRef,
    integerLiteral,
    colorMaskChannels
  );

const colorMaskCommand = new SyntaxElement("color_mask_command")
  .AsNode("ColorMaskCommand")
  .Token(/ColorMask/i)
  .Expects(colorMaskValue).As("mask")
  .Optional(renderTargetIndex).As("rtIndex");

// 6.9 AlphaToMask
const alphaToMaskCommand = new SyntaxElement("alpha_to_mask_command")
  .AsNode("AlphaToMaskCommand")
  .Token(/AlphaToMask/i)
  .Expects(onOffValue).As("value");

// 6.10 Stencil Block
const stencilValue = new SyntaxElement("stencil_value")
  .AsNode("StencilValue")
  .ExpectsOneOf(
    propRef,
    integerLiteral
  );

const stencilOpValue = new SyntaxElement("stencil_op_value")
  .AsNode("StencilOpValue")
  .ExpectsOneOf(
    propRef,
    Token(/Keep/i),
    Token(/Zero/i),
    Token(/Replace/i),
    Token(/IncrSat/i),
    Token(/DecrSat/i),
    Token(/Invert/i),
    Token(/IncrWrap/i),
    Token(/DecrWrap/i)
  );

const stencilRef = new SyntaxElement("stencil_ref").AsNode("StencilRef").Token(/Ref/i).Expects(stencilValue).As("val");
const stencilReadMask = new SyntaxElement("stencil_read_mask").AsNode("StencilReadMask").Token(/ReadMask/i).Expects(stencilValue).As("val");
const stencilWriteMask = new SyntaxElement("stencil_write_mask").AsNode("StencilWriteMask").Token(/WriteMask/i).Expects(stencilValue).As("val");

const stencilComp = new SyntaxElement("stencil_comp").AsNode("StencilComp").Token(/Comp/i).Expects(compareFunction).As("func");
const stencilPass = new SyntaxElement("stencil_pass").AsNode("StencilPass").Token(/Pass/i).Expects(stencilOpValue).As("op");
const stencilFail = new SyntaxElement("stencil_fail").AsNode("StencilFail").Token(/Fail/i).Expects(stencilOpValue).As("op");
const stencilZFail = new SyntaxElement("stencil_zfail").AsNode("StencilZFail").Token(/ZFail/i).Expects(stencilOpValue).As("op");

const stencilCompBack = new SyntaxElement("stencil_comp_back").AsNode("StencilCompBack").Token(/CompBack/i).Expects(compareFunction).As("func");
const stencilPassBack = new SyntaxElement("stencil_pass_back").AsNode("StencilPassBack").Token(/PassBack/i).Expects(stencilOpValue).As("op");
const stencilFailBack = new SyntaxElement("stencil_fail_back").AsNode("StencilFailBack").Token(/FailBack/i).Expects(stencilOpValue).As("op");
const stencilZFailBack = new SyntaxElement("stencil_zfail_back").AsNode("StencilZFailBack").Token(/ZFailBack/i).Expects(stencilOpValue).As("op");

const stencilCompFront = new SyntaxElement("stencil_comp_front").AsNode("StencilCompFront").Token(/CompFront/i).Expects(compareFunction).As("func");
const stencilPassFront = new SyntaxElement("stencil_pass_front").AsNode("StencilPassFront").Token(/PassFront/i).Expects(stencilOpValue).As("op");
const stencilFailFront = new SyntaxElement("stencil_fail_front").AsNode("StencilFailFront").Token(/FailFront/i).Expects(stencilOpValue).As("op");
const stencilZFailFront = new SyntaxElement("stencil_zfail_front").AsNode("StencilZFailFront").Token(/ZFailFront/i).Expects(stencilOpValue).As("op");

const stencilState = new SyntaxElement("stencil_state")
  .ExpectsOneOf(
    stencilCompBack, stencilPassBack, stencilFailBack, stencilZFailBack,
    stencilCompFront, stencilPassFront, stencilFailFront, stencilZFailFront,
    stencilRef, stencilReadMask, stencilWriteMask,
    stencilComp, stencilPass, stencilFail, stencilZFail
  );

const stencilBlock = new SyntaxElement("stencil_block")
  .AsNode("StencilBlock")
  .Token(/Stencil/i)
  .Token(BeginScope("{"))
  .ZeroOrMore(stencilState).As("states")
  .Token(EndScope("}"));

// 6.11 ColorMaterial (legacy)
const colorMaterialCommand = new SyntaxElement("color_material_command")
  .AsNode("ColorMaterialCommand")
  .Token(/ColorMaterial/i)
  .ExpectsOneOf(
    Token(/AmbientAndDiffuse/i),
    Token(/Emission/i)
  ).As("value");

// 6.12 Lighting (legacy)
const lightingCommand = new SyntaxElement("lighting_command")
  .AsNode("LightingCommand")
  .Token(/Lighting/i)
  .Expects(onOffValue).As("value");

// 6.13 Conservative Rasterization
const conservativeCommand = new SyntaxElement("conservative_command")
  .AsNode("ConservativeCommand")
  .Token(/Conservative/i)
  .Expects(onOffValue).As("value");

// 6.14 AlphaTest (legacy)
const alphaTestValue = new SyntaxElement("alpha_test_value")
  .AsNode("AlphaTestValue")
  .ExpectsOneOf(
    propRef,
    number
  );

const alphaTestMode = new SyntaxElement("alpha_test_mode")
  .AsNode("AlphaTestMode")
  .Expects(compareFunction).As("func")
  .Expects(alphaTestValue).As("val");

const alphaTestCommand = new SyntaxElement("alpha_test_command")
  .AsNode("AlphaTestCommand")
  .Token(/AlphaTest/i)
  .ExpectsOneOf(
    Token(/Off/i),
    alphaTestMode
  ).As("mode");

// 6.15 Fog Block (legacy)
const fogMode = new SyntaxElement("fog_mode")
  .AsNode("FogMode")
  .ExpectsOneOf(
    Token(/Off/i),
    Token(/Global/i),
    Token(/Linear/i),
    Token(/Exp2/i),
    Token(/Exp/i)
  );

const fogStateRange = new SyntaxElement("fog_state_range")
  .Inline()
  .Token(/Range/i)
  .Expects(number).As("min")
  .Token(",")
  .Expects(number).As("max");

const fogState = new SyntaxElement("fog_state")
  .AsNode("FogState")
  .ExpectsOneOf(
    new SyntaxElement("fog_state_mode").Inline().Token(/Mode/i).Expects(fogMode).As("mode"),
    new SyntaxElement("fog_state_color").Inline().Token(/Color/i).Expects(vectorLiteral).As("color"),
    new SyntaxElement("fog_state_density").Inline().Token(/Density/i).Expects(number).As("density"),
    fogStateRange
  );

const fogBlock = new SyntaxElement("fog_block")
  .AsNode("FogBlock")
  .Token(/Fog/i)
  .Token(BeginScope("{"))
  .ZeroOrMore(fogState).As("states")
  .Token(EndScope("}"));

// 6.16 SeparateSpecular (legacy)
const separateSpecularCommand = new SyntaxElement("separate_specular_command")
  .AsNode("SeparateSpecularCommand")
  .Token(/SeparateSpecular/i)
  .Expects(onOffValue).As("value");

// Render State Groupings
const renderState = new SyntaxElement("render_state")
  .ExpectsOneOf(
    blendCommand,
    blendOpCommand,
    zWriteCommand,
    zTestCommand,
    zClipCommand,
    cullCommand,
    offsetCommand,
    colorMaskCommand,
    alphaToMaskCommand,
    stencilBlock,
    colorMaterialCommand,
    lightingCommand,
    conservativeCommand,
    alphaTestCommand,
    fogBlock,
    separateSpecularCommand
  );

// --- Section 4: LOD ---
const lodDecl = new SyntaxElement("lod_decl")
  .AsNode("LODDecl")
  .Token(/LOD/i)
  .Expects(integerLiteral).As("value");

// --- Section 3: Tags Block ---
const tagEntry = new SyntaxElement("tag_entry")
  .AsNode("TagEntry")
  .Expects(string).As("key")
  .Token("=")
  .Expects(string).As("value");

const tagsBlock = new SyntaxElement("tags_block")
  .AsNode("TagsBlock")
  .Token(/Tags/i)
  .Token(BeginScope("{"))
  .ZeroOrMore(tagEntry).As("entries")
  .Token(EndScope("}"));

// --- Section 7: Shader Program Blocks (Opaque) ---
const cgProgram = Token(/CGPROGRAM[\\s\\S]*?ENDCG/, "programBlock");
const hlslProgram = Token(/HLSLPROGRAM[\\s\\S]*?ENDHLSL/, "programBlock");
const glslProgram = Token(/GLSLPROGRAM[\\s\\S]*?ENDGLSL/, "programBlock");

const cgInclude = Token(/CGINCLUDE[\\s\\S]*?ENDCG/, "programBlock");
const hlslInclude = Token(/HLSLINCLUDE[\\s\\S]*?ENDHLSL/, "programBlock");
const glslInclude = Token(/GLSLINCLUDE[\\s\\S]*?ENDGLSL/, "programBlock");

const programBlock = new SyntaxElement("program_block")
  .AsNode("ProgramBlock")
  .ExpectsOneOf(
    cgProgram,
    hlslProgram,
    glslProgram,
    cgInclude,
    hlslInclude,
    glslInclude
  );

const includeBlock = new SyntaxElement("include_block")
  .AsNode("IncludeBlock")
  .ExpectsOneOf(
    cgInclude,
    hlslInclude,
    glslInclude
  );

// --- Section 5: Pass Types ---
const nameDecl = new SyntaxElement("name_decl")
  .AsNode("NameDecl")
  .Token(/Name/i)
  .Expects(string).As("value");

const passState = new SyntaxElement("pass_state")
  .ExpectsOneOf(
    tagsBlock,
    nameDecl,
    lodDecl,
    renderState,
    includeBlock,
    programBlock
  );

const passBody = new SyntaxElement("pass_body")
  .Inline()
  .ZeroOrMore(passState).As("contents");

const pass = new SyntaxElement("pass")
  .AsNode("Pass")
  .Token(/Pass/i)
  .Token(BeginScope("{"))
  .Expects(passBody)
  .Token(EndScope("}"));

const grabPass = new SyntaxElement("grab_pass")
  .AsNode("GrabPass")
  .Token(/GrabPass/i)
  .Token(BeginScope("{"))
  .Optional(string).As("textureName")
  .Token(EndScope("}"));

const usePass = new SyntaxElement("use_pass")
  .AsNode("UsePass")
  .Token(/UsePass/i)
  .Expects(string).As("passName");

// --- Section 2: SubShader ---
const subShaderState = new SyntaxElement("subshader_state")
  .ExpectsOneOf(
    pass,
    grabPass,
    usePass,
    tagsBlock,
    lodDecl,
    renderState,
    includeBlock,
    programBlock
  );

const subShaderBody = new SyntaxElement("subshader_body")
  .Inline()
  .ZeroOrMore(subShaderState).As("contents");

const subShader = new SyntaxElement("subshader")
  .AsNode("SubShader")
  .Token(/SubShader/i)
  .Token(BeginScope("{"))
  .Expects(subShaderBody)
  .Token(EndScope("}"));

// --- Section 1: Properties Block ---
const propertyName = id;

const attributeArg = new SyntaxElement("attribute_arg")
  .AsNode("AttributeArg")
  .ExpectsOneOf(
    string,
    number,
    id
  );

const attributeContent = new SyntaxElement("attribute_content")
  .AsNode("AttributeContent")
  .Expects(id).As("name")
  .Optional(
    new SyntaxElement("attribute_args_block")
      .Inline()
      .Token("(")
      .Expects(attributeArg).As("firstArg")
      .ZeroOrMore(new SyntaxElement("attribute_arg_comma").Token(",").Expects(attributeArg)).As("moreArgs")
      .Token(")")
  );

const attribute = new SyntaxElement("attribute")
  .AsNode("Attribute")
  .Token("[")
  .Expects(attributeContent)
  .Token("]");

const rangeType = new SyntaxElement("range_type")
  .AsNode("RangeType")
  .Token(/Range/i)
  .Token("(")
  .Expects(number).As("min")
  .Token(",")
  .Expects(number).As("max")
  .Token(")");

const propertyType = new SyntaxElement("property_type")
  .AsNode("PropertyType")
  .ExpectsOneOf(
    rangeType,
    Token(/CubeArray/i),
    Token(/2DArray/i),
    Token(/Color/i),
    Token(/3D/i),
    Token(/2D/i),
    Token(/Cube/i),
    Token(/Integer/i),
    Token(/Int/i),
    Token(/Float/i),
    Token(/Vector/i),
    Token(/Any/i)
  );

const textureOptions = new SyntaxElement("texture_options")
  .Inline()
  .ZeroOrMore(id);

const textureDefault = new SyntaxElement("texture_default")
  .AsNode("TextureDefault")
  .Expects(string).As("texName")
  .Token(BeginScope("{"))
  .Expects(textureOptions).As("options")
  .Token(EndScope("}"));

const propertyDefault = new SyntaxElement("property_default")
  .AsNode("PropertyDefault")
  .ExpectsOneOf(
    vectorLiteral,
    textureDefault,
    number
  );

const property = new SyntaxElement("property")
  .AsNode("Property")
  .ZeroOrMore(attribute).As("attributes")
  .Expects(propertyName).As("name")
  .Token("(")
  .Expects(string).As("displayName")
  .Token(",")
  .Expects(propertyType).As("type")
  .Token(")")
  .Token("=")
  .Expects(propertyDefault).As("defaultValue");

const propertiesBlock = new SyntaxElement("properties_block")
  .AsNode("PropertiesBlock")
  .Token(/Properties/i)
  .Token(BeginScope("{"))
  .ZeroOrMore(property).As("properties")
  .Token(EndScope("}"));

// --- Section 9: Category Block (legacy) ---
const categoryState = new SyntaxElement("category_state")
  .ExpectsOneOf(
    subShader,
    tagsBlock,
    lodDecl,
    renderState,
    includeBlock,
    programBlock
  );

const categoryBody = new SyntaxElement("category_body")
  .Inline()
  .ZeroOrMore(categoryState).As("contents");

const categoryBlock = new SyntaxElement("category_block")
  .AsNode("CategoryBlock")
  .Token(/Category/i)
  .Token(BeginScope("{"))
  .Expects(categoryBody)
  .Token(EndScope("}"));

// --- Top-Level Structure ---
const fallbackDecl = new SyntaxElement("fallback_decl")
  .AsNode("FallbackDecl")
  .Token(/Fallback/i)
  .ExpectsOneOf(string, Token(/Off/i)).As("value");

const customEditorDecl = new SyntaxElement("custom_editor_decl")
  .AsNode("CustomEditorDecl")
  .Token(/CustomEditor/i)
  .Expects(string).As("value");

const shaderBodyElement = new SyntaxElement("shader_element")
  .ExpectsOneOf(
    propertiesBlock,
    subShader,
    categoryBlock,
    fallbackDecl,
    customEditorDecl
  );

const shaderBody = new SyntaxElement("shader_body")
  .Inline()
  .ZeroOrMore(shaderBodyElement).As("contents");

const root = new SyntaxElement("_root")
  .Token(/Shader/i)
  .Expects(string).As("shaderName")
  .Token(BeginScope("{"))
  .Expects(shaderBody)
  .Token(EndScope("}"));`;

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

  // Copy fields if present to allow queries with labels to work on AST
  if (node._fields) {
    cleanNode._fields = {};
    for (const key in node._fields) {
      const val = node._fields[key];
      const transformedVal = transform(val);
      cleanNode._fields[key] = transformedVal;
      cleanNode[key] = transformedVal;
    }
  }

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

  // If the node ended up with no children, no data, no value, and no fields, prune it
  // unless it has a specific type we want to retain (like identifier/id/literals)
  const hasFields = cleanNode._fields && Object.keys(cleanNode._fields).length > 0;
  if (
    cleanNode.children === undefined && 
    cleanNode.data === undefined && 
    cleanNode.value === undefined &&
    !hasFields
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

interface SuggestionItem {
  label: string; 
  insertText: string; 
  type: 'method' | 'class' | 'variable' | 'keyword';
  description: string;
}

const GRAMMAR_SUGGESTIONS: SuggestionItem[] = [
  { label: 'Expects', insertText: 'Expects(', type: 'method', description: 'Schedule standard terminal literal / sub-element rule' },
  { label: 'ExpectsOneOf', insertText: 'ExpectsOneOf(', type: 'method', description: 'Schedule a speculative choice selection (any matched pattern)' },
  { label: 'Token', insertText: 'Token(', type: 'method', description: 'Inject clean terminal lexical Token marker (wraps literals/regexes)' },
  { label: 'Optional', insertText: 'Optional(', type: 'method', description: 'Mark element rule as fully optional' },
  { label: 'ZeroOrMore', insertText: 'ZeroOrMore(', type: 'method', description: 'Repetition: loop consecutive matches. Overloaded to support choices if passed array/multiple parameters' },
  { label: 'OneOrMore', insertText: 'OneOrMore(', type: 'method', description: 'Repetition: loop consecutive matches requires at least 1 match. Overloaded to support choices if passed array/multiple parameters' },
  { label: 'LeadingTrivia', insertText: 'LeadingTrivia(', type: 'method', description: 'Define expected default preceding layout whitespaces or comments' },
  { label: 'TrailingTrivia', insertText: 'TrailingTrivia(', type: 'method', description: 'Define expected default trailing layout whitespaces or comments' },
  { label: 'Whitespace', insertText: 'Whitespace()', type: 'method', description: 'Consume contiguous space layouts' },
  { label: 'EnumTarget', insertText: 'EnumTarget()', type: 'method', description: 'Flag elements for C# enum compilation structures' },
  { label: 'BeginScope', insertText: 'BeginScope(', type: 'method', description: 'Signal local lexical namespace creation (e.g., matching brace "{" )' },
  { label: 'EndScope', insertText: 'EndScope(', type: 'method', description: 'Signal local lexical namespace termination (e.g., matching brace "}" )' },
  { label: 'ExpectsEOF', insertText: 'ExpectsEOF()', type: 'method', description: 'Enforce complete final end-of-file condition' },
  { label: 'AsASTNode', insertText: 'AsASTNode(', type: 'method', description: 'Re-bind generated visual abstract type identifier' },
  { label: 'As', insertText: 'As(', type: 'method', description: 'Assign field property name/label to the matched result' },
  { label: 'AsNode', insertText: 'AsNode(', type: 'method', description: 'Instruct engine to construct visual AST Node representation instead of direct CST structure' },
  { label: 'AsToken', insertText: 'AsToken(', type: 'method', description: 'Assign a custom token name to the matched terminal pattern without injecting trivias' },
  { label: 'Ignore', insertText: 'Ignore()', type: 'method', description: 'Exclude matched terminal/token value output representation' },
  { label: 'Inline', insertText: 'Inline()', type: 'method', description: 'Instruct engine to flatten and merge current SyntaxElement rule inside parent nodes' },
  { label: 'IgnoreSelf', insertText: 'IgnoreSelf()', type: 'method', description: 'Skip this entire subtree node construction while still executing parsing checks' },
  { label: 'RecoverWith', insertText: 'RecoverWith(', type: 'method', description: 'Register explicit manual recovery delimiters for automated parser healing' },
  { label: 'SelfHeals', insertText: 'SelfHeals(', type: 'method', description: 'Designate current rules blocks automated healing boundaries' },
  { label: 'MapToEnum', insertText: 'MapToEnum(', type: 'method', description: 'Map matched string tokens to target C# compilation enumerations' },
  { label: 'SeparatedBy', insertText: 'SeparatedBy(', type: 'method', description: 'Sequence matcher for elements separated by distinct separator literal/token' },
  { label: 'Assert', insertText: 'Assert(', type: 'method', description: 'Lookahead assertion checker: verify ahead without consuming incoming layout streams' },
  { label: 'SyntaxElement', insertText: 'SyntaxElement', type: 'class', description: 'Compiler blueprint construct initializer' },
  { label: 'Sort', insertText: 'Sort(', type: 'keyword', description: 'Sort array inputs descending by pattern length' },
  { label: 'DefaultLeadingTrivia', insertText: 'DefaultLeadingTrivia', type: 'variable', description: 'Pre-registered standard spacer elements container' },
  { label: 'DefaultTrailingTrivia', insertText: 'DefaultTrailingTrivia', type: 'variable', description: 'Pre-registered standard spacer elements container' },
];

const getCaretCoordinatesRelative = (element: HTMLTextAreaElement, position: number) => {
  const div = document.createElement('div');
  const style = window.getComputedStyle(element);
  
  const properties = [
    'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderStyle', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontStyle', 'fontVariant', 'fontVariantNumeric', 'fontVariantCaps',
    'fontVariantEastAsian', 'fontVariantLigatures', 'fontWeight', 'fontStretch',
    'fontSize', 'fontSizeAdjust', 'lineHeight', 'fontFamily', 'textAlign',
    'textTransform', 'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing',
    'tabSize', 'MozTabSize'
  ];
  
  properties.forEach(prop => {
    if (prop in style) {
      (div.style as any)[prop] = (style as any)[prop];
    }
  });

  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordBreak = 'break-word';
  
  document.body.appendChild(div);
  
  const text = element.value;
  div.textContent = text.substring(0, position);
  
  const span = document.createElement('span');
  span.textContent = text.substring(position) || '.';
  div.appendChild(span);
  
  const spanLeft = span.offsetLeft;
  const spanTop = span.offsetTop;
  
  document.body.removeChild(div);
  
  const textareaRect = element.getBoundingClientRect();
  const parentElement = element.offsetParent || element.parentElement;
  let topOffset = 0;
  let leftOffset = 0;
  
  if (parentElement) {
    const parentRect = parentElement.getBoundingClientRect();
    topOffset = textareaRect.top - parentRect.top;
    leftOffset = textareaRect.left - parentRect.left;
  }
  
  return {
    top: topOffset + spanTop - element.scrollTop,
    left: leftOffset + spanLeft - element.scrollLeft,
    lineHeight: parseInt(style.lineHeight) || 16
  };
};

interface MemoizedEditorProps {
  value: string;
  onValueChange: (value: string) => void;
  highlight: (value: string) => string;
  className?: string;
  style?: React.CSSProperties;
  highlightDeps: any[];
  [key: string]: any;
}

const MemoizedEditor = React.memo<MemoizedEditorProps>(
  ({ value, highlight, onValueChange, className, style, highlightDeps, ...rest }) => {
    return (
      <Editor
        value={value}
        onValueChange={onValueChange}
        highlight={highlight}
        className={className}
        style={style}
        {...rest}
      />
    );
  },
  (prev, next) => {
    if (prev.value !== next.value) return false;
    if (prev.className !== next.className) return false;
    if (prev.highlightDeps && next.highlightDeps) {
      if (prev.highlightDeps.length !== next.highlightDeps.length) return false;
      for (let i = 0; i < prev.highlightDeps.length; i++) {
        if (prev.highlightDeps[i] !== next.highlightDeps[i]) return false;
      }
      return true;
    }
    return false;
  }
);

export default function App() {
  const [grammarCode, setGrammarCode] = useState(DEFAULT_CODE);
  const [autocomplete, setAutocomplete] = useState<{
    show: boolean;
    suggestions: SuggestionItem[];
    activeIndex: number;
    word: string;
    cursorOffset: number;
    lineIndex: number;
    lineText: string;
    top: number;
    left: number;
    lineHeight: number;
  } | null>(null);

  const getCustomVars = (code: string): SuggestionItem[] => {
    try {
      const matchVars = [...code.matchAll(/(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=/g)];
      return Array.from(new Set(matchVars.map(m => m[1]))).map(v => ({
        label: v,
        insertText: v,
        type: 'variable' as const,
        description: 'User-defined SyntaxElement in grammar code'
      }));
    } catch (e) {
      return [];
    }
  };

  const handleAutocompleteCheck = (textarea: HTMLTextAreaElement) => {
    const value = textarea.value;
    const offset = textarea.selectionStart;
    
    const textBefore = value.slice(0, offset);
    const lines = textBefore.split('\n');
    const lineIndex = lines.length - 1;
    const currentLineText = lines[lineIndex] || '';
    
    // Check if the cursor is directly after a dot, or a dot followed by some word characters
    const wordWithDotMatch = textBefore.match(/\.([a-zA-Z0-9_$]*)$/);
    const wordMatch = textBefore.match(/([a-zA-Z0-9_$]*)$/);
    
    let word = '';
    let isMethodOnly = false;
    
    if (wordWithDotMatch) {
      word = wordWithDotMatch[1];
      isMethodOnly = true;
    } else if (wordMatch) {
      word = wordMatch[1];
    }
    
    if (wordWithDotMatch || (word && word.length > 0)) {
      let suggestionsSource = [...GRAMMAR_SUGGESTIONS, ...getCustomVars(value)];
      if (isMethodOnly) {
        suggestionsSource = GRAMMAR_SUGGESTIONS.filter(s => s.type === 'method');
      }
      
      const matched = suggestionsSource.filter(s => {
        const labelLower = s.label.toLowerCase();
        const wordLower = word.toLowerCase();
        return labelLower.startsWith(wordLower) && labelLower !== wordLower;
      });
      
      if (matched.length > 0) {
        const coords = getCaretCoordinatesRelative(textarea, offset);
        setAutocomplete({
          show: true,
          suggestions: matched,
          activeIndex: 0,
          word,
          cursorOffset: offset,
          lineIndex,
          lineText: currentLineText,
          top: coords.top,
          left: coords.left,
          lineHeight: coords.lineHeight
        });
        return;
      }
    }
    setAutocomplete(null);
  };

  const insertSuggestion = (item: SuggestionItem) => {
    const textarea = document.querySelector('.grammar-editor-container textarea') as HTMLTextAreaElement;
    if (!textarea || !autocomplete) return;
    
    const value = textarea.value;
    const offset = autocomplete.cursorOffset;
    const wordLen = autocomplete.word.length;
    
    const before = value.slice(0, offset - wordLen);
    const after = value.slice(offset);
    const insertText = item.insertText;
    
    const newValue = before + insertText + after;
    setGrammarCode(newValue);
    setAutocomplete(null);
    
    setTimeout(() => {
      textarea.focus();
      const newCursor = offset - wordLen + insertText.length;
      textarea.setSelectionRange(newCursor, newCursor);
    }, 10);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (autocomplete && autocomplete.show) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAutocomplete(prev => prev ? { ...prev, activeIndex: (prev.activeIndex + 1) % prev.suggestions.length } : null);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAutocomplete(prev => prev ? { ...prev, activeIndex: (prev.activeIndex - 1 + prev.suggestions.length) % prev.suggestions.length } : null);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertSuggestion(autocomplete.suggestions[autocomplete.activeIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setAutocomplete(null);
      }
    }
  };
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

  const [isAddingFile, setIsAddingFile] = useState(false);
  const [newFileNameInput, setNewFileNameInput] = useState("");
  const [renamingFileName, setRenamingFileName] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");

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
  const [isRecoveredErrorsExpanded, setIsRecoveredErrorsExpanded] = useState(false);
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
    if (csExportMode === 'bundle') {
      const code = generateFullCSharp(rootElement, debouncedCsNamespace, lastScopeBuilder || undefined);
      return [{ name: `${rootElement.name ? rootElement.name.replace(/[^a-zA-Z0-9]/g, '') : 'Parser'}Bundle.cs`, content: code }];
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
      const name = `${rootElement.name ? rootElement.name.replace(/[^a-zA-Z0-9]/g, '') : 'Parser'}Bundle.ts`;
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
  const [hoveredQueryNode, setHoveredQueryNode] = useState<any | null>(null);
  const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({});
  const [cursorPosition, setCursorPosition] = useState({ line: 1, col: 1 });
  const transformComponentRef = useRef<any>(null);
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
  const lastCapturedEditRef = useRef<{ editOffset: number; removedLength: number; insertedText: string } | null>(null);
  const latestCSTRef = useRef<any>(null);

  const lastHighlightCache = useRef<{
    code: string;
    debouncedTestInput: string;
    parseResult: any;
    activeBlockStart: number;
    activeBlockEnd: number;
    activeSymStart: number;
    activeSymEnd: number;
    activeSymRefsStr: string;
    activeRefStart: number;
    activeRefEnd: number;
    resultHtml: string;
  } | null>(null);

  const lastPrismCache = useRef<{
    code: string;
    lang: string;
    result: string;
  } | null>(null);

  const cachedPrismHighlight = (code: string, lang: string) => {
    if (
      lastPrismCache.current &&
      lastPrismCache.current.code === code &&
      lastPrismCache.current.lang === lang
    ) {
      return lastPrismCache.current.result;
    }
    const result = Prism.highlight(code, Prism.languages[lang] || Prism.languages.javascript, lang);
    lastPrismCache.current = { code, lang, result };
    return result;
  };

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

  const handleEditorSelectionChange = (e: any) => {
    const textarea = (e.target || e.currentTarget) as any;
    if (!textarea) return;
    const start = textarea.selectionStart || 0;
    const value = textarea.value || "";
    const textBefore = value.slice(0, start);
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
      
      // Execute the grammar code
      // We provide SyntaxElement and the Sort helper to the execution context
      const executionFunc = new Function('SyntaxElement', 'Sort', 'Token', 'DefaultLeadingTrivia', 'DefaultTrailingTrivia', 'BeginScope', 'EndScope', `
        ${debouncedGrammarCode}
        return typeof root !== 'undefined' ? root : null;
      `);
      
      const root = executionFunc(SyntaxElement, Sort, Token, DefaultLeadingTrivia, DefaultTrailingTrivia, BeginScope, EndScope);
      if (root instanceof SyntaxElement) {
        root.autoInjectLoopBoundaries();
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

  const highlightWithCST = (code: string) => {
    const activeBlock = hoveredScope || selectedScope;
    const hasActiveBlock = !!(activeBlock && activeBlock.type !== 'global');
    const activeBlockStart = hasActiveBlock ? activeBlock.start : -1;
    const activeBlockEnd = hasActiveBlock ? activeBlock.end : -1;

    const activeSym = selectedSymbol || hoveredSymbol;
    const activeSymStart = activeSym ? activeSym.start : -1;
    const activeSymEnd = activeSym ? activeSym.end : -1;
    const activeSymRefsStr = activeSym && activeSym.references 
      ? JSON.stringify(activeSym.references.map((r: any) => ({ start: r.start, end: r.end }))) 
      : "";

    const activeRef = selectedReference || hoveredReference;
    const activeRefStart = activeRef ? activeRef.start : -1;
    const activeRefEnd = activeRef ? activeRef.end : -1;

    // Check Cache Hit
    if (
      lastHighlightCache.current &&
      lastHighlightCache.current.code === code &&
      lastHighlightCache.current.debouncedTestInput === debouncedTestInput &&
      lastHighlightCache.current.parseResult === parseResult &&
      lastHighlightCache.current.activeBlockStart === activeBlockStart &&
      lastHighlightCache.current.activeBlockEnd === activeBlockEnd &&
      lastHighlightCache.current.activeSymStart === activeSymStart &&
      lastHighlightCache.current.activeSymEnd === activeSymEnd &&
      lastHighlightCache.current.activeSymRefsStr === activeSymRefsStr &&
      lastHighlightCache.current.activeRefStart === activeRefStart &&
      lastHighlightCache.current.activeRefEnd === activeRefEnd
    ) {
      return lastHighlightCache.current.resultHtml;
    }

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

    // Save output in cache
    lastHighlightCache.current = {
      code,
      debouncedTestInput,
      parseResult,
      activeBlockStart,
      activeBlockEnd,
      activeSymStart,
      activeSymEnd,
      activeSymRefsStr,
      activeRefStart,
      activeRefEnd,
      resultHtml: html
    };

    return html;
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

  const renderCSTVisualNode = (node: any, depth: number = 0, isLast: boolean = true, path: string = "root"): React.ReactNode => {
    if (!node) return null;
    
    // Handle primitive nodes (strings/numbers/booleans) directly
    if (typeof node !== 'object') {
      return (
        <div key={path} className="p-2 px-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl text-[11px] font-mono text-emerald-300/90 inline-block shadow-sm">
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
            "p-3.5 bg-red-500/10 border rounded-xl flex items-start gap-3 max-w-[320px] shadow-lg shadow-red-500/5 relative group cursor-pointer transition-all text-left",
            isSelected ? "border-red-500 ring-2 ring-red-500/30 bg-red-500/20" : "border-red-500/40 hover:border-red-500/80",
            isHovered ? "bg-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.2)] border-red-400" : ""
          )}
        >
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <div className="flex flex-col">
            <span className="text-[8px] font-black uppercase tracking-widest text-red-400 mb-1">RECOVERED ERROR NODE</span>
            <span className="text-[11px] font-mono text-red-100/80 leading-relaxed italic truncate max-w-[240px]">
              {node.message}
            </span>
            <span className="text-[8px] font-bold text-red-400/50 mt-2 uppercase tracking-tighter">
              Panic Recovery offset {node.start}..{node.end}
            </span>
          </div>
        </motion.div>
      );
    }

    const isArray = Array.isArray(value);
    const isLeaf = !isArray && typeof value !== 'object';
    const isSelected = selectedCstNode === node;
    const isHovered = hoveredCstNode === node;
    
    // Extract list of children nodes
    let children: any[] = [];
    if (isArray) {
      children = value.filter(n => n !== null && n !== undefined);
    } else if (typeof value === 'object' && value !== null) {
      children = [value];
    }

    const hasChildren = children.length > 0;

    return (
      <div key={path} className="flex flex-col items-center relative">
        {/* Main Node Box */}
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
            "inline-flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all border group shadow-md relative z-10 cursor-pointer min-w-[124px] justify-center text-center",
            isLeaf ? "bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/15" : "bg-black/80 border-white/10 hover:bg-white/[0.08]",
            isSelected ? "ring-2 ring-indigo-500 bg-indigo-500/20 border-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.35)]" : "hover:border-indigo-500/40",
            isHovered ? "border-indigo-400 bg-indigo-950/40 shadow-[0_0_15px_rgba(99,102,241,0.25)]" : ""
          )}
        >
          <div className={cn(
            "w-2 h-2 rounded-full shrink-0 ring-4 ring-black/40",
            isLeaf ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]" : "bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.4)]"
          )} />
          
          <div className="flex flex-col items-center">
            <span className={cn(
              "text-[8px] font-black uppercase tracking-[0.25em] leading-none mb-1.5 opacity-60",
              isLeaf ? "text-emerald-400" : "text-indigo-400"
            )}>
              {type || 'Rule'}
            </span>
            {isLeaf ? (
              <span className="text-[11px] font-mono text-white/95 break-all max-w-[210px] font-medium leading-tight">
                {value !== undefined ? String(value) : "null"}
              </span>
            ) : isArray ? (
              <span className="text-[8.5px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                {children.length} {children.length === 1 ? 'branch' : 'branches'}
              </span>
            ) : null}
          </div>
        </div>

        {/* Vertical connective track going down to horizontal split line */}
        {hasChildren && (
          <div className="w-px h-6 bg-indigo-500/30 relative">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-indigo-500/40 rounded-full" />
          </div>
        )}

        {/* Horizontal flex of sub-children */}
        {hasChildren && (
          <div className="flex flex-row items-start justify-center gap-x-8 relative">
            {children.map((child: any, idx: number) => {
              const isFirst = idx === 0;
              const isLast = idx === children.length - 1;
              return (
                <div key={`${path}-${idx}`} className="flex flex-col items-center relative">
                  {/* Left and right connecting segments */}
                  {children.length > 1 && (
                    <>
                      {!isFirst && <div className="absolute top-0 left-0 right-1/2 h-px bg-indigo-500/30" />}
                      {!isLast && <div className="absolute top-0 left-1/2 right-0 h-px bg-indigo-500/30" />}
                    </>
                  )}
                  {/* Incoming line of the child itself */}
                  <div className="w-px h-6 bg-indigo-500/30 relative">
                    <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 bg-indigo-500 rounded-full" />
                  </div>
                  
                  {/* Recurse on children */}
                  {renderCSTVisualNode(child, depth + 1, idx === children.length - 1, `${path}-${idx}`)}
                </div>
              );
            })}
          </div>
        )}
      </div>
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
                      rule.type === 'beginScope' && "bg-violet-500/20 text-violet-400",
                      rule.type === 'endScope' && "bg-purple-500/20 text-purple-400",
                      rule.type === 'eof' && "bg-zinc-500/20 text-zinc-400"
                    )}>
                      {rule.type === 'not' ? 'Not' : rule.type === 'element' ? 'Call' : rule.type === 'whitespace' ? 'Space' : rule.type === 'choice' ? 'OneOf' : rule.type === 'optional' ? 'Opt' : rule.type === 'zeroOrMore' ? 'Any' : rule.type === 'oneOrMore' ? 'Some' : rule.type === 'beginScope' ? 'BeginScope' : rule.type === 'endScope' ? 'EndScope' : rule.type === 'eof' ? 'End' : 'Expects'}
                    </span>
                    
                    <code className={cn(
                      "text-sm font-mono leading-none truncate max-w-[200px]",
                      rule.type === 'regex' ? "text-emerald-400" : 
                      rule.type === 'eof' ? "text-zinc-500" :
                      rule.type === 'not' ? "text-rose-300" :
                      rule.type === 'beginScope' ? "text-violet-300 font-bold" :
                      rule.type === 'endScope' ? "text-purple-300 font-bold" :
                      rule.type === 'element' ? "text-indigo-300" : "text-white"
                    )}>
                      {rule.type === 'whitespace' ? 'WS' : 
                      rule.type === 'choice' ? `[ ${(rule.value as any[]).map(v => typeof v === 'string' ? `"${v}"` : v instanceof RegExp ? `Regex` : v?.name || 'Element').join(' | ')} ]` :
                      rule.type === 'regex' ? `Regex("${rule.value?.source}")` : 
                      rule.type === 'eof' ? 'EOF' :
                      rule.type === 'beginScope' || rule.type === 'endScope' ? `${typeof rule.value === 'string' ? `"${rule.value}"` : (rule.value as any)?.name ? (rule.value as any).name : 'Pattern'}` :
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
            <SyntaxEngineLogo className="text-white w-5 h-5" />
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
                    <button
                      id="diag-console-tab-btn"
                      onClick={() => setDesignerEditorTab('console')}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[9px] uppercase tracking-wider font-extrabold rounded-lg border transition-all cursor-pointer shadow-sm relative",
                        designerEditorTab === 'console'
                          ? "bg-indigo-600/15 border-indigo-500/30 text-indigo-300"
                          : "bg-transparent border-transparent text-slate-400 hover:text-slate-300 hover:bg-white/[0.02]"
                      )}
                    >
                      <Terminal className="w-3.5 h-3.5 text-indigo-400" /> Console
                      {grammarDiagnostics.length > 0 && (
                        <div className="absolute -top-1.5 -right-1.5 flex gap-0.5 pointer-events-none">
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
                                              rule.type === 'beginScope' && "bg-violet-500/10 text-violet-400 border border-violet-500/20",
                                              rule.type === 'endScope' && "bg-purple-500/10 text-purple-400 border border-purple-500/20",
                                              rule.type === 'eof' && "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20"
                                            )}>
                                              {rule.type === 'not' ? 'Not matched' : rule.type === 'element' ? 'Rule Call' : rule.type === 'whitespace' ? 'Whitespace' : rule.type === 'choice' ? 'OneOf Choice' : rule.type === 'optional' ? 'Optional' : rule.type === 'zeroOrMore' ? 'Any Count' : rule.type === 'oneOrMore' ? 'Some Count' : rule.type === 'beginScope' ? 'Begin Scope' : rule.type === 'endScope' ? 'End Scope' : rule.type === 'eof' ? 'EOF Boundary' : 'Expects Match'}
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
                                          ) : (rule.type === 'beginScope' || rule.type === 'endScope') ? (
                                            <code className="text-[11px] font-mono text-violet-300 bg-violet-500/5 px-2 py-0.5 rounded border border-violet-500/10 font-bold">
                                              {rule.type === 'beginScope' ? 'Begin' : 'End'}: "{String(rule.value)}"
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
                <div ref={editorScrollContainerRef} className="flex-1 overflow-auto custom-scrollbar bg-[#161618] relative flex flex-row">
                  <TestCodeMirror
                    editorRef={testEditorRef}
                    onGotoDefinition={(def) => {
                      setSelectedSymbol(def);
                    }}
                    value={testInput}
                    onChange={(code, edit) => {
                      if (edit) {
                        pendingEditsRef.current.push(edit);
                        const delta = edit.insertedText.length - edit.removedLength;
                        if (delta !== 0 || edit.removedLength > 0) {
                          shiftAstAndStateOffsets(edit.editOffset, edit.removedLength, delta);
                        }
                      }
                      setTestInput(code);
                    }}
                    setCursorPosition={setCursorPosition}
                    parserState={{
                      debouncedTestInput,
                      parseResult,
                      hoveredScope,
                      selectedScope,
                      hoveredSymbol,
                      selectedSymbol,
                      hoveredReference,
                      selectedReference,
                      parseError,
                      symbols: allSymbolsAndReferences.symbols,
                      references: allSymbolsAndReferences.references
                    }}
                    className="h-full"
                  />
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
                      <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#a5b4fc] bg-[#4f46e5]/10 px-2.5 py-1 rounded-md border border-[#4f46e5]/20 flex items-center gap-1.5 shadow-sm">
                        <FileCode className="w-3.5 h-3.5" /> CST Parser Tree
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-3">
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
                          onClick={() => setCstViewMode('investigate')}
                          className={cn(
                            "px-1.5 py-0.5 text-[8px] font-bold transition-all rounded",
                            cstViewMode === 'investigate' ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 font-black shadow-sm" : "text-slate-500 hover:text-slate-300"
                          )}
                        >
                          🔍 INVESTIGATE
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

                      <button 
                        onClick={() => {
                          const targetData = parseResult;
                          navigator.clipboard.writeText(JSON.stringify(targetData, null, 2));
                          alert(`CST JSON copied!`);
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
                                <div className="p-16 min-h-full min-w-full flex items-center justify-center bg-transparent">
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
                          <div className="relative group border border-white/10 bg-slate-900/50 rounded-lg overflow-hidden flex min-h-[100px] items-stretch focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/20 transition-all max-h-[160px]">
                            <div className="absolute top-3.5 left-3 flex items-center pointer-events-none text-slate-500 group-focus-within:text-indigo-400 transition-colors z-10">
                              <Search className="w-3.5 h-3.5" />
                            </div>
                            <div className="flex-1 pl-8 min-h-[100px]">
                              <CodeMirror
                                value={queryText}
                                onChange={(val) => setQueryText(val)}
                                theme="none"
                                extensions={[queryEditorTheme]}
                                basicSetup={{
                                  lineNumbers: false,
                                  foldGutter: false,
                                  dropCursor: false,
                                  allowMultipleSelections: false,
                                  indentOnInput: false,
                                  syntaxHighlighting: false,
                                  bracketMatching: true,
                                  closeBrackets: true,
                                  autocompletion: false,
                                }}
                                className="w-full h-full text-xs font-mono"
                                placeholder="Enter S-expression query (e.g. (struct_decl (id @name)))"
                              />
                            </div>
                            <div className="absolute right-3 bottom-2.5 flex gap-1 pointer-events-none z-10">
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
                    ) : cstViewMode === 'investigate' ? (
                      <div className="h-full flex flex-col md:flex-row overflow-hidden text-slate-300 bg-[#0e0e11]/80 backdrop-blur-xl">
                        {/* Left Side: Interactive Char Monospace Grid */}
                        <div className="w-full md:w-1/2 border-b md:border-b-0 md:border-r border-white/5 flex flex-col overflow-hidden bg-black/50">
                          <div className="p-3 bg-white/[0.01] border-b border-white/5 flex items-center justify-between select-none">
                            <div className="flex items-center gap-1.5 flex-1">
                              <Search className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Hover Code Matrix
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {pinnedOffset !== null && (
                                <button
                                  onClick={() => setPinnedOffset(null)}
                                  className="px-2 py-0.5 text-[8.5px] font-bold bg-indigo-500/20 text-indigo-300 rounded border border-indigo-500/30 hover:bg-indigo-500/30 transition-all flex items-center gap-1 cursor-pointer"
                                >
                                  Unpin Offset ({pinnedOffset})
                                </button>
                              )}
                              <span className="text-[9.5px] font-mono text-slate-500">
                                Offset: <strong className="text-emerald-400 font-bold">{pinnedOffset ?? hoveredOffset ?? 0}</strong>
                              </span>
                            </div>
                          </div>

                          <div className="flex-1 p-3 overflow-auto custom-scrollbar font-mono bg-black/20 select-none">
                            {(() => {
                              const code = debouncedTestInput || "";
                              const lines = code.split("\n");
                              let absoluteOffset = 0;

                              // Highlight ranges of nodes hovered in investigator sidebar
                              const extraHighlightStart = investigateHoveredNode?.offset ?? -1;
                              const extraHighlightEnd = extraHighlightStart + (investigateHoveredNode?.width ?? 0);

                              return lines.map((line, lineIdx) => {
                                const chars = Array.from(line);
                                const lineStartOffset = absoluteOffset;
                                absoluteOffset += line.length + 1; // including \n

                                return (
                                  <div key={lineIdx} className="flex hover:bg-white/[0.02] py-[1.5px] leading-relaxed transition-all min-h-[22px]">
                                    {/* Line Gutter */}
                                    <div className="w-8 shrink-0 text-[10px] font-mono text-slate-600 border-r border-white/5 pr-2 select-none text-right">
                                      {lineIdx + 1}
                                    </div>
                                    <div className="flex pl-2.5 font-mono text-[12.5px] flex-wrap">
                                      {chars.map((char, charIdx) => {
                                        const charOffset = lineStartOffset + charIdx;
                                        const isHovered = charOffset === hoveredOffset;
                                        const isPinned = charOffset === pinnedOffset;
                                        const isInInvestigateRange = charOffset >= extraHighlightStart && charOffset < extraHighlightEnd;

                                        return (
                                          <span
                                            key={charIdx}
                                            onMouseEnter={() => setHoveredOffset(charOffset)}
                                            onMouseLeave={() => setHoveredOffset(null)}
                                            onClick={() => {
                                              if (pinnedOffset === charOffset) {
                                                setPinnedOffset(null);
                                              } else {
                                                setPinnedOffset(charOffset);
                                              }
                                            }}
                                            className={cn(
                                              "cursor-crosshair font-mono px-[0.5px] rounded transition-all select-none",
                                              isPinned 
                                                ? "bg-amber-500/40 text-amber-100 ring-2 ring-amber-500 outline-none font-bold"
                                                : isHovered 
                                                ? "bg-indigo-500/30 text-indigo-100 outline outline-1 outline-indigo-500 font-bold scale-[1.05] relative z-10 shadow-lg"
                                                : isInInvestigateRange
                                                ? "bg-emerald-500/25 text-emerald-200 border-b-2 border-emerald-400"
                                                : "text-slate-300 hover:bg-white/10"
                                            )}
                                          >
                                            {char === ' ' ? '\u00A0' : char}
                                          </span>
                                        );
                                      })}
                                      {line.length === 0 && (
                                        <span 
                                          onMouseEnter={() => setHoveredOffset(lineStartOffset)}
                                          onMouseLeave={() => setHoveredOffset(null)}
                                          onClick={() => {
                                            if (pinnedOffset === lineStartOffset) setPinnedOffset(null);
                                            else setPinnedOffset(lineStartOffset);
                                          }}
                                          className={cn(
                                            "text-slate-600/35 italic text-[10px] select-none cursor-crosshair pl-1 transition-all rounded",
                                            pinnedOffset === lineStartOffset ? "bg-amber-500/20 text-amber-300" :
                                            hoveredOffset === lineStartOffset ? "bg-white/10 text-slate-400" : ""
                                          )}
                                        >
                                          ¶
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        </div>

                        {/* Right Side: Resolved Rule Stack */}
                        <div className="flex-1 flex flex-col overflow-hidden bg-slate-950/40 p-3">
                          <div className="p-1 mb-2 select-none">
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5 mb-1.5">
                              <Layers className="w-3.5 h-3.5 text-indigo-400" />
                              Rule Stack Encompassed
                            </div>
                            <p className="text-[10px] text-slate-500 leading-normal">
                              Move cursor over characters or click to pin. The rule hierarchy matching that position is resolved bottom-up.
                            </p>
                          </div>

                          <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 mt-2">
                            {(() => {
                              const currentOffset = pinnedOffset ?? debouncedInvestigateOffset;
                              if (currentOffset === null) {
                                return (
                                  <div className="h-full flex flex-col items-center justify-center p-6 text-slate-500/60 font-mono text-[11px] text-center italic leading-relaxed border border-dashed border-white/5 rounded-xl m-2 bg-black/10 select-none">
                                    <MousePointer className="w-5 h-5 text-indigo-400/40 animate-bounce mb-2" />
                                    <span>Hover over the code matrix to trace matching rules!</span>
                                  </div>
                                );
                              }

                              // Recursive rule gatherer
                              const matching: any[] = [];
                              const findMatching = (node: any) => {
                                if (!node || typeof node !== 'object') return;
                                const start = node.offset;
                                const width = node.width;
                                if (typeof start !== 'number' || typeof width !== 'number') return;
                                const end = start + width;
                                if (currentOffset >= start && currentOffset < end) {
                                  matching.push(node);
                                  const val = node.value;
                                  if (Array.isArray(val)) {
                                    for (const child of val) {
                                      findMatching(child);
                                    }
                                  } else if (val && typeof val === 'object') {
                                    findMatching(val);
                                  }
                                }
                              };

                              if (parseResult) {
                                findMatching(parseResult);
                              }

                              if (matching.length === 0) {
                                return (
                                  <div className="p-4 rounded-xl bg-slate-900 border border-white/5 text-slate-500 font-mono text-[10.5px] italic text-center select-none">
                                    No grammatical rules matched at offset {currentOffset}.
                                  </div>
                                );
                              }

                              return (
                                <div className="space-y-2 select-text p-1">
                                  {matching.map((node, index) => {
                                    const length = node.width;
                                    const snippet = debouncedTestInput.substring(node.offset, node.offset + length);
                                    const collapsedSnippet = snippet.length > 120 ? snippet.substring(0, 120) + "..." : snippet;
                                    const isLeaf = !Array.isArray(node.value) && typeof node.value !== 'object';

                                    return (
                                      <div 
                                        key={index}
                                        onMouseEnter={() => setInvestigateHoveredNode(node)}
                                        onMouseLeave={() => setInvestigateHoveredNode(null)}
                                        onClick={() => {
                                          setSelectedCstNode(node);
                                        }}
                                        className={cn(
                                          "group p-3 rounded-xl border font-mono transition-all flex flex-col gap-2 cursor-pointer relative shadow-sm",
                                          isLeaf ? "bg-emerald-500/5 hover:bg-emerald-500/10 border-emerald-500/15" : "bg-black/30 hover:bg-white/[0.02] border-white/5 hover:border-indigo-500/30"
                                        )}
                                      >
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-2">
                                            <span className={cn(
                                              "text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border leading-none shadow-sm",
                                              isLeaf 
                                                ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300" 
                                                : "bg-[#4f46e5]/15 border-[#4f46e5]/30 text-indigo-300"
                                            )}>
                                              {node.type || `rule-${node.ruleId}`}
                                            </span>
                                            <span className="text-[10px] text-slate-600 font-extrabold select-none">
                                              #{node.green?.id || node.id || ''}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-1.5 select-none">
                                            <span className="text-[8.5px] font-mono text-indigo-400 bg-indigo-400/5 px-2 py-0.5 border border-indigo-400/15 rounded-md">
                                              range: {node.offset} - {node.offset + length}
                                            </span>
                                            <span className="text-[8.5px] font-mono text-slate-500 bg-black/40 px-1.5 py-0.5 border border-white/5 rounded-md">
                                              width: {length}
                                            </span>
                                          </div>
                                        </div>

                                        <div className="text-[10.5px] font-mono text-slate-300 bg-black/40 px-2 py-1 border border-white/5 rounded-md leading-relaxed whitespace-pre truncate max-h-[85px] overflow-hidden">
                                          {collapsedSnippet}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                          </div>
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
                            <ErrorBoundary sectionName="Scope Tree Panel">
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
                            </ErrorBoundary>
                          </div>
                        </div>

                        {/* 2. Right Detail Panel */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 bg-slate-950/40">
                          <ErrorBoundary sectionName="Scope Details Pane">
                            {(() => {
                              const currentScope = (selectedScope || scopeChain || { name: 'None', symbols: [], references: [], type: 'global', id: 'global', start: 0, end: 0 }) as any;
                            
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
                                              <span>↳ Declared Node: <b>{selectedSymbol.name}</b> as <b>{selectedSymbol.datatype}</b></span>
                                            </div>
                                            {selectedSymbol.references.map((r, ri) => (
                                              <div key={r.id} className="pl-3 border-l-2 border-dashed border-indigo-500/40 text-emerald-400 flex items-center gap-1.5">
                                                <span>↳ Ref #{ri+1}: at Offset {r.start} resolved to declaration symbol</span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>

                                        <div className="space-y-1">
                                          <span className="block text-[8px] text-slate-500 font-bold uppercase tracking-wider">Symbol Snippet Source</span>
                                          <pre className="p-2.5 rounded bg-black/60 border border-indigo-500/20 text-[10px] text-emerald-400 leading-relaxed overflow-x-auto truncate">
                                            {(testInput || "").substring(selectedSymbol.start, selectedSymbol.end) || "Empty Definition Match"}
                                          </pre>
                                        </div>

                                        <div className="space-y-1.5">
                                          <span className="block text-[8px] text-slate-500 font-bold uppercase tracking-wider">Code usages / references ({selectedSymbol.references.length})</span>
                                          {selectedSymbol.references.length === 0 ? (
                                            <div className="text-[10px] italic text-slate-500">No active usages analyzed.</div>
                                          ) : (
                                            <div className="flex flex-wrap gap-1.5">
                                              {selectedSymbol.references.map((r, ri) => {
                                                const rLoc = getLineAndCol(testInput, r.start);
                                                return (
                                                  <div 
                                                    key={r.id}
                                                    onClick={() => {
                                                      scrollToNode(r);
                                                    }}
                                                    className="p-1.5 px-2 bg-emerald-500/5 hover:bg-indigo-500/20 border border-emerald-500/20 hover:border-indigo-500/40 rounded text-[10px] text-emerald-300 transition-all flex items-center gap-1.5 cursor-pointer"
                                                    title={`Click to jump to line ${rLoc.line}`}
                                                  >
                                                    <Link className="w-3 h-3 text-emerald-400/80" />
                                                    <span>Ref #{ri+1} (Line {rLoc.line}, Col {rLoc.col})</span>
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
                          </ErrorBoundary>
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
