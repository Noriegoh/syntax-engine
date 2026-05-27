using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;
namespace TestNamespace
{
    public interface ITextDocument
    {
        int Length { get; }
        ReadOnlyMemory<char> GetText(int start, int length);
        char this[int index] { get; }
        int GetLineEnd(int offset);
        int GetLineEnding(int offset);
    }
    public class StringTextDocument : ITextDocument
    {
        private readonly string _text;
        private readonly ReadOnlyMemory<char> _memory;
        public int Length => _text.Length;
        public StringTextDocument(string text)
        {
            _text = text ?? "";
            _memory = _text.AsMemory();
        }
        public ReadOnlyMemory<char> GetText(int start, int length)
        {
            return _memory.Slice(start, length);
        }
        public char this[int index] => _text[index];
        public int GetLineEnd(int offset)
        {
            if (offset < 0) return 0;
            if (offset >= _text.Length) return _text.Length;
            for (int i = offset; i < _text.Length; i++)
            {
                char c = _text[i];
                if (c == '' || c == '
') return i;
            }
            return _text.Length;
        }
        public int GetLineEnding(int offset)
        {
            if (offset < 0 || offset >= _text.Length) return 0;
            int end = GetLineEnd(offset);
            return end - offset;
        }
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
        public bool TryGet(int ruleId, int offset, out ParseResult cached)
        {
            if(NodesByOffset.TryGetValue(offset, out var ruleMap))
            {
                if(ruleMap.TryGetValue(ruleId, out var node))
                {
                    cached = node.Result;
                    return true;
                }
            }
            return false;
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
        public List<string> ActiveScopeEnds { get; set; } = new List<string>();
        private int _cachedLineTextOffset = -1;
        private int _cachedLineTextLength = -1;
        private ReadOnlyMemory<char> _cachedLineText = ReadOnlyMemory<char>.Empty;
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public ReadOnlyMemory<char> GetCachedLineText(ITextDocument text, int offset, out int relativeOffset)
        {
            int lineEndingLength = text.GetLineEnding(offset);
            bool isCached = !_cachedLineText.IsEmpty && offset >= _cachedLineTextOffset && offset < _cachedLineTextOffset + _cachedLineTextLength;
            if (isCached)
            {
                relativeOffset = offset - _cachedLineTextOffset;
                return _cachedLineText;
            }
            _cachedLineTextOffset = offset;
            _cachedLineTextLength = lineEndingLength;
            _cachedLineText = text.GetText(offset, lineEndingLength);
            relativeOffset = 0;
            return _cachedLineText;
        }
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public bool MatchLiteral(ITextDocument text, int offset, string literal, int literalLength)
        {
            if (offset + literalLength > text.Length) return false;
            if (_cachedLineTextOffset != -1 && offset >= _cachedLineTextOffset && offset + literalLength <= _cachedLineTextOffset + _cachedLineTextLength)
            {
                int relOffset = offset - _cachedLineTextOffset;
                return _cachedLineText.Span.Slice(relOffset, literalLength).SequenceEqual(literal.AsSpan());
            }
            ReadOnlyMemory<char> segment = text.GetText(offset, literalLength);
            return segment.Span.SequenceEqual(literal.AsSpan());
        }
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public bool MatchRegex(ITextDocument text, int offset, System.Text.RegularExpressions.Regex regex, out string matchedValue)
        {
            matchedValue = string.Empty;
            if (offset >= text.Length) return false;
            int lineEndingLength = text.GetLineEnding(offset);
            if (lineEndingLength <= 0) return false;
            int relOffset;
            ReadOnlyMemory<char> lineText = GetCachedLineText(text, offset, out relOffset);
            int sliceLen = lineText.Length - relOffset;
            if (sliceLen <= 0) return false;
            string slice = lineText.Slice(relOffset, sliceLen).ToString();
            var match = regex.Match(slice);
            if (match.Success && match.Index == 0)
            {
                matchedValue = match.Value;
                return true;
            }
            return false;
        }
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
        private static (int editOffset, int removedLength, string insertedText) FindDiff(ReadOnlyMemory<char> oldStr, ReadOnlyMemory<char> newStr)
        {
            ReadOnlySpan<char> oldSpan = oldStr.Span;
            ReadOnlySpan<char> newSpan = newStr.Span;
            int prefix = 0;
            while (prefix < oldSpan.Length && prefix < newSpan.Length && oldSpan[prefix] == newSpan[prefix])
            {
                prefix++;
            }
            int oldLen = oldSpan.Length - prefix;
            int newLen = newSpan.Length - prefix;
            int suffix = 0;
            while (suffix < oldLen && suffix < newLen && oldSpan[oldSpan.Length - 1 - suffix] == newSpan[newSpan.Length - 1 - suffix])
            {
                suffix++;
            }
            int removedLength = oldLen - suffix;
            string insertedText = newStr.Slice(prefix, newLen - suffix).ToString();
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
                if (queryStr[i] == '"' || queryStr[i] == '\'')
                {
                    char quote = queryStr[i];
                    i++;
                    var val = "";
                    while (i < queryStr.Length && queryStr[i] != quote)
                    {
                        if (queryStr[i] == '\\' && i + 1 < queryStr.Length)
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
                    while (i < queryStr.Length && queryStr[i] != '
') i++;
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
        public static ScopeBuilder CreateDefault()
        {
            return new ScopeBuilder();
        }
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
            return System.Text.RegularExpressions.Regex.Replace(format, @"{([^}]+)}", m =>
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

using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Linq;
using System.Runtime.CompilerServices;
namespace TestNamespace
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
        HlslBlock,
        S,
        N,
        Ws,
        LineComment,
        HlslItem,
        HlslStmt,
        Struct,
        Id,
        StructMemberWrapper,
        StructMember,
        VarDecl,
        HlslType,
        OptArray,
        ArraySpec,
        ArrSize,
        SemOpt,
        Semantic,
        Function,
        CodeBlock,
        Directive
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
                _valueCache = string.Empty;
                return _valueCache;
            }
        }
        public static AstNode CreateRedNode(GreenNode green, AstNode parent, int offset)
        {
            if (green == null) return null;
            switch (green.Type)
            {
                case NodeType.HlslBlock: return new HlslBlockNode(green, parent, offset);
                case NodeType.S: return new SNode(green, parent, offset);
                case NodeType.N: return new NNode(green, parent, offset);
                case NodeType.Ws: return new WsNode(green, parent, offset);
                case NodeType.LineComment: return new LineCommentNode(green, parent, offset);
                case NodeType.HlslItem: return new HlslItemNode(green, parent, offset);
                case NodeType.HlslStmt: return new HlslStmtNode(green, parent, offset);
                case NodeType.Struct: return new StructNode(green, parent, offset);
                case NodeType.Id: return new IdNode(green, parent, offset);
                case NodeType.StructMemberWrapper: return new StructMemberWrapperNode(green, parent, offset);
                case NodeType.StructMember: return new StructMemberNode(green, parent, offset);
                case NodeType.VarDecl: return new VarDeclNode(green, parent, offset);
                case NodeType.HlslType: return new HlslTypeNode(green, parent, offset);
                case NodeType.OptArray: return new OptArrayNode(green, parent, offset);
                case NodeType.ArraySpec: return new ArraySpecNode(green, parent, offset);
                case NodeType.ArrSize: return new ArrSizeNode(green, parent, offset);
                case NodeType.SemOpt: return new SemOptNode(green, parent, offset);
                case NodeType.Semantic: return new SemanticNode(green, parent, offset);
                case NodeType.Function: return new FunctionNode(green, parent, offset);
                case NodeType.SemOpt: return new SemOptNode(green, parent, offset);
                case NodeType.CodeBlock: return new CodeBlockNode(green, parent, offset);
                case NodeType.Directive: return new DirectiveNode(green, parent, offset);
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
    public class HlslBlockParser : IParserRunner
    {

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        private bool MatchDFA_Rule_4(ITextDocument text, int offset, out string matchedValue)
        {
            matchedValue = string.Empty;
            int textLength = text.Length;
            if (offset >= textLength) return false;
            ReadOnlyMemory<char> mem = text.GetText(offset, textLength - offset);
            ReadOnlySpan<char> span = mem.Span;
            int spanLength = span.Length;
            int state = 0;
            int finalMatchLength = -1;
            int i = 0;
            while (i < spanLength)
            {
                switch (state)
                {
                case 3: finalMatchLength = i; break;
                case 6: finalMatchLength = i; break;
                case 7: finalMatchLength = i; break;
                }
                char c = span[i];
                switch (state)
                {
            case 0:
                    if (c == '/')
                    {
                        state = 1;
                        break;
                    }
                    else
                    {
                        goto end_match;
                    }

            case 1:
                    if (c == '*')
                    {
                        state = 2;
                        break;
                    }
                    else if (c == '/')
                    {
                        state = 3;
                        break;
                    }
                    else
                    {
                        goto end_match;
                    }

            case 2:
                    if (c == '*')
                    {
                        state = 5;
                        break;
                    }
                    // Fallback transition
                    state = 4;
                    break;

            case 3:
                    // Fallback transition
                    state = 6;
                    break;

            case 4:
                    if (c == '*')
                    {
                        state = 5;
                        break;
                    }
                    // Fallback transition
                    state = 4;
                    break;

            case 5:
                    if (c == '*')
                    {
                        state = 5;
                        break;
                    }
                    else if (c == '/')
                    {
                        state = 7;
                        break;
                    }
                    // Fallback transition
                    state = 4;
                    break;

            case 6:
                    // Fallback transition
                    state = 6;
                    break;

            case 7:
                    if (c == '*')
                    {
                        state = 5;
                        break;
                    }
                    // Fallback transition
                    state = 4;
                    break;

                    default:
                        goto end_match;
                }
                i++;
            }
            switch (state)
            {
                case 3: finalMatchLength = i; break;
                case 6: finalMatchLength = i; break;
                case 7: finalMatchLength = i; break;
            }
        end_match:
            if (finalMatchLength != -1)
            {
                matchedValue = span.Slice(0, finalMatchLength).ToString();
                return true;
            }
            return false;
        }


        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        private bool MatchDFA_Rule_10(ITextDocument text, int offset, out string matchedValue)
        {
            matchedValue = string.Empty;
            int textLength = text.Length;
            if (offset >= textLength) return false;
            ReadOnlyMemory<char> mem = text.GetText(offset, textLength - offset);
            ReadOnlySpan<char> span = mem.Span;
            int spanLength = span.Length;
            int state = 0;
            int finalMatchLength = -1;
            int i = 0;
            while (i < spanLength)
            {
                switch (state)
                {
                case 1: finalMatchLength = i; break;
                case 2: finalMatchLength = i; break;
                }
                char c = span[i];
                switch (state)
                {
            case 0:
                    if ((c >= 'A' && c <= 'Z') || c == '_' || (c >= 'a' && c <= 'z'))
                    {
                        state = 1;
                        break;
                    }
                    else
                    {
                        goto end_match;
                    }

            case 1:
                    if ((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || c == '_' || (c >= 'a' && c <= 'z'))
                    {
                        state = 2;
                        break;
                    }
                    else
                    {
                        goto end_match;
                    }

            case 2:
                    if ((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || c == '_' || (c >= 'a' && c <= 'z'))
                    {
                        state = 2;
                        break;
                    }
                    else
                    {
                        goto end_match;
                    }

                    default:
                        goto end_match;
                }
                i++;
            }
            switch (state)
            {
                case 1: finalMatchLength = i; break;
                case 2: finalMatchLength = i; break;
            }
        end_match:
            if (finalMatchLength != -1)
            {
                matchedValue = span.Slice(0, finalMatchLength).ToString();
                return true;
            }
            return false;
        }


        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        private bool MatchDFA_Rule_17(ITextDocument text, int offset, out string matchedValue)
        {
            matchedValue = string.Empty;
            int textLength = text.Length;
            if (offset >= textLength) return false;
            ReadOnlyMemory<char> mem = text.GetText(offset, textLength - offset);
            ReadOnlySpan<char> span = mem.Span;
            int spanLength = span.Length;
            int state = 0;
            int finalMatchLength = -1;
            int i = 0;
            while (i < spanLength)
            {
                switch (state)
                {
                case 0: finalMatchLength = i; break;
                case 1: finalMatchLength = i; break;
                }
                char c = span[i];
                switch (state)
                {
            case 0:
                    if ((c >= '0' && c <= '9'))
                    {
                        state = 1;
                        break;
                    }
                    else
                    {
                        goto end_match;
                    }

            case 1:
                    if ((c >= '0' && c <= '9'))
                    {
                        state = 1;
                        break;
                    }
                    else
                    {
                        goto end_match;
                    }

                    default:
                        goto end_match;
                }
                i++;
            }
            switch (state)
            {
                case 0: finalMatchLength = i; break;
                case 1: finalMatchLength = i; break;
            }
        end_match:
            if (finalMatchLength != -1)
            {
                matchedValue = span.Slice(0, finalMatchLength).ToString();
                return true;
            }
            return false;
        }


        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        private bool MatchDFA_Rule_77(ITextDocument text, int offset, out string matchedValue)
        {
            matchedValue = string.Empty;
            int textLength = text.Length;
            if (offset >= textLength) return false;
            ReadOnlyMemory<char> mem = text.GetText(offset, textLength - offset);
            ReadOnlySpan<char> span = mem.Span;
            int spanLength = span.Length;
            int state = 0;
            int finalMatchLength = -1;
            int i = 0;
            while (i < spanLength)
            {
                switch (state)
                {
                case 1: finalMatchLength = i; break;
                case 2: finalMatchLength = i; break;
                case 3: finalMatchLength = i; break;
                }
                char c = span[i];
                switch (state)
                {
            case 0:
                    if (c == '#')
                    {
                        state = 1;
                        break;
                    }
                    else
                    {
                        goto end_match;
                    }

            case 1:
                    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'))
                    {
                        state = 3;
                        break;
                    }
                    // Fallback transition
                    state = 2;
                    break;

            case 2:
                    // Fallback transition
                    state = 2;
                    break;

            case 3:
                    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'))
                    {
                        state = 3;
                        break;
                    }
                    // Fallback transition
                    state = 2;
                    break;

                    default:
                        goto end_match;
                }
                i++;
            }
            switch (state)
            {
                case 1: finalMatchLength = i; break;
                case 2: finalMatchLength = i; break;
                case 3: finalMatchLength = i; break;
            }
        end_match:
            if (finalMatchLength != -1)
            {
                matchedValue = span.Slice(0, finalMatchLength).ToString();
                return true;
            }
            return false;
        }


        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        private bool MatchDFA_Spec_58(ITextDocument text, int offset, out string matchedValue)
        {
            matchedValue = string.Empty;
            int textLength = text.Length;
            if (offset >= textLength) return false;
            ReadOnlyMemory<char> mem = text.GetText(offset, textLength - offset);
            ReadOnlySpan<char> span = mem.Span;
            int spanLength = span.Length;
            int state = 0;
            int finalMatchLength = -1;
            int i = 0;
            while (i < spanLength)
            {
                switch (state)
                {
                case 0: finalMatchLength = i; break;
                case 1: finalMatchLength = i; break;
                }
                char c = span[i];
                switch (state)
                {
            case 0:
                    // Fallback transition
                    state = 1;
                    break;

            case 1:
                    // Fallback transition
                    state = 1;
                    break;

                    default:
                        goto end_match;
                }
                i++;
            }
            switch (state)
            {
                case 0: finalMatchLength = i; break;
                case 1: finalMatchLength = i; break;
            }
        end_match:
            if (finalMatchLength != -1)
            {
                matchedValue = span.Slice(0, finalMatchLength).ToString();
                return true;
            }
            return false;
        }

        public ParseResult Parse(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            return ParseHlslBlock(text, offset, memo, ctx);
        }
        public ParseResult ParseHlslBlock(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = 82;
            if (memo.TryGet(ruleId, offset, out var cached))
            {
                if(cached != null)
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
            
            int lastStructuralOffset = offset;
            int lastStructuralResultsCount = 0;

            // Choice Rule (id: 83)
            if (!panicked)
            {
                int startOffset_83 = currentOffset;
                bool choiceMatched_83 = false;
                int baseErrors_83 = ctx.RecoveredErrors.Count;
                GreenNode backupAst_83 = null;
                int backupOffset_83 = -1;
                List<ParseError> backupErrors_83 = null;

                // Speculative alternative check 1
                if (!choiceMatched_83)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_83, ctx.RecoveredErrors.Count - baseErrors_83);
                    const string lit_1 = "CGPROGRAM";
                        const int litLen_1 = 9;
                        bool matched_1 = ctx.MatchLiteral(text, currentOffset, lit_1, litLen_1);
                        GreenNode parsedAst_1 = matched_1 ? GreenNode.Create(NodeType.Literal, lit_1, 83, litLen_1) : null;
                        int newOffset_1 = matched_1 ? currentOffset + litLen_1 : currentOffset;
                        int prec_1 = 0;
                    if (matched_1)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_83;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_1 != null && (parsedAst_1.Width > 0 || parsedAst_1.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_1);
                            }
                            currentOffset = newOffset_1;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_83)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_83 = true;
                        }
                        else
                        {
                            if (backupAst_83 == null)
                            {
                                backupAst_83 = parsedAst_1;
                                backupOffset_83 = newOffset_1;
                                backupErrors_83 = ctx.RecoveredErrors.GetRange(baseErrors_83, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_83, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 2
                if (!choiceMatched_83)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_83, ctx.RecoveredErrors.Count - baseErrors_83);
                    const string lit_2 = "HLSLPROGRAM";
                        const int litLen_2 = 11;
                        bool matched_2 = ctx.MatchLiteral(text, currentOffset, lit_2, litLen_2);
                        GreenNode parsedAst_2 = matched_2 ? GreenNode.Create(NodeType.Literal, lit_2, 83, litLen_2) : null;
                        int newOffset_2 = matched_2 ? currentOffset + litLen_2 : currentOffset;
                        int prec_2 = 0;
                    if (matched_2)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_83;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_2 != null && (parsedAst_2.Width > 0 || parsedAst_2.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_2);
                            }
                            currentOffset = newOffset_2;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_83)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_83 = true;
                        }
                        else
                        {
                            if (backupAst_83 == null)
                            {
                                backupAst_83 = parsedAst_2;
                                backupOffset_83 = newOffset_2;
                                backupErrors_83 = ctx.RecoveredErrors.GetRange(baseErrors_83, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_83, branchErrorsCount);
                        }
                    }
                }
                if (!choiceMatched_83 && backupAst_83 != null)
                {
                    if (backupAst_83.Width > 0 || backupAst_83.Type == NodeType.Eof)
                    {
                        results.Add(backupAst_83);
                    }
                    currentOffset = backupOffset_83;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_83)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                    ctx.RecoveredErrors.AddRange(backupErrors_83);
                    choiceMatched_83 = true;
                }
                if (!choiceMatched_83)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_83, ctx.RecoveredErrors.Count - baseErrors_83);
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 83, "None of the choices matched in rule 83", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }

            // Optional Rule (id: 84)
            if (!panicked)
            {
                int startOffset_84 = currentOffset;
                int optErrors_84 = ctx.RecoveredErrors.Count;
                var res_3 = ParseS(text, currentOffset, memo, ctx);
                        bool matched_3 = res_3.Success;
                        GreenNode parsedAst_3 = matched_3 ? res_3.Ast : null;
                        int newOffset_3 = matched_3 ? res_3.NewOffset : currentOffset;
                        int prec_3 = 0;
                if (matched_3)
                {
                    if (parsedAst_3 != null && (parsedAst_3.Width > 0 || parsedAst_3.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_3);
                    }
                    currentOffset = newOffset_3;
                    if (false && currentOffset > startOffset_84)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_84, ctx.RecoveredErrors.Count - optErrors_84);
                }
            }

            // Zero Or More Rule (id: 88)
            if (!panicked)
            {
                int startOffset_88 = currentOffset;
                int startLoopOffset = currentOffset;
                var loopResults = new List<GreenNode>();
                while (currentOffset < text.Length)
                {
                    int beforeIterOffset = currentOffset;
                    int loopErrors_88 = ctx.RecoveredErrors.Count;
                    var res_4 = ParseHlslItem(text, currentOffset, memo, ctx);
                        bool matched_4 = res_4.Success;
                        GreenNode parsedAst_4 = matched_4 ? res_4.Ast : null;
                        int newOffset_4 = matched_4 ? res_4.NewOffset : currentOffset;
                        int prec_4 = 0;
                    if (matched_4 && newOffset_4 > beforeIterOffset)
                    {
                        loopResults.Add(parsedAst_4);
                        currentOffset = newOffset_4;
                    }
                    else
                    {
                        ctx.RecoveredErrors.RemoveRange(loopErrors_88, ctx.RecoveredErrors.Count - loopErrors_88);
                        break;
                    }
                }
                if (loopResults.Count > 0)
                {
                    results.Add(GreenNode.Create(NodeType.ZeroOrMore, loopResults, 88, currentOffset - startLoopOffset));
                    if (true && currentOffset > startOffset_88)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
            }

            // Optional Rule (id: 89)
            if (!panicked)
            {
                int startOffset_89 = currentOffset;
                int optErrors_89 = ctx.RecoveredErrors.Count;
                var res_5 = ParseS(text, currentOffset, memo, ctx);
                        bool matched_5 = res_5.Success;
                        GreenNode parsedAst_5 = matched_5 ? res_5.Ast : null;
                        int newOffset_5 = matched_5 ? res_5.NewOffset : currentOffset;
                        int prec_5 = 0;
                if (matched_5)
                {
                    if (parsedAst_5 != null && (parsedAst_5.Width > 0 || parsedAst_5.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_5);
                    }
                    currentOffset = newOffset_5;
                    if (false && currentOffset > startOffset_89)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_89, ctx.RecoveredErrors.Count - optErrors_89);
                }
            }

            // Choice Rule (id: 90)
            if (!panicked)
            {
                int startOffset_90 = currentOffset;
                bool choiceMatched_90 = false;
                int baseErrors_90 = ctx.RecoveredErrors.Count;
                GreenNode backupAst_90 = null;
                int backupOffset_90 = -1;
                List<ParseError> backupErrors_90 = null;

                // Speculative alternative check 6
                if (!choiceMatched_90)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_90, ctx.RecoveredErrors.Count - baseErrors_90);
                    const string lit_6 = "ENDCG";
                        const int litLen_6 = 5;
                        bool matched_6 = ctx.MatchLiteral(text, currentOffset, lit_6, litLen_6);
                        GreenNode parsedAst_6 = matched_6 ? GreenNode.Create(NodeType.Literal, lit_6, 90, litLen_6) : null;
                        int newOffset_6 = matched_6 ? currentOffset + litLen_6 : currentOffset;
                        int prec_6 = 0;
                    if (matched_6)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_90;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_6 != null && (parsedAst_6.Width > 0 || parsedAst_6.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_6);
                            }
                            currentOffset = newOffset_6;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_90)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_90 = true;
                        }
                        else
                        {
                            if (backupAst_90 == null)
                            {
                                backupAst_90 = parsedAst_6;
                                backupOffset_90 = newOffset_6;
                                backupErrors_90 = ctx.RecoveredErrors.GetRange(baseErrors_90, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_90, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 7
                if (!choiceMatched_90)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_90, ctx.RecoveredErrors.Count - baseErrors_90);
                    const string lit_7 = "ENDHLSL";
                        const int litLen_7 = 7;
                        bool matched_7 = ctx.MatchLiteral(text, currentOffset, lit_7, litLen_7);
                        GreenNode parsedAst_7 = matched_7 ? GreenNode.Create(NodeType.Literal, lit_7, 90, litLen_7) : null;
                        int newOffset_7 = matched_7 ? currentOffset + litLen_7 : currentOffset;
                        int prec_7 = 0;
                    if (matched_7)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_90;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_7 != null && (parsedAst_7.Width > 0 || parsedAst_7.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_7);
                            }
                            currentOffset = newOffset_7;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_90)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_90 = true;
                        }
                        else
                        {
                            if (backupAst_90 == null)
                            {
                                backupAst_90 = parsedAst_7;
                                backupOffset_90 = newOffset_7;
                                backupErrors_90 = ctx.RecoveredErrors.GetRange(baseErrors_90, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_90, branchErrorsCount);
                        }
                    }
                }
                if (!choiceMatched_90 && backupAst_90 != null)
                {
                    if (backupAst_90.Width > 0 || backupAst_90.Type == NodeType.Eof)
                    {
                        results.Add(backupAst_90);
                    }
                    currentOffset = backupOffset_90;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_90)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                    ctx.RecoveredErrors.AddRange(backupErrors_90);
                    choiceMatched_90 = true;
                }
                if (!choiceMatched_90)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_90, ctx.RecoveredErrors.Count - baseErrors_90);
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 90, "None of the choices matched in rule 90", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }
            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }
            var nextRes = new ParseResult
            {
                Success = true,
                Ast = GreenNode.Create(NodeType.HlslBlock, results, ruleId, currentOffset - offset),
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };
            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }

        public ParseResult ParseS(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = 5;
            if (memo.TryGet(ruleId, offset, out var cached))
            {
                if(cached != null)
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
            
            int lastStructuralOffset = offset;
            int lastStructuralResultsCount = 0;

            // Zero Or More Rule (id: 8)
            if (!panicked)
            {
                int startOffset_8 = currentOffset;
                int startLoopOffset = currentOffset;
                var loopResults = new List<GreenNode>();
                while (currentOffset < text.Length)
                {
                    int beforeIterOffset = currentOffset;
                    int loopErrors_8 = ctx.RecoveredErrors.Count;
                    var res_8 = ParseN(text, currentOffset, memo, ctx);
                        bool matched_8 = res_8.Success;
                        GreenNode parsedAst_8 = matched_8 ? res_8.Ast : null;
                        int newOffset_8 = matched_8 ? res_8.NewOffset : currentOffset;
                        int prec_8 = 0;
                    if (matched_8 && newOffset_8 > beforeIterOffset)
                    {
                        loopResults.Add(parsedAst_8);
                        currentOffset = newOffset_8;
                    }
                    else
                    {
                        ctx.RecoveredErrors.RemoveRange(loopErrors_8, ctx.RecoveredErrors.Count - loopErrors_8);
                        break;
                    }
                }
                if (loopResults.Count > 0)
                {
                    results.Add(GreenNode.Create(NodeType.ZeroOrMore, loopResults, 8, currentOffset - startLoopOffset));
                    if (true && currentOffset > startOffset_8)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
            }
            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }
            var nextRes = new ParseResult
            {
                Success = true,
                Ast = GreenNode.Create(NodeType.S, results, ruleId, currentOffset - offset),
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };
            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }

        public ParseResult ParseN(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = 6;
            if (memo.TryGet(ruleId, offset, out var cached))
            {
                if(cached != null)
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
            
            int lastStructuralOffset = offset;
            int lastStructuralResultsCount = 0;

            // Choice Rule (id: 7)
            if (!panicked)
            {
                int startOffset_7 = currentOffset;
                bool choiceMatched_7 = false;
                int baseErrors_7 = ctx.RecoveredErrors.Count;
                GreenNode backupAst_7 = null;
                int backupOffset_7 = -1;
                List<ParseError> backupErrors_7 = null;

                // Speculative alternative check 9
                if (!choiceMatched_7)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_7, ctx.RecoveredErrors.Count - baseErrors_7);
                    var res_9 = ParseWs(text, currentOffset, memo, ctx);
                        bool matched_9 = res_9.Success;
                        GreenNode parsedAst_9 = matched_9 ? res_9.Ast : null;
                        int newOffset_9 = matched_9 ? res_9.NewOffset : currentOffset;
                        int prec_9 = 0;
                    if (matched_9)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_7;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_9 != null && (parsedAst_9.Width > 0 || parsedAst_9.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_9);
                            }
                            currentOffset = newOffset_9;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_7)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_7 = true;
                        }
                        else
                        {
                            if (backupAst_7 == null)
                            {
                                backupAst_7 = parsedAst_9;
                                backupOffset_7 = newOffset_9;
                                backupErrors_7 = ctx.RecoveredErrors.GetRange(baseErrors_7, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_7, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 10
                if (!choiceMatched_7)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_7, ctx.RecoveredErrors.Count - baseErrors_7);
                    var res_10 = ParseLineComment(text, currentOffset, memo, ctx);
                        bool matched_10 = res_10.Success;
                        GreenNode parsedAst_10 = matched_10 ? res_10.Ast : null;
                        int newOffset_10 = matched_10 ? res_10.NewOffset : currentOffset;
                        int prec_10 = 0;
                    if (matched_10)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_7;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_10 != null && (parsedAst_10.Width > 0 || parsedAst_10.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_10);
                            }
                            currentOffset = newOffset_10;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_7)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_7 = true;
                        }
                        else
                        {
                            if (backupAst_7 == null)
                            {
                                backupAst_7 = parsedAst_10;
                                backupOffset_7 = newOffset_10;
                                backupErrors_7 = ctx.RecoveredErrors.GetRange(baseErrors_7, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_7, branchErrorsCount);
                        }
                    }
                }
                if (!choiceMatched_7 && backupAst_7 != null)
                {
                    if (backupAst_7.Width > 0 || backupAst_7.Type == NodeType.Eof)
                    {
                        results.Add(backupAst_7);
                    }
                    currentOffset = backupOffset_7;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_7)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                    ctx.RecoveredErrors.AddRange(backupErrors_7);
                    choiceMatched_7 = true;
                }
                if (!choiceMatched_7)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_7, ctx.RecoveredErrors.Count - baseErrors_7);
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 7, "None of the choices matched in rule 7", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }
            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }
            var nextRes = new ParseResult
            {
                Success = true,
                Ast = GreenNode.Create(NodeType.N, results, ruleId, currentOffset - offset),
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };
            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }

        public ParseResult ParseWs(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = 1;
            if (memo.TryGet(ruleId, offset, out var cached))
            {
                if(cached != null)
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
            
            int lastStructuralOffset = offset;
            int lastStructuralResultsCount = 0;

            // Whitespace Rule (id: 2)
            if (!panicked)
            {
                int startOffset_2 = currentOffset;
                int wsStart = currentOffset;
                while (currentOffset < text.Length && char.IsWhiteSpace(text[currentOffset]))
                {
                    currentOffset++;
                }
                localMaxOffset = Math.Max(localMaxOffset, currentOffset);
                if (currentOffset > wsStart)
                {
                    results.Add(GreenNode.Create(NodeType.Whitespace, text.GetText(wsStart, currentOffset - wsStart).ToString(), 2, currentOffset - wsStart));
                }
                else
                {
                    if (!TryRecover(text, (false && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 2, "Expected whitespace", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }
            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }
            var nextRes = new ParseResult
            {
                Success = true,
                Ast = GreenNode.Create(NodeType.Ws, results, ruleId, currentOffset - offset),
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };
            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }

        public ParseResult ParseLineComment(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = 3;
            if (memo.TryGet(ruleId, offset, out var cached))
            {
                if(cached != null)
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
            
            int lastStructuralOffset = offset;
            int lastStructuralResultsCount = 0;

            // Regex Rule: \/\/.*|\/\*[\s\S]*?\*\/ (id: 4)
            if (!panicked)
            {
                int startOffset_4 = currentOffset;
                string mval_4;
                if (MatchDFA_Rule_4(text, currentOffset, out mval_4))
                {
                    results.Add(GreenNode.Create(NodeType.Token, mval_4, 4, mval_4.Length));
                    currentOffset += mval_4.Length;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_4)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                    localMaxOffset = Math.Max(localMaxOffset, currentOffset);
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 4, "Expected match for pattern", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }
            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }
            var nextRes = new ParseResult
            {
                Success = true,
                Ast = GreenNode.Create(NodeType.LineComment, results, ruleId, currentOffset - offset),
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };
            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }

        public ParseResult ParseHlslItem(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = 85;
            if (memo.TryGet(ruleId, offset, out var cached))
            {
                if(cached != null)
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
            
            int lastStructuralOffset = offset;
            int lastStructuralResultsCount = 0;

            // Optional Rule (id: 86)
            if (!panicked)
            {
                int startOffset_86 = currentOffset;
                int optErrors_86 = ctx.RecoveredErrors.Count;
                var res_11 = ParseS(text, currentOffset, memo, ctx);
                        bool matched_11 = res_11.Success;
                        GreenNode parsedAst_11 = matched_11 ? res_11.Ast : null;
                        int newOffset_11 = matched_11 ? res_11.NewOffset : currentOffset;
                        int prec_11 = 0;
                if (matched_11)
                {
                    if (parsedAst_11 != null && (parsedAst_11.Width > 0 || parsedAst_11.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_11);
                    }
                    currentOffset = newOffset_11;
                    if (false && currentOffset > startOffset_86)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_86, ctx.RecoveredErrors.Count - optErrors_86);
                }
            }

            // Element Rule: hlsl_stmt (id: 87)
            if (!panicked)
            {
                int startOffset_87 = currentOffset;
                var res = ParseHlslStmt(text, currentOffset, memo, ctx);
                localMaxOffset = Math.Max(localMaxOffset, res.DependencyLimit);
                if (res.Success)
                {
                    if (res.Ast != null && (res.Ast.Width > 0 || res.Ast.Type == NodeType.Eof))
                    {
                        results.Add(res.Ast);
                    }
                    currentOffset = res.NewOffset;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_87)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 87, res.Error ?? "Expected sub-element hlsl_stmt", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }
            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }
            var nextRes = new ParseResult
            {
                Success = true,
                Ast = GreenNode.Create(NodeType.HlslItem, results, ruleId, currentOffset - offset),
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };
            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }

        public ParseResult ParseHlslStmt(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = 78;
            if (memo.TryGet(ruleId, offset, out var cached))
            {
                if(cached != null)
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
            
            int lastStructuralOffset = offset;
            int lastStructuralResultsCount = 0;

            // Not Lookahead Rule: (id: 79)
            if (!panicked)
            {
                int notErrors_79 = ctx.RecoveredErrors.Count;
                const string lit_12 = "ENDCG";
                        const int litLen_12 = 5;
                        bool matched_12 = ctx.MatchLiteral(text, currentOffset, lit_12, litLen_12);
                        GreenNode parsedAst_12 = matched_12 ? GreenNode.Create(NodeType.Literal, lit_12, 79, litLen_12) : null;
                        int newOffset_12 = matched_12 ? currentOffset + litLen_12 : currentOffset;
                        int prec_12 = 0;
                if (matched_12)
                {
                    ctx.RecoveredErrors.RemoveRange(notErrors_79, ctx.RecoveredErrors.Count - notErrors_79);
                    return new ParseResult
                    {
                        Success = false,
                        Error = "Encountered forbidden lookahead pattern",
                        NewOffset = currentOffset,
                        DependencyLimit = localMaxOffset,
                        RuleId = 79
                    };
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(notErrors_79, ctx.RecoveredErrors.Count - notErrors_79);
                }
            }

            // Not Lookahead Rule: (id: 80)
            if (!panicked)
            {
                int notErrors_80 = ctx.RecoveredErrors.Count;
                const string lit_13 = "ENDHLSL";
                        const int litLen_13 = 7;
                        bool matched_13 = ctx.MatchLiteral(text, currentOffset, lit_13, litLen_13);
                        GreenNode parsedAst_13 = matched_13 ? GreenNode.Create(NodeType.Literal, lit_13, 80, litLen_13) : null;
                        int newOffset_13 = matched_13 ? currentOffset + litLen_13 : currentOffset;
                        int prec_13 = 0;
                if (matched_13)
                {
                    ctx.RecoveredErrors.RemoveRange(notErrors_80, ctx.RecoveredErrors.Count - notErrors_80);
                    return new ParseResult
                    {
                        Success = false,
                        Error = "Encountered forbidden lookahead pattern",
                        NewOffset = currentOffset,
                        DependencyLimit = localMaxOffset,
                        RuleId = 80
                    };
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(notErrors_80, ctx.RecoveredErrors.Count - notErrors_80);
                }
            }

            // Choice Rule (id: 81)
            if (!panicked)
            {
                int startOffset_81 = currentOffset;
                bool choiceMatched_81 = false;
                int baseErrors_81 = ctx.RecoveredErrors.Count;
                GreenNode backupAst_81 = null;
                int backupOffset_81 = -1;
                List<ParseError> backupErrors_81 = null;

                // Speculative alternative check 14
                if (!choiceMatched_81)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_81, ctx.RecoveredErrors.Count - baseErrors_81);
                    var res_14 = ParseStruct(text, currentOffset, memo, ctx);
                        bool matched_14 = res_14.Success;
                        GreenNode parsedAst_14 = matched_14 ? res_14.Ast : null;
                        int newOffset_14 = matched_14 ? res_14.NewOffset : currentOffset;
                        int prec_14 = 0;
                    if (matched_14)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_81;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_14 != null && (parsedAst_14.Width > 0 || parsedAst_14.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_14);
                            }
                            currentOffset = newOffset_14;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_81)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_81 = true;
                        }
                        else
                        {
                            if (backupAst_81 == null)
                            {
                                backupAst_81 = parsedAst_14;
                                backupOffset_81 = newOffset_14;
                                backupErrors_81 = ctx.RecoveredErrors.GetRange(baseErrors_81, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_81, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 15
                if (!choiceMatched_81)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_81, ctx.RecoveredErrors.Count - baseErrors_81);
                    var res_15 = ParseFunction(text, currentOffset, memo, ctx);
                        bool matched_15 = res_15.Success;
                        GreenNode parsedAst_15 = matched_15 ? res_15.Ast : null;
                        int newOffset_15 = matched_15 ? res_15.NewOffset : currentOffset;
                        int prec_15 = 0;
                    if (matched_15)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_81;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_15 != null && (parsedAst_15.Width > 0 || parsedAst_15.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_15);
                            }
                            currentOffset = newOffset_15;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_81)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_81 = true;
                        }
                        else
                        {
                            if (backupAst_81 == null)
                            {
                                backupAst_81 = parsedAst_15;
                                backupOffset_81 = newOffset_15;
                                backupErrors_81 = ctx.RecoveredErrors.GetRange(baseErrors_81, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_81, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 16
                if (!choiceMatched_81)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_81, ctx.RecoveredErrors.Count - baseErrors_81);
                    var res_16 = ParseVarDecl(text, currentOffset, memo, ctx);
                        bool matched_16 = res_16.Success;
                        GreenNode parsedAst_16 = matched_16 ? res_16.Ast : null;
                        int newOffset_16 = matched_16 ? res_16.NewOffset : currentOffset;
                        int prec_16 = 0;
                    if (matched_16)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_81;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_16 != null && (parsedAst_16.Width > 0 || parsedAst_16.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_16);
                            }
                            currentOffset = newOffset_16;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_81)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_81 = true;
                        }
                        else
                        {
                            if (backupAst_81 == null)
                            {
                                backupAst_81 = parsedAst_16;
                                backupOffset_81 = newOffset_16;
                                backupErrors_81 = ctx.RecoveredErrors.GetRange(baseErrors_81, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_81, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 17
                if (!choiceMatched_81)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_81, ctx.RecoveredErrors.Count - baseErrors_81);
                    var res_17 = ParseDirective(text, currentOffset, memo, ctx);
                        bool matched_17 = res_17.Success;
                        GreenNode parsedAst_17 = matched_17 ? res_17.Ast : null;
                        int newOffset_17 = matched_17 ? res_17.NewOffset : currentOffset;
                        int prec_17 = 0;
                    if (matched_17)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_81;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_17 != null && (parsedAst_17.Width > 0 || parsedAst_17.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_17);
                            }
                            currentOffset = newOffset_17;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_81)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_81 = true;
                        }
                        else
                        {
                            if (backupAst_81 == null)
                            {
                                backupAst_81 = parsedAst_17;
                                backupOffset_81 = newOffset_17;
                                backupErrors_81 = ctx.RecoveredErrors.GetRange(baseErrors_81, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_81, branchErrorsCount);
                        }
                    }
                }
                if (!choiceMatched_81 && backupAst_81 != null)
                {
                    if (backupAst_81.Width > 0 || backupAst_81.Type == NodeType.Eof)
                    {
                        results.Add(backupAst_81);
                    }
                    currentOffset = backupOffset_81;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_81)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                    ctx.RecoveredErrors.AddRange(backupErrors_81);
                    choiceMatched_81 = true;
                }
                if (!choiceMatched_81)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_81, ctx.RecoveredErrors.Count - baseErrors_81);
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 81, "None of the choices matched in rule 81", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }
            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }
            var nextRes = new ParseResult
            {
                Success = true,
                Ast = GreenNode.Create(NodeType.HlslStmt, results, ruleId, currentOffset - offset),
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };
            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }

        public ParseResult ParseStruct(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = 42;
            if (memo.TryGet(ruleId, offset, out var cached))
            {
                if(cached != null)
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
            
            int lastStructuralOffset = offset;
            int lastStructuralResultsCount = 0;

            // Literal Rule: "struct" (id: 43)
            if (!panicked)
            {
                int startOffset_43 = currentOffset;
                const string lit = "struct";
                const int litLen = 6;
                localMaxOffset = Math.Max(localMaxOffset, currentOffset + litLen);
                if (ctx.MatchLiteral(text, currentOffset, lit, litLen))
                {
                    results.Add(GreenNode.Create(NodeType.Literal, lit, 43, litLen));
                    currentOffset += litLen;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_43)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 43, "Expected literal \"struct\"", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes; // Handled recovery boundary hit
                }
            }

            // Element Rule: s (id: 44)
            if (!panicked)
            {
                int startOffset_44 = currentOffset;
                var res = ParseS(text, currentOffset, memo, ctx);
                localMaxOffset = Math.Max(localMaxOffset, res.DependencyLimit);
                if (res.Success)
                {
                    if (res.Ast != null && (res.Ast.Width > 0 || res.Ast.Type == NodeType.Eof))
                    {
                        results.Add(res.Ast);
                    }
                    currentOffset = res.NewOffset;
                    hasCommitted = true;
                    if (false && currentOffset > startOffset_44)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (false && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 44, res.Error ?? "Expected sub-element s", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }

            // Element Rule: id (id: 45)
            if (!panicked)
            {
                int startOffset_45 = currentOffset;
                var res = ParseId(text, currentOffset, memo, ctx);
                localMaxOffset = Math.Max(localMaxOffset, res.DependencyLimit);
                if (res.Success)
                {
                    if (res.Ast != null && (res.Ast.Width > 0 || res.Ast.Type == NodeType.Eof))
                    {
                        results.Add(res.Ast);
                    }
                    currentOffset = res.NewOffset;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_45)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 45, res.Error ?? "Expected sub-element id", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }

            // Optional Rule (id: 46)
            if (!panicked)
            {
                int startOffset_46 = currentOffset;
                int optErrors_46 = ctx.RecoveredErrors.Count;
                var res_18 = ParseS(text, currentOffset, memo, ctx);
                        bool matched_18 = res_18.Success;
                        GreenNode parsedAst_18 = matched_18 ? res_18.Ast : null;
                        int newOffset_18 = matched_18 ? res_18.NewOffset : currentOffset;
                        int prec_18 = 0;
                if (matched_18)
                {
                    if (parsedAst_18 != null && (parsedAst_18.Width > 0 || parsedAst_18.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_18);
                    }
                    currentOffset = newOffset_18;
                    if (false && currentOffset > startOffset_46)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_46, ctx.RecoveredErrors.Count - optErrors_46);
                }
            }

            // BeginScope Rule (id: 47)
            if (!panicked)
            {
                int startOffset_47 = currentOffset;
                const string lit = "{";
                const int litLen = 1;
                localMaxOffset = Math.Max(localMaxOffset, currentOffset + litLen);
                if (ctx.MatchLiteral(text, currentOffset, lit, litLen))
                {
                    results.Add(GreenNode.Create(NodeType.Literal, lit, 47, litLen));
                    currentOffset += litLen;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_47)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 47, "Expected scope start \"{\"", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
                if (!panicked)
                {
                    ctx.ActiveScopeEnds.Add("}");
                }
            }

            // Zero Or More Rule (id: 51)
            if (!panicked)
            {
                int startOffset_51 = currentOffset;
                int startLoopOffset = currentOffset;
                var loopResults = new List<GreenNode>();
                while (currentOffset < text.Length)
                {
                    int beforeIterOffset = currentOffset;
                    int loopErrors_51 = ctx.RecoveredErrors.Count;
                    var res_19 = ParseStructMemberWrapper(text, currentOffset, memo, ctx);
                        bool matched_19 = res_19.Success;
                        GreenNode parsedAst_19 = matched_19 ? res_19.Ast : null;
                        int newOffset_19 = matched_19 ? res_19.NewOffset : currentOffset;
                        int prec_19 = 0;
                    if (matched_19 && newOffset_19 > beforeIterOffset)
                    {
                        loopResults.Add(parsedAst_19);
                        currentOffset = newOffset_19;
                    }
                    else
                    {
                        ctx.RecoveredErrors.RemoveRange(loopErrors_51, ctx.RecoveredErrors.Count - loopErrors_51);
                        break;
                    }
                }
                if (loopResults.Count > 0)
                {
                    results.Add(GreenNode.Create(NodeType.ZeroOrMore, loopResults, 51, currentOffset - startLoopOffset));
                    if (true && currentOffset > startOffset_51)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
            }

            // Optional Rule (id: 52)
            if (!panicked)
            {
                int startOffset_52 = currentOffset;
                int optErrors_52 = ctx.RecoveredErrors.Count;
                var res_20 = ParseS(text, currentOffset, memo, ctx);
                        bool matched_20 = res_20.Success;
                        GreenNode parsedAst_20 = matched_20 ? res_20.Ast : null;
                        int newOffset_20 = matched_20 ? res_20.NewOffset : currentOffset;
                        int prec_20 = 0;
                if (matched_20)
                {
                    if (parsedAst_20 != null && (parsedAst_20.Width > 0 || parsedAst_20.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_20);
                    }
                    currentOffset = newOffset_20;
                    if (false && currentOffset > startOffset_52)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_52, ctx.RecoveredErrors.Count - optErrors_52);
                }
            }

            // EndScope Rule (id: 53)
            if (!panicked)
            {
                int startOffset_53 = currentOffset;
                const string lit = "}";
                const int litLen = 1;
                localMaxOffset = Math.Max(localMaxOffset, currentOffset + litLen);
                if (ctx.MatchLiteral(text, currentOffset, lit, litLen))
                {
                    results.Add(GreenNode.Create(NodeType.Literal, lit, 53, litLen));
                    currentOffset += litLen;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_53)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 53, "Expected scope end \"}\"", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
                int popIdx = ctx.ActiveScopeEnds.LastIndexOf("}");
                if (popIdx != -1) ctx.ActiveScopeEnds.RemoveAt(popIdx);
            }

            // Optional Rule (id: 54)
            if (!panicked)
            {
                int startOffset_54 = currentOffset;
                int optErrors_54 = ctx.RecoveredErrors.Count;
                var res_21 = ParseS(text, currentOffset, memo, ctx);
                        bool matched_21 = res_21.Success;
                        GreenNode parsedAst_21 = matched_21 ? res_21.Ast : null;
                        int newOffset_21 = matched_21 ? res_21.NewOffset : currentOffset;
                        int prec_21 = 0;
                if (matched_21)
                {
                    if (parsedAst_21 != null && (parsedAst_21.Width > 0 || parsedAst_21.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_21);
                    }
                    currentOffset = newOffset_21;
                    if (false && currentOffset > startOffset_54)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_54, ctx.RecoveredErrors.Count - optErrors_54);
                }
            }

            // Literal Rule: ";" (id: 55)
            if (!panicked)
            {
                int startOffset_55 = currentOffset;
                const string lit = ";";
                const int litLen = 1;
                localMaxOffset = Math.Max(localMaxOffset, currentOffset + litLen);
                if (ctx.MatchLiteral(text, currentOffset, lit, litLen))
                {
                    results.Add(GreenNode.Create(NodeType.Literal, lit, 55, litLen));
                    currentOffset += litLen;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_55)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 55, "Expected literal \";\"", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes; // Handled recovery boundary hit
                }
            }
            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }
            var nextRes = new ParseResult
            {
                Success = true,
                Ast = GreenNode.Create(NodeType.Struct, results, ruleId, currentOffset - offset),
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };
            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }

        public ParseResult ParseId(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = 9;
            if (memo.TryGet(ruleId, offset, out var cached))
            {
                if(cached != null)
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
            
            int lastStructuralOffset = offset;
            int lastStructuralResultsCount = 0;

            // Regex Rule: [a-zA-Z_][a-zA-Z0-9_]* (id: 10)
            if (!panicked)
            {
                int startOffset_10 = currentOffset;
                string mval_10;
                if (MatchDFA_Rule_10(text, currentOffset, out mval_10))
                {
                    results.Add(GreenNode.Create(NodeType.Token, mval_10, 10, mval_10.Length));
                    currentOffset += mval_10.Length;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_10)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                    localMaxOffset = Math.Max(localMaxOffset, currentOffset);
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 10, "Expected match for pattern", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }
            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }
            var nextRes = new ParseResult
            {
                Success = true,
                Ast = GreenNode.Create(NodeType.Id, results, ruleId, currentOffset - offset),
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };
            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }

        public ParseResult ParseStructMemberWrapper(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = 48;
            if (memo.TryGet(ruleId, offset, out var cached))
            {
                if(cached != null)
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
            
            int lastStructuralOffset = offset;
            int lastStructuralResultsCount = 0;

            // Optional Rule (id: 49)
            if (!panicked)
            {
                int startOffset_49 = currentOffset;
                int optErrors_49 = ctx.RecoveredErrors.Count;
                var res_22 = ParseS(text, currentOffset, memo, ctx);
                        bool matched_22 = res_22.Success;
                        GreenNode parsedAst_22 = matched_22 ? res_22.Ast : null;
                        int newOffset_22 = matched_22 ? res_22.NewOffset : currentOffset;
                        int prec_22 = 0;
                if (matched_22)
                {
                    if (parsedAst_22 != null && (parsedAst_22.Width > 0 || parsedAst_22.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_22);
                    }
                    currentOffset = newOffset_22;
                    if (false && currentOffset > startOffset_49)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_49, ctx.RecoveredErrors.Count - optErrors_49);
                }
            }

            // Element Rule: struct_member (id: 50)
            if (!panicked)
            {
                int startOffset_50 = currentOffset;
                var res = ParseStructMember(text, currentOffset, memo, ctx);
                localMaxOffset = Math.Max(localMaxOffset, res.DependencyLimit);
                if (res.Success)
                {
                    if (res.Ast != null && (res.Ast.Width > 0 || res.Ast.Type == NodeType.Eof))
                    {
                        results.Add(res.Ast);
                    }
                    currentOffset = res.NewOffset;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_50)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 50, res.Error ?? "Expected sub-element struct_member", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }
            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }
            var nextRes = new ParseResult
            {
                Success = true,
                Ast = GreenNode.Create(NodeType.StructMemberWrapper, results, ruleId, currentOffset - offset),
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };
            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }

        public ParseResult ParseStructMember(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = 39;
            if (memo.TryGet(ruleId, offset, out var cached))
            {
                if(cached != null)
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
            
            int lastStructuralOffset = offset;
            int lastStructuralResultsCount = 0;

            // Optional Rule (id: 40)
            if (!panicked)
            {
                int startOffset_40 = currentOffset;
                int optErrors_40 = ctx.RecoveredErrors.Count;
                var res_23 = ParseS(text, currentOffset, memo, ctx);
                        bool matched_23 = res_23.Success;
                        GreenNode parsedAst_23 = matched_23 ? res_23.Ast : null;
                        int newOffset_23 = matched_23 ? res_23.NewOffset : currentOffset;
                        int prec_23 = 0;
                if (matched_23)
                {
                    if (parsedAst_23 != null && (parsedAst_23.Width > 0 || parsedAst_23.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_23);
                    }
                    currentOffset = newOffset_23;
                    if (false && currentOffset > startOffset_40)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_40, ctx.RecoveredErrors.Count - optErrors_40);
                }
            }

            // Choice Rule (id: 41)
            if (!panicked)
            {
                int startOffset_41 = currentOffset;
                bool choiceMatched_41 = false;
                int baseErrors_41 = ctx.RecoveredErrors.Count;
                GreenNode backupAst_41 = null;
                int backupOffset_41 = -1;
                List<ParseError> backupErrors_41 = null;

                // Speculative alternative check 24
                if (!choiceMatched_41)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_41, ctx.RecoveredErrors.Count - baseErrors_41);
                    var res_24 = ParseVarDecl(text, currentOffset, memo, ctx);
                        bool matched_24 = res_24.Success;
                        GreenNode parsedAst_24 = matched_24 ? res_24.Ast : null;
                        int newOffset_24 = matched_24 ? res_24.NewOffset : currentOffset;
                        int prec_24 = 0;
                    if (matched_24)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_41;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_24 != null && (parsedAst_24.Width > 0 || parsedAst_24.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_24);
                            }
                            currentOffset = newOffset_24;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_41)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_41 = true;
                        }
                        else
                        {
                            if (backupAst_41 == null)
                            {
                                backupAst_41 = parsedAst_24;
                                backupOffset_41 = newOffset_24;
                                backupErrors_41 = ctx.RecoveredErrors.GetRange(baseErrors_41, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_41, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 25
                if (!choiceMatched_41)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_41, ctx.RecoveredErrors.Count - baseErrors_41);
                    var res_25 = ParseLineComment(text, currentOffset, memo, ctx);
                        bool matched_25 = res_25.Success;
                        GreenNode parsedAst_25 = matched_25 ? res_25.Ast : null;
                        int newOffset_25 = matched_25 ? res_25.NewOffset : currentOffset;
                        int prec_25 = 0;
                    if (matched_25)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_41;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_25 != null && (parsedAst_25.Width > 0 || parsedAst_25.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_25);
                            }
                            currentOffset = newOffset_25;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_41)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_41 = true;
                        }
                        else
                        {
                            if (backupAst_41 == null)
                            {
                                backupAst_41 = parsedAst_25;
                                backupOffset_41 = newOffset_25;
                                backupErrors_41 = ctx.RecoveredErrors.GetRange(baseErrors_41, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_41, branchErrorsCount);
                        }
                    }
                }
                if (!choiceMatched_41 && backupAst_41 != null)
                {
                    if (backupAst_41.Width > 0 || backupAst_41.Type == NodeType.Eof)
                    {
                        results.Add(backupAst_41);
                    }
                    currentOffset = backupOffset_41;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_41)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                    ctx.RecoveredErrors.AddRange(backupErrors_41);
                    choiceMatched_41 = true;
                }
                if (!choiceMatched_41)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_41, ctx.RecoveredErrors.Count - baseErrors_41);
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 41, "None of the choices matched in rule 41", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }
            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }
            var nextRes = new ParseResult
            {
                Success = true,
                Ast = GreenNode.Create(NodeType.StructMember, results, ruleId, currentOffset - offset),
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };
            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }

        public ParseResult ParseVarDecl(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = 25;
            if (memo.TryGet(ruleId, offset, out var cached))
            {
                if(cached != null)
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
            
            int lastStructuralOffset = offset;
            int lastStructuralResultsCount = 0;

            // Element Rule: hlsl_type (id: 26)
            if (!panicked)
            {
                int startOffset_26 = currentOffset;
                var res = ParseHlslType(text, currentOffset, memo, ctx);
                localMaxOffset = Math.Max(localMaxOffset, res.DependencyLimit);
                if (res.Success)
                {
                    if (res.Ast != null && (res.Ast.Width > 0 || res.Ast.Type == NodeType.Eof))
                    {
                        results.Add(res.Ast);
                    }
                    currentOffset = res.NewOffset;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_26)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 26, res.Error ?? "Expected sub-element hlsl_type", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }

            // Element Rule: s (id: 27)
            if (!panicked)
            {
                int startOffset_27 = currentOffset;
                var res = ParseS(text, currentOffset, memo, ctx);
                localMaxOffset = Math.Max(localMaxOffset, res.DependencyLimit);
                if (res.Success)
                {
                    if (res.Ast != null && (res.Ast.Width > 0 || res.Ast.Type == NodeType.Eof))
                    {
                        results.Add(res.Ast);
                    }
                    currentOffset = res.NewOffset;
                    hasCommitted = true;
                    if (false && currentOffset > startOffset_27)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (false && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 27, res.Error ?? "Expected sub-element s", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }

            // Element Rule: id (id: 28)
            if (!panicked)
            {
                int startOffset_28 = currentOffset;
                var res = ParseId(text, currentOffset, memo, ctx);
                localMaxOffset = Math.Max(localMaxOffset, res.DependencyLimit);
                if (res.Success)
                {
                    if (res.Ast != null && (res.Ast.Width > 0 || res.Ast.Type == NodeType.Eof))
                    {
                        results.Add(res.Ast);
                    }
                    currentOffset = res.NewOffset;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_28)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 28, res.Error ?? "Expected sub-element id", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }

            // Optional Rule (id: 32)
            if (!panicked)
            {
                int startOffset_32 = currentOffset;
                int optErrors_32 = ctx.RecoveredErrors.Count;
                var res_26 = ParseOptArray(text, currentOffset, memo, ctx);
                        bool matched_26 = res_26.Success;
                        GreenNode parsedAst_26 = matched_26 ? res_26.Ast : null;
                        int newOffset_26 = matched_26 ? res_26.NewOffset : currentOffset;
                        int prec_26 = 0;
                if (matched_26)
                {
                    if (parsedAst_26 != null && (parsedAst_26.Width > 0 || parsedAst_26.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_26);
                    }
                    currentOffset = newOffset_26;
                    if (true && currentOffset > startOffset_32)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_32, ctx.RecoveredErrors.Count - optErrors_32);
                }
            }

            // Optional Rule (id: 36)
            if (!panicked)
            {
                int startOffset_36 = currentOffset;
                int optErrors_36 = ctx.RecoveredErrors.Count;
                var res_27 = ParseSemOpt(text, currentOffset, memo, ctx);
                        bool matched_27 = res_27.Success;
                        GreenNode parsedAst_27 = matched_27 ? res_27.Ast : null;
                        int newOffset_27 = matched_27 ? res_27.NewOffset : currentOffset;
                        int prec_27 = 0;
                if (matched_27)
                {
                    if (parsedAst_27 != null && (parsedAst_27.Width > 0 || parsedAst_27.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_27);
                    }
                    currentOffset = newOffset_27;
                    if (true && currentOffset > startOffset_36)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_36, ctx.RecoveredErrors.Count - optErrors_36);
                }
            }

            // Optional Rule (id: 37)
            if (!panicked)
            {
                int startOffset_37 = currentOffset;
                int optErrors_37 = ctx.RecoveredErrors.Count;
                var res_28 = ParseS(text, currentOffset, memo, ctx);
                        bool matched_28 = res_28.Success;
                        GreenNode parsedAst_28 = matched_28 ? res_28.Ast : null;
                        int newOffset_28 = matched_28 ? res_28.NewOffset : currentOffset;
                        int prec_28 = 0;
                if (matched_28)
                {
                    if (parsedAst_28 != null && (parsedAst_28.Width > 0 || parsedAst_28.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_28);
                    }
                    currentOffset = newOffset_28;
                    if (false && currentOffset > startOffset_37)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_37, ctx.RecoveredErrors.Count - optErrors_37);
                }
            }

            // Literal Rule: ";" (id: 38)
            if (!panicked)
            {
                int startOffset_38 = currentOffset;
                const string lit = ";";
                const int litLen = 1;
                localMaxOffset = Math.Max(localMaxOffset, currentOffset + litLen);
                if (ctx.MatchLiteral(text, currentOffset, lit, litLen))
                {
                    results.Add(GreenNode.Create(NodeType.Literal, lit, 38, litLen));
                    currentOffset += litLen;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_38)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 38, "Expected literal \";\"", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes; // Handled recovery boundary hit
                }
            }
            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }
            var nextRes = new ParseResult
            {
                Success = true,
                Ast = GreenNode.Create(NodeType.VarDecl, results, ruleId, currentOffset - offset),
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };
            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }

        public ParseResult ParseHlslType(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = 11;
            if (memo.TryGet(ruleId, offset, out var cached))
            {
                if(cached != null)
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
            
            int lastStructuralOffset = offset;
            int lastStructuralResultsCount = 0;

            // Choice Rule (id: 12)
            if (!panicked)
            {
                int startOffset_12 = currentOffset;
                bool choiceMatched_12 = false;
                int baseErrors_12 = ctx.RecoveredErrors.Count;
                GreenNode backupAst_12 = null;
                int backupOffset_12 = -1;
                List<ParseError> backupErrors_12 = null;

                // Speculative alternative check 29
                if (!choiceMatched_12)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_12, ctx.RecoveredErrors.Count - baseErrors_12);
                    const string lit_29 = "float4";
                        const int litLen_29 = 6;
                        bool matched_29 = ctx.MatchLiteral(text, currentOffset, lit_29, litLen_29);
                        GreenNode parsedAst_29 = matched_29 ? GreenNode.Create(NodeType.Literal, lit_29, 12, litLen_29) : null;
                        int newOffset_29 = matched_29 ? currentOffset + litLen_29 : currentOffset;
                        int prec_29 = 0;
                    if (matched_29)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_12;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_29 != null && (parsedAst_29.Width > 0 || parsedAst_29.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_29);
                            }
                            currentOffset = newOffset_29;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_12)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_12 = true;
                        }
                        else
                        {
                            if (backupAst_12 == null)
                            {
                                backupAst_12 = parsedAst_29;
                                backupOffset_12 = newOffset_29;
                                backupErrors_12 = ctx.RecoveredErrors.GetRange(baseErrors_12, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_12, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 30
                if (!choiceMatched_12)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_12, ctx.RecoveredErrors.Count - baseErrors_12);
                    const string lit_30 = "float3";
                        const int litLen_30 = 6;
                        bool matched_30 = ctx.MatchLiteral(text, currentOffset, lit_30, litLen_30);
                        GreenNode parsedAst_30 = matched_30 ? GreenNode.Create(NodeType.Literal, lit_30, 12, litLen_30) : null;
                        int newOffset_30 = matched_30 ? currentOffset + litLen_30 : currentOffset;
                        int prec_30 = 0;
                    if (matched_30)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_12;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_30 != null && (parsedAst_30.Width > 0 || parsedAst_30.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_30);
                            }
                            currentOffset = newOffset_30;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_12)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_12 = true;
                        }
                        else
                        {
                            if (backupAst_12 == null)
                            {
                                backupAst_12 = parsedAst_30;
                                backupOffset_12 = newOffset_30;
                                backupErrors_12 = ctx.RecoveredErrors.GetRange(baseErrors_12, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_12, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 31
                if (!choiceMatched_12)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_12, ctx.RecoveredErrors.Count - baseErrors_12);
                    const string lit_31 = "float2";
                        const int litLen_31 = 6;
                        bool matched_31 = ctx.MatchLiteral(text, currentOffset, lit_31, litLen_31);
                        GreenNode parsedAst_31 = matched_31 ? GreenNode.Create(NodeType.Literal, lit_31, 12, litLen_31) : null;
                        int newOffset_31 = matched_31 ? currentOffset + litLen_31 : currentOffset;
                        int prec_31 = 0;
                    if (matched_31)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_12;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_31 != null && (parsedAst_31.Width > 0 || parsedAst_31.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_31);
                            }
                            currentOffset = newOffset_31;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_12)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_12 = true;
                        }
                        else
                        {
                            if (backupAst_12 == null)
                            {
                                backupAst_12 = parsedAst_31;
                                backupOffset_12 = newOffset_31;
                                backupErrors_12 = ctx.RecoveredErrors.GetRange(baseErrors_12, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_12, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 32
                if (!choiceMatched_12)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_12, ctx.RecoveredErrors.Count - baseErrors_12);
                    const string lit_32 = "float";
                        const int litLen_32 = 5;
                        bool matched_32 = ctx.MatchLiteral(text, currentOffset, lit_32, litLen_32);
                        GreenNode parsedAst_32 = matched_32 ? GreenNode.Create(NodeType.Literal, lit_32, 12, litLen_32) : null;
                        int newOffset_32 = matched_32 ? currentOffset + litLen_32 : currentOffset;
                        int prec_32 = 0;
                    if (matched_32)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_12;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_32 != null && (parsedAst_32.Width > 0 || parsedAst_32.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_32);
                            }
                            currentOffset = newOffset_32;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_12)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_12 = true;
                        }
                        else
                        {
                            if (backupAst_12 == null)
                            {
                                backupAst_12 = parsedAst_32;
                                backupOffset_12 = newOffset_32;
                                backupErrors_12 = ctx.RecoveredErrors.GetRange(baseErrors_12, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_12, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 33
                if (!choiceMatched_12)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_12, ctx.RecoveredErrors.Count - baseErrors_12);
                    const string lit_33 = "half4";
                        const int litLen_33 = 5;
                        bool matched_33 = ctx.MatchLiteral(text, currentOffset, lit_33, litLen_33);
                        GreenNode parsedAst_33 = matched_33 ? GreenNode.Create(NodeType.Literal, lit_33, 12, litLen_33) : null;
                        int newOffset_33 = matched_33 ? currentOffset + litLen_33 : currentOffset;
                        int prec_33 = 0;
                    if (matched_33)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_12;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_33 != null && (parsedAst_33.Width > 0 || parsedAst_33.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_33);
                            }
                            currentOffset = newOffset_33;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_12)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_12 = true;
                        }
                        else
                        {
                            if (backupAst_12 == null)
                            {
                                backupAst_12 = parsedAst_33;
                                backupOffset_12 = newOffset_33;
                                backupErrors_12 = ctx.RecoveredErrors.GetRange(baseErrors_12, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_12, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 34
                if (!choiceMatched_12)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_12, ctx.RecoveredErrors.Count - baseErrors_12);
                    const string lit_34 = "half3";
                        const int litLen_34 = 5;
                        bool matched_34 = ctx.MatchLiteral(text, currentOffset, lit_34, litLen_34);
                        GreenNode parsedAst_34 = matched_34 ? GreenNode.Create(NodeType.Literal, lit_34, 12, litLen_34) : null;
                        int newOffset_34 = matched_34 ? currentOffset + litLen_34 : currentOffset;
                        int prec_34 = 0;
                    if (matched_34)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_12;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_34 != null && (parsedAst_34.Width > 0 || parsedAst_34.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_34);
                            }
                            currentOffset = newOffset_34;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_12)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_12 = true;
                        }
                        else
                        {
                            if (backupAst_12 == null)
                            {
                                backupAst_12 = parsedAst_34;
                                backupOffset_12 = newOffset_34;
                                backupErrors_12 = ctx.RecoveredErrors.GetRange(baseErrors_12, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_12, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 35
                if (!choiceMatched_12)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_12, ctx.RecoveredErrors.Count - baseErrors_12);
                    const string lit_35 = "half2";
                        const int litLen_35 = 5;
                        bool matched_35 = ctx.MatchLiteral(text, currentOffset, lit_35, litLen_35);
                        GreenNode parsedAst_35 = matched_35 ? GreenNode.Create(NodeType.Literal, lit_35, 12, litLen_35) : null;
                        int newOffset_35 = matched_35 ? currentOffset + litLen_35 : currentOffset;
                        int prec_35 = 0;
                    if (matched_35)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_12;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_35 != null && (parsedAst_35.Width > 0 || parsedAst_35.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_35);
                            }
                            currentOffset = newOffset_35;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_12)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_12 = true;
                        }
                        else
                        {
                            if (backupAst_12 == null)
                            {
                                backupAst_12 = parsedAst_35;
                                backupOffset_12 = newOffset_35;
                                backupErrors_12 = ctx.RecoveredErrors.GetRange(baseErrors_12, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_12, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 36
                if (!choiceMatched_12)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_12, ctx.RecoveredErrors.Count - baseErrors_12);
                    const string lit_36 = "half";
                        const int litLen_36 = 4;
                        bool matched_36 = ctx.MatchLiteral(text, currentOffset, lit_36, litLen_36);
                        GreenNode parsedAst_36 = matched_36 ? GreenNode.Create(NodeType.Literal, lit_36, 12, litLen_36) : null;
                        int newOffset_36 = matched_36 ? currentOffset + litLen_36 : currentOffset;
                        int prec_36 = 0;
                    if (matched_36)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_12;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_36 != null && (parsedAst_36.Width > 0 || parsedAst_36.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_36);
                            }
                            currentOffset = newOffset_36;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_12)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_12 = true;
                        }
                        else
                        {
                            if (backupAst_12 == null)
                            {
                                backupAst_12 = parsedAst_36;
                                backupOffset_12 = newOffset_36;
                                backupErrors_12 = ctx.RecoveredErrors.GetRange(baseErrors_12, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_12, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 37
                if (!choiceMatched_12)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_12, ctx.RecoveredErrors.Count - baseErrors_12);
                    const string lit_37 = "fixed4";
                        const int litLen_37 = 6;
                        bool matched_37 = ctx.MatchLiteral(text, currentOffset, lit_37, litLen_37);
                        GreenNode parsedAst_37 = matched_37 ? GreenNode.Create(NodeType.Literal, lit_37, 12, litLen_37) : null;
                        int newOffset_37 = matched_37 ? currentOffset + litLen_37 : currentOffset;
                        int prec_37 = 0;
                    if (matched_37)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_12;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_37 != null && (parsedAst_37.Width > 0 || parsedAst_37.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_37);
                            }
                            currentOffset = newOffset_37;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_12)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_12 = true;
                        }
                        else
                        {
                            if (backupAst_12 == null)
                            {
                                backupAst_12 = parsedAst_37;
                                backupOffset_12 = newOffset_37;
                                backupErrors_12 = ctx.RecoveredErrors.GetRange(baseErrors_12, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_12, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 38
                if (!choiceMatched_12)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_12, ctx.RecoveredErrors.Count - baseErrors_12);
                    const string lit_38 = "fixed3";
                        const int litLen_38 = 6;
                        bool matched_38 = ctx.MatchLiteral(text, currentOffset, lit_38, litLen_38);
                        GreenNode parsedAst_38 = matched_38 ? GreenNode.Create(NodeType.Literal, lit_38, 12, litLen_38) : null;
                        int newOffset_38 = matched_38 ? currentOffset + litLen_38 : currentOffset;
                        int prec_38 = 0;
                    if (matched_38)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_12;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_38 != null && (parsedAst_38.Width > 0 || parsedAst_38.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_38);
                            }
                            currentOffset = newOffset_38;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_12)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_12 = true;
                        }
                        else
                        {
                            if (backupAst_12 == null)
                            {
                                backupAst_12 = parsedAst_38;
                                backupOffset_12 = newOffset_38;
                                backupErrors_12 = ctx.RecoveredErrors.GetRange(baseErrors_12, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_12, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 39
                if (!choiceMatched_12)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_12, ctx.RecoveredErrors.Count - baseErrors_12);
                    const string lit_39 = "fixed2";
                        const int litLen_39 = 6;
                        bool matched_39 = ctx.MatchLiteral(text, currentOffset, lit_39, litLen_39);
                        GreenNode parsedAst_39 = matched_39 ? GreenNode.Create(NodeType.Literal, lit_39, 12, litLen_39) : null;
                        int newOffset_39 = matched_39 ? currentOffset + litLen_39 : currentOffset;
                        int prec_39 = 0;
                    if (matched_39)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_12;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_39 != null && (parsedAst_39.Width > 0 || parsedAst_39.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_39);
                            }
                            currentOffset = newOffset_39;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_12)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_12 = true;
                        }
                        else
                        {
                            if (backupAst_12 == null)
                            {
                                backupAst_12 = parsedAst_39;
                                backupOffset_12 = newOffset_39;
                                backupErrors_12 = ctx.RecoveredErrors.GetRange(baseErrors_12, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_12, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 40
                if (!choiceMatched_12)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_12, ctx.RecoveredErrors.Count - baseErrors_12);
                    const string lit_40 = "fixed";
                        const int litLen_40 = 5;
                        bool matched_40 = ctx.MatchLiteral(text, currentOffset, lit_40, litLen_40);
                        GreenNode parsedAst_40 = matched_40 ? GreenNode.Create(NodeType.Literal, lit_40, 12, litLen_40) : null;
                        int newOffset_40 = matched_40 ? currentOffset + litLen_40 : currentOffset;
                        int prec_40 = 0;
                    if (matched_40)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_12;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_40 != null && (parsedAst_40.Width > 0 || parsedAst_40.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_40);
                            }
                            currentOffset = newOffset_40;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_12)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_12 = true;
                        }
                        else
                        {
                            if (backupAst_12 == null)
                            {
                                backupAst_12 = parsedAst_40;
                                backupOffset_12 = newOffset_40;
                                backupErrors_12 = ctx.RecoveredErrors.GetRange(baseErrors_12, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_12, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 41
                if (!choiceMatched_12)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_12, ctx.RecoveredErrors.Count - baseErrors_12);
                    const string lit_41 = "int";
                        const int litLen_41 = 3;
                        bool matched_41 = ctx.MatchLiteral(text, currentOffset, lit_41, litLen_41);
                        GreenNode parsedAst_41 = matched_41 ? GreenNode.Create(NodeType.Literal, lit_41, 12, litLen_41) : null;
                        int newOffset_41 = matched_41 ? currentOffset + litLen_41 : currentOffset;
                        int prec_41 = 0;
                    if (matched_41)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_12;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_41 != null && (parsedAst_41.Width > 0 || parsedAst_41.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_41);
                            }
                            currentOffset = newOffset_41;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_12)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_12 = true;
                        }
                        else
                        {
                            if (backupAst_12 == null)
                            {
                                backupAst_12 = parsedAst_41;
                                backupOffset_12 = newOffset_41;
                                backupErrors_12 = ctx.RecoveredErrors.GetRange(baseErrors_12, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_12, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 42
                if (!choiceMatched_12)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_12, ctx.RecoveredErrors.Count - baseErrors_12);
                    const string lit_42 = "uint";
                        const int litLen_42 = 4;
                        bool matched_42 = ctx.MatchLiteral(text, currentOffset, lit_42, litLen_42);
                        GreenNode parsedAst_42 = matched_42 ? GreenNode.Create(NodeType.Literal, lit_42, 12, litLen_42) : null;
                        int newOffset_42 = matched_42 ? currentOffset + litLen_42 : currentOffset;
                        int prec_42 = 0;
                    if (matched_42)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_12;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_42 != null && (parsedAst_42.Width > 0 || parsedAst_42.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_42);
                            }
                            currentOffset = newOffset_42;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_12)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_12 = true;
                        }
                        else
                        {
                            if (backupAst_12 == null)
                            {
                                backupAst_12 = parsedAst_42;
                                backupOffset_12 = newOffset_42;
                                backupErrors_12 = ctx.RecoveredErrors.GetRange(baseErrors_12, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_12, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 43
                if (!choiceMatched_12)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_12, ctx.RecoveredErrors.Count - baseErrors_12);
                    const string lit_43 = "bool";
                        const int litLen_43 = 4;
                        bool matched_43 = ctx.MatchLiteral(text, currentOffset, lit_43, litLen_43);
                        GreenNode parsedAst_43 = matched_43 ? GreenNode.Create(NodeType.Literal, lit_43, 12, litLen_43) : null;
                        int newOffset_43 = matched_43 ? currentOffset + litLen_43 : currentOffset;
                        int prec_43 = 0;
                    if (matched_43)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_12;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_43 != null && (parsedAst_43.Width > 0 || parsedAst_43.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_43);
                            }
                            currentOffset = newOffset_43;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_12)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_12 = true;
                        }
                        else
                        {
                            if (backupAst_12 == null)
                            {
                                backupAst_12 = parsedAst_43;
                                backupOffset_12 = newOffset_43;
                                backupErrors_12 = ctx.RecoveredErrors.GetRange(baseErrors_12, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_12, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 44
                if (!choiceMatched_12)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_12, ctx.RecoveredErrors.Count - baseErrors_12);
                    const string lit_44 = "sampler2D";
                        const int litLen_44 = 9;
                        bool matched_44 = ctx.MatchLiteral(text, currentOffset, lit_44, litLen_44);
                        GreenNode parsedAst_44 = matched_44 ? GreenNode.Create(NodeType.Literal, lit_44, 12, litLen_44) : null;
                        int newOffset_44 = matched_44 ? currentOffset + litLen_44 : currentOffset;
                        int prec_44 = 0;
                    if (matched_44)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_12;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_44 != null && (parsedAst_44.Width > 0 || parsedAst_44.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_44);
                            }
                            currentOffset = newOffset_44;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_12)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_12 = true;
                        }
                        else
                        {
                            if (backupAst_12 == null)
                            {
                                backupAst_12 = parsedAst_44;
                                backupOffset_12 = newOffset_44;
                                backupErrors_12 = ctx.RecoveredErrors.GetRange(baseErrors_12, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_12, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 45
                if (!choiceMatched_12)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_12, ctx.RecoveredErrors.Count - baseErrors_12);
                    const string lit_45 = "samplerCUBE";
                        const int litLen_45 = 11;
                        bool matched_45 = ctx.MatchLiteral(text, currentOffset, lit_45, litLen_45);
                        GreenNode parsedAst_45 = matched_45 ? GreenNode.Create(NodeType.Literal, lit_45, 12, litLen_45) : null;
                        int newOffset_45 = matched_45 ? currentOffset + litLen_45 : currentOffset;
                        int prec_45 = 0;
                    if (matched_45)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_12;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_45 != null && (parsedAst_45.Width > 0 || parsedAst_45.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_45);
                            }
                            currentOffset = newOffset_45;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_12)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_12 = true;
                        }
                        else
                        {
                            if (backupAst_12 == null)
                            {
                                backupAst_12 = parsedAst_45;
                                backupOffset_12 = newOffset_45;
                                backupErrors_12 = ctx.RecoveredErrors.GetRange(baseErrors_12, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_12, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 46
                if (!choiceMatched_12)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_12, ctx.RecoveredErrors.Count - baseErrors_12);
                    const string lit_46 = "void";
                        const int litLen_46 = 4;
                        bool matched_46 = ctx.MatchLiteral(text, currentOffset, lit_46, litLen_46);
                        GreenNode parsedAst_46 = matched_46 ? GreenNode.Create(NodeType.Literal, lit_46, 12, litLen_46) : null;
                        int newOffset_46 = matched_46 ? currentOffset + litLen_46 : currentOffset;
                        int prec_46 = 0;
                    if (matched_46)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_12;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_46 != null && (parsedAst_46.Width > 0 || parsedAst_46.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_46);
                            }
                            currentOffset = newOffset_46;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_12)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_12 = true;
                        }
                        else
                        {
                            if (backupAst_12 == null)
                            {
                                backupAst_12 = parsedAst_46;
                                backupOffset_12 = newOffset_46;
                                backupErrors_12 = ctx.RecoveredErrors.GetRange(baseErrors_12, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_12, branchErrorsCount);
                        }
                    }
                }

                // Speculative alternative check 47
                if (!choiceMatched_12)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_12, ctx.RecoveredErrors.Count - baseErrors_12);
                    var res_47 = ParseId(text, currentOffset, memo, ctx);
                        bool matched_47 = res_47.Success;
                        GreenNode parsedAst_47 = matched_47 ? res_47.Ast : null;
                        int newOffset_47 = matched_47 ? res_47.NewOffset : currentOffset;
                        int prec_47 = 0;
                    if (matched_47)
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - baseErrors_12;
                        if (branchErrorsCount == 0)
                        {
                            if (parsedAst_47 != null && (parsedAst_47.Width > 0 || parsedAst_47.Type == NodeType.Eof))
                            {
                                results.Add(parsedAst_47);
                            }
                            currentOffset = newOffset_47;
                            hasCommitted = true;
                    if (true && currentOffset > startOffset_12)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                            choiceMatched_12 = true;
                        }
                        else
                        {
                            if (backupAst_12 == null)
                            {
                                backupAst_12 = parsedAst_47;
                                backupOffset_12 = newOffset_47;
                                backupErrors_12 = ctx.RecoveredErrors.GetRange(baseErrors_12, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(baseErrors_12, branchErrorsCount);
                        }
                    }
                }
                if (!choiceMatched_12 && backupAst_12 != null)
                {
                    if (backupAst_12.Width > 0 || backupAst_12.Type == NodeType.Eof)
                    {
                        results.Add(backupAst_12);
                    }
                    currentOffset = backupOffset_12;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_12)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                    ctx.RecoveredErrors.AddRange(backupErrors_12);
                    choiceMatched_12 = true;
                }
                if (!choiceMatched_12)
                {
                    ctx.RecoveredErrors.RemoveRange(baseErrors_12, ctx.RecoveredErrors.Count - baseErrors_12);
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 12, "None of the choices matched in rule 12", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }
            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }
            var nextRes = new ParseResult
            {
                Success = true,
                Ast = GreenNode.Create(NodeType.HlslType, results, ruleId, currentOffset - offset),
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };
            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }

        public ParseResult ParseOptArray(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = 29;
            if (memo.TryGet(ruleId, offset, out var cached))
            {
                if(cached != null)
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
            
            int lastStructuralOffset = offset;
            int lastStructuralResultsCount = 0;

            // Optional Rule (id: 30)
            if (!panicked)
            {
                int startOffset_30 = currentOffset;
                int optErrors_30 = ctx.RecoveredErrors.Count;
                var res_48 = ParseS(text, currentOffset, memo, ctx);
                        bool matched_48 = res_48.Success;
                        GreenNode parsedAst_48 = matched_48 ? res_48.Ast : null;
                        int newOffset_48 = matched_48 ? res_48.NewOffset : currentOffset;
                        int prec_48 = 0;
                if (matched_48)
                {
                    if (parsedAst_48 != null && (parsedAst_48.Width > 0 || parsedAst_48.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_48);
                    }
                    currentOffset = newOffset_48;
                    if (false && currentOffset > startOffset_30)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_30, ctx.RecoveredErrors.Count - optErrors_30);
                }
            }

            // Element Rule: array_spec (id: 31)
            if (!panicked)
            {
                int startOffset_31 = currentOffset;
                var res = ParseArraySpec(text, currentOffset, memo, ctx);
                localMaxOffset = Math.Max(localMaxOffset, res.DependencyLimit);
                if (res.Success)
                {
                    if (res.Ast != null && (res.Ast.Width > 0 || res.Ast.Type == NodeType.Eof))
                    {
                        results.Add(res.Ast);
                    }
                    currentOffset = res.NewOffset;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_31)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 31, res.Error ?? "Expected sub-element array_spec", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }
            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }
            var nextRes = new ParseResult
            {
                Success = true,
                Ast = GreenNode.Create(NodeType.OptArray, results, ruleId, currentOffset - offset),
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };
            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }

        public ParseResult ParseArraySpec(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = 13;
            if (memo.TryGet(ruleId, offset, out var cached))
            {
                if(cached != null)
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
            
            int lastStructuralOffset = offset;
            int lastStructuralResultsCount = 0;

            // Literal Rule: "[" (id: 14)
            if (!panicked)
            {
                int startOffset_14 = currentOffset;
                const string lit = "[";
                const int litLen = 1;
                localMaxOffset = Math.Max(localMaxOffset, currentOffset + litLen);
                if (ctx.MatchLiteral(text, currentOffset, lit, litLen))
                {
                    results.Add(GreenNode.Create(NodeType.Literal, lit, 14, litLen));
                    currentOffset += litLen;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_14)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 14, "Expected literal \"[\"", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes; // Handled recovery boundary hit
                }
            }

            // Optional Rule (id: 15)
            if (!panicked)
            {
                int startOffset_15 = currentOffset;
                int optErrors_15 = ctx.RecoveredErrors.Count;
                var res_49 = ParseS(text, currentOffset, memo, ctx);
                        bool matched_49 = res_49.Success;
                        GreenNode parsedAst_49 = matched_49 ? res_49.Ast : null;
                        int newOffset_49 = matched_49 ? res_49.NewOffset : currentOffset;
                        int prec_49 = 0;
                if (matched_49)
                {
                    if (parsedAst_49 != null && (parsedAst_49.Width > 0 || parsedAst_49.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_49);
                    }
                    currentOffset = newOffset_49;
                    if (false && currentOffset > startOffset_15)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_15, ctx.RecoveredErrors.Count - optErrors_15);
                }
            }

            // Optional Rule (id: 20)
            if (!panicked)
            {
                int startOffset_20 = currentOffset;
                int optErrors_20 = ctx.RecoveredErrors.Count;
                var res_50 = ParseArrSize(text, currentOffset, memo, ctx);
                        bool matched_50 = res_50.Success;
                        GreenNode parsedAst_50 = matched_50 ? res_50.Ast : null;
                        int newOffset_50 = matched_50 ? res_50.NewOffset : currentOffset;
                        int prec_50 = 0;
                if (matched_50)
                {
                    if (parsedAst_50 != null && (parsedAst_50.Width > 0 || parsedAst_50.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_50);
                    }
                    currentOffset = newOffset_50;
                    if (true && currentOffset > startOffset_20)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_20, ctx.RecoveredErrors.Count - optErrors_20);
                }
            }
            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }
            var nextRes = new ParseResult
            {
                Success = true,
                Ast = GreenNode.Create(NodeType.ArraySpec, results, ruleId, currentOffset - offset),
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };
            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }

        public ParseResult ParseArrSize(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = 16;
            if (memo.TryGet(ruleId, offset, out var cached))
            {
                if(cached != null)
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
            
            int lastStructuralOffset = offset;
            int lastStructuralResultsCount = 0;

            // Regex Rule: [0-9]+ (id: 17)
            if (!panicked)
            {
                int startOffset_17 = currentOffset;
                string mval_17;
                if (MatchDFA_Rule_17(text, currentOffset, out mval_17))
                {
                    results.Add(GreenNode.Create(NodeType.Token, mval_17, 17, mval_17.Length));
                    currentOffset += mval_17.Length;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_17)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                    localMaxOffset = Math.Max(localMaxOffset, currentOffset);
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 17, "Expected match for pattern", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }

            // Optional Rule (id: 18)
            if (!panicked)
            {
                int startOffset_18 = currentOffset;
                int optErrors_18 = ctx.RecoveredErrors.Count;
                var res_51 = ParseS(text, currentOffset, memo, ctx);
                        bool matched_51 = res_51.Success;
                        GreenNode parsedAst_51 = matched_51 ? res_51.Ast : null;
                        int newOffset_51 = matched_51 ? res_51.NewOffset : currentOffset;
                        int prec_51 = 0;
                if (matched_51)
                {
                    if (parsedAst_51 != null && (parsedAst_51.Width > 0 || parsedAst_51.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_51);
                    }
                    currentOffset = newOffset_51;
                    if (false && currentOffset > startOffset_18)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_18, ctx.RecoveredErrors.Count - optErrors_18);
                }
            }

            // Literal Rule: "]" (id: 19)
            if (!panicked)
            {
                int startOffset_19 = currentOffset;
                const string lit = "]";
                const int litLen = 1;
                localMaxOffset = Math.Max(localMaxOffset, currentOffset + litLen);
                if (ctx.MatchLiteral(text, currentOffset, lit, litLen))
                {
                    results.Add(GreenNode.Create(NodeType.Literal, lit, 19, litLen));
                    currentOffset += litLen;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_19)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 19, "Expected literal \"]\"", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes; // Handled recovery boundary hit
                }
            }
            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }
            var nextRes = new ParseResult
            {
                Success = true,
                Ast = GreenNode.Create(NodeType.ArrSize, results, ruleId, currentOffset - offset),
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };
            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }

        public ParseResult ParseSemOpt(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = 33;
            if (memo.TryGet(ruleId, offset, out var cached))
            {
                if(cached != null)
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
            
            int lastStructuralOffset = offset;
            int lastStructuralResultsCount = 0;

            // Optional Rule (id: 34)
            if (!panicked)
            {
                int startOffset_34 = currentOffset;
                int optErrors_34 = ctx.RecoveredErrors.Count;
                var res_52 = ParseS(text, currentOffset, memo, ctx);
                        bool matched_52 = res_52.Success;
                        GreenNode parsedAst_52 = matched_52 ? res_52.Ast : null;
                        int newOffset_52 = matched_52 ? res_52.NewOffset : currentOffset;
                        int prec_52 = 0;
                if (matched_52)
                {
                    if (parsedAst_52 != null && (parsedAst_52.Width > 0 || parsedAst_52.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_52);
                    }
                    currentOffset = newOffset_52;
                    if (false && currentOffset > startOffset_34)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_34, ctx.RecoveredErrors.Count - optErrors_34);
                }
            }

            // Element Rule: semantic (id: 35)
            if (!panicked)
            {
                int startOffset_35 = currentOffset;
                var res = ParseSemantic(text, currentOffset, memo, ctx);
                localMaxOffset = Math.Max(localMaxOffset, res.DependencyLimit);
                if (res.Success)
                {
                    if (res.Ast != null && (res.Ast.Width > 0 || res.Ast.Type == NodeType.Eof))
                    {
                        results.Add(res.Ast);
                    }
                    currentOffset = res.NewOffset;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_35)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 35, res.Error ?? "Expected sub-element semantic", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }
            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }
            var nextRes = new ParseResult
            {
                Success = true,
                Ast = GreenNode.Create(NodeType.SemOpt, results, ruleId, currentOffset - offset),
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };
            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }

        public ParseResult ParseSemantic(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = 21;
            if (memo.TryGet(ruleId, offset, out var cached))
            {
                if(cached != null)
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
            
            int lastStructuralOffset = offset;
            int lastStructuralResultsCount = 0;

            // Literal Rule: ":" (id: 22)
            if (!panicked)
            {
                int startOffset_22 = currentOffset;
                const string lit = ":";
                const int litLen = 1;
                localMaxOffset = Math.Max(localMaxOffset, currentOffset + litLen);
                if (ctx.MatchLiteral(text, currentOffset, lit, litLen))
                {
                    results.Add(GreenNode.Create(NodeType.Literal, lit, 22, litLen));
                    currentOffset += litLen;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_22)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 22, "Expected literal \":\"", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes; // Handled recovery boundary hit
                }
            }

            // Optional Rule (id: 23)
            if (!panicked)
            {
                int startOffset_23 = currentOffset;
                int optErrors_23 = ctx.RecoveredErrors.Count;
                var res_53 = ParseS(text, currentOffset, memo, ctx);
                        bool matched_53 = res_53.Success;
                        GreenNode parsedAst_53 = matched_53 ? res_53.Ast : null;
                        int newOffset_53 = matched_53 ? res_53.NewOffset : currentOffset;
                        int prec_53 = 0;
                if (matched_53)
                {
                    if (parsedAst_53 != null && (parsedAst_53.Width > 0 || parsedAst_53.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_53);
                    }
                    currentOffset = newOffset_53;
                    if (false && currentOffset > startOffset_23)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_23, ctx.RecoveredErrors.Count - optErrors_23);
                }
            }

            // Element Rule: id (id: 24)
            if (!panicked)
            {
                int startOffset_24 = currentOffset;
                var res = ParseId(text, currentOffset, memo, ctx);
                localMaxOffset = Math.Max(localMaxOffset, res.DependencyLimit);
                if (res.Success)
                {
                    if (res.Ast != null && (res.Ast.Width > 0 || res.Ast.Type == NodeType.Eof))
                    {
                        results.Add(res.Ast);
                    }
                    currentOffset = res.NewOffset;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_24)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 24, res.Error ?? "Expected sub-element id", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }
            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }
            var nextRes = new ParseResult
            {
                Success = true,
                Ast = GreenNode.Create(NodeType.Semantic, results, ruleId, currentOffset - offset),
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };
            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }

        public ParseResult ParseFunction(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = 60;
            if (memo.TryGet(ruleId, offset, out var cached))
            {
                if(cached != null)
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
            
            int lastStructuralOffset = offset;
            int lastStructuralResultsCount = 0;

            // Element Rule: hlsl_type (id: 61)
            if (!panicked)
            {
                int startOffset_61 = currentOffset;
                var res = ParseHlslType(text, currentOffset, memo, ctx);
                localMaxOffset = Math.Max(localMaxOffset, res.DependencyLimit);
                if (res.Success)
                {
                    if (res.Ast != null && (res.Ast.Width > 0 || res.Ast.Type == NodeType.Eof))
                    {
                        results.Add(res.Ast);
                    }
                    currentOffset = res.NewOffset;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_61)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 61, res.Error ?? "Expected sub-element hlsl_type", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }

            // Element Rule: s (id: 62)
            if (!panicked)
            {
                int startOffset_62 = currentOffset;
                var res = ParseS(text, currentOffset, memo, ctx);
                localMaxOffset = Math.Max(localMaxOffset, res.DependencyLimit);
                if (res.Success)
                {
                    if (res.Ast != null && (res.Ast.Width > 0 || res.Ast.Type == NodeType.Eof))
                    {
                        results.Add(res.Ast);
                    }
                    currentOffset = res.NewOffset;
                    hasCommitted = true;
                    if (false && currentOffset > startOffset_62)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (false && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 62, res.Error ?? "Expected sub-element s", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }

            // Element Rule: id (id: 63)
            if (!panicked)
            {
                int startOffset_63 = currentOffset;
                var res = ParseId(text, currentOffset, memo, ctx);
                localMaxOffset = Math.Max(localMaxOffset, res.DependencyLimit);
                if (res.Success)
                {
                    if (res.Ast != null && (res.Ast.Width > 0 || res.Ast.Type == NodeType.Eof))
                    {
                        results.Add(res.Ast);
                    }
                    currentOffset = res.NewOffset;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_63)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 63, res.Error ?? "Expected sub-element id", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }

            // Optional Rule (id: 64)
            if (!panicked)
            {
                int startOffset_64 = currentOffset;
                int optErrors_64 = ctx.RecoveredErrors.Count;
                var res_54 = ParseS(text, currentOffset, memo, ctx);
                        bool matched_54 = res_54.Success;
                        GreenNode parsedAst_54 = matched_54 ? res_54.Ast : null;
                        int newOffset_54 = matched_54 ? res_54.NewOffset : currentOffset;
                        int prec_54 = 0;
                if (matched_54)
                {
                    if (parsedAst_54 != null && (parsedAst_54.Width > 0 || parsedAst_54.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_54);
                    }
                    currentOffset = newOffset_54;
                    if (false && currentOffset > startOffset_64)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_64, ctx.RecoveredErrors.Count - optErrors_64);
                }
            }

            // Literal Rule: "(" (id: 65)
            if (!panicked)
            {
                int startOffset_65 = currentOffset;
                const string lit = "(";
                const int litLen = 1;
                localMaxOffset = Math.Max(localMaxOffset, currentOffset + litLen);
                if (ctx.MatchLiteral(text, currentOffset, lit, litLen))
                {
                    results.Add(GreenNode.Create(NodeType.Literal, lit, 65, litLen));
                    currentOffset += litLen;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_65)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 65, "Expected literal \"(\"", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes; // Handled recovery boundary hit
                }
            }

            // Optional Rule (id: 66)
            if (!panicked)
            {
                int startOffset_66 = currentOffset;
                int optErrors_66 = ctx.RecoveredErrors.Count;
                var res_55 = ParseS(text, currentOffset, memo, ctx);
                        bool matched_55 = res_55.Success;
                        GreenNode parsedAst_55 = matched_55 ? res_55.Ast : null;
                        int newOffset_55 = matched_55 ? res_55.NewOffset : currentOffset;
                        int prec_55 = 0;
                if (matched_55)
                {
                    if (parsedAst_55 != null && (parsedAst_55.Width > 0 || parsedAst_55.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_55);
                    }
                    currentOffset = newOffset_55;
                    if (false && currentOffset > startOffset_66)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_66, ctx.RecoveredErrors.Count - optErrors_66);
                }
            }

            // Optional Rule (id: 67)
            if (!panicked)
            {
                int startOffset_67 = currentOffset;
                int optErrors_67 = ctx.RecoveredErrors.Count;
                var res_56 = ParseS(text, currentOffset, memo, ctx);
                        bool matched_56 = res_56.Success;
                        GreenNode parsedAst_56 = matched_56 ? res_56.Ast : null;
                        int newOffset_56 = matched_56 ? res_56.NewOffset : currentOffset;
                        int prec_56 = 0;
                if (matched_56)
                {
                    if (parsedAst_56 != null && (parsedAst_56.Width > 0 || parsedAst_56.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_56);
                    }
                    currentOffset = newOffset_56;
                    if (false && currentOffset > startOffset_67)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_67, ctx.RecoveredErrors.Count - optErrors_67);
                }
            }

            // Optional Rule (id: 68)
            if (!panicked)
            {
                int startOffset_68 = currentOffset;
                int optErrors_68 = ctx.RecoveredErrors.Count;
                var res_57 = ParseS(text, currentOffset, memo, ctx);
                        bool matched_57 = res_57.Success;
                        GreenNode parsedAst_57 = matched_57 ? res_57.Ast : null;
                        int newOffset_57 = matched_57 ? res_57.NewOffset : currentOffset;
                        int prec_57 = 0;
                if (matched_57)
                {
                    if (parsedAst_57 != null && (parsedAst_57.Width > 0 || parsedAst_57.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_57);
                    }
                    currentOffset = newOffset_57;
                    if (false && currentOffset > startOffset_68)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_68, ctx.RecoveredErrors.Count - optErrors_68);
                }
            }

            // Literal Rule: ")" (id: 69)
            if (!panicked)
            {
                int startOffset_69 = currentOffset;
                const string lit = ")";
                const int litLen = 1;
                localMaxOffset = Math.Max(localMaxOffset, currentOffset + litLen);
                if (ctx.MatchLiteral(text, currentOffset, lit, litLen))
                {
                    results.Add(GreenNode.Create(NodeType.Literal, lit, 69, litLen));
                    currentOffset += litLen;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_69)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 69, "Expected literal \")\"", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes; // Handled recovery boundary hit
                }
            }

            // Optional Rule (id: 73)
            if (!panicked)
            {
                int startOffset_73 = currentOffset;
                int optErrors_73 = ctx.RecoveredErrors.Count;
                var res_58 = ParseSemOpt(text, currentOffset, memo, ctx);
                        bool matched_58 = res_58.Success;
                        GreenNode parsedAst_58 = matched_58 ? res_58.Ast : null;
                        int newOffset_58 = matched_58 ? res_58.NewOffset : currentOffset;
                        int prec_58 = 0;
                if (matched_58)
                {
                    if (parsedAst_58 != null && (parsedAst_58.Width > 0 || parsedAst_58.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_58);
                    }
                    currentOffset = newOffset_58;
                    if (true && currentOffset > startOffset_73)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_73, ctx.RecoveredErrors.Count - optErrors_73);
                }
            }

            // Optional Rule (id: 74)
            if (!panicked)
            {
                int startOffset_74 = currentOffset;
                int optErrors_74 = ctx.RecoveredErrors.Count;
                var res_59 = ParseS(text, currentOffset, memo, ctx);
                        bool matched_59 = res_59.Success;
                        GreenNode parsedAst_59 = matched_59 ? res_59.Ast : null;
                        int newOffset_59 = matched_59 ? res_59.NewOffset : currentOffset;
                        int prec_59 = 0;
                if (matched_59)
                {
                    if (parsedAst_59 != null && (parsedAst_59.Width > 0 || parsedAst_59.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_59);
                    }
                    currentOffset = newOffset_59;
                    if (false && currentOffset > startOffset_74)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_74, ctx.RecoveredErrors.Count - optErrors_74);
                }
            }

            // Element Rule: code_block (id: 75)
            if (!panicked)
            {
                int startOffset_75 = currentOffset;
                var res = ParseCodeBlock(text, currentOffset, memo, ctx);
                localMaxOffset = Math.Max(localMaxOffset, res.DependencyLimit);
                if (res.Success)
                {
                    if (res.Ast != null && (res.Ast.Width > 0 || res.Ast.Type == NodeType.Eof))
                    {
                        results.Add(res.Ast);
                    }
                    currentOffset = res.NewOffset;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_75)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 75, res.Error ?? "Expected sub-element code_block", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }
            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }
            var nextRes = new ParseResult
            {
                Success = true,
                Ast = GreenNode.Create(NodeType.Function, results, ruleId, currentOffset - offset),
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };
            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }

        public ParseResult ParseSemOpt(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = 70;
            if (memo.TryGet(ruleId, offset, out var cached))
            {
                if(cached != null)
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
            
            int lastStructuralOffset = offset;
            int lastStructuralResultsCount = 0;

            // Optional Rule (id: 71)
            if (!panicked)
            {
                int startOffset_71 = currentOffset;
                int optErrors_71 = ctx.RecoveredErrors.Count;
                var res_60 = ParseS(text, currentOffset, memo, ctx);
                        bool matched_60 = res_60.Success;
                        GreenNode parsedAst_60 = matched_60 ? res_60.Ast : null;
                        int newOffset_60 = matched_60 ? res_60.NewOffset : currentOffset;
                        int prec_60 = 0;
                if (matched_60)
                {
                    if (parsedAst_60 != null && (parsedAst_60.Width > 0 || parsedAst_60.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_60);
                    }
                    currentOffset = newOffset_60;
                    if (false && currentOffset > startOffset_71)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_71, ctx.RecoveredErrors.Count - optErrors_71);
                }
            }

            // Element Rule: semantic (id: 72)
            if (!panicked)
            {
                int startOffset_72 = currentOffset;
                var res = ParseSemantic(text, currentOffset, memo, ctx);
                localMaxOffset = Math.Max(localMaxOffset, res.DependencyLimit);
                if (res.Success)
                {
                    if (res.Ast != null && (res.Ast.Width > 0 || res.Ast.Type == NodeType.Eof))
                    {
                        results.Add(res.Ast);
                    }
                    currentOffset = res.NewOffset;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_72)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 72, res.Error ?? "Expected sub-element semantic", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }
            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }
            var nextRes = new ParseResult
            {
                Success = true,
                Ast = GreenNode.Create(NodeType.SemOpt, results, ruleId, currentOffset - offset),
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };
            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }

        public ParseResult ParseCodeBlock(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = 56;
            if (memo.TryGet(ruleId, offset, out var cached))
            {
                if(cached != null)
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
            
            int lastStructuralOffset = offset;
            int lastStructuralResultsCount = 0;

            // BeginScope Rule (id: 57)
            if (!panicked)
            {
                int startOffset_57 = currentOffset;
                const string lit = "{";
                const int litLen = 1;
                localMaxOffset = Math.Max(localMaxOffset, currentOffset + litLen);
                if (ctx.MatchLiteral(text, currentOffset, lit, litLen))
                {
                    results.Add(GreenNode.Create(NodeType.Literal, lit, 57, litLen));
                    currentOffset += litLen;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_57)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 57, "Expected scope start \"{\"", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
                if (!panicked)
                {
                    ctx.ActiveScopeEnds.Add("}");
                }
            }

            // Optional Rule (id: 58)
            if (!panicked)
            {
                int startOffset_58 = currentOffset;
                int optErrors_58 = ctx.RecoveredErrors.Count;
                string mval_61;
                        bool matched_61 = MatchDFA_Spec_58(text, currentOffset, out mval_61);
                        GreenNode parsedAst_61 = matched_61 ? GreenNode.Create(NodeType.Token, mval_61, 58, mval_61.Length) : null;
                        int newOffset_61 = matched_61 ? currentOffset + mval_61.Length : currentOffset;
                        int prec_61 = 0;
                if (matched_61)
                {
                    if (parsedAst_61 != null && (parsedAst_61.Width > 0 || parsedAst_61.Type == NodeType.Eof))
                    {
                        results.Add(parsedAst_61);
                    }
                    currentOffset = newOffset_61;
                    if (true && currentOffset > startOffset_58)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(optErrors_58, ctx.RecoveredErrors.Count - optErrors_58);
                }
            }

            // EndScope Rule (id: 59)
            if (!panicked)
            {
                int startOffset_59 = currentOffset;
                const string lit = "}";
                const int litLen = 1;
                localMaxOffset = Math.Max(localMaxOffset, currentOffset + litLen);
                if (ctx.MatchLiteral(text, currentOffset, lit, litLen))
                {
                    results.Add(GreenNode.Create(NodeType.Literal, lit, 59, litLen));
                    currentOffset += litLen;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_59)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 59, "Expected scope end \"}\"", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
                int popIdx = ctx.ActiveScopeEnds.LastIndexOf("}");
                if (popIdx != -1) ctx.ActiveScopeEnds.RemoveAt(popIdx);
            }
            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }
            var nextRes = new ParseResult
            {
                Success = true,
                Ast = GreenNode.Create(NodeType.CodeBlock, results, ruleId, currentOffset - offset),
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };
            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }

        public ParseResult ParseDirective(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = 76;
            if (memo.TryGet(ruleId, offset, out var cached))
            {
                if(cached != null)
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
            
            int lastStructuralOffset = offset;
            int lastStructuralResultsCount = 0;

            // Regex Rule: #[a-zA-Z]+[^\r\n]* (id: 77)
            if (!panicked)
            {
                int startOffset_77 = currentOffset;
                string mval_77;
                if (MatchDFA_Rule_77(text, currentOffset, out mval_77))
                {
                    results.Add(GreenNode.Create(NodeType.Token, mval_77, 77, mval_77.Length));
                    currentOffset += mval_77.Length;
                    hasCommitted = true;
                    if (true && currentOffset > startOffset_77)
                    {
                        lastStructuralOffset = currentOffset;
                        lastStructuralResultsCount = results.Count;
                    }
                    localMaxOffset = Math.Max(localMaxOffset, currentOffset);
                }
                else
                {
                    if (!TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 77, "Expected match for pattern", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
                        return failRes;
                }
            }
            if (panicked)
            {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }
            var nextRes = new ParseResult
            {
                Success = true,
                Ast = GreenNode.Create(NodeType.Directive, results, ruleId, currentOffset - offset),
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };
            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }
        private bool TryRecover(
            ITextDocument text, 
            int failStartOffset, 
            int ruleId, 
            string errorMsg, 
            ref int localMaxOffset, 
            List<GreenNode> results,
            int truncateResultsCount, 
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
                int nextCharIndex = failStartOffset;
                while (nextCharIndex < text.Length && char.IsWhiteSpace(text[nextCharIndex]))
                {
                    nextCharIndex++;
                }
                if (nextCharIndex < text.Length)
                {
                    char c = text[nextCharIndex];
                    bool isScopeEnd = c == '}' || c == ')';
                    if (ctx.ActiveScopeEnds != null && ctx.ActiveScopeEnds.Count > 0)
                    {
                        foreach (var scopeEnd in ctx.ActiveScopeEnds)
                        {
                            if (scopeEnd.Length > 0 && c == scopeEnd[0])
                            {
                                isScopeEnd = true;
                                break;
                            }
                        }
                    }
                    if (!isScopeEnd)
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
                    int lookaheadLimit = Math.Min(text.Length - failStartOffset, 2048);
                    string window = text.GetText(failStartOffset, lookaheadLimit).ToString();
                    int idxInWindow = window.IndexOf(boundary);
                    if (idxInWindow != -1)
                    {
                        int idx = failStartOffset + idxInWindow;
                        if (bestRecoveryOffset == -1 || idx < bestRecoveryOffset)
                        {
                            bestRecoveryOffset = idx;
                        }
                    }
                }
                if (bestRecoveryOffset != -1)
                {
                    int len = bestRecoveryOffset - failStartOffset;
                    string skipped = text.GetText(failStartOffset, len).ToString();
                    string snippet = skipped.Length > 25 ? skipped.Substring(0, 22) + "..." : skipped;
                    string msg = $"Syntax Error in parser: {errorMsg} at offset {failStartOffset}. Skipped \"{snippet}\" to sync.";
                    ctx.RecoveredErrors.Add(new ParseError { Message = msg, Offset = failStartOffset });
                    var errNode = GreenNode.Create(NodeType.ErrorNode, msg, 0, bestRecoveryOffset - failStartOffset);
                    if (truncateResultsCount >= 0 && truncateResultsCount < results.Count)
                    {
                        results.RemoveRange(truncateResultsCount, results.Count - truncateResultsCount);
                    }
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
                NewOffset = failStartOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId
            };
            return false;
        }
    }
    #endregion
}

