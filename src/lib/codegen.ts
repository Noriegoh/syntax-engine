import { SyntaxElement } from './syntax-element';
import { ScopeBuilder } from './scope';

/**
 * Normalizes a string to be a safe C# identifier.
 */
function sanitize(name: string): string {
  if (!name) return "";
  const parts = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // split camelCase
    .replace(/[^a-zA-Z0-9]/g, ' ')          // replace non-alphanumeric with spaces
    .split(/\s+/)
    .filter(Boolean);
  
  if (parts.length === 0) return "_";
  
  const result = parts
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
  
  if (/^[0-9]/.test(result)) {
    return '_' + result;
  }
  return result;
}

/**
 * Escapes strings for C# code literal initialization.
 */
function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Escapes regex pattern for C# verbatims.
 */
function escapeRegex(pattern: RegExp): string {
  return pattern.source.replace(/"/g, '""');
}

/**
 * Collects all unique SyntaxElements reachable from root.
 */
function collectElements(root: SyntaxElement): SyntaxElement[] {
  const visited = new Set<number>();
  const elements: SyntaxElement[] = [];

  function visit(el: SyntaxElement) {
    if (!el || visited.has(el.id)) return;
    visited.add(el.id);
    elements.push(el);

    for (const rule of el.rules) {
      if (rule.type === 'element' && rule.value instanceof SyntaxElement) {
        visit(rule.value);
      } else if (rule.type === 'choice') {
        for (const child of rule.value) {
          if (child instanceof SyntaxElement) {
            visit(child);
          }
        }
      } else if (
        rule.type === 'optional' ||
        rule.type === 'zeroOrMore' ||
        rule.type === 'oneOrMore' ||
        rule.type === 'not'
      ) {
        if (rule.value instanceof SyntaxElement) {
          visit(rule.value);
        }
      }
    }
  }

  visit(root);
  return elements;
}

/**
 * Formats a speculative match in C# for nested rules like Choice, Optional, ZeroOrMore.
 */
function compileSpeculativeMatch(
  pattern: any,
  ruleId: number,
  varId: number,
  childElements: Set<string>
): { code: string; matchedName: string; parsedAstName: string; newOffsetName: string; precName: string } {
  const mVar = `matched_${varId}`;
  const astVar = `parsedAst_${varId}`;
  const offsetVar = `newOffset_${varId}`;
  const precVar = `prec_${varId}`;

  let code = "";
  if (pattern instanceof RegExp) {
    code = `
                        int lookahead_${varId} = Math.Min(text.Length - currentOffset, 512);
                        string cand_${varId} = text.GetText(currentOffset, lookahead_${varId});
                        var m_${varId} = Regex_Spec_${ruleId}.Match(cand_${varId});
                        bool ${mVar} = (m_${varId}.Success && m_${varId}.Index == 0);
                        GreenNode ${astVar} = ${mVar} ? GreenNode.Create(NodeType.Token, m_${varId}.Value, ${ruleId}, m_${varId}.Value.Length) : null;
                        int ${offsetVar} = ${mVar} ? currentOffset + m_${varId}.Value.Length : currentOffset;
                        int ${precVar} = 0;`;
  } else if (typeof pattern === 'string') {
    const esc = escapeString(pattern);
    code = `
                        const string lit_${varId} = "${esc}";
                        const int litLen_${varId} = ${pattern.length};
                        bool ${mVar} = (currentOffset + litLen_${varId} <= text.Length && text.GetText(currentOffset, litLen_${varId}) == lit_${varId});
                        GreenNode ${astVar} = ${mVar} ? GreenNode.Create(NodeType.Literal, lit_${varId}, ${ruleId}, litLen_${varId}) : null;
                        int ${offsetVar} = ${mVar} ? currentOffset + litLen_${varId} : currentOffset;
                        int ${precVar} = 0;`;
  } else {
    // SyntaxElement
    const cname = sanitize(pattern.name);
    childElements.add(cname);
    code = `
                        var res_${varId} = Parse_${cname}(text, currentOffset, memo, ctx);
                        bool ${mVar} = res_${varId}.Success;
                        GreenNode ${astVar} = ${mVar} ? res_${varId}.Ast : null;
                        int ${offsetVar} = ${mVar} ? res_${varId}.NewOffset : currentOffset;
                        int ${precVar} = ${pattern.precedence || 0};`;
  }

  return { code, matchedName: mVar, parsedAstName: astVar, newOffsetName: offsetVar, precName: precVar };
}

/**
 * Generates declarative C# ScopeBuilder rules setup.
 */
function generateScopeBuilderConfigCode(scopeBuilder?: ScopeBuilder): string {
  if (!scopeBuilder) {
    return `        public static ScopeBuilder CreateDefault()
        {
            return new ScopeBuilder();
        }`;
  }
  const lines: string[] = [];
  lines.push('        public static ScopeBuilder CreateDefault()');
  lines.push('        {');
  lines.push('            var sb = new ScopeBuilder();');

  const escapeCsString = (str: string) => {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  };

  // 1. Scope Rules
  for (const rule of scopeBuilder.scopeRules) {
    if (typeof rule.nameFn === 'string') {
      lines.push(`            sb.DefineScope("${escapeCsString(rule.type)}", "${escapeCsString(rule.queryStr)}", "${escapeCsString(rule.nameFn)}");`);
    } else {
      lines.push(`            // Functional rule type: ${rule.type}`);
      lines.push(`            // sb.DefineScope("${escapeCsString(rule.type)}", "${escapeCsString(rule.queryStr)}", (captures, raw, match) => ...);`);
    }
  }

  // 2. Symbol Rules
  for (const rule of scopeBuilder.symbolRules) {
    if (rule.isPlural) {
      lines.push(`            // Plural functional symbol rule:`);
      lines.push(`            // sb.DefineSymbols("${escapeCsString(rule.queryStr)}", (captures, raw, match) => ...);`);
    } else if (typeof rule.nameFn === 'string' && typeof rule.kindFn === 'string' && typeof rule.datatypeFn === 'string') {
      lines.push(`            sb.DefineSymbol("${escapeCsString(rule.queryStr)}", "${escapeCsString(rule.nameFn)}", "${escapeCsString(rule.kindFn)}", "${escapeCsString(rule.datatypeFn)}");`);
    } else {
      lines.push(`            // Custom symbol rule mapping:`);
      lines.push(`            // sb.DefineSymbol("${escapeCsString(rule.queryStr)}", nameFn, kindFn, datatypeFn);`);
    }
  }

  // 3. Reference Rules
  for (const rule of scopeBuilder.referenceRules) {
    if (typeof rule.nameFn === 'string') {
      lines.push(`            sb.DefineReference("${escapeCsString(rule.queryStr)}", "${escapeCsString(rule.nameFn)}");`);
    } else {
      lines.push(`            // Functional reference rule:`);
      lines.push(`            // sb.DefineReference("${escapeCsString(rule.queryStr)}", nameFn);`);
    }
  }

  lines.push('            return sb;');
  lines.push('        }');
  return lines.join('\n');
}

/**
 * Generates core classes independently definitions for modular use.
 */
export function generateCoreCSharpCode(namespaceName: string = "SyntaxEngine", scopeBuilder?: ScopeBuilder): string {
  return `using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;

namespace ${namespaceName}
{
    public interface ITextDocument
    {
        int Length { get; }
        string GetText(int start, int length);
        char this[int index] { get; }
    }

    public class StringTextDocument : ITextDocument
    {
        private readonly string _text;
        public int Length => _text.Length;

        public StringTextDocument(string text)
        {
            _text = text ?? "";
        }

        public string GetText(int start, int length)
        {
            if (start < 0 || length <= 0 || start + length > _text.Length) return "";
            return _text.Substring(start, length);
        }

        public char this[int index] => _text[index];

        public override string ToString() => _text;
    }

    public class ParseError
    {
        public string Message { get; set; }
        public int Offset { get; set; }
    }

    public class ParseResult
    {
        public bool Success { get; set; }
        public GreenNode Ast { get; set; }
        public int NewOffset { get; set; }
        public string Error { get; set; }
        public int RuleId { get; set; }
        public List<ParseError> RecoveredErrors { get; set; } = new List<ParseError>();
        public int DependencyLimit { get; set; }

        private AstNode _redAstCache = null;
        public AstNode Root
        {
            get
            {
                if (_redAstCache != null) return _redAstCache;
                if (Ast == null) return null;
                _redAstCache = AstNode.CreateRedNode(Ast, null, 0);
                return _redAstCache;
            }
        }
    }

    public class CSTNode
    {
        public int RuleId { get; set; }
        public int Start { get; set; }
        public int End { get; set; }
        public int DependencyLimit { get; set; }
        public ParseResult Result { get; set; }
    }

    public class SpatialCSTIndex
    {
        public Dictionary<int, Dictionary<int, CSTNode>> NodesByOffset { get; set; } = new Dictionary<int, Dictionary<int, CSTNode>>();
        public int TotalNodes { get; set; } = 0;

        public bool Has(int ruleId, int offset)
        {
            if (NodesByOffset.TryGetValue(offset, out var ruleMap))
            {
                return ruleMap.ContainsKey(ruleId);
            }
            return false;
        }

        public ParseResult Get(int ruleId, int offset)
        {
            if (NodesByOffset.TryGetValue(offset, out var ruleMap))
            {
                if (ruleMap.TryGetValue(ruleId, out var node))
                {
                    return node.Result;
                }
            }
            return null;
        }

        public void Set(int ruleId, int offset, ParseResult result)
        {
            int dependencyLimit = result.DependencyLimit;
            var node = new CSTNode
            {
                RuleId = ruleId,
                Start = offset,
                End = result.NewOffset,
                DependencyLimit = dependencyLimit,
                Result = result
            };

            if (!NodesByOffset.TryGetValue(offset, out var ruleMap))
            {
                ruleMap = new Dictionary<int, CSTNode>();
                NodesByOffset[offset] = ruleMap;
            }

            if (!ruleMap.ContainsKey(ruleId))
            {
                TotalNodes++;
            }
            ruleMap[ruleId] = node;
        }

        public void Clear()
        {
            NodesByOffset.Clear();
            TotalNodes = 0;
        }

        public void ApplyEdit(int editOffset, int removedLength, int delta)
        {
            var nextNodesByOffset = new Dictionary<int, Dictionary<int, CSTNode>>();
            int nextTotalNodes = 0;

            foreach (var kvp in NodesByOffset)
            {
                int startOffset = kvp.Key;
                foreach (var ruleKvp in kvp.Value)
                {
                    int ruleId = ruleKvp.Key;
                    var node = ruleKvp.Value;
                    int dependencyLimit = node.DependencyLimit;

                    // Case 1: Parse started before the edit point
                    if (node.Start < editOffset)
                    {
                        if (dependencyLimit >= editOffset)
                        {
                            continue; // Overlaps with edit, discard
                        }
                        if (!nextNodesByOffset.TryGetValue(node.Start, out var rMap))
                        {
                            rMap = new Dictionary<int, CSTNode>();
                            nextNodesByOffset[node.Start] = rMap;
                        }
                        rMap[ruleId] = node;
                        nextTotalNodes++;
                    }
                    // Case 2: Parse started inside edited/deleted range
                    else if (node.Start >= editOffset && node.Start < editOffset + removedLength)
                    {
                        continue; // Discard completely
                    }
                    // Case 3: Parse started after the edited/deleted range
                    else
                    {
                        int newStart = node.Start + delta;
                        int newEnd = node.End + delta;
                        int newDependencyLimit = node.DependencyLimit + delta;

                        var shiftedResult = new ParseResult
                        {
                            Success = node.Result.Success,
                            NewOffset = node.Result.NewOffset + delta,
                            DependencyLimit = newDependencyLimit,
                            Error = node.Result.Error,
                            RuleId = node.Result.RuleId,
                            Ast = node.Result.Ast, // Identity copy! O(1) shifting under Red-Green design!
                            RecoveredErrors = node.Result.RecoveredErrors?.Select(err => new ParseError
                            {
                                Message = err.Message,
                                Offset = err.Offset + delta
                            }).ToList() ?? new List<ParseError>()
                        };

                        var shiftedNode = new CSTNode
                        {
                            RuleId = ruleId,
                            Start = newStart,
                            End = newEnd,
                            DependencyLimit = newDependencyLimit,
                            Result = shiftedResult
                        };

                        if (!nextNodesByOffset.TryGetValue(newStart, out var rMap))
                        {
                            rMap = new Dictionary<int, CSTNode>();
                            nextNodesByOffset[newStart] = rMap;
                        }
                        rMap[ruleId] = shiftedNode;
                        nextTotalNodes++;
                    }
                }
            }

            NodesByOffset = nextNodesByOffset;
            TotalNodes = nextTotalNodes;
        }
    }

    public class ParserContext
    {
        public int MaxOffset { get; set; } = -1;
        public List<ParseError> RecoveredErrors { get; set; } = new List<ParseError>();
    }

    public interface IParserRunner
    {
        ParseResult Parse(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx);
    }

    public class IncrementalParser
    {
        private ITextDocument _lastText = null;
        private SpatialCSTIndex _memo = new SpatialCSTIndex();
        private ParseResult _lastResult = null;

        public SpatialCSTIndex Memo => _memo;
        public ITextDocument LastText => _lastText;

        public void Clear()
        {
            _lastText = null;
            _memo.Clear();
            _lastResult = null;
        }

        public void ApplyEdit(int editOffset, int removedLength, int insertedLength, ITextDocument newText)
        {
            int delta = insertedLength - removedLength;
            if (removedLength > 0 || insertedLength > 0)
            {
                _memo.ApplyEdit(editOffset, removedLength, delta);
            }
            _lastText = newText;
        }

        public ParseResult Parse(IParserRunner parser, string newText)
        {
            return Parse(parser, new StringTextDocument(newText));
        }

        public ParseResult Parse(IParserRunner parser, ITextDocument newText, int editOffset, int removedLength, int insertedLength)
        {
            ApplyEdit(editOffset, removedLength, insertedLength, newText);
            return Parse(parser);
        }

        public ParseResult Parse(IParserRunner parser, ITextDocument newText)
        {
            if (_lastText == null)
            {
                var context = new ParserContext();
                var res = parser.Parse(newText, 0, _memo, context);
                _lastText = newText;
                _lastResult = res;
                return _lastResult;
            }

            var (editOffset, removedLength, insertedText) = FindDiff(_lastText.GetText(0, _lastText.Length), newText.GetText(0, newText.Length));
            int delta = insertedText.Length - removedLength;

            if (removedLength > 0 || insertedText.Length > 0)
            {
                _memo.ApplyEdit(editOffset, removedLength, delta);
            }

            var ctx = new ParserContext();
            var nextRes = parser.Parse(newText, 0, _memo, ctx);

            _lastText = newText;
            _lastResult = nextRes;
            return _lastResult;
        }

        public ParseResult Parse(IParserRunner parser)
        {
            if (_lastText == null)
            {
                throw new InvalidOperationException("No document has been parsed yet. Call Parse(parser, document) first.");
            }
            var ctx = new ParserContext();
            var nextRes = parser.Parse(_lastText, 0, _memo, ctx);
            _lastResult = nextRes;
            return _lastResult;
        }

        private static (int editOffset, int removedLength, string insertedText) FindDiff(string oldStr, string newStr)
        {
            int prefix = 0;
            while (prefix < oldStr.Length && prefix < newStr.Length && oldStr[prefix] == newStr[prefix])
            {
                prefix++;
            }

            string oldSuffix = oldStr.Substring(prefix);
            string newSuffix = newStr.Substring(prefix);

            int oldLen = oldSuffix.Length;
            int newLen = newSuffix.Length;
            int suffix = 0;
            while (suffix < oldLen && suffix < newLen && oldSuffix[oldLen - 1 - suffix] == newSuffix[newLen - 1 - suffix])
            {
                suffix++;
            }

            int removedLength = oldLen - suffix;
            string insertedText = newSuffix.Substring(0, newLen - suffix);

            return (prefix, removedLength, insertedText);
        }
    }

    #region Scopes & Symbol Definitions

    public class SymbolDefinition
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Kind { get; set; }
        public string Datatype { get; set; }
        public int Start { get; set; }
        public int End { get; set; }
        public AstNode Node { get; set; }
        public string ScopeId { get; set; }
        public List<SymbolReference> References { get; set; } = new List<SymbolReference>();
    }

    public class SymbolReference
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public int Start { get; set; }
        public int End { get; set; }
        public AstNode Node { get; set; }
        public string ScopeId { get; set; }
        public string ResolvedSymbolId { get; set; }
    }

    public class LexicalScope
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Type { get; set; }
        public int Start { get; set; }
        public int End { get; set; }
        public AstNode Node { get; set; }
        public string ParentId { get; set; }
        public List<LexicalScope> Children { get; set; } = new List<LexicalScope>();
        public List<SymbolDefinition> Symbols { get; set; } = new List<SymbolDefinition>();
        public List<SymbolReference> References { get; set; } = new List<SymbolReference>();
    }

    public class QueryCapture
    {
        public string Name { get; set; }
        public AstNode Node { get; set; }
    }

    public class QueryMatch
    {
        public int PatternIndex { get; set; }
        public List<QueryCapture> Captures { get; set; } = new List<QueryCapture>();
        public AstNode Node { get; set; }
    }

    public class QueryPattern
    {
        public string Type { get; set; } // "node", "literal", "wildcard", "alternation"
        public string NodeType { get; set; }
        public string LiteralValue { get; set; }
        public List<QueryPattern> Children { get; set; } = new List<QueryPattern>();
        public List<QueryPattern> Alternatives { get; set; } = new List<QueryPattern>();
        public string Capture { get; set; }
        public string Field { get; set; }
        public char? Quantifier { get; set; } // '*', '+', '?'
        public bool IsDescendant { get; set; }
        public List<QueryPredicate> Predicates { get; set; } = new List<QueryPredicate>();
    }

    public class QueryPredicate
    {
        public string Operator { get; set; } // "#eq?", "#not-eq?", "#match?"
        public string Capture { get; set; }
        public string Value { get; set; }
    }

    public class RelativeQueryCapture
    {
        public string Name { get; set; }
        public List<int> NodePath { get; set; }
    }

    public class RelativeQueryMatch
    {
        public int PatternIndex { get; set; }
        public List<int> NodePath { get; set; }
        public List<RelativeQueryCapture> Captures { get; set; }
    }

    public class CSTQuery
    {
        private static readonly ConditionalWeakTable<GreenNode, Dictionary<CSTQuery, List<RelativeQueryMatch>>> _greenQueryCache =
            new ConditionalWeakTable<GreenNode, Dictionary<CSTQuery, List<RelativeQueryMatch>>>();

        public List<QueryPattern> Patterns { get; set; }

        public CSTQuery(string queryStr)
        {
            Patterns = ParseQuery(queryStr);
        }

        private enum TokenType
        {
            LPAREN, RPAREN, LBRACKET, RBRACKET, STRING, IDENTIFIER, CAPTURE, FIELD, QUANTIFIER, WILDCARD, PREDICATE
        }

        private class QueryToken
        {
            public TokenType Type { get; set; }
            public string Value { get; set; }
        }

        private static List<QueryToken> TokenizeQuery(string queryStr)
        {
            var tokens = new List<QueryToken>();
            int i = 0;
            while (i < queryStr.Length)
            {
                if (char.IsWhiteSpace(queryStr[i]))
                {
                    i++;
                    continue;
                }

                if (queryStr[i] == '(') { tokens.Add(new QueryToken { Type = TokenType.LPAREN, Value = "(" }); i++; continue; }
                if (queryStr[i] == ')') { tokens.Add(new QueryToken { Type = TokenType.RPAREN, Value = ")" }); i++; continue; }
                if (queryStr[i] == '[') { tokens.Add(new QueryToken { Type = TokenType.LBRACKET, Value = "[" }); i++; continue; }
                if (queryStr[i] == ']') { tokens.Add(new QueryToken { Type = TokenType.RBRACKET, Value = "]" }); i++; continue; }

                if (i + 1 < queryStr.Length && queryStr.Substring(i, 2) == "..")
                {
                    tokens.Add(new QueryToken { Type = TokenType.IDENTIFIER, Value = ".." });
                    i += 2;
                    continue;
                }

                if (queryStr[i] == '+' || queryStr[i] == '?')
                {
                    tokens.Add(new QueryToken { Type = TokenType.QUANTIFIER, Value = queryStr[i].ToString() });
                    i++;
                    continue;
                }

                if (queryStr[i] == '*')
                {
                    tokens.Add(new QueryToken { Type = TokenType.WILDCARD, Value = "*" });
                    i++;
                    continue;
                }

                if (queryStr[i] == '"' || queryStr[i] == '\\'')
                {
                    char quote = queryStr[i];
                    i++;
                    var val = "";
                    while (i < queryStr.Length && queryStr[i] != quote)
                    {
                        if (queryStr[i] == '\\\\' && i + 1 < queryStr.Length)
                        {
                            val += queryStr[i + 1];
                            i += 2;
                        }
                        else
                        {
                            val += queryStr[i];
                            i++;
                        }
                    }
                    if (i < queryStr.Length) i++;
                    tokens.Add(new QueryToken { Type = TokenType.STRING, Value = val });
                    continue;
                }

                if (queryStr[i] == '@')
                {
                    i++;
                    var val = "";
                    while (i < queryStr.Length && (char.IsLetterOrDigit(queryStr[i]) || queryStr[i] == '_' || queryStr[i] == '-'))
                    {
                        val += queryStr[i];
                        i++;
                    }
                    tokens.Add(new QueryToken { Type = TokenType.CAPTURE, Value = val });
                    continue;
                }

                if (queryStr[i] == ';')
                {
                    while (i < queryStr.Length && queryStr[i] != '\n') i++;
                    continue;
                }

                int start = i;
                while (i < queryStr.Length && (char.IsLetterOrDigit(queryStr[i]) || queryStr[i] == '_' || queryStr[i] == '-' || queryStr[i] == '.' || queryStr[i] == '#'))
                {
                    i++;
                }

                if (i < queryStr.Length && queryStr[i] == '?')
                {
                    i++;
                }

                if (i < queryStr.Length && queryStr[i] == ':')
                {
                    tokens.Add(new QueryToken { Type = TokenType.FIELD, Value = queryStr.Substring(start, i - start) });
                    i++;
                    continue;
                }

                string chunk = queryStr.Substring(start, i - start);
                if (string.IsNullOrEmpty(chunk))
                {
                    i++;
                    continue;
                }

                if (chunk == "_")
                {
                    tokens.Add(new QueryToken { Type = TokenType.WILDCARD, Value = "_" });
                }
                else if (chunk.StartsWith("#"))
                {
                    tokens.Add(new QueryToken { Type = TokenType.PREDICATE, Value = chunk });
                }
                else
                {
                    tokens.Add(new QueryToken { Type = TokenType.IDENTIFIER, Value = chunk });
                }
            }
            return tokens;
        }

        private static QueryPattern ParsePattern(List<QueryToken> tokens, ref int index)
        {
            if (index >= tokens.Count) return null;

            QueryPattern pattern = null;
            string field = null;

            if (tokens[index].Type == TokenType.FIELD)
            {
                field = tokens[index].Value;
                index++;
            }

            if (index >= tokens.Count) return null;
            var token = tokens[index];

            if (token.Type == TokenType.WILDCARD)
            {
                pattern = new QueryPattern { Type = "wildcard" };
                index++;
            }
            else if (token.Type == TokenType.STRING)
            {
                pattern = new QueryPattern { Type = "literal", LiteralValue = token.Value };
                index++;
            }
            else if (token.Type == TokenType.IDENTIFIER)
            {
                pattern = new QueryPattern { Type = "node", NodeType = token.Value };
                index++;
            }
            else if (token.Type == TokenType.LBRACKET)
            {
                index++;
                var alts = new List<QueryPattern>();
                while (index < tokens.Count && tokens[index].Type != TokenType.RBRACKET)
                {
                    var alt = ParsePattern(tokens, ref index);
                    if (alt != null) alts.Add(alt);
                    else index++;
                }
                if (index < tokens.Count) index++;
                pattern = new QueryPattern { Type = "alternation", Alternatives = alts };
            }
            else if (token.Type == TokenType.LPAREN)
            {
                index++;
                if (index >= tokens.Count) return null;

                var nextToken = tokens[index];
                if (nextToken.Type == TokenType.IDENTIFIER || nextToken.Type == TokenType.WILDCARD)
                {
                    string nodeType = (nextToken.Value == "_" || nextToken.Value == "*") ? null : nextToken.Value;
                    string type = (nextToken.Value == "_" || nextToken.Value == "*") ? "wildcard" : "node";
                    index++;

                    var children = new List<QueryPattern>();
                    var predicates = new List<QueryPredicate>();
                    string innerCapture = null;
                    bool nextIsDescendant = false;

                    while (index < tokens.Count && tokens[index].Type != TokenType.RPAREN)
                    {
                        if (tokens[index].Type == TokenType.LPAREN && index + 1 < tokens.Count && tokens[index + 1].Type == TokenType.PREDICATE)
                        {
                            index += 2;
                            string op = tokens[index - 1].Value;
                            string cap = "";
                            string val = "";

                            while (index < tokens.Count && tokens[index].Type != TokenType.RPAREN)
                            {
                                if (tokens[index].Type == TokenType.CAPTURE)
                                {
                                    cap = tokens[index].Value;
                                    index++;
                                }
                                else if (tokens[index].Type == TokenType.STRING)
                                {
                                    val = tokens[index].Value;
                                    index++;
                                }
                                else
                                {
                                    index++;
                                }
                            }
                            if (index < tokens.Count) index++;
                            predicates.Add(new QueryPredicate { Operator = op, Capture = cap, Value = val });
                        }
                        else if (tokens[index].Type == TokenType.CAPTURE)
                        {
                            innerCapture = tokens[index].Value;
                            index++;
                        }
                        else if (tokens[index].Type == TokenType.IDENTIFIER && tokens[index].Value == "..")
                        {
                            nextIsDescendant = true;
                            index++;
                        }
                        else
                        {
                            var child = ParsePattern(tokens, ref index);
                            if (child != null)
                            {
                                if (nextIsDescendant)
                                {
                                    child.IsDescendant = true;
                                    nextIsDescendant = false;
                                }
                                children.Add(child);
                            }
                            else
                            {
                                index++;
                            }
                        }
                    }
                    if (index < tokens.Count) index++;

                    pattern = new QueryPattern { Type = type, NodeType = nodeType, Children = children, Predicates = predicates };
                    if (!string.IsNullOrEmpty(innerCapture)) pattern.Capture = innerCapture;
                }
                else
                {
                    pattern = ParsePattern(tokens, ref index);
                    if (pattern != null)
                    {
                        while (index < tokens.Count && tokens[index].Type != TokenType.RPAREN)
                        {
                            if (tokens[index].Type == TokenType.LPAREN && index + 1 < tokens.Count && tokens[index + 1].Type == TokenType.PREDICATE)
                            {
                                index += 2;
                                string op = tokens[index - 1].Value;
                                string cap = "";
                                string val = "";

                                while (index < tokens.Count && tokens[index].Type != TokenType.RPAREN)
                                {
                                    if (tokens[index].Type == TokenType.CAPTURE)
                                    {
                                        cap = tokens[index].Value;
                                        index++;
                                    }
                                    else if (tokens[index].Type == TokenType.STRING)
                                    {
                                        val = tokens[index].Value;
                                        index++;
                                    }
                                    else
                                    {
                                        index++;
                                    }
                                }
                                if (index < tokens.Count) index++;
                                if (pattern.Predicates == null) pattern.Predicates = new List<QueryPredicate>();
                                pattern.Predicates.Add(new QueryPredicate { Operator = op, Capture = cap, Value = val });
                            }
                            else
                            {
                                index++;
                            }
                        }
                        if (index < tokens.Count) index++;
                    }
                }
            }
            else
            {
                index++;
            }

            if (pattern == null) return null;
            if (!string.IsNullOrEmpty(field)) pattern.Field = field;

            while (index < tokens.Count)
            {
                var postToken = tokens[index];
                if (postToken.Type == TokenType.QUANTIFIER || (postToken.Type == TokenType.WILDCARD && postToken.Value == "*"))
                {
                    pattern.Quantifier = postToken.Value[0];
                    index++;
                }
                else if (postToken.Type == TokenType.CAPTURE)
                {
                    pattern.Capture = postToken.Value;
                    index++;
                }
                else
                {
                    break;
                }
            }

            return pattern;
        }

        public static List<QueryPattern> ParseQuery(string queryStr)
        {
            var tokens = TokenizeQuery(queryStr);
            var patterns = new List<QueryPattern>();
            int index = 0;
            while (index < tokens.Count)
            {
                var pat = ParsePattern(tokens, ref index);
                if (pat != null) patterns.Add(pat);
                else index++;
            }
            return patterns;
        }

        private static List<int> GetPathFromRoot(AstNode node, AstNode root)
        {
            var path = new List<int>();
            var curr = node;
            while (curr != root && curr.Parent != null)
            {
                int index = curr.Parent.Children.IndexOf(curr);
                if (index != -1)
                {
                    path.Add(index);
                }
                else
                {
                    break;
                }
                curr = curr.Parent;
            }
            path.Reverse();
            return path;
        }

        private static AstNode ResolveNodePath(AstNode root, List<int> path)
        {
            var current = root;
            foreach (var idx in path)
            {
                var children = current.Children;
                if (idx < children.Count)
                {
                    current = children[idx];
                }
                else
                {
                    break;
                }
            }
            return current;
        }

        private void RunRecursively(
            AstNode node,
            List<int> path,
            List<RelativeQueryMatch> tempMatches)
        {
            if (node == null) return;

            if (_greenQueryCache.TryGetValue(node.Green, out var cacheMap))
            {
                if (cacheMap.TryGetValue(this, out var cachedSub))
                {
                    foreach (var rel in cachedSub)
                    {
                        var fullNodePath = new List<int>(path);
                        fullNodePath.AddRange(rel.NodePath);

                        var caps = new List<RelativeQueryCapture>();
                        foreach (var c in rel.Captures)
                        {
                            var fullCapPath = new List<int>(path);
                            fullCapPath.AddRange(c.NodePath);
                            caps.Add(new RelativeQueryCapture
                            {
                                Name = c.Name,
                                NodePath = fullCapPath
                            });
                        }

                        tempMatches.Add(new RelativeQueryMatch
                        {
                            PatternIndex = rel.PatternIndex,
                            NodePath = fullNodePath,
                            Captures = caps
                        });
                    }
                    return;
                }
            }

            for (int i = 0; i < Patterns.Count; i++)
            {
                var pat = Patterns[i];
                var captures = new List<QueryCapture>();
                if (ExecutePatternMatch(node, pat, captures))
                {
                    var caps = new List<RelativeQueryCapture>();
                    foreach (var c in captures)
                    {
                        var relPath = GetPathFromRoot(c.Node, node);
                        var fullCapPath = new List<int>(path);
                        fullCapPath.AddRange(relPath);
                        caps.Add(new RelativeQueryCapture
                        {
                            Name = c.Name,
                            NodePath = fullCapPath
                        });
                    }

                    tempMatches.Add(new RelativeQueryMatch
                    {
                        PatternIndex = i,
                        NodePath = new List<int>(path),
                        Captures = caps
                    });
                }
            }

            var children = node.Children;
            for (int idx = 0; idx < children.Count; idx++)
            {
                var child = children[idx];
                if (child != null)
                {
                    var childPath = new List<int>(path) { idx };
                    RunRecursively(child, childPath, tempMatches);
                }
            }
        }

        public List<QueryMatch> Run(AstNode ast)
        {
            if (ast == null) return new List<QueryMatch>();

            if (!_greenQueryCache.TryGetValue(ast.Green, out var cacheMap))
            {
                cacheMap = new Dictionary<CSTQuery, List<RelativeQueryMatch>>();
                _greenQueryCache.Remove(ast.Green);
                _greenQueryCache.Add(ast.Green, cacheMap);
            }

            if (!cacheMap.TryGetValue(this, out var cached))
            {
                var tempMatches = new List<RelativeQueryMatch>();
                var tempRoot = AstNode.CreateRedNode(ast.Green, null, 0);
                RunRecursively(tempRoot, new List<int>(), tempMatches);
                cached = tempMatches;
                cacheMap[this] = cached;
            }

            var results = new List<QueryMatch>();
            foreach (var rel in cached)
            {
                var matchNode = ResolveNodePath(ast, rel.NodePath);
                var caps = new List<QueryCapture>();
                foreach (var cap in rel.Captures)
                {
                    caps.Add(new QueryCapture
                    {
                        Name = cap.Name,
                        Node = ResolveNodePath(ast, cap.NodePath)
                    });
                }

                results.Add(new QueryMatch
                {
                    PatternIndex = rel.PatternIndex,
                    Node = matchNode,
                    Captures = caps
                });
            }

            return results;
        }

        private static bool EvaluatePredicates(QueryPattern pat, List<QueryCapture> captures)
        {
            if (pat.Predicates == null || pat.Predicates.Count == 0) return true;

            foreach (var pred in pat.Predicates)
            {
                var targetCaptures = captures.Where(c => c.Name == pred.Capture).ToList();
                if (targetCaptures.Count == 0) continue;

                foreach (var cap in targetCaptures)
                {
                    string val = GetNodeText(cap.Node);

                    if (pred.Operator == "#eq?")
                    {
                        if (val != pred.Value) return false;
                    }
                    else if (pred.Operator == "#not-eq?")
                    {
                        if (val == pred.Value) return false;
                    }
                    else if (pred.Operator == "#match?")
                    {
                        try
                        {
                            var r = new System.Text.RegularExpressions.Regex(pred.Value);
                            if (!r.IsMatch(val)) return false;
                        }
                        catch { return false; }
                    }
                }
            }
            return true;
        }

        private static string GetNodeText(AstNode n)
        {
            if (n == null) return "";
            return n.Value;
        }

        public static List<AstNode> GetStructuralNodes(AstNode node)
        {
            var result = new List<AstNode>();
            if (node == null) return result;
            
            if (node.Type != NodeType.Whitespace && node.Type != NodeType.Optional && node.Type != NodeType.ZeroOrMore && node.Type != NodeType.OneOrMore)
            {
                result.Add(node);
            }
            else
            {
                foreach (var child in node.Children)
                {
                    result.AddRange(GetStructuralNodes(child));
                }
            }
            return result;
        }

        public class CandInfo
        {
            public AstNode Node { get; set; }
            public bool IsDirect { get; set; }
        }

        public static List<CandInfo> GetPreOrderCandidates(List<AstNode> nodes)
        {
            var result = new List<CandInfo>();
            void Traverse(AstNode n, bool isDirect)
            {
                if (n == null) return;
                result.Add(new CandInfo { Node = n, IsDirect = isDirect });
                var children = GetStructuralNodes(n);
                foreach (var child in children)
                {
                    Traverse(child, false);
                }
            }
            foreach (var n in nodes)
            {
                Traverse(n, true);
            }
            return result;
        }

        private static bool MatchChildren(
            AstNode parent,
            List<CandInfo> candidates,
            List<QueryPattern> childPatterns,
            int childIdx,
            int nodeIdx,
            List<QueryCapture> captures,
            out List<QueryCapture> result)
        {
            result = null;
            if (childIdx >= childPatterns.Count)
            {
                result = captures;
                return true;
            }

            var pat = childPatterns[childIdx];
            char? q = pat.Quantifier;
            bool isDescendantPat = pat.IsDescendant;

            if (!string.IsNullOrEmpty(pat.Field))
            {
                var prop = parent.GetType().GetProperty(pat.Field);
                object targetVal = prop?.GetValue(parent);
                if (targetVal != null)
                {
                    var targetNodes = new List<AstNode>();
                    if (targetVal is AstNode an) targetNodes.Add(an);
                    else if (targetVal is IEnumerable<AstNode> en) targetNodes.AddRange(en);

                    foreach (var tn in targetNodes)
                    {
                        var localCaptures = new List<QueryCapture>();
                        if (ExecutePatternMatch(tn, pat, localCaptures))
                        {
                            var newCaps = new List<QueryCapture>(captures);
                            newCaps.AddRange(localCaptures);
                            if (MatchChildren(parent, candidates, childPatterns, childIdx + 1, nodeIdx, newCaps, out var res))
                            {
                                result = res;
                                return true;
                            }
                        }
                    }
                }

                if (q == '*' || q == '?')
                {
                    if (MatchChildren(parent, candidates, childPatterns, childIdx + 1, nodeIdx, captures, out var res))
                    {
                        result = res;
                        return true;
                    }
                }
                return false;
            }

            for (int i = nodeIdx; i < candidates.Count; i++)
            {
                var cand = candidates[i];
                if (!isDescendantPat && !cand.IsDirect)
                {
                    continue;
                }

                var localCaptures = new List<QueryCapture>();
                if (ExecutePatternMatch(cand.Node, pat, localCaptures))
                {
                    if (q == '?' || q == null)
                    {
                        var newCaps = new List<QueryCapture>(captures);
                        newCaps.AddRange(localCaptures);
                        if (MatchChildren(parent, candidates, childPatterns, childIdx + 1, i + 1, newCaps, out var res))
                        {
                            result = res;
                            return true;
                        }
                    }
                    else if (q == '*' || q == '+')
                    {
                        var modifiedPat = new QueryPattern
                        {
                            Type = pat.Type,
                            NodeType = pat.NodeType,
                            LiteralValue = pat.LiteralValue,
                            Children = pat.Children,
                            Alternatives = pat.Alternatives,
                            Capture = pat.Capture,
                            Field = pat.Field,
                            Quantifier = '*',
                            IsDescendant = pat.IsDescendant,
                            Predicates = pat.Predicates
                        };
                        var newPatterns = new List<QueryPattern>(childPatterns);
                        newPatterns[childIdx] = modifiedPat;

                        var newCaps = new List<QueryCapture>(captures);
                        newCaps.AddRange(localCaptures);
                        if (MatchChildren(parent, candidates, newPatterns, childIdx, i + 1, newCaps, out var res))
                        {
                            result = res;
                            return true;
                        }
                    }
                }
            }

            if (q == '*' || q == '?')
            {
                if (MatchChildren(parent, candidates, childPatterns, childIdx + 1, nodeIdx, captures, out var res))
                {
                    result = res;
                    return true;
                }
            }

            return false;
        }

        public static bool ExecutePatternMatch(AstNode node, QueryPattern pat, List<QueryCapture> captures)
        {
            if (node == null && pat.Type != "wildcard") return false;

            int startCapturesLen = captures.Count;

            if (pat.Type == "wildcard")
            {
                if (!string.IsNullOrEmpty(pat.Capture))
                {
                    captures.Add(new QueryCapture { Name = pat.Capture, Node = node });
                }
                return EvaluatePredicates(pat, captures.Skip(startCapturesLen).ToList());
            }

            if (pat.Type == "literal")
            {
                string textVal = node?.Value;
                if (textVal == pat.LiteralValue)
                {
                    if (!string.IsNullOrEmpty(pat.Capture))
                    {
                        captures.Add(new QueryCapture { Name = pat.Capture, Node = node });
                    }
                    return EvaluatePredicates(pat, captures.Skip(startCapturesLen).ToList());
                }
                return false;
            }

            if (pat.Type == "alternation")
            {
                foreach (var alt in pat.Alternatives)
                {
                    var altCaptures = new List<QueryCapture>();
                    if (ExecutePatternMatch(node, alt, altCaptures))
                    {
                        captures.AddRange(altCaptures);
                        if (!string.IsNullOrEmpty(pat.Capture))
                        {
                            captures.Add(new QueryCapture { Name = pat.Capture, Node = node });
                        }
                        return EvaluatePredicates(pat, captures.Skip(startCapturesLen).ToList());
                    }
                }
                return false;
            }

            if (pat.Type == "node")
            {
                if (!string.IsNullOrEmpty(pat.NodeType) && pat.NodeType != "_")
                {
                    string target = pat.NodeType.ToLowerInvariant().Replace("_", "");
                    string currentType = node.GetType().Name.ToLowerInvariant().Replace("node", "").Replace("_", "");
                    string nodeTypeName = node.Type.ToString().ToLowerInvariant().Replace("_", "");
                    
                    if (currentType != target && nodeTypeName != target)
                    {
                        return false;
                    }
                }

                if (pat.Children != null && pat.Children.Count > 0)
                {
                    var childrenNodes = GetStructuralNodes(node);
                    var candidates = GetPreOrderCandidates(childrenNodes);
                    if (!MatchChildren(node, candidates, pat.Children, 0, 0, new List<QueryCapture>(), out var childMatchCaptures))
                    {
                        return false;
                    }
                    captures.AddRange(childMatchCaptures);
                }

                if (!string.IsNullOrEmpty(pat.Capture))
                {
                    captures.Add(new QueryCapture { Name = pat.Capture, Node = node });
                }
                return EvaluatePredicates(pat, captures.Skip(startCapturesLen).ToList());
            }

            return false;
        }
    }

    public class ScopeBuilder
    {
        public delegate string MatchSelectorDelegate(Dictionary<string, List<AstNode>> captures, List<QueryCapture> rawCaptures, QueryMatch match);

\${generateScopeBuilderConfigCode(scopeBuilder)}

        public class ScopeRule
        {
            public string Type { get; set; }
            public CSTQuery Query { get; set; }
            public MatchSelectorDelegate NameFn { get; set; }
            public string NameFormat { get; set; }
            public Func<AstNode, bool> Matcher { get; set; }
            public Func<AstNode, string> NameSelector { get; set; }
        }

        public class SymbolRule
        {
            public CSTQuery Query { get; set; }
            public MatchSelectorDelegate NameFn { get; set; }
            public MatchSelectorDelegate KindFn { get; set; }
            public MatchSelectorDelegate DatatypeFn { get; set; }
            public string NameFormat { get; set; }
            public string KindFormat { get; set; }
            public string DatatypeFormat { get; set; }
            public Func<AstNode, bool> Matcher { get; set; }
            public Func<AstNode, string> NameSelector { get; set; }
            public Func<AstNode, string> KindSelector { get; set; }
            public Func<AstNode, string> DatatypeSelector { get; set; }
        }

        public class ReferenceRule
        {
            public CSTQuery Query { get; set; }
            public MatchSelectorDelegate NameFn { get; set; }
            public string NameFormat { get; set; }
            public Func<AstNode, bool> Matcher { get; set; }
            public Func<AstNode, string> NameSelector { get; set; }
        }

        public class CachedScope
        {
            public LexicalScope Scope { get; set; }
            public int BaseOffset { get; set; }
        }

        private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<GreenNode, CachedScope> _nodeScopeCache = 
            new System.Runtime.CompilerServices.ConditionalWeakTable<GreenNode, CachedScope>();

        private readonly List<ScopeRule> _scopeRules = new List<ScopeRule>();
        private readonly List<SymbolRule> _symbolRules = new List<SymbolRule>();
        private readonly List<ReferenceRule> _referenceRules = new List<ReferenceRule>();

        public void DefineScope(string type, string queryStr, MatchSelectorDelegate nameFn)
        {
            _scopeRules.Add(new ScopeRule { Type = type, Query = new CSTQuery(queryStr), NameFn = nameFn });
        }

        public void DefineScope(string type, string queryStr, string nameFormat)
        {
            _scopeRules.Add(new ScopeRule { Type = type, Query = new CSTQuery(queryStr), NameFormat = nameFormat });
        }

        public void DefineScope(string type, Func<AstNode, bool> matcher, Func<AstNode, string> nameSelector)
        {
            _scopeRules.Add(new ScopeRule { Type = type, Matcher = matcher, NameSelector = nameSelector });
        }

        public void DefineSymbol(string queryStr, MatchSelectorDelegate nameFn, MatchSelectorDelegate kindFn, MatchSelectorDelegate datatypeFn)
        {
            _symbolRules.Add(new SymbolRule { Query = new CSTQuery(queryStr), NameFn = nameFn, KindFn = kindFn, DatatypeFn = datatypeFn });
        }

        public void DefineSymbol(string queryStr, string nameFormat, string kindFormat, string datatypeFormat)
        {
            _symbolRules.Add(new SymbolRule { Query = new CSTQuery(queryStr), NameFormat = nameFormat, KindFormat = kindFormat, DatatypeFormat = datatypeFormat });
        }

        public void DefineSymbol(Func<AstNode, bool> matcher, Func<AstNode, string> nameSelector, Func<AstNode, string> kindSelector, Func<AstNode, string> datatypeSelector)
        {
            _symbolRules.Add(new SymbolRule { Matcher = matcher, NameSelector = nameSelector, KindSelector = kindSelector, DatatypeSelector = datatypeSelector });
        }

        public void DefineReference(string queryStr, MatchSelectorDelegate nameFn)
        {
            _referenceRules.Add(new ReferenceRule { Query = new CSTQuery(queryStr), NameFn = nameFn });
        }

        public void DefineReference(string queryStr, string nameFormat)
        {
            _referenceRules.Add(new ReferenceRule { Query = new CSTQuery(queryStr), NameFormat = nameFormat });
        }

        public void DefineReference(Func<AstNode, bool> matcher, Func<AstNode, string> nameSelector)
        {
            _referenceRules.Add(new ReferenceRule { Matcher = matcher, NameSelector = nameSelector });
        }

        private LexicalScope CloneAndShiftScope(LexicalScope scope, int delta, string parentId)
        {
            var cloned = new LexicalScope
            {
                Id = scope.Id,
                Name = scope.Name,
                Type = scope.Type,
                Start = scope.Start + delta,
                End = scope.End + delta,
                Node = scope.Node,
                ParentId = parentId,
            };

            foreach (var child in scope.Children)
            {
                cloned.Children.Add(CloneAndShiftScope(child, delta, cloned.Id));
            }

            foreach (var sym in scope.Symbols)
            {
                var clonedSym = new SymbolDefinition
                {
                    Id = sym.Id,
                    Name = sym.Name,
                    Kind = sym.Kind,
                    Datatype = sym.Datatype,
                    Start = sym.Start + delta,
                    End = sym.End + delta,
                    Node = sym.Node,
                    ScopeId = cloned.Id
                };
                cloned.Symbols.Add(clonedSym);
            }

            foreach (var r in scope.References)
            {
                var clonedRef = new SymbolReference
                {
                    Id = r.Id,
                    Name = r.Name,
                    Start = r.Start + delta,
                    End = r.End + delta,
                    Node = r.Node,
                    ScopeId = cloned.Id,
                    ResolvedSymbolId = r.ResolvedSymbolId
                };
                cloned.References.Add(clonedRef);
            }

            return cloned;
        }

        private static Dictionary<string, List<AstNode>> GetCapturesDict(QueryMatch match)
        {
            var dict = new Dictionary<string, List<AstNode>>();
            foreach (var c in match.Captures)
            {
                if (!dict.TryGetValue(c.Name, out var list))
                {
                    list = new List<AstNode>();
                    dict[c.Name] = list;
                }
                list.Add(c.Node);
            }
            return dict;
        }

        public LexicalScope Build(AstNode ast, int documentLength)
        {
            if (ast == null) return null;

            if (_nodeScopeCache.TryGetValue(ast.Green, out var cachedRoot))
            {
                return CloneAndShiftScope(cachedRoot.Scope, ast.Offset - cachedRoot.BaseOffset, null);
            }

            var globalScope = new LexicalScope
            {
                Id = "global",
                Name = "Global Scope",
                Type = "global",
                Start = 0,
                End = documentLength,
                Node = ast
            };

            var scopes = new List<LexicalScope>();
            int scopeCounter = 0;
            int symbolCounter = 0;
            int refCounter = 0;

            List<AstNode> allNodes = null;
            List<AstNode> GetAllNodes()
            {
                if (allNodes == null)
                {
                    allNodes = FlattenAst(ast);
                }
                return allNodes;
            }

            // 1. Find all scopes
            foreach (var rule in _scopeRules)
            {
                if (rule.Query != null)
                {
                    var matches = rule.Query.Run(ast);
                    foreach (var match in matches)
                    {
                        var captures = GetCapturesDict(match);
                        AstNode targetNode = null;
                        if (captures.TryGetValue("node", out var nodeList) && nodeList.Count > 0)
                        {
                            targetNode = nodeList[0];
                        }
                        else if (match.Captures.Count > 0)
                        {
                            targetNode = match.Captures[0].Node;
                        }

                        if (targetNode == null) continue;

                        scopes.Add(new LexicalScope
                        {
                            Id = $"scope-{rule.Type}-{++scopeCounter}",
                            Name = rule.NameFormat != null ? EvaluateFormat(rule.NameFormat, captures) : rule.NameFn(captures, match.Captures, match),
                            Type = rule.Type,
                            Start = targetNode.Start,
                            End = targetNode.End,
                            Node = targetNode
                        });
                    }
                }
                else if (rule.Matcher != null)
                {
                    var nodes = GetAllNodes();
                    foreach (var node in nodes)
                    {
                        if (rule.Matcher(node))
                        {
                            scopes.Add(new LexicalScope
                            {
                                Id = $"scope-{rule.Type}-{++scopeCounter}",
                                Name = rule.NameSelector(node),
                                Type = rule.Type,
                                Start = node.Start,
                                End = node.End,
                                Node = node
                            });
                        }
                    }
                }
            }

            // Order scopes start ascending, end descending
            scopes.Sort((a, b) =>
            {
                if (a.Start != b.Start) return a.Start - b.Start;
                return b.End - a.End;
            });

            var activeStack = new List<LexicalScope> { globalScope };
            foreach (var scope in scopes)
            {
                while (activeStack.Count > 1)
                {
                    var top = activeStack[activeStack.Count - 1];
                    if (top.Start <= scope.Start && top.End >= scope.End)
                    {
                        break;
                    }
                    activeStack.RemoveAt(activeStack.Count - 1);
                }
                var parent = activeStack[activeStack.Count - 1];
                scope.ParentId = parent.Id;
                parent.Children.Add(scope);
                activeStack.Add(scope);
            }

            var scopeMap = new Dictionary<string, LexicalScope>();
            AddScopesToMap(globalScope, scopeMap);

            LexicalScope FindDeepestScope(LexicalScope parent, int start, int end)
            {
                foreach (var child in parent.Children)
                {
                    if (child.Start <= start && child.End >= end)
                    {
                        return FindDeepestScope(child, start, end);
                    }
                }
                return parent;
            }

            var mainDeclOffsets = new HashSet<int>();

            // 2. Find all symbols
            foreach (var rule in _symbolRules)
            {
                if (rule.Query != null)
                {
                    var matches = rule.Query.Run(ast);
                    foreach (var match in matches)
                    {
                        var captures = GetCapturesDict(match);
                        AstNode targetNode = null;
                        if (captures.TryGetValue("node", out var nodeList) && nodeList.Count > 0)
                        {
                            targetNode = nodeList[0];
                        }
                        else if (match.Captures.Count > 0)
                        {
                            targetNode = match.Captures[0].Node;
                        }

                        if (targetNode == null) continue;

                        int start = targetNode.Start;
                        int end = targetNode.End;
                        var parentScope = FindDeepestScope(globalScope, start, end);

                        var symId = $"sym-{++symbolCounter}";
                        parentScope.Symbols.Add(new SymbolDefinition
                        {
                            Id = symId,
                            Name = rule.NameFormat != null ? EvaluateFormat(rule.NameFormat, captures) : rule.NameFn(captures, match.Captures, match),
                            Kind = rule.KindFormat != null ? EvaluateFormat(rule.KindFormat, captures) : rule.KindFn(captures, match.Captures, match),
                            Datatype = rule.DatatypeFormat != null ? EvaluateFormat(rule.DatatypeFormat, captures) : rule.DatatypeFn(captures, match.Captures, match),
                            Start = start,
                            End = end,
                            Node = targetNode,
                            ScopeId = parentScope.Id
                        });

                        mainDeclOffsets.Add(start);
                    }
                }
                else if (rule.Matcher != null)
                {
                    var nodes = GetAllNodes();
                    foreach (var node in nodes)
                    {
                        if (rule.Matcher(node))
                        {
                            int start = node.Start;
                            int end = node.End;
                            var parentScope = FindDeepestScope(globalScope, start, end);

                            var symId = $"sym-{++symbolCounter}";
                            parentScope.Symbols.Add(new SymbolDefinition
                            {
                                Id = symId,
                                Name = rule.NameSelector(node),
                                Kind = rule.KindSelector(node),
                                Datatype = rule.DatatypeSelector(node),
                                Start = start,
                                End = end,
                                Node = node,
                                ScopeId = parentScope.Id
                            });

                            mainDeclOffsets.Add(start);
                        }
                    }
                }
            }

            // 3. Find all references
            foreach (var rule in _referenceRules)
            {
                if (rule.Query != null)
                {
                    var matches = rule.Query.Run(ast);
                    foreach (var match in matches)
                    {
                        var captures = GetCapturesDict(match);
                        AstNode targetNode = null;
                        if (captures.TryGetValue("node", out var nodeList) && nodeList.Count > 0)
                        {
                            targetNode = nodeList[0];
                        }
                        else if (match.Captures.Count > 0)
                        {
                            targetNode = match.Captures[0].Node;
                        }

                        if (targetNode == null) continue;

                        int start = targetNode.Start;
                        int end = targetNode.End;

                        if (mainDeclOffsets.Contains(start)) continue;

                        var parentScope = FindDeepestScope(globalScope, start, end);

                        parentScope.References.Add(new SymbolReference
                        {
                            Id = $"ref-{++refCounter}",
                            Name = rule.NameFormat != null ? EvaluateFormat(rule.NameFormat, captures) : rule.NameFn(captures, match.Captures, match),
                            Start = start,
                            End = end,
                            Node = targetNode,
                            ScopeId = parentScope.Id
                        });
                    }
                }
                else if (rule.Matcher != null)
                {
                    var nodes = GetAllNodes();
                    foreach (var node in nodes)
                    {
                        if (mainDeclOffsets.Contains(node.Start)) continue;

                        if (rule.Matcher(node))
                        {
                            int start = node.Start;
                            int end = node.End;
                            var parentScope = FindDeepestScope(globalScope, start, end);

                            parentScope.References.Add(new SymbolReference
                            {
                                Id = $"ref-{++refCounter}",
                                Name = rule.NameSelector(node),
                                Start = start,
                                End = end,
                                Node = node,
                                ScopeId = parentScope.Id
                            });
                        }
                    }
                }
            }

            // 4. Resolve references
            SymbolDefinition ResolveRef(SymbolReference r, string sId)
            {
                string currentId = sId;
                while (currentId != null)
                {
                    if (scopeMap.TryGetValue(currentId, out var s))
                    {
                        var matchedSym = s.Symbols.FirstOrDefault(sym => sym.Name == r.Name);
                        if (matchedSym != null) return matchedSym;
                        currentId = s.ParentId;
                    }
                    else
                    {
                        break;
                    }
                }
                return null;
            }

            void ResolveAllScopeReferences(LexicalScope s)
            {
                foreach (var r in s.References)
                {
                    var resolvedSym = ResolveRef(r, s.Id);
                    if (resolvedSym != null)
                    {
                        r.ResolvedSymbolId = resolvedSym.Id;
                        resolvedSym.References.Add(r);
                    }
                }
                foreach (var child in s.Children)
                {
                    ResolveAllScopeReferences(child);
                }
            }

            ResolveAllScopeReferences(globalScope);

            _nodeScopeCache.Remove(ast.Green);
            _nodeScopeCache.Add(ast.Green, new CachedScope { Scope = globalScope, BaseOffset = ast.Offset });

            return globalScope;
        }

        private void AddScopesToMap(LexicalScope scope, Dictionary<string, LexicalScope> map)
        {
            map[scope.Id] = scope;
            foreach (var child in scope.Children)
            {
                AddScopesToMap(child, map);
            }
        }

        private List<AstNode> FlattenAst(AstNode node)
        {
            var list = new List<AstNode>();
            if (node == null) return list;
            list.Add(node);
            foreach (var child in node.Children)
            {
                list.AddRange(FlattenAst(child));
            }
            return list;
        }

        public static string ExtractId(AstNode n)
        {
            if (n == null) return "untitled";
            if (n.Value is string s) return s;
            if (n.Type == "id" && n.Value is string vs) return vs;
            if (n.Children != null && n.Children.Count > 0)
            {
                foreach (var child in n.Children)
                {
                    var res = ExtractId(child);
                    if (res != "untitled") return res;
                }
            }
            return "untitled";
        }

        public static string ExtractType(AstNode n)
        {
            if (n == null) return "auto";
            if (n.Type == "hlsl_type" || n.Type == "type")
            {
                return ExtractId(n);
            }
            if (n.Children != null && n.Children.Count > 0)
            {
                foreach (var child in n.Children)
                {
                    var t = ExtractType(child);
                    if (t != "auto") return t;
                }
            }
            return "auto";
        }

        public static string EvaluateFormat(string format, Dictionary<string, List<AstNode>> captures)
        {
            if (string.IsNullOrEmpty(format)) return string.Empty;
            return System.Text.RegularExpressions.Regex.Replace(format, @"\{([^}]+)\}", m =>
            {
                var key = m.Groups[1].Value;
                var mode = "id";
                var capName = key;
                if (key.Contains(":"))
                {
                    var parts = key.Split(':');
                    capName = parts[0];
                    mode = parts[1];
                }
                if (!captures.TryGetValue(capName, out var nodeList) || nodeList.Count == 0)
                {
                    return string.Empty;
                }
                var targetNode = nodeList[0];
                if (mode == "type")
                {
                    return ExtractType(targetNode);
                }
                return ExtractId(targetNode);
            });
        }
    }

    #endregion
}
`;
}

/**
 * Generates the specific Parser and and supporting AST Node structure.
 */
export function generateParserAndAstCSharpCode(rootElement: SyntaxElement, namespaceName: string = "SyntaxEngine"): string {
  const elements = collectElements(rootElement);
  const rootName = sanitize(rootElement.name);

  const regexFields: string[] = [];
  const speculativeRegexes: string[] = [];

  // Core & custom nodes elements list mapping to C# NodeType enum
  const customNodeTypes = Array.from(new Set(elements.map(el => sanitize(el.name))));

  // Generate switch cases for RedNode mapping
  const factoryCases = elements.map(el => {
    const elName = sanitize(el.name);
    return `                case NodeType.${elName}: return new ${elName}Node(green, parent, offset);`;
  }).join("\n");

  // Generate rule-flattened parser methods for each element
  let specIdCounter = 0;
  const nextSpecId = () => ++specIdCounter;

  const parserMethods = elements.map(el => {
    const elName = sanitize(el.name);
    const childElements = new Set<string>();

    // Build recovery boundaries list
    const boundaries: string[] = [];
    if (el.recoveryPatterns) {
      for (const p of el.recoveryPatterns) {
        if (typeof p === 'string') boundaries.push(p);
      }
    }
    if (el.isAutoHealing) {
      const custom = el.autoHealingBoundaries || [";", "}", "\n"];
      for (const p of custom) {
        if (typeof p === 'string') boundaries.push(p);
      }
    }
    const boundariesExpr = boundaries.length > 0
      ? `new List<string> { ${boundaries.map(b => `"${escapeString(b)}"`).join(", ")} }`
      : "null";

    // Flatten rules inside sequence into linear Allman C# code
    const ruleBlocks = el.rules.map(rule => {
      const ruleId = rule.id;

      if (rule.type === 'literal') {
        const esc = escapeString(rule.value);
        return `
            // Literal Rule: "${esc}" (id: ${ruleId})
            if (!panicked)
            {
                const string lit = "${esc}";
                const int litLen = ${rule.value.length};
                localMaxOffset = Math.Max(localMaxOffset, currentOffset + litLen);
                if (currentOffset + litLen <= text.Length && text.GetText(currentOffset, litLen) == lit)
                {
                    results.Add(GreenNode.Create(NodeType.Literal, lit, ${ruleId}, litLen));
                    currentOffset += litLen;
                    hasCommitted = true;
                }
                else
                {
                    if (TryRecover(text, currentOffset, ${ruleId}, "Expected literal \\"${esc}\\\"", ref localMaxOffset, results, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                    {
                        if (panicked) panicked = true; // Handled recovery boundary hit
                    }
                    else
                    {
                        return failRes;
                    }
                }
            }`;
      }

      if (rule.type === 'regex') {
        regexFields.push(`        private static readonly Regex Regex_Rule_${ruleId} = new Regex(@"^${escapeRegex(rule.value)}", RegexOptions.Compiled);`);
        return `
            // Regex Rule: ${rule.value.source} (id: ${ruleId})
            if (!panicked)
            {
                int lookahead_${ruleId} = Math.Min(text.Length - currentOffset, 512);
                string cand_${ruleId} = text.GetText(currentOffset, lookahead_${ruleId});
                var m = Regex_Rule_${ruleId}.Match(cand_${ruleId});
                if (m.Success && m.Index == 0)
                {
                    string mval = m.Value;
                    results.Add(GreenNode.Create(NodeType.Token, mval, ${ruleId}, mval.Length));
                    currentOffset += mval.Length;
                    hasCommitted = true;
                    localMaxOffset = Math.Max(localMaxOffset, currentOffset);
                }
                else
                {
                    if (TryRecover(text, currentOffset, ${ruleId}, "Expected match for pattern", ref localMaxOffset, results, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                    {
                        if (panicked) panicked = true;
                    }
                    else
                    {
                        return failRes;
                    }
                }
            }`;
      }

      if (rule.type === 'whitespace') {
        return `
            // Whitespace Rule (id: ${ruleId})
            if (!panicked)
            {
                int wsStart = currentOffset;
                while (currentOffset < text.Length && char.IsWhiteSpace(text[currentOffset]))
                {
                    currentOffset++;
                }
                localMaxOffset = Math.Max(localMaxOffset, currentOffset);
                if (currentOffset > wsStart)
                {
                    results.Add(GreenNode.Create(NodeType.Whitespace, text.GetText(wsStart, currentOffset - wsStart), ${ruleId}, currentOffset - wsStart));
                }
                else
                {
                    if (TryRecover(text, currentOffset, ${ruleId}, "Expected whitespace", ref localMaxOffset, results, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                    {
                        if (panicked) panicked = true;
                    }
                    else
                    {
                        return failRes;
                    }
                }
            }`;
      }

      if (rule.type === 'element') {
        const subName = sanitize(rule.value.name);
        childElements.add(subName);
        return `
            // Element Rule: ${rule.value.name} (id: ${ruleId})
            if (!panicked)
            {
                var res = Parse_${subName}(text, currentOffset, memo, ctx);
                localMaxOffset = Math.Max(localMaxOffset, res.DependencyLimit);
                if (res.Success)
                {
                    if (res.Ast != null && (res.Ast.Width > 0 || res.Ast.Type == NodeType.Eof))
                    {
                        results.Add(res.Ast);
                    }
                    currentOffset = res.NewOffset;
                    hasCommitted = true;
                }
                else
                {
                    if (TryRecover(text, currentOffset, ${ruleId}, res.Error ?? "Expected sub-element ${rule.value.name}", ref localMaxOffset, results, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                    {
                        if (panicked) panicked = true;
                    }
                    else
                    {
                        return failRes;
                    }
                }
            }`;
      }

      if (rule.type === 'choice') {
        const patterns = rule.value as any[];
        const baseErrorsVar = `baseErrors_${ruleId}`;

        const choiceChecks: string[] = [];
        patterns.forEach(p => {
          const sId = nextSpecId();
          if (p instanceof RegExp) {
            speculativeRegexes.push(`        private static readonly Regex Regex_Spec_${ruleId} = new Regex(@"^${escapeRegex(p)}", RegexOptions.Compiled);`);
          }
          const spec = compileSpeculativeMatch(p, ruleId, sId, childElements);
          choiceChecks.push(`
                // Speculative alternative check ${sId}
                if (!choiceMatched_${ruleId})
                {
                    ctx.RecoveredErrors.RemoveRange(${baseErrorsVar}, ctx.RecoveredErrors.Count - ${baseErrorsVar});
                    ${spec.code.trim()}
                    if (${spec.matchedName})
                    {
                        bestAst = ${spec.parsedAstName};
                        bestOffset = ${spec.newOffsetName};
                        bestPrec = ${spec.precName};
                        bestErrors = ctx.RecoveredErrors.GetRange(${baseErrorsVar}, ctx.RecoveredErrors.Count - ${baseErrorsVar});
                        choiceMatched_${ruleId} = true;
                    }
                }`);
        });

        return `
            // Choice Rule (id: ${ruleId})
            if (!panicked)
            {
                bool choiceMatched_${ruleId} = false;
                int ${baseErrorsVar} = ctx.RecoveredErrors.Count;

                GreenNode bestAst = null;
                int bestOffset = -1;
                int bestPrec = -1;
                List<ParseError> bestErrors = null;
${choiceChecks.join("\n")}

                if (choiceMatched_${ruleId} && bestAst != null)
                {
                    ctx.RecoveredErrors.AddRange(bestErrors);
                    if (bestAst.Width > 0 || bestAst.Type == NodeType.Eof)
                    {
                        results.Add(bestAst);
                    }
                    currentOffset = bestOffset;
                    hasCommitted = true;
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(${baseErrorsVar}, ctx.RecoveredErrors.Count - ${baseErrorsVar});
                    if (TryRecover(text, currentOffset, ${ruleId}, "None of the choices matched in rule ${ruleId}", ref localMaxOffset, results, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                    {
                        if (panicked) panicked = true;
                    }
                    else
                    {
                        return failRes;
                    }
                }
            }`;
      }

      if (rule.type === 'optional') {
        const sId = nextSpecId();
        const escErrorsVar = `optErrors_${ruleId}`;
        if (rule.value instanceof RegExp) {
          speculativeRegexes.push(`        private static readonly Regex Regex_Spec_${ruleId} = new Regex(@"^${escapeRegex(rule.value)}", RegexOptions.Compiled);`);
        }
        const spec = compileSpeculativeMatch(rule.value, ruleId, sId, childElements);

        return `
            // Optional Rule (id: ${ruleId})
            if (!panicked)
            {
                int ${escErrorsVar} = ctx.RecoveredErrors.Count;
                ${spec.code.trim()}
                if (${spec.matchedName})
                {
                    if (${spec.parsedAstName} != null && (${spec.parsedAstName}.Width > 0 || ${spec.parsedAstName}.Type == NodeType.Eof))
                    {
                        results.Add(${spec.parsedAstName});
                    }
                    currentOffset = ${spec.newOffsetName};
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(${escErrorsVar}, ctx.RecoveredErrors.Count - ${escErrorsVar});
                }
            }`;
      }

      if (rule.type === 'zeroOrMore') {
        const sId = nextSpecId();
        const escErrorsVar = `loopErrors_${ruleId}`;
        if (rule.value instanceof RegExp) {
          speculativeRegexes.push(`        private static readonly Regex Regex_Spec_${ruleId} = new Regex(@"^${escapeRegex(rule.value)}", RegexOptions.Compiled);`);
        }
        const spec = compileSpeculativeMatch(rule.value, ruleId, sId, childElements);

        return `
            // Zero Or More Rule (id: ${ruleId})
            if (!panicked)
            {
                int startLoopOffset = currentOffset;
                var loopResults = new List<GreenNode>();
                while (currentOffset < text.Length)
                {
                    int beforeIterOffset = currentOffset;
                    int ${escErrorsVar} = ctx.RecoveredErrors.Count;
                    ${spec.code.trim()}
                    if (${spec.matchedName} && ${spec.newOffsetName} > beforeIterOffset)
                    {
                        loopResults.Add(${spec.parsedAstName});
                        currentOffset = ${spec.newOffsetName};
                    }
                    else
                    {
                        ctx.RecoveredErrors.RemoveRange(${escErrorsVar}, ctx.RecoveredErrors.Count - ${escErrorsVar});
                        break;
                    }
                }
                if (loopResults.Count > 0)
                {
                    results.Add(GreenNode.Create(NodeType.ZeroOrMore, loopResults, ${ruleId}, currentOffset - startLoopOffset));
                }
            }`;
      }

      if (rule.type === 'oneOrMore') {
        const sId = nextSpecId();
        const escErrorsVar = `loopErrors_${ruleId}`;
        if (rule.value instanceof RegExp) {
          speculativeRegexes.push(`        private static readonly Regex Regex_Spec_${ruleId} = new Regex(@"^${escapeRegex(rule.value)}", RegexOptions.Compiled);`);
        }
        const spec = compileSpeculativeMatch(rule.value, ruleId, sId, childElements);

        return `
            // One Or More Rule (id: ${ruleId})
            if (!panicked)
            {
                int startLoopOffset = currentOffset;
                var loopResults = new List<GreenNode>();
                while (currentOffset < text.Length)
                {
                    int beforeIterOffset = currentOffset;
                    int ${escErrorsVar} = ctx.RecoveredErrors.Count;
                    ${spec.code.trim()}
                    if (${spec.matchedName} && ${spec.newOffsetName} > beforeIterOffset)
                    {
                        loopResults.Add(${spec.parsedAstName});
                        currentOffset = ${spec.newOffsetName};
                    }
                    else
                    {
                        ctx.RecoveredErrors.RemoveRange(${escErrorsVar}, ctx.RecoveredErrors.Count - ${escErrorsVar});
                        break;
                    }
                }
                if (loopResults.Count > 0)
                {
                    results.Add(GreenNode.Create(NodeType.OneOrMore, loopResults, ${ruleId}, currentOffset - startLoopOffset));
                    hasCommitted = true;
                }
                else
                {
                    if (TryRecover(text, currentOffset, ${ruleId}, "Expected at least one occurrence in loop", ref localMaxOffset, results, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                    {
                        if (panicked) panicked = true;
                    }
                    else
                    {
                        return failRes;
                    }
                }
            }`;
      }

      if (rule.type === 'not') {
        const sId = nextSpecId();
        const escErrorsVar = `notErrors_${ruleId}`;
        if (rule.value instanceof RegExp) {
          speculativeRegexes.push(`        private static readonly Regex Regex_Spec_${ruleId} = new Regex(@"^${escapeRegex(rule.value)}", RegexOptions.Compiled);`);
        }
        const spec = compileSpeculativeMatch(rule.value, ruleId, sId, childElements);

        return `
            // Not Lookahead Rule: (id: ${ruleId})
            if (!panicked)
            {
                int ${escErrorsVar} = ctx.RecoveredErrors.Count;
                ${spec.code.trim()}
                if (${spec.matchedName})
                {
                    ctx.RecoveredErrors.RemoveRange(${escErrorsVar}, ctx.RecoveredErrors.Count - ${escErrorsVar});
                    return new ParseResult
                    {
                        Success = false,
                        Error = "Encountered forbidden lookahead pattern",
                        NewOffset = currentOffset,
                        DependencyLimit = localMaxOffset,
                        RuleId = ${ruleId}
                    };
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(${escErrorsVar}, ctx.RecoveredErrors.Count - ${escErrorsVar});
                }
            }`;
      }

      if (rule.type === 'eof') {
        return `
            // EOF Rule (id: ${ruleId})
            if (!panicked)
            {
                localMaxOffset = Math.Max(localMaxOffset, currentOffset + 1);
                if (currentOffset == text.Length)
                {
                    results.Add(GreenNode.Create(NodeType.Eof, null, ${ruleId}, 0));
                }
                else
                {
                    if (TryRecover(text, currentOffset, ${ruleId}, "Expected EOF end of string", ref localMaxOffset, results, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                    {
                        if (panicked) panicked = true;
                    }
                    else
                    {
                        return failRes;
                    }
                }
            }`;
      }

      return "            // Unsupported rule type";
    }).join("\n");

    const instantiator = `GreenNode.Create(NodeType.${elName}, results, ruleId, currentOffset - offset)`;

    return `        public ParseResult Parse_${elName}(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = ${el.id};
            if (memo.Has(ruleId, offset))
            {
                var cached = memo.Get(ruleId, offset);
                if (cached != null)
                {
                    if (cached.RecoveredErrors != null)
                    {
                        ctx.RecoveredErrors.AddRange(cached.RecoveredErrors);
                    }
                    return cached;
                }
            }

            int currentOffset = offset;
            int localMaxOffset = offset;
            var results = new List<GreenNode>();
            bool panicked = false;
            bool hasCommitted = false;
            int initialErrorsLength = ctx.RecoveredErrors.Count;

${ruleBlocks}

            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }

            var nextRes = new ParseResult
            {
                Success = true,
                Ast = ${instantiator},
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };

            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }`;
  }).join("\n\n");

  const combinedRegexes = Array.from(new Set([...regexFields, ...speculativeRegexes])).join("\n");

  return `using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Linq;

namespace ${namespaceName}
{
    public enum NodeType
    {
        Literal,
        Token,
        Whitespace,
        Eof,
        ErrorNode,
        ZeroOrMore,
        OneOrMore,
        ${customNodeTypes.join(",\n        ")}
    }

    public struct GreenNodeKey : IEquatable<GreenNodeKey>
    {
        public NodeType Type { get; }
        public int RuleId { get; }
        public int Width { get; }
        public object Value { get; }

        public GreenNodeKey(NodeType type, int ruleId, int width, object value)
        {
            Type = type;
            RuleId = ruleId;
            Width = width;
            Value = value;
        }

        public bool Equals(GreenNodeKey other)
        {
            if (Type != other.Type || RuleId != other.RuleId || Width != other.Width)
            {
                return false;
            }

            if (Value == null && other.Value == null) return true;
            if (Value == null || other.Value == null) return false;

            if (Value is string s1 && other.Value is string s2)
            {
                return s1 == s2;
            }

            if (Value is List<GreenNode> l1 && other.Value is List<GreenNode> l2)
            {
                if (l1.Count != l2.Count) return false;
                for (int i = 0; i < l1.Count; i++)
                {
                    var e1 = l1[i];
                    var e2 = l2[i];
                    if (e1 == null && e2 == null) continue;
                    if (e1 == null || e2 == null || e1.Id != e2.Id) return false;
                }
                return true;
            }

            return Value.Equals(other.Value);
        }

        public override bool Equals(object obj)
        {
            return obj is GreenNodeKey other && Equals(other);
        }

        public override int GetHashCode()
        {
            unchecked
            {
                int hash = 17;
                hash = hash * 23 + (int)Type;
                hash = hash * 23 + RuleId;
                hash = hash * 23 + Width;
                if (Value is string s)
                {
                    hash = hash * 23 + s.GetHashCode();
                }
                else if (Value is List<GreenNode> list)
                {
                    foreach (var child in list)
                    {
                        hash = hash * 23 + (child != null ? child.Id : 0);
                    }
                }
                else if (Value != null)
                {
                    hash = hash * 23 + Value.GetHashCode();
                }
                return hash;
            }
        }
    }

    public class GreenNode
    {
        public int Id { get; set; }
        public NodeType Type { get; set; }
        public object Value { get; set; } // string or List<GreenNode>
        public int RuleId { get; set; }
        public int Width { get; set; }

        private static readonly Dictionary<GreenNodeKey, WeakReference<GreenNode>> _greenNodeCache = new Dictionary<GreenNodeKey, WeakReference<GreenNode>>();
        private static int _nextGreenNodeId = 0;
        private static readonly object _cacheLock = new object();
        private static int _addedSincePrune = 0;

        public GreenNode(NodeType type, object value, int ruleId, int width)
        {
            Id = System.Threading.Interlocked.Increment(ref _nextGreenNodeId);
            Type = type;
            Value = value;
            RuleId = ruleId;
            Width = width;
        }

        public static GreenNode Create(NodeType type, object value, int ruleId, int width)
        {
            GreenNodeKey key = new GreenNodeKey(type, ruleId, width, value);
            
            lock (_cacheLock)
            {
                if (_greenNodeCache.TryGetValue(key, out var weakRef))
                {
                    if (weakRef.TryGetTarget(out var cachedNode))
                    {
                        return cachedNode;
                    }
                }

                var newNode = new GreenNode(type, value, ruleId, width);
                _greenNodeCache[key] = new WeakReference<GreenNode>(newNode);
                
                _addedSincePrune++;
                if (_addedSincePrune > 20000)
                {
                    PruneCache();
                    _addedSincePrune = 0;
                }

                return newNode;
            }
        }

        private static void PruneCache()
        {
            var deadKeys = new List<GreenNodeKey>();
            foreach (var kvp in _greenNodeCache)
            {
                if (!kvp.Value.TryGetTarget(out _))
                {
                    deadKeys.Add(kvp.Key);
                }
            }
            foreach (var k in deadKeys)
            {
                _greenNodeCache.Remove(k);
            }
        }
    }

    public class AstNode
    {
        public GreenNode Green { get; set; }
        public AstNode Parent { get; set; }
        public int Offset { get; set; }

        private object _valueCache = null;

        public AstNode(GreenNode green, AstNode parent, int offset)
        {
            Green = green;
            Parent = parent;
            Offset = offset;
        }

        public NodeType Type => Green.Type;
        public int RuleId => Green.RuleId;
        public int Start => Offset;
        public int End => Offset + Green.Width;

        public string Value
        {
            get
            {
                var val = this.ChildrenValue;
                if (val is string s) return s;
                return "";
            }
        }

        public List<AstNode> Children
        {
            get
            {
                var val = this.ChildrenValue;
                if (val is List<AstNode> list) return list;
                return new List<AstNode>();
            }
        }

        private object ChildrenValue
        {
            get
            {
                if (_valueCache != null) return _valueCache;

                if (Green.Value is string s)
                {
                    _valueCache = s;
                    return _valueCache;
                }
                if (Green.Value is IEnumerable<GreenNode> greenChildren)
                {
                    int currentOffset = Offset;
                    var redChildren = new List<AstNode>();
                    foreach (var childGreen in greenChildren)
                    {
                        if (childGreen != null)
                        {
                            redChildren.Add(CreateRedNode(childGreen, this, currentOffset));
                            currentOffset += childGreen.Width;
                        }
                    }
                    _valueCache = redChildren;
                    return _valueCache;
                }

                _valueCache = "";
                return _valueCache;
            }
        }

        public static AstNode CreateRedNode(GreenNode green, AstNode parent, int offset)
        {
            if (green == null) return null;
            switch (green.Type)
            {
${factoryCases}
                default: return new AstNode(green, parent, offset);
            }
        }

        public T FindChild<T>() where T : AstNode
        {
            return Children.OfType<T>().FirstOrDefault();
        }

        public List<T> FindChildren<T>() where T : AstNode
        {
            return Children.OfType<T>().ToList();
        }
    }

    #region Rule Flattened Parser Engine

    public class ${rootName}Parser : IParserRunner
    {
${combinedRegexes}

        public ParseResult Parse(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            return Parse_${rootName}(text, offset, memo, ctx);
        }

${parserMethods}

        private bool TryRecover(
            ITextDocument text, 
            int currentOffset, 
            int ruleId, 
            string errorMsg, 
            ref int localMaxOffset, 
            List<GreenNode> results, 
            ref int currentOffsetRef, 
            ref bool panicked, 
            bool hasCommitted,
            List<string> recoveryBoundaries,
            ParserContext ctx,
            out ParseResult failResult
        )
        {
            failResult = null;
            bool shouldRecover = hasCommitted;
            if (!shouldRecover)
            {
                int nextCharIndex = currentOffset;
                while (nextCharIndex < text.Length && char.IsWhiteSpace(text[nextCharIndex]))
                {
                    nextCharIndex++;
                }
                if (nextCharIndex < text.Length)
                {
                    char c = text[nextCharIndex];
                    if (c != '}' && c != ')')
                    {
                        shouldRecover = true;
                    }
                }
            }

            if (shouldRecover && recoveryBoundaries != null && recoveryBoundaries.Count > 0)
            {
                int bestRecoveryOffset = -1;
                foreach (var boundary in recoveryBoundaries)
                {
                    int lookaheadLimit = Math.Min(text.Length - currentOffset, 2048);
                    string window = text.GetText(currentOffset, lookaheadLimit);
                    int idxInWindow = window.IndexOf(boundary);
                    if (idxInWindow != -1)
                    {
                        int idx = currentOffset + idxInWindow;
                        if (bestRecoveryOffset == -1 || idx < bestRecoveryOffset)
                        {
                            bestRecoveryOffset = idx;
                        }
                    }
                }

                if (bestRecoveryOffset != -1)
                {
                    int len = bestRecoveryOffset - currentOffset;
                    string skipped = text.GetText(currentOffset, len);
                    string snippet = skipped.Length > 25 ? skipped.Substring(0, 22) + "..." : skipped;
                    string msg = $"Syntax Error in parser: {errorMsg} at offset {currentOffset}. Skipped \\\"{snippet}\\\" to sync.";

                    ctx.RecoveredErrors.Add(new ParseError { Message = msg, Offset = currentOffset });
                    var errNode = GreenNode.Create(NodeType.ErrorNode, msg, 0, bestRecoveryOffset - currentOffset);
                    results.Add(errNode);
                    currentOffsetRef = bestRecoveryOffset;
                    panicked = true;
                    return true;
                }
            }

            failResult = new ParseResult
            {
                Success = false,
                Error = errorMsg,
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId
            };
            return false;
        }
    }

    #endregion
}
`;
}

/**
 * Generates the strongly-typed AST node class structures.
 */
export function generateStronglyTypedAstClasses(rootElement: SyntaxElement, namespaceName: string = "SyntaxEngine"): string {
  const elements = collectElements(rootElement);

  return `using System;
using System.Collections.Generic;

namespace ${namespaceName}
{
${elements.map(el => {
    const elName = sanitize(el.name);
    const childrenNodeTypes = new Set<string>();

    for (const rule of el.rules) {
      if (rule.type === 'element' && rule.value instanceof SyntaxElement) {
        childrenNodeTypes.add(sanitize(rule.value.name));
      } else if (rule.type === 'choice') {
        for (const child of rule.value) {
          if (child instanceof SyntaxElement) {
            childrenNodeTypes.add(sanitize(child.name));
          }
        }
      } else if (
        rule.type === 'optional' ||
        rule.type === 'zeroOrMore' ||
        rule.type === 'oneOrMore' ||
        rule.type === 'not'
      ) {
        if (rule.value instanceof SyntaxElement) {
          childrenNodeTypes.add(sanitize(rule.value.name));
        }
      }
    }

    const properties = Array.from(childrenNodeTypes).map(childName => `        public ${childName}Node ${childName} => FindChild<${childName}Node>();
        public List<${childName}Node> All_${childName} => FindChildren<${childName}Node>();`).join("\n\n");

    return `    public class ${elName}Node : AstNode
    {
        public ${elName}Node(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }

${properties}
    }`;
  }).join("\n\n")}
}
`;
}

/**
 * Generates the complete, self-contained C# code string in Allman style.
 */
export function generateFullCSharp(rootElement: SyntaxElement, namespaceName: string = "SyntaxEngine", scopeBuilder?: ScopeBuilder): string {
  const coreCode = generateCoreCSharpCode(namespaceName, scopeBuilder);
  const parserCode = generateParserAndAstCSharpCode(rootElement, namespaceName);
  const astCode = generateStronglyTypedAstClasses(rootElement, namespaceName);

  // Strip identical usings/namespace wraps to create a beautiful single cohesive file
  const cleanParser = parserCode
    .replace(/using [a-zA-Z.]+;\s*/g, '')
    .replace(`namespace ${namespaceName}\n{`, '')
    .replace(/}\s*$/, ''); // remove namespace ending bracket

  const cleanAst = astCode
    .replace(/using [a-zA-Z.]+;\s*/g, '')
    .replace(`namespace ${namespaceName}\n{`, '')
    .replace(/}\s*$/, ''); // remove namespace ending bracket

  // Splice everything into the core file beautifully right before its last namespace enclosing bracket '}'
  const lastBracketIndex = coreCode.lastIndexOf('}');
  const prefix = coreCode.substring(0, lastBracketIndex);
  const suffix = coreCode.substring(lastBracketIndex);

  return `${prefix}
    #region Specific Grammar Parser and Red Nodes

${cleanParser.trim()}

${cleanAst.trim()}

    #endregion
${suffix}`;
}

