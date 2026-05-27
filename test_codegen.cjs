const { SyntaxElement } = require('./src/lib/syntax-element');
const { generateParserAndAstCSharpCode, generateCoreCSharpCode, generateStronglyTypedAstClasses } = require('./src/lib/codegen');
const fs = require('fs');

const ws = new SyntaxElement('ws').ExpectsWhitespace().Hide();
const comment = new SyntaxElement('line_comment').Expects(/\/\/.*|\/\*[\s\S]*?\*\//).Hide();
const s = new SyntaxElement('s').ZeroOrMore(new SyntaxElement('n').ExpectsOneOf(ws, comment)).Hide();
const id = new SyntaxElement('id').Expects(/[a-zA-Z_][a-zA-Z0-9_]*/);

const hlslType = new SyntaxElement('hlsl_type').ExpectsOneOf('float4', 'float3', 'float2', 'float', 'half4', 'half3', 'half2', 'half', 'fixed4', 'fixed3', 'fixed2', 'fixed', 'int', 'uint', 'bool', 'sampler2D', 'samplerCUBE', 'void', id);

const arraySpec = new SyntaxElement('array_spec').Expects('[').Optional(s).Optional(new SyntaxElement('arr_size').Expects(/[0-9]+/).Optional(s).Expects(']'));
const semantic = new SyntaxElement('semantic').Expects(':').Optional(s).Expects(id);

const varDecl = new SyntaxElement('var_decl')
  .Expects(hlslType).Expects(s).Expects(id)
  .Optional(new SyntaxElement('opt_array').Optional(s).Expects(arraySpec))
  .Optional(new SyntaxElement('sem_opt').Optional(s).Expects(semantic))
  .Optional(s).Expects(';');

const structMember = new SyntaxElement('struct_member').Optional(s).ExpectsOneOf(varDecl, comment);

const structDecl = new SyntaxElement('struct')
  .Expects('struct').Expects(s).Expects(id).Optional(s).BeginScope('{')
  .ZeroOrMore(new SyntaxElement('struct_member_wrapper').Optional(s).Expects(structMember))
  .Optional(s).EndScope('}').Optional(s).Expects(';');

const codeBlock = new SyntaxElement('code_block').BeginScope('{').Optional(/[^}]*/).EndScope('}');

const funcDecl = new SyntaxElement('function')
  .Expects(hlslType).Expects(s).Expects(id).Optional(s).Expects('(').Optional(s).Optional(s).Optional(s).Expects(')')
  .Optional(new SyntaxElement('sem_opt').Optional(s).Expects(semantic))
  .Optional(s).Expects(codeBlock);

const directive = new SyntaxElement('directive').Expects(/#[a-zA-Z]+[^\r\n]*/);

const hlslStmt = new SyntaxElement('hlsl_stmt')
  .Unexpects('ENDCG').Unexpects('ENDHLSL')
  .ExpectsOneOf(structDecl, funcDecl, varDecl, directive);

const hlslBlock = new SyntaxElement('hlsl_block')
  .ExpectsOneOf('CGPROGRAM', 'HLSLPROGRAM').Optional(s)
  .ZeroOrMore(new SyntaxElement('hlsl_item').Optional(s).Expects(hlslStmt))
  .Optional(s).ExpectsOneOf('ENDCG', 'ENDHLSL');

const csharpCode = generateCoreCSharpCode("TestNamespace") + "\n" + generateParserAndAstCSharpCode(hlslBlock, "TestNamespace") + "\n" + generateStronglyTypedAstClasses(hlslBlock, "TestNamespace");

fs.writeFileSync('ParserTest.cs', csharpCode);
console.log("Written to ParserTest.cs");