using System;
using System.Collections.Generic;
namespace TestNamespace
{
    public class HlslBlockNode : AstNode
    {
        public HlslBlockNode(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }
        public SNode S => FindChild<SNode>();
        public List<SNode> All_S => FindChildren<SNode>();

        public HlslItemNode HlslItem => FindChild<HlslItemNode>();
        public List<HlslItemNode> All_HlslItem => FindChildren<HlslItemNode>();
    }

    public class SNode : AstNode
    {
        public SNode(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }
        public NNode N => FindChild<NNode>();
        public List<NNode> All_N => FindChildren<NNode>();
    }

    public class NNode : AstNode
    {
        public NNode(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }
        public WsNode Ws => FindChild<WsNode>();
        public List<WsNode> All_Ws => FindChildren<WsNode>();

        public LineCommentNode LineComment => FindChild<LineCommentNode>();
        public List<LineCommentNode> All_LineComment => FindChildren<LineCommentNode>();
    }

    public class WsNode : AstNode
    {
        public WsNode(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }

    }

    public class LineCommentNode : AstNode
    {
        public LineCommentNode(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }

    }

    public class HlslItemNode : AstNode
    {
        public HlslItemNode(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }
        public SNode S => FindChild<SNode>();
        public List<SNode> All_S => FindChildren<SNode>();

