export const DEFAULT_CODE = `
/* 
Unity ShaderLab Shader Parser Grammar
💡 GREEDY CHOICE: OneOff picks the first match. 
💡 AUTOMATED RECOVERY: The parser automatically derives recovery boundaries from ending literals 
   and dynamically heals malformed blocks using active EndScope boundaries!
*/

const ws = /\s+/;
const comment = /\/\/.*|\/\*[\s\S]*?\*\//;
const lineWs = /[ \t]+/;

const leadingTrivia = Element('leading_trivia').ZeroOrMore(ws, comment);
const trailingTrivia = Element('trailing_trivia')
  .ZeroOrMore(lineWs, comment)
  .Optional(/\r?\n/);

DefaultLeadingTrivia(leadingTrivia);
DefaultTrailingTrivia(trailingTrivia);

// --- Section 10: Primitives ---
const id_exp = /[a-zA-Z_][a-zA-Z0-9_]*/;
const id = Token(id_exp, "id");
const number = Token(/-?(?:[0-9]*\.[0-9]+(?:[eE][+-]?[0-9]+)?|[0-9]+(?:[eE][+-]?[0-9]+)?|[0-9]+)/, "number");
const integerLiteral = Token(/-?[0-9]+/, "integerLiteral");

const string = Element("string")
  .BeginScope('"')
  .Expects(/([^"\\]|\\.)*/)
  .EndScope('"');

const vectorLiteral = Element("vector_literal")
  .AsNode("VectorLiteral")
  .BeginScope(Token("("))
  .Expects(number).As("x")
  .Token(",")
  .Expects(number).As("y")
  .Token(",")
  .Expects(number).As("z")
  .Token(",")
  .Expects(number).As("w")
  .EndScope(Token(")"));

const colorLiteral = Element("color_literal")
  .AsNode("ColorLiteral")
  .BeginScope(Token("("))
  .Expects(number).As("r")
  .Token(",")
  .Expects(number).As("g")
  .Token(",")
  .Expects(number).As("b")
  .Token(",")
  .Expects(number).As("a")
  .EndScope(Token(")"));

// --- Property Reference ---
const propRef = Element("prop_ref")
  .AsNode("PropertyReference")
  .BeginScope(Token("["))
  .Expects(id).As("name")
  .EndScope(Token("]"));

// --- Section 6: Render State Commands ---

// 6.1 Blend
const blendFactor = Element("blend_factor")
  .AsNode("BlendFactor")
  .OneOffToken(
    propRef,
    LiteralMatch(/OneMinusSrcColor/i, id_exp),
    LiteralMatch(/OneMinusSrcAlpha/i, id_exp),
    LiteralMatch(/OneMinusDstColor/i, id_exp),
    LiteralMatch(/OneMinusDstAlpha/i, id_exp),
    LiteralMatch(/SrcAlphaSaturate/i, id_exp),
    LiteralMatch(/SrcColor/i, id_exp),
    LiteralMatch(/SrcAlpha/i, id_exp),
    LiteralMatch(/DstColor/i, id_exp),
    LiteralMatch(/DstAlpha/i, id_exp),
    LiteralMatch(/One/i, id_exp),
    LiteralMatch(/Zero/i, id_exp)
  );

const renderTargetIndex = integerLiteral;

const blendCommand = Element("blend_command")
  .AsNode("BlendCommand")
  .Token(LiteralMatch(/Blend/i, id_exp))
  .OneOffToken(
    LiteralMatch(/Off/i, id_exp),
    Element("blend_args")
      .Ignore()
      .Optional(renderTargetIndex).As("rtIndex")
      .Expects(blendFactor).As("src")
      .Expects(blendFactor).As("dst")
      .Optional(
        Element("blend_alpha")
          .Ignore()
          .Token(",")
          .Expects(blendFactor).As("srcAlpha")
          .Expects(blendFactor).As("dstAlpha")
      )
  );

// --- 6.2 BlendOp
const blendOperation = Element("blend_operation")
  .AsNode("BlendOperation")
  .OneOffToken(
    LiteralMatch(/LogicalAndReverse/i, id_exp),
    LiteralMatch(/LogicalAndInverted/i, id_exp),
    LiteralMatch(/LogicalOrReverse/i, id_exp),
    LiteralMatch(/LogicalOrInverted/i, id_exp),
    LiteralMatch(/LogicalCopyInverted/i, id_exp),
    LiteralMatch(/LogicalClear/i, id_exp),
    LiteralMatch(/LogicalSet/i, id_exp),
    LiteralMatch(/LogicalCopy/i, id_exp),
    LiteralMatch(/LogicalNoop/i, id_exp),
    LiteralMatch(/LogicalInvert/i, id_exp),
    LiteralMatch(/LogicalAnd/i, id_exp),
    LiteralMatch(/LogicalNand/i, id_exp),
    LiteralMatch(/LogicalOr/i, id_exp),
    LiteralMatch(/LogicalNor/i, id_exp),
    LiteralMatch(/LogicalXor/i, id_exp),
    LiteralMatch(/LogicalEquiv/i, id_exp),
    LiteralMatch(/Multiply/i, id_exp),
    LiteralMatch(/Screen/i, id_exp),
    LiteralMatch(/Overlay/i, id_exp),
    LiteralMatch(/Darken/i, id_exp),
    LiteralMatch(/Lighten/i, id_exp),
    LiteralMatch(/ColorDodge/i, id_exp),
    LiteralMatch(/ColorBurn/i, id_exp),
    LiteralMatch(/HardLight/i, id_exp),
    LiteralMatch(/SoftLight/i, id_exp),
    LiteralMatch(/Difference/i, id_exp),
    LiteralMatch(/Exclusion/i, id_exp),
    LiteralMatch(/HSLHue/i, id_exp),
    LiteralMatch(/HSLSaturation/i, id_exp),
    LiteralMatch(/HSLColor/i, id_exp),
    LiteralMatch(/HSLLuminosity/i, id_exp),
    LiteralMatch(/RevSub/i, id_exp),
    LiteralMatch(/Add/i, id_exp),
    LiteralMatch(/Sub/i, id_exp),
    LiteralMatch(/Min/i, id_exp),
    LiteralMatch(/Max/i, id_exp)
  );

const blendOpCommand = Element("blend_op_command")
  .AsNode("BlendOpCommand")
  .Token(LiteralMatch(/BlendOp/i, id_exp))
  .Optional(renderTargetIndex).As("rtIndex")
  .Expects(blendOperation).As("op")
  .Optional(
    Element("blend_op_alpha")
      .Ignore()
      .Token(",")
      .Expects(blendOperation).As("opAlpha")
  );

// 6.3 ZWrite
const onOffValue = Element("on_off_value")
  .AsNode("OnOffValue")
  .OneOffToken(
    propRef,
    LiteralMatch(/On/i, id_exp),
    LiteralMatch(/Off/i, id_exp)
  );

const zWriteCommand = Element("zwrite_command")
  .AsNode("ZWriteCommand")
  .Token(LiteralMatch(/ZWrite/i, id_exp))
  .Expects(onOffValue).As("value");

// 6.4 ZTest
const compareFunction = Element("compare_function")
  .AsNode("CompareFunction")
  .OneOffToken(
    propRef,
    LiteralMatch(/LEqual/i, id_exp),
    LiteralMatch(/GEqual/i, id_exp),
    LiteralMatch(/Less/i, id_exp),
    LiteralMatch(/Greater/i, id_exp),
    LiteralMatch(/Equal/i, id_exp),
    LiteralMatch(/NotEqual/i, id_exp),
    LiteralMatch(/Always/i, id_exp),
    LiteralMatch(/Never/i, id_exp),
    LiteralMatch(/Off/i, id_exp)
  );

const zTestCommand = Element("ztest_command")
  .AsNode("ZTestCommand")
  .Token(LiteralMatch(/ZTest/i, id_exp))
  .Expects(compareFunction).As("func");

// 6.5 ZClip
const zClipCommand = Element("zclip_command")
  .AsNode("ZClipCommand")
  .Token(LiteralMatch(/ZClip/i, id_exp))
  .Expects(onOffValue).As("value");

// 6.6 Cull
const cullMode = Element("cull_mode")
  .AsNode("CullMode")
  .OneOffToken(
    propRef,
    LiteralMatch(/Back/i, id_exp),
    LiteralMatch(/Front/i, id_exp),
    LiteralMatch(/Off/i, id_exp)
  );

const cullCommand = Element("cull_command")
  .AsNode("CullCommand")
  .Token(LiteralMatch(/Cull/i, id_exp))
  .Expects(cullMode).As("mode");

// 6.7 Offset
const offsetValue = Element("offset_value")
  .AsNode("OffsetValue")
  .OneOff(
    propRef,
    number
  );

const offsetCommand = Element("offset_command")
  .AsNode("OffsetCommand")
  .Token(LiteralMatch(/Offset/i, id_exp))
  .Expects(offsetValue).As("factor")
  .Token(",")
  .Expects(offsetValue).As("units");

// 6.8 ColorMask
const colorMaskChannels = Token(/[RGBA]+/i);

const colorMaskValue = Element("color_mask_value")
  .AsNode("ColorMaskValue")
  .OneOff(
    propRef,
    integerLiteral,
    colorMaskChannels,
    Token(LiteralMatch(/0/, id_exp))
  );

const colorMaskCommand = Element("color_mask_command")
  .AsNode("ColorMaskCommand")
  .Token(LiteralMatch(/ColorMask/i, id_exp))
  .Expects(colorMaskValue).As("mask")
  .Optional(renderTargetIndex).As("rtIndex");

// 6.9 AlphaToMask
const alphaToMaskCommand = Element("alpha_to_mask_command")
  .AsNode("AlphaToMaskCommand")
  .Token(LiteralMatch(/AlphaToMask/i, id_exp))
  .Expects(onOffValue).As("value");

// 6.10 Stencil Block
const stencilValue = Element("stencil_value")
  .AsNode("StencilValue")
  .OneOff(
    propRef,
    integerLiteral
  );

const stencilOpValue = Element("stencil_op_value")
  .AsNode("StencilOpValue")
  .OneOffToken(
    propRef,
    LiteralMatch(/Keep/i, id_exp),
    LiteralMatch(/Zero/i, id_exp),
    LiteralMatch(/Replace/i, id_exp),
    LiteralMatch(/IncrSat/i, id_exp),
    LiteralMatch(/DecrSat/i, id_exp),
    LiteralMatch(/Invert/i, id_exp),
    LiteralMatch(/IncrWrap/i, id_exp),
    LiteralMatch(/DecrWrap/i, id_exp)
  );

const stencilRef = Element("stencil_ref").AsNode("StencilRef").Token(LiteralMatch(/Ref/i, id_exp)).Expects(stencilValue).As("val");
const stencilReadMask = Element("stencil_read_mask").AsNode("StencilReadMask").Token(LiteralMatch(/ReadMask/i, id_exp)).Expects(stencilValue).As("val");
const stencilWriteMask = Element("stencil_write_mask").AsNode("StencilWriteMask").Token(LiteralMatch(/WriteMask/i, id_exp)).Expects(stencilValue).As("val");

const stencilComp = Element("stencil_comp").AsNode("StencilComp").Token(LiteralMatch(/Comp/i, id_exp)).Expects(compareFunction).As("func");
const stencilPass = Element("stencil_pass").AsNode("StencilPass").Token(LiteralMatch(/Pass/i, id_exp)).Expects(stencilOpValue).As("op");
const stencilFail = Element("stencil_fail").AsNode("StencilFail").Token(LiteralMatch(/Fail/i, id_exp)).Expects(stencilOpValue).As("op");
const stencilZFail = Element("stencil_zfail").AsNode("StencilZFail").Token(LiteralMatch(/ZFail/i, id_exp)).Expects(stencilOpValue).As("op");

const stencilCompBack = Element("stencil_comp_back").AsNode("StencilCompBack").Token(LiteralMatch(/CompBack/i, id_exp)).Expects(compareFunction).As("func");
const stencilPassBack = Element("stencil_pass_back").AsNode("StencilPassBack").Token(LiteralMatch(/PassBack/i, id_exp)).Expects(stencilOpValue).As("op");
const stencilFailBack = Element("stencil_fail_back").AsNode("StencilFailBack").Token(LiteralMatch(/FailBack/i, id_exp)).Expects(stencilOpValue).As("op");
const stencilZFailBack = Element("stencil_zfail_back").AsNode("StencilZFailBack").Token(LiteralMatch(/ZFailBack/i, id_exp)).Expects(stencilOpValue).As("op");

const stencilCompFront = Element("stencil_comp_front").AsNode("StencilCompFront").Token(LiteralMatch(/CompFront/i, id_exp)).Expects(compareFunction).As("func");
const stencilPassFront = Element("stencil_pass_front").AsNode("StencilPassFront").Token(LiteralMatch(/PassFront/i, id_exp)).Expects(stencilOpValue).As("op");
const stencilFailFront = Element("stencil_fail_front").AsNode("StencilFailFront").Token(LiteralMatch(/FailFront/i, id_exp)).Expects(stencilOpValue).As("op");
const stencilZFailFront = Element("stencil_zfail_front").AsNode("StencilZFailFront").Token(LiteralMatch(/ZFailFront/i, id_exp)).Expects(stencilOpValue).As("op");

const stencilState = Element("stencil_state")
  .OneOff(
    stencilCompBack, stencilPassBack, stencilFailBack, stencilZFailBack,
    stencilCompFront, stencilPassFront, stencilFailFront, stencilZFailFront,
    stencilRef, stencilReadMask, stencilWriteMask,
    stencilComp, stencilPass, stencilFail, stencilZFail
  );

const stencilBlock = Element("stencil_block")
  .AsNode("StencilBlock")
  .Token(/Stencil/i)
  .BeginScope(Token("{"))
  .ZeroOrMore(stencilState).As("states")
  .EndScope(Token("}"));

// 6.11 ColorMaterial (legacy)
const colorMaterialCommand = Element("color_material_command")
  .AsNode("ColorMaterialCommand")
  .Token(LiteralMatch(/ColorMaterial/i, id_exp))
  .OneOffToken(
    LiteralMatch(/AmbientAndDiffuse/i, id_exp),
    LiteralMatch(/Emission/i, id_exp)
  ).As("value");

// 6.12 Lighting (legacy)
const lightingCommand = Element("lighting_command")
  .AsNode("LightingCommand")
  .Token(LiteralMatch(/Lighting/i, id_exp))
  .Expects(onOffValue).As("value");

// 6.13 Conservative Rasterization
const conservativeCommand = Element("conservative_command")
  .AsNode("ConservativeCommand")
  .Token(LiteralMatch(/Conservative/i, id_exp))
  .Expects(onOffValue).As("value");

// 6.14 AlphaTest (legacy)
const alphaTestValue = Element("alpha_test_value")
  .AsNode("AlphaTestValue")
  .OneOff(
    propRef,
    number
  );

const alphaTestMode = Element("alpha_test_mode")
  .AsNode("AlphaTestMode")
  .Expects(compareFunction).As("func")
  .Expects(alphaTestValue).As("val");

const alphaTestCommand = Element("alpha_test_command")
  .AsNode("AlphaTestCommand")
  .Token(LiteralMatch(/AlphaTest/i, id_exp))
  .OneOffToken(
    LiteralMatch(/Off/i, id_exp),
    alphaTestMode
  ).As("mode");

// 6.15 Fog Block (legacy)
const fogMode = Element("fog_mode")
  .AsNode("FogMode")
  .OneOffToken(
    LiteralMatch(/Off/i, id_exp),
    LiteralMatch(/Global/i, id_exp),
    LiteralMatch(/Linear/i, id_exp),
    LiteralMatch(/Exp2/i, id_exp),
    LiteralMatch(/Exp/i, id_exp)
  );

const fogStateRange = Element("fog_state_range")
  .Ignore()
  .Token(LiteralMatch(/Range/i, id_exp))
  .Expects(number).As("min")
  .Token(",")
  .Expects(number).As("max");

const fogState = Element("fog_state")
  .AsNode("FogState")
  .OneOff(
    Element("fog_state_mode").Ignore().Token(LiteralMatch(/Mode/i, id_exp)).Expects(fogMode).As("mode"),
    Element("fog_state_color").Ignore().Token(/Color/i).Expects(vectorLiteral).As("color"),
    Element("fog_state_density").Ignore().Token(LiteralMatch(/Density/i, id_exp)).Expects(number).As("density"),
    fogStateRange
  );

const fogBlock = Element("fog_block")
  .AsNode("FogBlock")
  .Token(/Fog/i)
  .BeginScope(Token("{"))
  .ZeroOrMore(fogState).As("states")
  .EndScope(Token("}"));

// 6.16 SeparateSpecular (legacy)
const separateSpecularCommand = Element("separate_specular_command")
  .AsNode("SeparateSpecularCommand")
  .Token(LiteralMatch(/SeparateSpecular/i, id_exp))
  .Expects(onOffValue).As("value");

// Render State Groupings
const renderState = Element("render_state")
  .OneOff(
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
const lodDecl = Element("lod_decl")
  .AsNode("LODDecl")
  .Token(LiteralMatch(/LOD/i, id_exp))
  .Expects(integerLiteral).As("value");

// --- Section 3: Tags Block ---
const tagEntry = Element("tag_entry")
  .AsNode("TagEntry")
  .Expects(string).As("key")
  .Token("=")
  .Expects(string).As("value");

const tagsBlock = Element("tags_block")
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

const programBlock = Element("program_block")
  .AsNode("ProgramBlock")
  .OneOff(
    cgProgram,
    hlslProgram,
    glslProgram,
    cgInclude,
    hlslInclude,
    glslInclude
  );

const includeBlock = Element("include_block")
  .AsNode("IncludeBlock")
  .OneOff(
    cgInclude,
    hlslInclude,
    glslInclude
  );

// --- Section 5: Pass Types ---
const nameDecl = Element("name_decl")
  .AsNode("NameDecl")
  .Token(/Name/i)
  .Expects(string).As("value");

const passState = Element("pass_state")
  .OneOff(
    tagsBlock,
    nameDecl,
    lodDecl,
    renderState,
    includeBlock,
    programBlock
  );

const passBody = Element("pass_body")
  .Ignore()
  .ZeroOrMore(passState).As("contents");

const pass = Element("pass")
  .AsNode("Pass")
  .Token(/Pass/i)
  .BeginScope(Token("{"))
  .Expects(passBody)
  .EndScope(Token("}"));

const grabPass = Element("grab_pass")
  .AsNode("GrabPass")
  .Token(/GrabPass/i)
  .BeginScope(Token("{"))
  .Optional(string).As("textureName")
  .EndScope(Token("}"));

const usePass = Element("use_pass")
  .AsNode("UsePass")
  .Token(/UsePass/i)
  .Expects(string).As("passName");

// --- Section 2: SubShader ---
const subShaderContent = Element("subshader_content")
  .OneOff(
    pass,
    grabPass,
    usePass,
    includeBlock
  );

const subShaderState = Element("subshader_state")
  .OneOff(
    tagsBlock,
    lodDecl,
    renderState,
    includeBlock,
    subShaderContent
  );

const subShaderBody = Element("subshader_body")
  .Ignore()
  .ZeroOrMore(subShaderState).As("contents");

const subShader = Element("subshader")
  .AsNode("SubShader")
  .Token(/SubShader/i)
  .BeginScope(Token("{"))
  .Expects(subShaderBody)
  .EndScope(Token("}"));

// --- Section 1: Properties Block ---
const propertyName = id;

const attributeArg = Element("attribute_arg")
  .AsNode("AttributeArg")
  .OneOff(
    string,
    number,
    id
  );

const attributeContent = Element("attribute_content")
  .AsNode("AttributeContent")
  .Expects(id).As("name")
  .Optional(
    Element("attribute_args_block")
      .Ignore()
      .BeginScope(Token("("))
      .Expects(attributeArg).As("firstArg")
      .ZeroOrMoreToken(Element("attribute_arg_comma").Token(",").Expects(attributeArg)).As("moreArgs")
      .EndScope(Token(")"))
  );

const attribute = Element("attribute")
  .AsNode("Attribute")
  .BeginScope(Token("["))
  .Expects(attributeContent)
  .EndScope(Token("]"));

const rangeType = Element("range_type")
  .AsNode("RangeType")
  .Token(/Range/i)
  .BeginScope(Token("("))
  .Expects(number).As("min")
  .Token(",")
  .Expects(number).As("max")
  .EndScope(Token(")"));

const propertyType = Element("property_type")
  .AsNode("PropertyType")
  .OneOffToken(
    rangeType,
    LiteralMatch(/CubeArray/i, id_exp),
    LiteralMatch(/2DArray/i, id_exp),
    LiteralMatch(/Color/i, id_exp),
    LiteralMatch(/3D/i, id_exp),
    LiteralMatch(/2D/i, id_exp),
    LiteralMatch(/Cube/i, id_exp),
    LiteralMatch(/Integer/i, id_exp),
    LiteralMatch(/Int/i, id_exp),
    LiteralMatch(/Float/i, id_exp),
    LiteralMatch(/Vector/i, id_exp),
    LiteralMatch(/Any/i, id_exp)
  );

const textureOptions = Element("texture_options")
  .Ignore()
  .ZeroOrMore(id);

const textureDefault = Element("texture_default")
  .AsNode("TextureDefault")
  .Expects(string).As("texName")
  .BeginScope(Token("{"))
  .Expects(textureOptions).As("options")
  .EndScope(Token("}"));

const propertyDefault = Element("property_default")
  .AsNode("PropertyDefault")
  .OneOff(
    vectorLiteral,
    colorLiteral,
    textureDefault,
    number
  );

const property = Element("property")
  .AsNode("Property")
  .ZeroOrMore(attribute).As("attributes")
  .Expects(propertyName).As("name")
  .BeginScope(Token("("))
  .Expects(string).As("displayName")
  .Token(",")
  .Expects(propertyType).As("type")
  .EndScope(Token(")"))
  .Token("=")
  .Expects(propertyDefault).As("defaultValue");

const propertiesBlock = Element("properties_block")
  .AsNode("PropertiesBlock")
  .Token(/Properties/i)
  .BeginScope(Token("{"))
  .ZeroOrMore(property).As("properties")
  .EndScope(Token("}"));

// --- Section 9: Category Block (legacy) ---

const categoryState = Element("category_state")
  .OneOff(
    subShader,
    tagsBlock,
    lodDecl,
    renderState,
    includeBlock,
    programBlock
  );

const categoryBody = Element("category_body")
  .Ignore()
  .ZeroOrMore(categoryState).As("contents");

const categoryBlock = Element("category_block")
  .AsNode("CategoryBlock")
  .Token(/Category/i)
  .BeginScope(Token("{"))
  .Expects(categoryBody)
  .EndScope(Token("}"));

// --- Top-Level Structure ---
const fallbackDecl = Element("fallback_decl")
  .AsNode("FallbackDecl")
  .Token(LiteralMatch(/Fallback/i, id_exp))
  .OneOffToken(string, LiteralMatch(/Off/i, id_exp)).As("value");

const customEditorDecl = Element("custom_editor_decl")
  .AsNode("CustomEditorDecl")
  .Token(/CustomEditor/i)
  .Expects(string).As("value");

const shaderBodyElement = Element("shader_element")
  .OneOff(
    propertiesBlock,
    subShader,
    categoryBlock,
    fallbackDecl,
    customEditorDecl
  );

const shaderBody = Element("shader_body")
  .Ignore()
  .ZeroOrMore(shaderBodyElement).As("contents");

const root = Element("_root")
  .Token(/Shader/i)
  .Expects(string).As("shaderName")
  .BeginScope(Token("{"))
  .Expects(shaderBody)
  .EndScope(Token("}"));
`;

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
// Return transformed AST
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