/**
 * Custom file export interface representing independent C# compiler files.
 */
export interface GeneratedFile {
  name: string;
  content: string;
}

/**
 * Generates custom separate file splits so that core classes can stay un-duplicated
 * and strongly-typed nodes can reside in their own folders or single consolidated file.
 */
export function generateModularCSharp(
  rootElement: SyntaxElement,
  options: {
    namespace?: string;
    stronglyTypedAstSeparate?: boolean;
    scopeBuilder?: ScopeBuilder;
  } = {}
): GeneratedFile[] {
  const ns = options.namespace || "SyntaxEngine";
  const rootName = sanitize(rootElement.name);
  const files: GeneratedFile[] = [];

  // 1. Core classes file
  files.push({
    name: "SyntaxEngine.Core.cs",
    content: generateCoreCSharpCode(ns, options.scopeBuilder)
  });

  // 2. Parser specific file
  files.push({
    name: `${rootName}Parser.cs`,
    content: generateParserAndAstCSharpCode(rootElement, ns)
  });

  // 3. Strongly-typed AST nodes file(s)
  if (options.stronglyTypedAstSeparate) {
    const elements = collectElements(rootElement);
    elements.forEach(el => {
      const elName = sanitize(el.name);
      const childrenNodeTypes = new Set<string>();

      for (const rule of el.rules) {
        if (rule.type === 'element' && rule.value instanceof SyntaxElement) {
          childrenNodeTypes.add(sanitize(rule.value.name));
        } else if (rule.type === 'choice') {
          for (const child of rule.value) {
            if (child instanceof SyntaxElement) {
              childrenNodeTypes.add(sanitize(child.name));
            }
          }
        } else if (
          rule.type === 'optional' ||
          rule.type === 'zeroOrMore' ||
          rule.type === 'oneOrMore' ||
          rule.type === 'not'
        ) {
          if (rule.value instanceof SyntaxElement) {
            childrenNodeTypes.add(sanitize(rule.value.name));
          }
        }
      }

      const properties = Array.from(childrenNodeTypes).map(childName => `        public ${childName}Node ${childName} => FindChild<${childName}Node>();
        public List<${childName}Node> All_${childName} => FindChildren<${childName}Node>();`).join("\n\n");

      const nodeCode = `using System;
using System.Collections.Generic;

namespace ${ns}
{
    public class ${elName}Node : AstNode
    {
        public ${elName}Node(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }

${properties}
    }
}
`;

      files.push({
        name: `${elName}Node.cs`,
        content: nodeCode
      });
    });
  } else {
    files.push({
      name: "SyntaxEngine.AstNodes.cs",
      content: generateStronglyTypedAstClasses(rootElement, ns)
    });
  }

  return files;
}