        public HlslStmtNode HlslStmt => FindChild<HlslStmtNode>();
        public List<HlslStmtNode> All_HlslStmt => FindChildren<HlslStmtNode>();
    }

    public class HlslStmtNode : AstNode
    {
        public HlslStmtNode(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }
        public StructNode Struct => FindChild<StructNode>();
        public List<StructNode> All_Struct => FindChildren<StructNode>();

        public FunctionNode Function => FindChild<FunctionNode>();
        public List<FunctionNode> All_Function => FindChildren<FunctionNode>();

        public VarDeclNode VarDecl => FindChild<VarDeclNode>();
        public List<VarDeclNode> All_VarDecl => FindChildren<VarDeclNode>();

        public DirectiveNode Directive => FindChild<DirectiveNode>();
        public List<DirectiveNode> All_Directive => FindChildren<DirectiveNode>();
    }

    public class StructNode : AstNode
    {
        public StructNode(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }
        public SNode S => FindChild<SNode>();
        public List<SNode> All_S => FindChildren<SNode>();

        public IdNode Id => FindChild<IdNode>();
        public List<IdNode> All_Id => FindChildren<IdNode>();

        public StructMemberWrapperNode StructMemberWrapper => FindChild<StructMemberWrapperNode>();
        public List<StructMemberWrapperNode> All_StructMemberWrapper => FindChildren<StructMemberWrapperNode>();
    }

