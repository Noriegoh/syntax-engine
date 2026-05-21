import { SyntaxElement } from './syntax-element';

export function generateFullCSharp(root: SyntaxElement): string {
  const elements = root.getAllElements();
  
  let guts = elements.map(el => {
    const ruleLogic = el.rules.map((rule, idx) => {
      if (rule.type === 'literal') {
        return `
          if (remaining.StartsWith("${rule.value}")) {
              results.Add("${rule.value}");
              currentOffset += ${rule.value.length};
          } else return Fail("Expected literal: ${rule.value}", currentOffset);`;
      } else if (rule.type === 'whitespace') {
        return `
          var wsMatch = Regex.Match(remaining, @"^\\s+");
          if (wsMatch.Success) {
              results.Add(wsMatch.Value);
              currentOffset += wsMatch.Length;
          } else return Fail("Expected whitespace", currentOffset);`;
      } else if (rule.type === 'regex') {
        const pattern = rule.value.source.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
        return `
          var regexMatch = Regex.Match(remaining, @"^${pattern}");
          if (regexMatch.Success) {
              results.Add(regexMatch.Value);
              currentOffset += regexMatch.Length;
          } else return Fail("Regex failed: ${pattern}", currentOffset);`;
      } else if (rule.type === 'element') {
        return `
          var subResult = Parse${rule.value.name}(input, currentOffset, memo);
          if (subResult != null && subResult.Success) {
              results.Add(subResult.AST);
              currentOffset = subResult.NewOffset;
          } else return Fail("Failed sub-element: ${rule.value.name}", currentOffset);`;
      } else if (rule.type === 'not') {
        if (rule.value instanceof SyntaxElement) {
           return `
          if (Parse${rule.value.name}(input, currentOffset, memo)?.Success == true)
              return Fail("Forbidden element: ${rule.value.name}", currentOffset);`;
        } else {
           return `
          if (remaining.StartsWith("${rule.value}"))
              return Fail("Forbidden literal: ${rule.value}", currentOffset);`;
        }
      }
      return "";
    }).join("\n");

    return `
  private ParseResult Parse${el.name}(string input, int offset, Dictionary<string, ParseResult> memo) {
      string key = "${el.id}-" + offset;
      if (memo.ContainsKey(key)) return memo[key];

      int currentOffset = offset;
      var results = new List<object>();

      ${el.rules.map((rule, idx) => {
        let logic = "";
        if (rule.type === 'literal') {
          logic = `
          if (input.Substring(currentOffset).StartsWith("${rule.value}")) {
              results.Add("${rule.value}");
              currentOffset += ${rule.value.length};
          } else return Fail("Expected literal: ${rule.value}", currentOffset);`;
        } else if (rule.type === 'whitespace') {
          logic = `
          var wsMatch${idx} = Regex.Match(input.Substring(currentOffset), @"^\\s+");
          if (wsMatch${idx}.Success) {
              results.Add(wsMatch${idx}.Value);
              currentOffset += wsMatch${idx}.Length;
          } else return Fail("Expected whitespace", currentOffset);`;
        } else if (rule.type === 'regex') {
          const pattern = rule.value.source.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
          logic = `
          var regexMatch${idx} = Regex.Match(input.Substring(currentOffset), @"^${pattern}");
          if (regexMatch${idx}.Success) {
              results.Add(regexMatch${idx}.Value);
              currentOffset += regexMatch${idx}.Length;
          } else return Fail("Regex failed: ${pattern}", currentOffset);`;
        } else if (rule.type === 'element') {
          logic = `
          var subResult${idx} = Parse${rule.value.name}(input, currentOffset, memo);
          if (subResult${idx} != null && subResult${idx}.Success) {
              results.Add(subResult${idx}.AST);
              currentOffset = subResult${idx}.NewOffset;
          } else return Fail("Failed sub-element: ${rule.value.name}", currentOffset);`;
        } else if (rule.type === 'not') {
          if (rule.value instanceof SyntaxElement) {
             logic = `
          if (Parse${rule.value.name}(input, currentOffset, memo)?.Success == true)
              return Fail("Forbidden element: ${rule.value.name}", currentOffset);`;
          } else {
             logic = `
          if (input.Substring(currentOffset).StartsWith("${rule.value}"))
              return Fail("Forbidden literal: ${rule.value}", currentOffset);`;
          }
        } else if (rule.type === 'eof') {
          logic = `
          if (currentOffset != input.Length)
              return Fail("Expected EOF", currentOffset);`;
        } else if (rule.type === 'choice') {
          const choices = rule.value as (string | RegExp | SyntaxElement)[];
          logic = `
          bool matched${idx} = false;
          foreach (var pattern in new object[] { ${choices.map(c => {
             if (typeof c === 'string') return `"${c}"`;
             if (c instanceof RegExp) return `new Regex(@"^${c.source.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}")`;
             return `"${c.name}"`; // Name of sub-element
          }).join(", ")} }) {
              if (pattern is string str) {
                  if (str.StartsWith("Regex(") || (matched${idx} == false && !input.Substring(currentOffset).StartsWith(str) && pattern.ToString().Length > 0)) {
                      // This is a bit complex in a flat loop, let's generate optimized branches
                  }
              }
          }
          // Optimization: Let's actually generate distinct branches for choice to keep it fast
          ${choices.map((choice, cIdx) => {
            let choiceLogic = "";
            if (typeof choice === 'string') {
              choiceLogic = `if (!matched${idx} && input.Substring(currentOffset).StartsWith("${choice}")) { results.Add("${choice}"); currentOffset += ${choice.length}; matched${idx} = true; }`;
            } else if (choice instanceof RegExp) {
              choiceLogic = `if (!matched${idx}) { var m = Regex.Match(input.Substring(currentOffset), @"^${choice.source.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"); if (m.Success) { results.Add(m.Value); currentOffset += m.Length; matched${idx} = true; } }`;
            } else {
              choiceLogic = `if (!matched${idx}) { var res = Parse${choice.name}(input, currentOffset, memo); if (res.Success) { results.Add(res.AST); currentOffset = res.NewOffset; matched${idx} = true; } }`;
            }
            return choiceLogic;
          }).join("\n            ")}
          if (!matched${idx}) return Fail("OneOf: None of the choices matched", currentOffset);`;
        } else if (rule.type === 'optional') {
           if (typeof rule.value === 'string') {
             logic = `if (input.Substring(currentOffset).StartsWith("${rule.value}")) { results.Add("${rule.value}"); currentOffset += ${rule.value.length}; }`;
           } else if (rule.value instanceof RegExp) {
              logic = `var optMatch${idx} = Regex.Match(input.Substring(currentOffset), @"^${rule.value.source.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"); if (optMatch${idx}.Success) { results.Add(optMatch${idx}.Value); currentOffset += optMatch${idx}.Length; }`;
           } else {
              logic = `var optRes${idx} = Parse${rule.value.name}(input, currentOffset, memo); if (optRes${idx}.Success) { results.Add(optRes${idx}.AST); currentOffset = optRes${idx}.NewOffset; }`;
           }
        } else if (rule.type === 'zeroOrMore') {
           logic = `
          while (currentOffset < input.Length) {
              int loopStart = currentOffset;
              ${
                typeof rule.value === 'string' ? `if (input.Substring(currentOffset).StartsWith("${rule.value}")) { results.Add("${rule.value}"); currentOffset += ${rule.value.length}; }` :
                rule.value instanceof RegExp ? `var m = Regex.Match(input.Substring(currentOffset), @"^${rule.value.source.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"); if (m.Success) { results.Add(m.Value); currentOffset += m.Length; }` :
                `var res = Parse${rule.value.name}(input, currentOffset, memo); if (res.Success) { results.Add(res.AST); currentOffset = res.NewOffset; }`
              }
              if (currentOffset == loopStart) break;
          }`;
        } else if (rule.type === 'oneOrMore') {
           logic = `
          int matchCount${idx} = 0;
          while (currentOffset < input.Length) {
              int loopStart = currentOffset;
              ${
                typeof rule.value === 'string' ? `if (input.Substring(currentOffset).StartsWith("${rule.value}")) { results.Add("${rule.value}"); currentOffset += ${rule.value.length}; matchCount${idx}++; }` :
                rule.value instanceof RegExp ? `var m = Regex.Match(input.Substring(currentOffset), @"^${rule.value.source.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"); if (m.Success) { results.Add(m.Value); currentOffset += m.Length; matchCount${idx}++; }` :
                `var res = Parse${rule.value.name}(input, currentOffset, memo); if (res.Success) { results.Add(res.AST); currentOffset = res.NewOffset; matchCount${idx}++; }`
              }
              if (currentOffset == loopStart) break;
          }
          if (matchCount${idx} == 0) return Fail("OneOrMore: Expected at least one match", currentOffset);`;
        } else if (rule.type === 'eof') {
          logic = `if (currentOffset != input.Length) return Fail("Expected EOF", currentOffset);`;
        } else {
          logic = `// Unknown rule type: ${rule.type}`;
        }
        return logic;
      }).join("\n")}

      var res = new ParseResult { 
          Success = true, 
          AST = new Dictionary<string, object> { { "type", "${el.name}" }, { "value", results } }, 
          NewOffset = currentOffset 
        };
      memo[key] = res;
      return res;
  }`;
  }).join("\n");

  return `using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Linq;

namespace SyntaxEngine {
    public class ParseResult {
        public bool Success { get; set; }
        public object AST { get; set; }
        public int NewOffset { get; set; }
        public string Error { get; set; }
    }

    public class ${root.name}Parser {
        public ParseResult Parse(string input) {
            var memo = new Dictionary<string, ParseResult>();
            return Parse${root.name}(input, 0, memo);
        }

        private ParseResult Fail(string msg, int offset) {
            return new ParseResult { Success = false, Error = msg, NewOffset = offset };
        }

        ${guts}
    }
}`;
}
