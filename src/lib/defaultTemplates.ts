export const DEFAULT_CODE = `/* 
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
const id_exp = /[a-zA-Z_][a-zA-Z0-9_]*/;
const id = Token(id_exp, "id");
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
  .BeginScope(Token("["))
  .Expects(id).As("name")
  .EndScope(Token("]"));

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
  .StrictLiteral(/Blend/i, id_exp)
  .ExpectsOneOfStrict(
    StrictLiteral(/Off/i, id_exp),
    new SyntaxElement("blend_args")
      .Ignore()
      .Optional(renderTargetIndex).As("rtIndex")
      .Expects(blendFactor).As("src")
      .Expects(blendFactor).As("dst")
      .Optional(
        new SyntaxElement("blend_alpha")
          .Ignore()
          .Token(",")
          .Expects(blendFactor).As("srcAlpha")
          .Expects(blendFactor).As("dstAlpha")
      )
  );

// --- 6.2 BlendOp
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
  .StrictLiteral(/BlendOp/i, id_exp)
  .Optional(renderTargetIndex).As("rtIndex")
  .Expects(blendOperation).As("op")
  .Optional(
    new SyntaxElement("blend_op_alpha")
      .Ignore()
      .Token(",")
      .Expects(blendOperation).As("opAlpha")
  );

// 6.3 ZWrite
const onOffValue = new SyntaxElement("on_off_value")
  .AsNode("OnOffValue")
  .ExpectsOneOfStrict(
    propRef,
    StrictLiteral(/On/i, id_exp),
    StrictLiteral(/Off/i, id_exp)
  );

const zWriteCommand = new SyntaxElement("zwrite_command")
  .AsNode("ZWriteCommand")
  .StrictLiteral(/ZWrite/i, id_exp)
  .Expects(onOffValue).As("value");

// 6.4 ZTest
const compareFunction = new SyntaxElement("compare_function")
  .AsNode("CompareFunction")
  .ExpectsOneOfStrict(
    propRef,
    Token(/LEqual/i),
    Token(/GEqual/i),
    Token(/Less/i),
    Token(/Greater/i),
    Token(/Equal/i),
    Token(/NotEqual/i),
    Token(/Always/i),
    Token(/Never/i),
    StrictLiteral(/Off/i, id_exp)
  );

const zTestCommand = new SyntaxElement("ztest_command")
  .AsNode("ZTestCommand")
  .StrictLiteral(/ZTest/i, id_exp)
  .Expects(compareFunction).As("func");

// 6.5 ZClip
const zClipCommand = new SyntaxElement("zclip_command")
  .AsNode("ZClipCommand")
  .StrictLiteral(/ZClip/i, id_exp)
  .Expects(onOffValue).As("value");

// 6.6 Cull
const cullMode = new SyntaxElement("cull_mode")
  .AsNode("CullMode")
  .ExpectsOneOfStrict(
    propRef,
    Token(/Back/i),
    Token(/Front/i),
    StrictLiteral(/Off/i, id_exp)
  );

const cullCommand = new SyntaxElement("cull_command")
  .AsNode("CullCommand")
  .StrictLiteral(/Cull/i, id_exp)
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
  .StrictLiteral(/Offset/i, id_exp)
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
  .StrictLiteral(/ColorMask/i, id_exp)
  .Expects(colorMaskValue).As("mask")
  .Optional(renderTargetIndex).As("rtIndex");

// 6.9 AlphaToMask
const alphaToMaskCommand = new SyntaxElement("alpha_to_mask_command")
  .AsNode("AlphaToMaskCommand")
  .StrictLiteral(/AlphaToMask/i, id_exp)
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

const stencilRef = new SyntaxElement("stencil_ref").AsNode("StencilRef").StrictLiteral(/Ref/i, id_exp).Expects(stencilValue).As("val");
const stencilReadMask = new SyntaxElement("stencil_read_mask").AsNode("StencilReadMask").StrictLiteral(/ReadMask/i, id_exp).Expects(stencilValue).As("val");
const stencilWriteMask = new SyntaxElement("stencil_write_mask").AsNode("StencilWriteMask").StrictLiteral(/WriteMask/i, id_exp).Expects(stencilValue).As("val");

const stencilComp = new SyntaxElement("stencil_comp").AsNode("StencilComp").StrictLiteral(/Comp/i, id_exp).Expects(compareFunction).As("func");
const stencilPass = new SyntaxElement("stencil_pass").AsNode("StencilPass").StrictLiteral(/Pass/i, id_exp).Expects(stencilOpValue).As("op");
const stencilFail = new SyntaxElement("stencil_fail").AsNode("StencilFail").StrictLiteral(/Fail/i, id_exp).Expects(stencilOpValue).As("op");
const stencilZFail = new SyntaxElement("stencil_zfail").AsNode("StencilZFail").StrictLiteral(/ZFail/i, id_exp).Expects(stencilOpValue).As("op");

const stencilCompBack = new SyntaxElement("stencil_comp_back").AsNode("StencilCompBack").StrictLiteral(/CompBack/i, id_exp).Expects(compareFunction).As("func");
const stencilPassBack = new SyntaxElement("stencil_pass_back").AsNode("StencilPassBack").StrictLiteral(/PassBack/i, id_exp).Expects(stencilOpValue).As("op");
const stencilFailBack = new SyntaxElement("stencil_fail_back").AsNode("StencilFailBack").StrictLiteral(/FailBack/i, id_exp).Expects(stencilOpValue).As("op");
const stencilZFailBack = new SyntaxElement("stencil_zfail_back").AsNode("StencilZFailBack").StrictLiteral(/ZFailBack/i, id_exp).Expects(stencilOpValue).As("op");

const stencilCompFront = new SyntaxElement("stencil_comp_front").AsNode("StencilCompFront").StrictLiteral(/CompFront/i, id_exp).Expects(compareFunction).As("func");
const stencilPassFront = new SyntaxElement("stencil_pass_front").AsNode("StencilPassFront").StrictLiteral(/PassFront/i, id_exp).Expects(stencilOpValue).As("op");
const stencilFailFront = new SyntaxElement("stencil_fail_front").AsNode("StencilFailFront").StrictLiteral(/FailFront/i, id_exp).Expects(stencilOpValue).As("op");
const stencilZFailFront = new SyntaxElement("stencil_zfail_front").AsNode("StencilZFailFront").StrictLiteral(/ZFailFront/i, id_exp).Expects(stencilOpValue).As("op");

const stencilState = new SyntaxElement("stencil_state")
  .ExpectsOneOf(
    stencilCompBack, stencilPassBack, stencilFailBack, stencilZFailBack,
    stencilCompFront, stencilPassFront, stencilFailFront, stencilZFailFront,
    stencilRef, stencilReadMask, stencilWriteMask,
    stencilComp, stencilPass, stencilFail, stencilZFail
  );

const stencilBlock = new SyntaxElement("stencil_block")
  .AsNode("StencilBlock")
  .StrictLiteral(/Stencil/i, id_exp)
  .BeginScope(Token("{"))
  .ZeroOrMore(stencilState).As("states")
  .EndScope(Token("}"));

// 6.11 ColorMaterial (legacy)
const colorMaterialCommand = new SyntaxElement("color_material_command")
  .AsNode("ColorMaterialCommand")
  .StrictLiteral(/ColorMaterial/i, id_exp)
  .ExpectsOneOf(
    Token(/AmbientAndDiffuse/i),
    Token(/Emission/i)
  ).As("value");

// 6.12 Lighting (legacy)
const lightingCommand = new SyntaxElement("lighting_command")
  .AsNode("LightingCommand")
  .StrictLiteral(/Lighting/i, id_exp)
  .Expects(onOffValue).As("value");

// 6.13 Conservative Rasterization
const conservativeCommand = new SyntaxElement("conservative_command")
  .AsNode("ConservativeCommand")
  .StrictLiteral(/Conservative/i, id_exp)
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
  .StrictLiteral(/AlphaTest/i, id_exp)
  .ExpectsOneOfStrict(
    StrictLiteral(/Off/i, id_exp),
    alphaTestMode
  ).As("mode");

// 6.15 Fog Block (legacy)
const fogMode = new SyntaxElement("fog_mode")
  .AsNode("FogMode")
  .ExpectsOneOfStrict(
    StrictLiteral(/Off/i, id_exp),
    StrictLiteral(/Global/i, id_exp),
    StrictLiteral(/Linear/i, id_exp),
    StrictLiteral(/Exp2/i, id_exp),
    StrictLiteral(/Exp/i, id_exp)
  );

const fogStateRange = new SyntaxElement("fog_state_range")
  .Ignore()
  .StrictLiteral(/Range/i, id_exp)
  .Expects(number).As("min")
  .Token(",")
  .Expects(number).As("max");

const fogState = new SyntaxElement("fog_state")
  .AsNode("FogState")
  .ExpectsOneOf(
    new SyntaxElement("fog_state_mode").Ignore().StrictLiteral(/Mode/i, id_exp).Expects(fogMode).As("mode"),
    new SyntaxElement("fog_state_color").Ignore().StrictLiteral(/Color/i, id_exp).Expects(vectorLiteral).As("color"),
    new SyntaxElement("fog_state_density").Ignore().StrictLiteral(/Density/i, id_exp).Expects(number).As("density"),
    fogStateRange
  );

const fogBlock = new SyntaxElement("fog_block")
  .AsNode("FogBlock")
  .Token(/Fog/i)
  .BeginScope(Token("{"))
  .ZeroOrMore(fogState).As("states")
  .EndScope(Token("}"));

// 6.16 SeparateSpecular (legacy)
const separateSpecularCommand = new SyntaxElement("separate_specular_command")
  .AsNode("SeparateSpecularCommand")
  .StrictLiteral(/SeparateSpecular/i, id_exp)
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
  .BeginScope(Token("{"))
  .ZeroOrMore(tagEntry).As("entries")
  .EndScope(Token("}"));

// --- Section 7: Shader Program Blocks (Opaque) ---
const cgProgram = Token(/CGPROGRAM[\s\S]*?ENDCG/, "programBlock");
const hlslProgram = Token(/HLSLPROGRAM[\s\S]*?ENDHLSL/, "programBlock");
const glslProgram = Token(/GLSLPROGRAM[\s\S]*?ENDGLSL/, "programBlock");

const cgInclude = Token(/CGINCLUDE[\s\S]*?ENDCG/, "programBlock");
const hlslInclude = Token(/HLSLINCLUDE[\s\S]*?ENDHLSL/, "programBlock");
const glslInclude = Token(/GLSLINCLUDE[\s\S]*?ENDGLSL/, "programBlock");

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
  .Ignore()
  .ZeroOrMore(passState).As("contents");

const pass = new SyntaxElement("pass")
  .AsNode("Pass")
  .Token(/Pass/i)
  .BeginScope(Token("{"))
  .Expects(passBody)
  .EndScope(Token("}"));

const grabPass = new SyntaxElement("grab_pass")
  .AsNode("GrabPass")
  .Token(/GrabPass/i)
  .BeginScope(Token("{"))
  .Optional(string).As("textureName")
  .EndScope(Token("}"));

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
  .Ignore()
  .ZeroOrMore(subShaderState).As("contents");

const subShader = new SyntaxElement("subshader")
  .AsNode("SubShader")
  .Token(/SubShader/i)
  .BeginScope(Token("{"))
  .Expects(subShaderBody)
  .EndScope(Token("}"));

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
      .Ignore()
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
  .StrictLiteral(/Range/i, id_exp)
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
  .Ignore()
  .ZeroOrMore(id);

const textureDefault = new SyntaxElement("texture_default")
  .AsNode("TextureDefault")
  .Expects(string).As("texName")
  .BeginScope(Token("{"))
  .Expects(textureOptions).As("options")
  .EndScope(Token("}"));

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
  .BeginScope(Token("{"))
  .ZeroOrMore(property).As("properties")
  .EndScope(Token("}"));

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
  .Ignore()
  .ZeroOrMore(categoryState).As("contents");

const categoryBlock = new SyntaxElement("category_block")
  .AsNode("CategoryBlock")
  .Token(/Category/i)
  .BeginScope(Token("{"))
  .Expects(categoryBody)
  .EndScope(Token("}"));

// --- Top-Level Structure ---
const fallbackDecl = new SyntaxElement("fallback_decl")
  .AsNode("FallbackDecl")
  .Token(/Fallback/i)
  .ExpectsOneOfStrict(string, StrictLiteral(/Off/i, id_exp)).As("value");

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
  .Ignore()
  .ZeroOrMore(shaderBodyElement).As("contents");

const root = new SyntaxElement("_root")
  .Token(/Shader/i)
  .Expects(string).As("shaderName")
  .BeginScope(Token("{"))
  .Expects(shaderBody)
  .EndScope(Token("}"));`;

export const DEFAULT_AST_CODE = `// --- Optional AST Transformer ---
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

export const DEFAULT_SCOPE_RESOLVER_CODE = `// --- Custom Lexical Scope Resolver ---
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