    public class IdNode : AstNode
    {
        public IdNode(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }

    }

    public class StructMemberWrapperNode : AstNode
    {
        public StructMemberWrapperNode(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }
        public SNode S => FindChild<SNode>();
        public List<SNode> All_S => FindChildren<SNode>();

        public StructMemberNode StructMember => FindChild<StructMemberNode>();
        public List<StructMemberNode> All_StructMember => FindChildren<StructMemberNode>();
    }

    public class StructMemberNode : AstNode
    {
        public StructMemberNode(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }
        public SNode S => FindChild<SNode>();
        public List<SNode> All_S => FindChildren<SNode>();

        public VarDeclNode VarDecl => FindChild<VarDeclNode>();
        public List<VarDeclNode> All_VarDecl => FindChildren<VarDeclNode>();

        public LineCommentNode LineComment => FindChild<LineCommentNode>();
        public List<LineCommentNode> All_LineComment => FindChildren<LineCommentNode>();
    }

    public class VarDeclNode : AstNode
    {
        public VarDeclNode(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }
        public HlslTypeNode HlslType => FindChild<HlslTypeNode>();
        public List<HlslTypeNode> All_HlslType => FindChildren<HlslTypeNode>();

        public SNode S => FindChild<SNode>();
        public List<SNode> All_S => FindChildren<SNode>();

