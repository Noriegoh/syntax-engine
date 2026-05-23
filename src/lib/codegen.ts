import { SyntaxElement } from './syntax-element';

/**
 * Normalizes a string to be a safe C# identifier.
 */
function sanitize(name: string): string {
  const result = name.replace(/[^a-zA-Z0-9_]/g, '_');
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
                        var m_${varId} = Regex_Spec_${ruleId}.Match(text, currentOffset);
                        bool ${mVar} = (m_${varId}.Success && m_${varId}.Index == currentOffset);
                        AstNode ${astVar} = ${mVar} ? new AstNode { Type = "token", Value = m_${varId}.Value, Start = currentOffset, End = currentOffset + m_${varId}.Value.Length } : null;
                        int ${offsetVar} = ${mVar} ? currentOffset + m_${varId}.Value.Length : currentOffset;
                        int ${precVar} = 0;`;
  } else if (typeof pattern === 'string') {
    const esc = escapeString(pattern);
    code = `
                        string lit_${varId} = "${esc}";
                        int litLen_${varId} = lit_${varId}.Length;
                        bool ${mVar} = (currentOffset + litLen_${varId} <= text.Length && text.Substring(currentOffset, litLen_${varId}) == lit_${varId});
                        AstNode ${astVar} = ${mVar} ? new AstNode { Type = "literal", Value = lit_${varId}, Start = currentOffset, End = currentOffset + litLen_${varId} } : null;
                        int ${offsetVar} = ${mVar} ? currentOffset + litLen_${varId} : currentOffset;
                        int ${precVar} = 0;`;
  } else {
    // SyntaxElement
    const cname = sanitize(pattern.name);
    childElements.add(cname);
    code = `
                        var res_${varId} = Parse_${cname}(text, currentOffset, memo, ctx);
                        bool ${mVar} = res_${varId}.Success;
                        AstNode ${astVar} = ${mVar} ? res_${varId}.Ast : null;
                        int ${offsetVar} = ${mVar} ? res_${varId}.NewOffset : currentOffset;
                        int ${precVar} = ${pattern.precedence || 0};`;
  }

  return { code, matchedName: mVar, parsedAstName: astVar, newOffsetName: offsetVar, precName: precVar };
}

/**
 * Generates the complete, self-contained C# code string.
 */
export function generateFullCSharp(rootElement: SyntaxElement): string {
  const elements = collectElements(rootElement);
  const rootName = sanitize(rootElement.name);

  // 1. Build class-level Regex fields for rules that reference them
  const regexFields: string[] = [];
  const speculativeRegexes: string[] = [];

  // 2. Generate custom AST classes with strongly typed properties for children
  const astClasses = elements.map(el => {
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

    const properties = Array.from(childrenNodeTypes).map(childName => `
        public ${childName}Node ${childName} => FindChild<${childName}Node>();
        public List<${childName}Node> All_${childName} => FindChildren<${childName}Node>();`).join("\n");

    return `    public class ${elName}Node : AstNode {
        public ${elName}Node() { Type = "${el.name}"; }
${properties}
    }`;
  }).join("\n\n");

  // 3. Generate rule-flattened parser methods for each element
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

    // Flatten rules inside sequence into linear C# code
    const ruleBlocks = el.rules.map(rule => {
      const ruleId = rule.id;

      if (rule.type === 'literal') {
        const esc = escapeString(rule.value);
        return `
            // Literal Rule: "${esc}" (id: ${ruleId})
            if (!panicked) {
                string lit = "${esc}";
                int litLen = lit.Length;
                localMaxOffset = Math.Max(localMaxOffset, currentOffset + litLen);
                if (currentOffset + litLen <= text.Length && text.Substring(currentOffset, litLen) == lit) {
                    results.Add(new AstNode { Type = "literal", Value = lit, Start = currentOffset, End = currentOffset + litLen });
                    currentOffset += litLen;
                    hasCommitted = true;
                } else {
                    if (TryRecover(text, currentOffset, ${ruleId}, "Expected literal \\"${esc}\\\"", ref localMaxOffset, results, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes)) {
                        if (panicked) panicked = true; // Handled recovery boundary hit
                    } else {
                        return failRes;
                    }
                }
            }`;
      }

      if (rule.type === 'regex') {
        regexFields.push(`        private static readonly Regex Regex_Rule_${ruleId} = new Regex(@"^${escapeRegex(rule.value)}", RegexOptions.Compiled);`);
        return `
            // Regex Rule: ${rule.value.source} (id: ${ruleId})
            if (!panicked) {
                var m = Regex_Rule_${ruleId}.Match(text, currentOffset);
                if (m.Success && m.Index == currentOffset) {
                    string mval = m.Value;
                    results.Add(new AstNode { Type = "token", Value = mval, Start = currentOffset, End = currentOffset + mval.Length });
                    currentOffset += mval.Length;
                    hasCommitted = true;
                    localMaxOffset = Math.Max(localMaxOffset, currentOffset);
                } else {
                    if (TryRecover(text, currentOffset, ${ruleId}, "Expected match for pattern", ref localMaxOffset, results, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes)) {
                        if (panicked) panicked = true;
                    } else {
                        return failRes;
                    }
                }
            }`;
      }

      if (rule.type === 'whitespace') {
        return `
            // Whitespace Rule (id: {ruleId})
            if (!panicked) {
                int wsStart = currentOffset;
                while (currentOffset < text.Length && char.IsWhiteSpace(text[currentOffset])) {
                    currentOffset++;
                }
                localMaxOffset = Math.Max(localMaxOffset, currentOffset);
                if (currentOffset > wsStart) {
                    results.Add(new AstNode { Type = "whitespace", Value = text.Substring(wsStart, currentOffset - wsStart), Start = wsStart, End = currentOffset });
                } else {
                    if (TryRecover(text, currentOffset, ${ruleId}, "Expected whitespace", ref localMaxOffset, results, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes)) {
                        if (panicked) panicked = true;
                    } else {
                        return failRes;
                    }
                }
            }`;
      }

      if (rule.type === 'element') {
        const subName = sanitize(rule.value.name);
        childElements.add(subName);
        const isHiddenCheck = rule.value.isHidden ? "true" : "false";
        return `
            // Element Rule: ${rule.value.name} (id: ${ruleId})
            if (!panicked) {
                var res = Parse_${subName}(text, currentOffset, memo, ctx);
                localMaxOffset = Math.Max(localMaxOffset, res.DependencyLimit);
                if (res.Success) {
                    if (!${isHiddenCheck}) {
                        results.Add(res.Ast);
                    }
                    currentOffset = res.NewOffset;
                    hasCommitted = true;
                } else {
                    if (TryRecover(text, currentOffset, ${ruleId}, res.Error ?? "Expected sub-element ${rule.value.name}", ref localMaxOffset, results, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes)) {
                        if (panicked) panicked = true;
                    } else {
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
                if (!choiceMatched_${ruleId}) {
                    ctx.RecoveredErrors.RemoveRange(${baseErrorsVar}, ctx.RecoveredErrors.Count - ${baseErrorsVar});
                    ${spec.code.trim()}
                    if (${spec.matchedName}) {
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
            if (!panicked) {
                bool choiceMatched_${ruleId} = false;
                int ${baseErrorsVar} = ctx.RecoveredErrors.Count;

                AstNode bestAst = null;
                int bestOffset = -1;
                int bestPrec = -1;
                List<ParseError> bestErrors = null;
${choiceChecks.join("\n")}

                if (choiceMatched_${ruleId} && bestAst != null) {
                    ctx.RecoveredErrors.AddRange(bestErrors);
                    results.Add(bestAst);
                    currentOffset = bestOffset;
                    hasCommitted = true;
                } else {
                    ctx.RecoveredErrors.RemoveRange(${baseErrorsVar}, ctx.RecoveredErrors.Count - ${baseErrorsVar});
                    if (TryRecover(text, currentOffset, ${ruleId}, "None of the choices matched in rule ${ruleId}", ref localMaxOffset, results, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes)) {
                        if (panicked) panicked = true;
                    } else {
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
            if (!panicked) {
                int ${escErrorsVar} = ctx.RecoveredErrors.Count;
                ${spec.code.trim()}
                if (${spec.matchedName}) {
                    results.Add(${spec.parsedAstName});
                    currentOffset = ${spec.newOffsetName};
                } else {
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
            if (!panicked) {
                int startLoopOffset = currentOffset;
                var loopResults = new List<AstNode>();
                while (currentOffset < text.Length) {
                    int beforeIterOffset = currentOffset;
                    int ${escErrorsVar} = ctx.RecoveredErrors.Count;
                    ${spec.code.trim()}
                    if (${spec.matchedName} && ${spec.newOffsetName} > beforeIterOffset) {
                        loopResults.Add(${spec.parsedAstName});
                        currentOffset = ${spec.newOffsetName};
                    } else {
                        ctx.RecoveredErrors.RemoveRange(${escErrorsVar}, ctx.RecoveredErrors.Count - ${escErrorsVar});
                        break;
                    }
                }
                if (loopResults.Count > 0) {
                    results.Add(new AstNode {
                        Type = "zeroOrMore",
                        Children = loopResults,
                        Start = startLoopOffset,
                        End = currentOffset
                    });
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
            if (!panicked) {
                int startLoopOffset = currentOffset;
                var loopResults = new List<AstNode>();
                while (currentOffset < text.Length) {
                    int beforeIterOffset = currentOffset;
                    int ${escErrorsVar} = ctx.RecoveredErrors.Count;
                    ${spec.code.trim()}
                    if (${spec.matchedName} && ${spec.newOffsetName} > beforeIterOffset) {
                        loopResults.Add(${spec.parsedAstName});
                        currentOffset = ${spec.newOffsetName};
                    } else {
                        ctx.RecoveredErrors.RemoveRange(${escErrorsVar}, ctx.RecoveredErrors.Count - ${escErrorsVar});
                        break;
                    }
                }
                if (loopResults.Count > 0) {
                    results.Add(new AstNode {
                        Type = "oneOrMore",
                        Children = loopResults,
                        Start = startLoopOffset,
                        End = currentOffset
                    });
                    hasCommitted = true;
                } else {
                    if (TryRecover(text, currentOffset, ${ruleId}, "Expected at least one occurrence in loop", ref localMaxOffset, results, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes)) {
                        if (panicked) panicked = true;
                    } else {
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
            if (!panicked) {
                int ${escErrorsVar} = ctx.RecoveredErrors.Count;
                ${spec.code.trim()}
                if (${spec.matchedName}) {
                    ctx.RecoveredErrors.RemoveRange(${escErrorsVar}, ctx.RecoveredErrors.Count - ${escErrorsVar});
                    return new ParseResult {
                        Success = false,
                        Error = "Encountered forbidden lookahead pattern",
                        NewOffset = currentOffset,
                        DependencyLimit = localMaxOffset,
                        RuleId = ${ruleId}
                    };
                } else {
                    ctx.RecoveredErrors.RemoveRange(${escErrorsVar}, ctx.RecoveredErrors.Count - ${escErrorsVar});
                }
            }`;
      }

      if (rule.type === 'eof') {
        return `
            // EOF Rule (id: ${ruleId})
            if (!panicked) {
                localMaxOffset = Math.Max(localMaxOffset, currentOffset + 1);
                if (currentOffset == text.Length) {
                    results.Add(new AstNode { Type = "eof", Start = currentOffset, End = currentOffset });
                } else {
                    if (TryRecover(text, currentOffset, ${ruleId}, "Expected EOF end of string", ref localMaxOffset, results, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes)) {
                        if (panicked) panicked = true;
                    } else {
                        return failRes;
                    }
                }
            }`;
      }

      return "            // Unsupported rule type";
    }).join("\n");

    const instantiator = `new ${elName}Node { Value = text.Substring(offset, currentOffset - offset), Start = offset, End = currentOffset, Children = results }`;

    return `        public ParseResult Parse_${elName}(string text, int offset, SpatialCSTIndex memo, ParserContext ctx) {
            int ruleId = ${el.id};
            if (memo.Has(ruleId, offset)) {
                var cached = memo.Get(ruleId, offset);
                if (cached != null) {
                    if (cached.RecoveredErrors != null) {
                        ctx.RecoveredErrors.AddRange(cached.RecoveredErrors);
                    }
                    return cached;
                }
            }

            int currentOffset = offset;
            int localMaxOffset = offset;
            var results = new List<AstNode>();
            bool panicked = false;
            bool hasCommitted = false;
            int initialErrorsLength = ctx.RecoveredErrors.Count;

${ruleBlocks}

            if (panicked) {
                // If soft recovered or panicked, clean up spec errors
                ctx.RecoveredErrors.RemoveRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength);
            }

            var nextRes = new ParseResult {
                Success = true,
                Ast = ${instantiator},
                NewOffset = currentOffset,
                DependencyLimit = localMaxOffset,
                RuleId = ruleId,
                RecoveredErrors = ctx.RecoveredErrors.GetRange(initialErrorsLength, ctx.RecoveredErrors.Count - initialErrorsLength)
            };

            // Recursively update parent pointer references
            if (nextRes.Ast != null) {
                foreach (var child in nextRes.Ast.Children) {
                    child.Parent = nextRes.Ast;
                }
            }

            memo.Set(ruleId, offset, nextRes);
            return nextRes;
        }`;
  }).join("\n\n");

  const combinedRegexes = Array.from(new Set([...regexFields, ...speculativeRegexes])).join("\n");

  return `using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Linq;

namespace SyntaxEngine {

    #region Base Structures & Incremental Engine

    public class AstNode {
        public string Type { get; set; }
        public int Start { get; set; }
        public int End { get; set; }
        public string Value { get; set; }
        public List<AstNode> Children { get; set; } = new List<AstNode>();
        public AstNode Parent { get; set; }

        public T FindChild<T>() where T : AstNode {
            return Children.OfType<T>().FirstOrDefault();
        }

        public List<T> FindChildren<T>() where T : AstNode {
            return Children.OfType<T>().ToList();
        }
    }

    public class ParseError {
        public string Message { get; set; }
        public int Offset { get; set; }
    }

    public class ParseResult {
        public bool Success { get; set; }
        public AstNode Ast { get; set; }
        public int NewOffset { get; set; }
        public string Error { get; set; }
        public int RuleId { get; set; }
        public List<ParseError> RecoveredErrors { get; set; } = new List<ParseError>();
        public int DependencyLimit { get; set; }
    }

    public class CSTNode {
        public int RuleId { get; set; }
        public int Start { get; set; }
        public int End { get; set; }
        public int DependencyLimit { get; set; }
        public ParseResult Result { get; set; }
    }

    public class SpatialCSTIndex {
        public Dictionary<int, Dictionary<int, CSTNode>> NodesByOffset { get; set; } = new Dictionary<int, Dictionary<int, CSTNode>>();
        public int TotalNodes { get; set; } = 0;

        public bool Has(int ruleId, int offset) {
            if (NodesByOffset.TryGetValue(offset, out var ruleMap)) {
                return ruleMap.ContainsKey(ruleId);
            }
            return false;
        }

        public ParseResult Get(int ruleId, int offset) {
            if (NodesByOffset.TryGetValue(offset, out var ruleMap)) {
                if (ruleMap.TryGetValue(ruleId, out var node)) {
                    return node.Result;
                }
            }
            return null;
        }

        public void Set(int ruleId, int offset, ParseResult result) {
            int dependencyLimit = result.DependencyLimit;
            var node = new CSTNode {
                RuleId = ruleId,
                Start = offset,
                End = result.NewOffset,
                DependencyLimit = dependencyLimit,
                Result = result
            };

            if (!NodesByOffset.TryGetValue(offset, out var ruleMap)) {
                ruleMap = new Dictionary<int, CSTNode>();
                NodesByOffset[offset] = ruleMap;
            }

            if (!ruleMap.ContainsKey(ruleId)) {
                TotalNodes++;
            }
            ruleMap[ruleId] = node;
        }

        public void Clear() {
            NodesByOffset.Clear();
            TotalNodes = 0;
        }

        public void ApplyEdit(int editOffset, int removedLength, int delta) {
            var nextNodesByOffset = new Dictionary<int, Dictionary<int, CSTNode>>();
            int nextTotalNodes = 0;

            foreach (var kvp in NodesByOffset) {
                int startOffset = kvp.Key;
                foreach (var ruleKvp in kvp.Value) {
                    int ruleId = ruleKvp.Key;
                    var node = ruleKvp.Value;
                    int dependencyLimit = node.DependencyLimit;

                    // Case 1: Parse started before the edit point
                    if (node.Start < editOffset) {
                        if (dependencyLimit >= editOffset) {
                            continue; // Overlaps with edit, discard
                        }
                        if (!nextNodesByOffset.TryGetValue(node.Start, out var rMap)) {
                            rMap = new Dictionary<int, CSTNode>();
                            nextNodesByOffset[node.Start] = rMap;
                        }
                        rMap[ruleId] = node;
                        nextTotalNodes++;
                    }
                    // Case 2: Parse started inside edited/deleted range
                    else if (node.Start >= editOffset && node.Start < editOffset + removedLength) {
                        continue; // Discard completely
                    }
                    // Case 3: Parse started after the edited/deleted range
                    else {
                        int newStart = node.Start + delta;
                        int newEnd = node.End + delta;
                        int newDependencyLimit = node.DependencyLimit + delta;

                        var shiftedResult = new ParseResult {
                            Success = node.Result.Success,
                            NewOffset = node.Result.NewOffset + delta,
                            DependencyLimit = newDependencyLimit,
                            Error = node.Result.Error,
                            RuleId = node.Result.RuleId,
                            Ast = ShiftAst(node.Result.Ast, delta),
                            RecoveredErrors = node.Result.RecoveredErrors?.Select(err => new ParseError {
                                Message = err.Message,
                                Offset = err.Offset + delta
                            }).ToList() ?? new List<ParseError>()
                        };

                        var shiftedNode = new CSTNode {
                            RuleId = ruleId,
                            Start = newStart,
                            End = newEnd,
                            DependencyLimit = newDependencyLimit,
                            Result = shiftedResult
                        };

                        if (!nextNodesByOffset.TryGetValue(newStart, out var rMap)) {
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

        private AstNode ShiftAst(AstNode ast, int delta) {
            if (ast == null) return null;
            ast.Start += delta;
            ast.End += delta;
            foreach (var child in ast.Children) {
                ShiftAst(child, delta);
            }
            return ast;
        }
    }

    public class ParserContext {
        public int MaxOffset { get; set; } = -1;
        public List<ParseError> RecoveredErrors { get; set; } = new List<ParseError>();
    }

    public interface IParserRunner {
        ParseResult Parse(string text, int offset, SpatialCSTIndex memo, ParserContext ctx);
    }

    public class IncrementalParser {
        private string _lastText = "";
        private SpatialCSTIndex _memo = new SpatialCSTIndex();
        private ParseResult _lastResult = null;

        public SpatialCSTIndex Memo => _memo;

        public void Clear() {
            _lastText = "";
            _memo.Clear();
            _lastResult = null;
        }

        public ParseResult Parse(IParserRunner parser, string newText) {
            if (string.IsNullOrEmpty(_lastText)) {
                var context = new ParserContext();
                var res = parser.Parse(newText, 0, _memo, context);
                _lastText = newText;
                _lastResult = res;
                return _lastResult;
            }

            var (editOffset, removedLength, insertedText) = FindDiff(_lastText, newText);
            int delta = insertedText.Length - removedLength;

            if (removedLength > 0 || insertedText.Length > 0) {
                _memo.ApplyEdit(editOffset, removedLength, delta);
            }

            var ctx = new ParserContext();
            var nextRes = parser.Parse(newText, 0, _memo, ctx);

            _lastText = newText;
            _lastResult = nextRes;
            return _lastResult;
        }

        private static (int editOffset, int removedLength, string insertedText) FindDiff(string oldStr, string newStr) {
            int prefix = 0;
            while (prefix < oldStr.Length && prefix < newStr.Length && oldStr[prefix] == newStr[prefix]) {
                prefix++;
            }

            string oldSuffix = oldStr.Substring(prefix);
            string newSuffix = newStr.Substring(prefix);

            int oldLen = oldSuffix.Length;
            int newLen = newSuffix.Length;
            int suffix = 0;
            while (suffix < oldLen && suffix < newLen && oldSuffix[oldLen - 1 - suffix] == newSuffix[newLen - 1 - suffix]) {
                suffix++;
            }

            int removedLength = oldLen - suffix;
            string insertedText = newSuffix.Substring(0, newLen - suffix);

            return (prefix, removedLength, insertedText);
        }
    }

    #endregion

    #region Strongly Typed Custom AST Classes

${astClasses}

    #endregion

    #region Rule Flattened Parser Engine

    public class ${rootName}Parser : IParserRunner {
        
${combinedRegexes}

        public ParseResult Parse(string text, int offset, SpatialCSTIndex memo, ParserContext ctx) {
            return Parse_${rootName}(text, offset, memo, ctx);
        }

${parserMethods}

        private bool TryRecover(
            string text, 
            int currentOffset, 
            int ruleId, 
            string errorMsg, 
            ref int localMaxOffset, 
            List<AstNode> results, 
            ref int currentOffsetRef, 
            ref bool panicked, 
            bool hasCommitted,
            List<string> recoveryBoundaries,
            ParserContext ctx,
            out ParseResult failResult
        ) {
            failResult = null;
            bool shouldRecover = hasCommitted;
            if (!shouldRecover) {
                int nextCharIndex = currentOffset;
                while (nextCharIndex < text.Length && char.IsWhiteSpace(text[nextCharIndex])) {
                    nextCharIndex++;
                }
                if (nextCharIndex < text.Length) {
                    char c = text[nextCharIndex];
                    if (c != '}' && c != ')') {
                        shouldRecover = true;
                    }
                }
            }

            if (shouldRecover && recoveryBoundaries != null && recoveryBoundaries.Count > 0) {
                int bestRecoveryOffset = -1;
                foreach (var boundary in recoveryBoundaries) {
                    int idx = text.IndexOf(boundary, currentOffset);
                    if (idx != -1) {
                        if (bestRecoveryOffset == -1 || idx < bestRecoveryOffset) {
                            bestRecoveryOffset = idx;
                        }
                    }
                }

                if (bestRecoveryOffset != -1) {
                    int len = bestRecoveryOffset - currentOffset;
                    string skipped = text.Substring(currentOffset, len);
                    string snippet = skipped.Length > 25 ? skipped.Substring(0, 22) + "..." : skipped;
                    string msg = $"Syntax Error in parser: {errorMsg} at offset {currentOffset}. Skipped \\\"{snippet}\\\" to sync.";

                    ctx.RecoveredErrors.Add(new ParseError { Message = msg, Offset = currentOffset });
                    var errNode = new AstNode {
                        Type = "error_node",
                        Value = msg,
                        Start = currentOffset,
                        End = bestRecoveryOffset
                    };
                    results.Add(errNode);
                    currentOffsetRef = bestRecoveryOffset;
                    panicked = true;
                    return true;
                }
            }

            failResult = new ParseResult {
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

    #region Scopes & Symbol Definitions

    public class SymbolDefinition {
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

    public class SymbolReference {
        public string Id { get; set; }
        public string Name { get; set; }
        public int Start { get; set; }
        public int End { get; set; }
        public AstNode Node { get; set; }
        public string ScopeId { get; set; }
        public string ResolvedSymbolId { get; set; }
    }

    public class LexicalScope {
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

    public class ScopeBuilder {
        public class ScopeRule {
            public string Type { get; set; }
            public Func<AstNode, bool> Matcher { get; set; }
            public Func<AstNode, string> NameSelector { get; set; }
        }

        public class SymbolRule {
            public Func<AstNode, bool> Matcher { get; set; }
            public Func<AstNode, string> NameSelector { get; set; }
            public Func<AstNode, string> KindSelector { get; set; }
            public Func<AstNode, string> DatatypeSelector { get; set; }
        }

        public class ReferenceRule {
            public Func<AstNode, bool> Matcher { get; set; }
            public Func<AstNode, string> NameSelector { get; set; }
        }

        private readonly List<ScopeRule> _scopeRules = new List<ScopeRule>();
        private readonly List<SymbolRule> _symbolRules = new List<SymbolRule>();
        private readonly List<ReferenceRule> _referenceRules = new List<ReferenceRule>();

        public void DefineScope(string type, Func<AstNode, bool> matcher, Func<AstNode, string> nameSelector) {
            _scopeRules.Add(new ScopeRule { Type = type, Matcher = matcher, NameSelector = nameSelector });
        }

        public void DefineSymbol(Func<AstNode, bool> matcher, Func<AstNode, string> nameSelector, Func<AstNode, string> kindSelector, Func<AstNode, string> datatypeSelector) {
            _symbolRules.Add(new SymbolRule { Matcher = matcher, NameSelector = nameSelector, KindSelector = kindSelector, DatatypeSelector = datatypeSelector });
        }

        public void DefineReference(Func<AstNode, bool> matcher, Func<AstNode, string> nameSelector) {
            _referenceRules.Add(new ReferenceRule { Matcher = matcher, NameSelector = nameSelector });
        }

        public LexicalScope Build(AstNode ast, string fullText) {
            var globalScope = new LexicalScope {
                Id = "global",
                Name = "Global Scope",
                Type = "global",
                Start = 0,
                End = fullText.Length,
                Node = ast
            };

            var scopes = new List<LexicalScope>();
            int scopeCounter = 0;
            int symbolCounter = 0;
            int refCounter = 0;

            var allNodes = FlattenAst(ast);

            // 1. Find all scopes
            foreach (var node in allNodes) {
                foreach (var rule in _scopeRules) {
                    if (rule.Matcher(node)) {
                        scopes.Add(new LexicalScope {
                            Id = $"scope-{rule.Type}-{++scopeCounter}",
                            Name = rule.NameSelector(node),
                            Type = rule.Type,
                            Start = node.Start,
                            End = node.End,
                            Node = node
                        });
                        break;
                    }
                }
            }

            // Order scopes start ascending, end descending
            scopes.Sort((a, b) => {
                if (a.Start != b.Start) return a.Start - b.Start;
                return b.End - a.End;
            });

            var activeStack = new List<LexicalScope> { globalScope };
            foreach (var scope in scopes) {
                while (activeStack.Count > 1) {
                    var top = activeStack[activeStack.Count - 1];
                    if (top.Start <= scope.Start && top.End >= scope.End) {
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

            LexicalScope FindDeepestScope(LexicalScope parent, int start, int end) {
                foreach (var child in parent.Children) {
                    if (child.Start <= start && child.End >= end) {
                        return FindDeepestScope(child, start, end);
                    }
                }
                return parent;
            }

            var mainDeclOffsets = new HashSet<int>();

            // 2. Find all symbols
            foreach (var node in allNodes) {
                foreach (var rule in _symbolRules) {
                    if (rule.Matcher(node)) {
                        int start = node.Start;
                        int end = node.End;
                        var parentScope = FindDeepestScope(globalScope, start, end);

                        var symId = $"sym-{++symbolCounter}";
                        parentScope.Symbols.Add(new SymbolDefinition {
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
                        break;
                    }
                }
            }

            // 3. Find all references
            foreach (var node in allNodes) {
                if (mainDeclOffsets.Contains(node.Start)) continue;

                foreach (var rule in _referenceRules) {
                    if (rule.Matcher(node)) {
                        int start = node.Start;
                        int end = node.End;
                        var parentScope = FindDeepestScope(globalScope, start, end);

                        parentScope.References.Add(new SymbolReference {
                            Id = $"ref-{++refCounter}",
                            Name = rule.NameSelector(node),
                            Start = start,
                            End = end,
                            Node = node,
                            ScopeId = parentScope.Id
                        });
                        break;
                    }
                }
            }

            // 4. Resolve references
            SymbolDefinition ResolveRef(SymbolReference r, string sId) {
                string currentId = sId;
                while (currentId != null) {
                    if (scopeMap.TryGetValue(currentId, out var s)) {
                        var matchedSym = s.Symbols.FirstOrDefault(sym => sym.Name == r.Name);
                        if (matchedSym != null) return matchedSym;
                        currentId = s.ParentId;
                    } else {
                        break;
                    }
                }
                return null;
            }

            void ResolveAllScopeReferences(LexicalScope s) {
                foreach (var r in s.References) {
                    var resolvedSym = ResolveRef(r, s.Id);
                    if (resolvedSym != null) {
                        r.ResolvedSymbolId = resolvedSym.Id;
                        resolvedSym.References.Add(r);
                    }
                }
                foreach (var child in s.Children) {
                    ResolveAllScopeReferences(child);
                }
            }

            ResolveAllScopeReferences(globalScope);
            return globalScope;
        }

        private List<AstNode> FlattenAst(AstNode node) {
            var list = new List<AstNode>();
            if (node == null) return list;
            list.Add(node);
            foreach (var child in node.Children) {
                list.AddRange(FlattenAst(child));
            }
            return list;
        }

        private void AddScopesToMap(LexicalScope scope, Dictionary<string, LexicalScope> map) {
            map[scope.Id] = scope;
            foreach (var child in scope.Children) {
                AddScopesToMap(child, map);
            }
        }
    }

    #endregion
}
`;
}