        public IdNode Id => FindChild<IdNode>();
        public List<IdNode> All_Id => FindChildren<IdNode>();

        public OptArrayNode OptArray => FindChild<OptArrayNode>();
        public List<OptArrayNode> All_OptArray => FindChildren<OptArrayNode>();

        public SemOptNode SemOpt => FindChild<SemOptNode>();
        public List<SemOptNode> All_SemOpt => FindChildren<SemOptNode>();
    }

    public class HlslTypeNode : AstNode
    {
        public HlslTypeNode(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }
        public IdNode Id => FindChild<IdNode>();
        public List<IdNode> All_Id => FindChildren<IdNode>();
    }

    public class OptArrayNode : AstNode
    {
        public OptArrayNode(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }
        public SNode S => FindChild<SNode>();
        public List<SNode> All_S => FindChildren<SNode>();

        public ArraySpecNode ArraySpec => FindChild<ArraySpecNode>();
        public List<ArraySpecNode> All_ArraySpec => FindChildren<ArraySpecNode>();
    }

    public class ArraySpecNode : AstNode
    {
        public ArraySpecNode(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }
        public SNode S => FindChild<SNode>();
        public List<SNode> All_S => FindChildren<SNode>();

        public ArrSizeNode ArrSize => FindChild<ArrSizeNode>();
        public List<ArrSizeNode> All_ArrSize => FindChildren<ArrSizeNode>();
    }

    public class ArrSizeNode : AstNode
    {
        public ArrSizeNode(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }
        public SNode S => FindChild<SNode>();
        public List<SNode> All_S => FindChildren<SNode>();
    }

    public class SemOptNode : AstNode
    {
        public SemOptNode(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }
        public SNode S => FindChild<SNode>();
        public List<SNode> All_S => FindChildren<SNode>();

        public SemanticNode Semantic => FindChild<SemanticNode>();
        public List<SemanticNode> All_Semantic => FindChildren<SemanticNode>();
    }

    public class SemanticNode : AstNode
    {
        public SemanticNode(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }
        public SNode S => FindChild<SNode>();
        public List<SNode> All_S => FindChildren<SNode>();

        public IdNode Id => FindChild<IdNode>();
        public List<IdNode> All_Id => FindChildren<IdNode>();
    }

    public class FunctionNode : AstNode
    {
        public FunctionNode(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }
        public HlslTypeNode HlslType => FindChild<HlslTypeNode>();
        public List<HlslTypeNode> All_HlslType => FindChildren<HlslTypeNode>();

        public SNode S => FindChild<SNode>();
        public List<SNode> All_S => FindChildren<SNode>();

        public IdNode Id => FindChild<IdNode>();
        public List<IdNode> All_Id => FindChildren<IdNode>();

        public SemOptNode SemOpt => FindChild<SemOptNode>();
        public List<SemOptNode> All_SemOpt => FindChildren<SemOptNode>();

        public CodeBlockNode CodeBlock => FindChild<CodeBlockNode>();
        public List<CodeBlockNode> All_CodeBlock => FindChildren<CodeBlockNode>();
    }

    public class SemOptNode : AstNode
    {
        public SemOptNode(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }
        public SNode S => FindChild<SNode>();
        public List<SNode> All_S => FindChildren<SNode>();

        public SemanticNode Semantic => FindChild<SemanticNode>();
        public List<SemanticNode> All_Semantic => FindChildren<SemanticNode>();
    }

    public class CodeBlockNode : AstNode
    {
        public CodeBlockNode(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }

    }

    public class DirectiveNode : AstNode
    {
        public DirectiveNode(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }

    }
}
