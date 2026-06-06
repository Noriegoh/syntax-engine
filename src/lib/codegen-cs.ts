import { SyntaxElement } from './syntax-element';
import { ScopeBuilder } from './scope';
import { 
  sanitize, 
  compileDFA, 
  formatChar, 
  escapeString, 
  collectElements 
} from './codegen-core';
import { isSimpleCaseInsensitiveRegex } from './utils';


export function generateDFACSharpMethod(methodName: string, regex: RegExp, ruleId: number, type: 'Rule' | 'Spec'): string {
  const patternStr = regex.source;
  
  try {
    const { dfaStates, intervals } = compileDFA(regex);
    
    const acceptingCases: string[] = [];
    for (const dState of dfaStates) {
      if (dState.isAccepting) {
        acceptingCases.push(`                case ${dState.id}: finalMatchLength = i; break;`);
      }
    }
    const acceptingStatesCases = acceptingCases.join('\n');
    
    const transitionCasesList: string[] = [];
    for (const dState of dfaStates) {
      const targetGroups = new Map<number, {start: number; end: number}[]>();
      for (const [intervalIdx, targetDFA] of dState.transitions.entries()) {
        const interval = intervals[intervalIdx];
        if (!targetGroups.has(targetDFA.id)) {
          targetGroups.set(targetDFA.id, []);
        }
        targetGroups.get(targetDFA.id)!.push({start: interval[0], end: interval[1]});
      }
      
      for (const [targetId, ranges] of targetGroups.entries()) {
        const sorted = [...ranges].sort((a, b) => a.start - b.start);
        const merged: {start: number; end: number}[] = [];
        for (const r of sorted) {
          if (merged.length === 0) {
            merged.push({start: r.start, end: r.end});
          } else {
            const last = merged[merged.length - 1];
            if (r.start <= last.end + 1) {
              last.end = Math.max(last.end, r.end);
            } else {
              merged.push({start: r.start, end: r.end});
            }
          }
        }
        targetGroups.set(targetId, merged);
      }
      
      const sortedTargets = Array.from(targetGroups.entries()).sort((a, b) => {
        const aWidth = a[1].reduce((sum, r) => sum + (r.end - r.start + 1), 0);
        const bWidth = b[1].reduce((sum, r) => sum + (r.end - r.start + 1), 0);
        return aWidth - bWidth;
      });
      
      const conditions: string[] = [];
      for (let j = 0; j < sortedTargets.length; j++) {
        const [targetId, ranges] = sortedTargets[j];
        const rangeExprs = ranges.map(r => {
          if (r.start === r.end) {
            return `c == ${formatChar(r.start)}`;
          } else {
            return `(c >= ${formatChar(r.start)} && c <= ${formatChar(r.end)})`;
          }
        });
        const condStr = rangeExprs.join(' || ');
        
        const isFallback = (j === sortedTargets.length - 1 && ranges.reduce((sum, r) => sum + (r.end - r.start + 1), 0) > 30000);
        
        if (isFallback) {
          conditions.push(`                    state = ${targetId}; break; // Fallback transition`);
        } else {
          const ifKeyword = conditions.length === 0 ? 'if' : 'else if';
          conditions.push(`                    ${ifKeyword} (${condStr}) { state = ${targetId}; break; }`);
        }
      }
      
      if (conditions.length > 0) {
        const lastCond = conditions[conditions.length - 1];
        if (!lastCond.includes('// Fallback transition')) {
          conditions.push(`                    else goto end_match;`);
        }
      } else {
        conditions.push(`                    goto end_match;`);
      }
      
      transitionCasesList.push(`            case ${dState.id}:
${conditions.join('\n')}
`);
    }
    const transitionsCases = transitionCasesList.join('\n');
    
    return `
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        private bool ${methodName}(ITextDocument text, int offset, out string matchedValue)
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
${acceptingStatesCases}
                }
                char c = span[i];
                switch (state)
                {
${transitionsCases}
                    default:goto end_match;
                }
                i++;
            }
            switch (state)
            {
${acceptingStatesCases}
            }
        end_match:
            if (finalMatchLength != -1)
            {
                matchedValue = span.Slice(0, finalMatchLength).ToString();
                return true;
            }
            return false;
        }
`;
  } catch (err: any) {
    console.warn(`DFA compiler fallback for /${patternStr}/:`, err);
    const errMsg = err?.message || String(err);
    const errStackComment = err?.stack ? err.stack.split('\n').map((l: string) => `        // ${l}`).join('\n') : `        // No stack trace available`;
    const escapedErrMsg = escapeString(errMsg);
    return `
        // Regular Expression Fallback
        // DFA Compilation Failed: ${errMsg.replace(/\ng/, ' ')}
${errStackComment}
        #warning "DFA compilation failed for ${methodName} (Pattern: /${escapeRegex(regex)}/): ${escapedErrMsg}"
        private static readonly Regex Regex_Obj_${methodName} = new Regex(@"^${escapeRegex(regex)}", RegexOptions.Compiled);
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        private bool ${methodName}(ITextDocument text, int offset, out string matchedValue)
        {
            matchedValue = string.Empty;
            if (offset >= text.Length) return false;
            ReadOnlyMemory<char> mem = text.GetText(offset, text.Length - offset);
            string slice = mem.ToString();
            var match = Regex_Obj_${methodName}.Match(slice);
            if (match.Success && match.Index == 0)
            {
                matchedValue = match.Value;
                return true;
            }
            return false;
        }
`;
  }
}

/**
 * Escapes regex pattern for C# verbatims.
 */
function escapeRegex(pattern: RegExp): string {
  return pattern.source.replace(/"/g, '""');
}
/**
 * Formats a speculative match in C# for nested rules like Choice, Optional, ZeroOrMore.
 */
function compileSpeculativeMatch(
  pattern: any,
  ruleId: number,
  varId: number,
  childElements: Set<string>,
  dfaMethodName?: string
): { code: string; matchedName: string; parsedAstName: string; newOffsetName: string; precName: string; maxDepName: string } {
  const mVar = `matched_${varId}`;
  const astVar = `parsedAst_${varId}`;
  const offsetVar = `newOffset_${varId}`;
  const precVar = `prec_${varId}`;
  let code = "";
  if (pattern instanceof RegExp) {
    if (isSimpleCaseInsensitiveRegex(pattern)) {
      const esc = escapeString(pattern.source);
      code = `
                        const string lit_${varId} = "${esc}";
                        const int litLen_${varId} = ${pattern.source.length};
                        bool ${mVar} = ctx.MatchLiteralIgnoreCase(text, currentOffset, lit_${varId}, litLen_${varId});
                        GreenNode ${astVar} = ${mVar} ? GreenNode.Create(NodeType.Literal, text.GetText(currentOffset, litLen_${varId}).ToString(), ${ruleId}, litLen_${varId}) : null;
                        int ${offsetVar} = ${mVar} ? currentOffset + litLen_${varId} : currentOffset;
                        int maxDep_${varId} = ${mVar} ? currentOffset + litLen_${varId} : currentOffset + 1; // approximation for failures
                        localMaxOffset = Math.Max(localMaxOffset, maxDep_${varId});
                        int ${precVar} = 0;`;
    } else {
      const fnName = dfaMethodName || `MatchDFA_Spec_${ruleId}`;
      code = `
                        string mval_${varId};
                        bool ${mVar} = ${fnName}(text, currentOffset, out mval_${varId});
                        GreenNode ${astVar} = ${mVar} ? GreenNode.Create(NodeType.Token, mval_${varId}, ${ruleId}, mval_${varId}?.Length ?? 0) : null;
                        int ${offsetVar} = ${mVar} ? currentOffset + (mval_${varId}?.Length ?? 0) : currentOffset;
                        int maxDep_${varId} = ${mVar} ? currentOffset + (mval_${varId}?.Length ?? 0) : currentOffset + 1;
                        localMaxOffset = Math.Max(localMaxOffset, maxDep_${varId});
                        int ${precVar} = 0;`;
    }
  } else if (typeof pattern === 'string') {
    const esc = escapeString(pattern);
    code = `
                        const string lit_${varId} = "${esc}";
                        const int litLen_${varId} = ${pattern.length};
                        bool ${mVar} = ctx.MatchLiteral(text, currentOffset, lit_${varId}, litLen_${varId});
                        GreenNode ${astVar} = ${mVar} ? GreenNode.Create(NodeType.Literal, lit_${varId}, ${ruleId}, litLen_${varId}) : null;
                        int ${offsetVar} = ${mVar} ? currentOffset + litLen_${varId} : currentOffset;
                        int maxDep_${varId} = ${mVar} ? currentOffset + litLen_${varId} : currentOffset + 1;
                        localMaxOffset = Math.Max(localMaxOffset, maxDep_${varId});
                        int ${precVar} = 0;`;
  } else {
    // SyntaxElement
    const cname = sanitize(pattern.name);
    childElements.add(cname);
    code = `
                        var res_${varId} = Parse${cname}(text, currentOffset, memo, ctx);
                        bool ${mVar} = res_${varId}.Success;
                        GreenNode ${astVar} = ${mVar} ? res_${varId}.Ast : null;
                        int ${offsetVar} = ${mVar} ? res_${varId}.NewOffset : currentOffset;
                        int maxDep_${varId} = res_${varId}.DependencyLimit;
                        localMaxOffset = Math.Max(localMaxOffset, maxDep_${varId});
                        int ${precVar} = ${pattern.precedence || 0};`;
  }
  return { code, matchedName: mVar, parsedAstName: astVar, newOffsetName: offsetVar, precName: precVar, maxDepName: `maxDep_${varId}` };
}
/**
 * Generates the strongly-typed AST node class structures.
 */
export function generateStronglyTypedAstClasses(rootElement: SyntaxElement, namespaceName: string = "SyntaxEngine"): string {
  const elements = collectElements(rootElement);
  
  // 1. Generate Enums for elements marked with MapToEnum
  let enumsCode = "";
  for (const el of elements) {
    if (el.isEnumTarget && el.enumName) {
      const enumValues = new Set<string>();
      for (const rule of el.rules) {
        if (rule.type === 'choice') {
          for (const choice of rule.value) {
            if (typeof choice === 'string') {
              const sanitized = sanitize(choice);
              if (sanitized && sanitized !== "_") {
                enumValues.add(sanitized);
              }
            } else if (choice instanceof SyntaxElement) {
              const label = choice.rules.length > 0 ? choice.rules[choice.rules.length - 1].label : null;
              if (label) enumValues.add(label);
              else enumValues.add(sanitize(choice.name));
            }
          }
        }
      }
      
      enumsCode += `    public enum ${el.enumName}\n    {\n        None,\n${Array.from(enumValues).map(v => `        ${v}`).join(",\n")}\n    }\n\n`;
    }
  }

  return `using System;
using System.Collections.Generic;
using System.Linq;

namespace ${namespaceName}
{
${enumsCode}${elements.map(el => {
    const elName = el.astNodeName ? sanitize(el.astNodeName) : sanitize(el.name);
    
    let propertiesStr = "";
    
    // Explicit field binding workflow (Method 2)
    const propertyGroups: Map<string, { type: string, isList: boolean, ruleId: number }> = new Map();
    
    let hasExplicitBindings = false;
    for (const rule of el.rules) {
      if (rule.label && !rule.ignored) {
        hasExplicitBindings = true;
        let csharpType = "AstNode";
        let isList = false;
        
        // Determine type based on rule content
        if (rule.type === 'zeroOrMore' || rule.type === 'oneOrMore' || rule.type === 'separatedBy') {
          isList = true;
          const leafValue = rule.type === 'separatedBy' ? rule.value.item : rule.value;
          if (leafValue instanceof SyntaxElement) {
            csharpType = (leafValue.astNodeName ? sanitize(leafValue.astNodeName) : sanitize(leafValue.name)) + "Node";
          } else if (Array.isArray(leafValue)) {
            const elNames = leafValue.filter(v => v instanceof SyntaxElement).map(v => (v.astNodeName ? sanitize(v.astNodeName) : sanitize(v.name)) + "Node");
            if (elNames.length > 0) {
              const uniqueNames = Array.from(new Set(elNames));
              if (uniqueNames.length === 1) {
                csharpType = uniqueNames[0];
              } else {
                csharpType = "AstNode";
              }
            } else {
              csharpType = "AstNode";
            }
          }
        } else if (rule.type === 'element' || rule.type === 'optional' || rule.type === 'assert') {
          const leafValue = rule.type === 'assert' ? rule.value : rule.value;
          if (leafValue instanceof SyntaxElement) {
            csharpType = (leafValue.astNodeName ? sanitize(leafValue.astNodeName) : sanitize(leafValue.name)) + "Node";
          }
        } else if (rule.type === 'choice') {
          csharpType = "AstNode"; // General fallback
        }
        
        propertyGroups.set(rule.label, { type: csharpType, isList, ruleId: rule.id });
      }
    }
    
    if (hasExplicitBindings) {
      propertiesStr = Array.from(propertyGroups.entries()).map(([label, mapping]) => {
         const capLabel = label.charAt(0).toUpperCase() + label.slice(1);
         if (mapping.isList) {
             return `        public List<${mapping.type}> ${label} => Children.OfType<${mapping.type}>().ToList();
        public ${elName}Node With${capLabel}(List<${mapping.type}> newChildren)
        {
            return this;
        }`;
         } else {
             return `        public ${mapping.type} ${label} => Children.OfType<${mapping.type}>().FirstOrDefault();
        public ${elName}Node With${capLabel}(${mapping.type} newNode)
        {
            var oldChild = this.${label}?.Green;
            var newGreen = Green.ReplaceChild(oldChild, newNode?.Green);
            return new ${elName}Node(newGreen, Parent, Offset);
        }`;
         }
      }).join("\n\n");
    } else {
      // Fallback: the old behavior for elements without explicit bindings
      const childrenNodeTypes = new Set<string>();
      for (const rule of el.rules) {
        if (rule.ignored) continue;
        
        if (rule.type === 'element' && rule.value instanceof SyntaxElement) {
          childrenNodeTypes.add(rule.value.astNodeName ? sanitize(rule.value.astNodeName) : sanitize(rule.value.name));
        } else if (rule.type === 'choice') {
          for (const child of rule.value) {
            if (child instanceof SyntaxElement) {
              childrenNodeTypes.add(child.astNodeName ? sanitize(child.astNodeName) : sanitize(child.name));
            }
          }
        } else if (
          rule.type === 'optional' ||
          rule.type === 'leadingTrivia' ||
          rule.type === 'trailingTrivia' ||
          rule.type === 'zeroOrMore' ||
          rule.type === 'oneOrMore'
        ) {
          if (rule.value instanceof SyntaxElement) {
            childrenNodeTypes.add(rule.value.astNodeName ? sanitize(rule.value.astNodeName) : sanitize(rule.value.name));
          } else if (Array.isArray(rule.value)) {
            for (const sub of rule.value) {
              if (sub instanceof SyntaxElement) {
                childrenNodeTypes.add(sub.astNodeName ? sanitize(sub.astNodeName) : sanitize(sub.name));
              }
            }
          }
        } else if (rule.type === 'separatedBy' && rule.value) {
          if (rule.value.item instanceof SyntaxElement) {
            childrenNodeTypes.add(rule.value.item.astNodeName ? sanitize(rule.value.item.astNodeName) : sanitize(rule.value.item.name));
          }
          if (rule.value.separator instanceof SyntaxElement) {
            childrenNodeTypes.add(rule.value.separator.astNodeName ? sanitize(rule.value.separator.astNodeName) : sanitize(rule.value.separator.name));
          }
        }
      }
      propertiesStr = Array.from(childrenNodeTypes).map(childName => `        public ${childName}Node ${childName} => FindChild<${childName}Node>();\n        public List<${childName}Node> All_${childName} => FindChildren<${childName}Node>();`).join("\n\n");
    }

    // Enum helper logic inside the class
    let enumHelper = "";
    if (el.isEnumTarget && el.enumName) {
       enumHelper = `\n        private ${el.enumName}? _kindCache = null;\n        public ${el.enumName} Kind\n        {\n            get\n            {\n                if (_kindCache.HasValue) return _kindCache.Value;\n                string val = this.Value;\n                ${el.enumName} result = ${el.enumName}.None;\n                Enum.TryParse(val, true, out result);\n                _kindCache = result;\n                return result;\n            }\n        }\n`;
    }

    return `    public class ${elName}Node : AstNode
    {
        public ${elName}Node(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }
${propertiesStr}${enumHelper}
    }`;
  }).join("\n\n")}
}
`;
}
/**
 * Generates the complete, self-contained C# code string in Allman style.
 */
export function generateFullCSharp(rootElement: SyntaxElement, namespaceName: string = "SyntaxEngine", scopeBuilder?: ScopeBuilder): string {
  const elements = collectElements(rootElement);
  const ruleTokenNames: { ruleId: number; tokenName: string }[] = [];
  for (const el of elements) {
    for (const rule of el.rules) {
      if ((rule as any).tokenName) {
        ruleTokenNames.push({ ruleId: rule.id, tokenName: (rule as any).tokenName });
      }
    }
  }
  const coreCode = generateCoreCSharpCode(namespaceName, scopeBuilder, ruleTokenNames);
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
      const elName = el.astNodeName ? sanitize(el.astNodeName) : sanitize(el.name);
      
      let propertiesStr = "";
      
      const propertyGroups: Map<string, { type: string, isList: boolean, ruleId: number }> = new Map();
      
      let hasExplicitBindings = false;
      for (const rule of el.rules) {
        if (rule.label && !rule.ignored) {
          hasExplicitBindings = true;
          let csharpType = "AstNode";
          let isList = false;
          
          if (rule.type === 'zeroOrMore' || rule.type === 'oneOrMore' || rule.type === 'separatedBy') {
            isList = true;
            const leafValue = rule.type === 'separatedBy' ? rule.value.item : rule.value;
            if (leafValue instanceof SyntaxElement) {
              csharpType = (leafValue.astNodeName ? sanitize(leafValue.astNodeName) : sanitize(leafValue.name)) + "Node";
            } else if (Array.isArray(leafValue)) {
              const elNames = leafValue.filter(v => v instanceof SyntaxElement).map(v => (v.astNodeName ? sanitize(v.astNodeName) : sanitize(v.name)) + "Node");
              if (elNames.length > 0) {
                const uniqueNames = Array.from(new Set(elNames));
                if (uniqueNames.length === 1) {
                  csharpType = uniqueNames[0];
                } else {
                  csharpType = "AstNode";
                }
              } else {
                csharpType = "AstNode";
              }
            }
          } else if (rule.type === 'element' || rule.type === 'optional' || rule.type === 'assert') {
            const leafValue = rule.type === 'assert' ? rule.value : rule.value;
            if (leafValue instanceof SyntaxElement) {
              csharpType = (leafValue.astNodeName ? sanitize(leafValue.astNodeName) : sanitize(leafValue.name)) + "Node";
            }
          } else if (rule.type === 'choice') {
            csharpType = "AstNode";
          }
          
          propertyGroups.set(rule.label, { type: csharpType, isList, ruleId: rule.id });
        }
      }
      
      if (hasExplicitBindings) {
        propertiesStr = Array.from(propertyGroups.entries()).map(([label, mapping]) => {
           // Capitalize first letter for Method names
           const capLabel = label.charAt(0).toUpperCase() + label.slice(1);
           if (mapping.isList) {
               return `        public List<${mapping.type}> ${label} => Children.OfType<${mapping.type}>().ToList();
        public ${elName}Node With${capLabel}(List<${mapping.type}> newChildren)
        {
            // Simple list replacement (Warning: basic implementation for immutable mutation)
            return this; // Placeholder for list replacements
        }`;
           } else {
               return `        public ${mapping.type} ${label} => Children.OfType<${mapping.type}>().FirstOrDefault();
        public ${elName}Node With${capLabel}(${mapping.type} newNode)
        {
            var oldChild = this.${label}?.Green;
            return new ${elName}Node(Green.ReplaceChild(oldChild, newNode?.Green), Parent, Offset);
        }`;
           }
        }).join("\n\n");
      } else {
        const childrenNodeTypes = new Set<string>();
        for (const rule of el.rules) {
          if (rule.ignored) continue;
          
          if (rule.type === 'element' && rule.value instanceof SyntaxElement) {
            childrenNodeTypes.add(rule.value.astNodeName ? sanitize(rule.value.astNodeName) : sanitize(rule.value.name));
          } else if (rule.type === 'choice') {
            for (const child of rule.value) {
              if (child instanceof SyntaxElement) {
                childrenNodeTypes.add(child.astNodeName ? sanitize(child.astNodeName) : sanitize(child.name));
              }
            }
          } else if (
            rule.type === 'optional' ||
            rule.type === 'leadingTrivia' ||
            rule.type === 'trailingTrivia' ||
            rule.type === 'zeroOrMore' ||
            rule.type === 'oneOrMore'
          ) {
            if (rule.value instanceof SyntaxElement) {
              childrenNodeTypes.add(rule.value.astNodeName ? sanitize(rule.value.astNodeName) : sanitize(rule.value.name));
            } else if (Array.isArray(rule.value)) {
              for (const sub of rule.value) {
                if (sub instanceof SyntaxElement) {
                  childrenNodeTypes.add(sub.astNodeName ? sanitize(sub.astNodeName) : sanitize(sub.name));
                }
              }
            }
          } else if (rule.type === 'separatedBy' && rule.value) {
            if (rule.value.item instanceof SyntaxElement) {
              childrenNodeTypes.add(rule.value.item.astNodeName ? sanitize(rule.value.item.astNodeName) : sanitize(rule.value.item.name));
            }
            if (rule.value.separator instanceof SyntaxElement) {
              childrenNodeTypes.add(rule.value.separator.astNodeName ? sanitize(rule.value.separator.astNodeName) : sanitize(rule.value.separator.name));
            }
          }
        }
        propertiesStr = Array.from(childrenNodeTypes).map(childName => `        public ${childName}Node ${childName} => FindChild<${childName}Node>();\n        public List<${childName}Node> All_${childName} => FindChildren<${childName}Node>();`).join("\n\n");
      }

      let enumHelper = "";
      if (el.isEnumTarget && el.enumName) {
         enumHelper = `\n        private ${el.enumName}? _kindCache = null;\n        public ${el.enumName} Kind\n        {\n            get\n            {\n                if (_kindCache.HasValue) return _kindCache.Value;\n                string val = this.Value;\n                ${el.enumName} result = ${el.enumName}.None;\n                Enum.TryParse(val, true, out result);\n                _kindCache = result;\n                return result;\n            }\n        }\n`;
      }

      const nodeCode = `using System;
using System.Collections.Generic;
using System.Linq;

namespace ${ns}
{
    public class ${elName}Node : AstNode
    {
        public ${elName}Node(GreenNode green, AstNode parent, int offset) : base(green, parent, offset)
        {
        }
${propertiesStr}${enumHelper}
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
  const compileFormatToCsLambda = (format: string) => {
    const regex = /\{([^}]+)\}/g;
    let match;
    const parts: string[] = [];
    let lastIndex = 0;
    let hasPlaceholders = false;
    let idCounter = 0;
    while ((match = regex.exec(format)) !== null) {
      hasPlaceholders = true;
      const literal = format.substring(lastIndex, match.index);
      if (literal) {
        parts.push(`"${escapeCsString(literal)}"`);
      }
      const key = match[1];
      let capName = key;
      if (key.includes(':')) {
        const splitParts = key.split(':');
        capName = splitParts[0];
      }
      const uId = ++idCounter;
      parts.push(`(captures.TryGetValue("${escapeCsString(capName)}", out var list${uId}) && list${uId}.Count > 0 ? (list${uId}[0].Value?.ToString() ?? list${uId}[0].Type) : "")`);
      lastIndex = regex.lastIndex;
    }
    const tail = format.substring(lastIndex);
    if (tail) {
      parts.push(`"${escapeCsString(tail)}"`);
    }
    if (!hasPlaceholders) {
      return `(captures, raw, match) => "${escapeCsString(format)}"`;
    }
    return `(captures, raw, match) => ${parts.join(' + ')}`;
  };
  // 1. Scope Rules
  for (const rule of scopeBuilder.scopeRules) {
    if (typeof rule.nameFn === 'string') {
      const lambdaStr = compileFormatToCsLambda(rule.nameFn);
      lines.push(`            sb.DefineScope("${escapeCsString(rule.type)}", "${escapeCsString(rule.queryStr)}", ${lambdaStr});`);
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
      const nameLambdaStr = compileFormatToCsLambda(rule.nameFn);
      const kindLambdaStr = compileFormatToCsLambda(rule.kindFn);
      const datatypeLambdaStr = compileFormatToCsLambda(rule.datatypeFn);
      lines.push(`            sb.DefineSymbol("${escapeCsString(rule.queryStr)}", \n                ${nameLambdaStr}, \n                ${kindLambdaStr}, \n                ${datatypeLambdaStr}\n            );`);
    } else {
      lines.push(`            // Custom symbol rule mapping:`);
      lines.push(`            // sb.DefineSymbol("${escapeCsString(rule.queryStr)}", nameFn, kindFn, datatypeFn);`);
    }
  }
  // 3. Reference Rules
  for (const rule of scopeBuilder.referenceRules) {
    if (typeof rule.nameFn === 'string') {
      const lambdaStr = compileFormatToCsLambda(rule.nameFn);
      lines.push(`            sb.DefineReference("${escapeCsString(rule.queryStr)}", ${lambdaStr});`);
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
export function generateCoreCSharpCode(namespaceName: string = "SyntaxEngine", scopeBuilder?: ScopeBuilder, ruleTokenNames: { ruleId: number; tokenName: string }[] = []): string {
  let ruleTokenNamesInit = "";
  if (ruleTokenNames && ruleTokenNames.length > 0) {
    ruleTokenNamesInit = ruleTokenNames.map(r => `            { ${r.ruleId}, "${r.tokenName}" }`).join(",\n");
  }
  return `using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;
namespace ${namespaceName}
{
    public interface ITextDocument
    {
        int Length { get; }
        ReadOnlyMemory<char> GetText(int start, int length);
        char this[int index] { get; }
        int GetLineEnd(int offset);
        int GetLineEnding(int offset);
        int IndexOf(int start, string pattern, int limit);
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
                if (c == '\r' || c == '\n') return i;
            }
            return _text.Length;
        }
        public int GetLineEnding(int offset)
        {
            if (offset < 0 || offset >= _text.Length) return 0;
            int end = GetLineEnd(offset);
            return end - offset;
        }
        public int IndexOf(int start, string pattern, int limit)
        {
            if (start < 0 || start >= _text.Length || string.IsNullOrEmpty(pattern)) return -1;
            int count = Math.Min(_text.Length - start, limit);
            if (count < pattern.Length) return -1;
            return _text.IndexOf(pattern, start, count, StringComparison.Ordinal);
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
        public bool MatchLiteralIgnoreCase(ITextDocument text, int offset, string literal, int literalLength)
        {
            if (offset + literalLength > text.Length) return false;
            if (_cachedLineTextOffset != -1 && offset >= _cachedLineTextOffset && offset + literalLength <= _cachedLineTextOffset + _cachedLineTextLength)
            {
                int relOffset = offset - _cachedLineTextOffset;
                return _cachedLineText.Span.Slice(relOffset, literalLength).Equals(literal.AsSpan(), StringComparison.OrdinalIgnoreCase);
            }
            ReadOnlyMemory<char> segment = text.GetText(offset, literalLength);
            return segment.Span.Equals(literal.AsSpan(), StringComparison.OrdinalIgnoreCase);
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
        public static readonly Dictionary<int, string> RuleTokenNames = new Dictionary<int, string>
        {
${ruleTokenNamesInit}
        };
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
        public List<RelativeQueryMatch> GetMatchesForNode(AstNode node)
        {
            if (node == null) return new List<RelativeQueryMatch>();
            if (!_greenQueryCache.TryGetValue(node.Green, out var cacheMap))
            {
                cacheMap = new Dictionary<CSTQuery, List<RelativeQueryMatch>>();
                _greenQueryCache.Remove(node.Green);
                _greenQueryCache.Add(node.Green, cacheMap);
            }
            if (cacheMap.TryGetValue(this, out var cached))
            {
                return cached;
            }
            var localMatches = new List<RelativeQueryMatch>();
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
                        caps.Add(new RelativeQueryCapture
                        {
                            Name = c.Name,
                            NodePath = relPath
                        });
                    }
                    localMatches.Add(new RelativeQueryMatch
                    {
                        PatternIndex = i,
                        NodePath = new List<int>(),
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
                    var childMatches = GetMatchesForNode(child);
                    foreach (var m in childMatches)
                    {
                        var shiftedPath = new List<int> { idx };
                        shiftedPath.AddRange(m.NodePath);
                        var shiftedCaps = new List<RelativeQueryCapture>();
                        foreach (var c in m.Captures)
                        {
                            var shiftedCapPath = new List<int> { idx };
                            shiftedCapPath.AddRange(c.NodePath);
                            shiftedCaps.Add(new RelativeQueryCapture
                            {
                                Name = c.Name,
                                NodePath = shiftedCapPath
                            });
                        }
                        localMatches.Add(new RelativeQueryMatch
                        {
                            PatternIndex = m.PatternIndex,
                            NodePath = shiftedPath,
                            Captures = shiftedCaps
                        });
                    }
                }
            }
            cacheMap[this] = localMatches;
            return localMatches;
        }
        public List<QueryMatch> Run(AstNode ast)
        {
            if (ast == null) return new List<QueryMatch>();
            var cached = GetMatchesForNode(ast);
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
                var fieldNameCapitalized = char.ToUpper(pat.Field[0]) + pat.Field.Substring(1);
                var prop = parent.GetType().GetProperty(pat.Field) ?? parent.GetType().GetProperty(fieldNameCapitalized);
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
                    
                    string ruleTokenName = null;
                    if (CSTQuery.RuleTokenNames.TryGetValue(node.RuleId, out var rName))
                    {
                        ruleTokenName = rName.ToLowerInvariant().Replace("_", "");
                    }
                    
                    if (currentType != target && nodeTypeName != target && ruleTokenName != target)
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
${generateScopeBuilderConfigCode(scopeBuilder)}
        public class ScopeRule
        {
            public string Type { get; set; }
            public CSTQuery Query { get; set; }
            public MatchSelectorDelegate NameFn { get; set; }
        }
        public class SymbolRule
        {
            public CSTQuery Query { get; set; }
            public MatchSelectorDelegate NameFn { get; set; }
            public MatchSelectorDelegate KindFn { get; set; }
            public MatchSelectorDelegate DatatypeFn { get; set; }
        }
        public class ReferenceRule
        {
            public CSTQuery Query { get; set; }
            public MatchSelectorDelegate NameFn { get; set; }
        }
        private readonly List<ScopeRule> _scopeRules = new List<ScopeRule>();
        private readonly List<SymbolRule> _symbolRules = new List<SymbolRule>();
        private readonly List<ReferenceRule> _referenceRules = new List<ReferenceRule>();
        public void DefineScope(string type, string queryStr, MatchSelectorDelegate nameFn)
        {
            _scopeRules.Add(new ScopeRule { Type = type, Query = new CSTQuery(queryStr), NameFn = nameFn });
        }
        public void DefineSymbol(string queryStr, MatchSelectorDelegate nameFn, MatchSelectorDelegate kindFn, MatchSelectorDelegate datatypeFn)
        {
            _symbolRules.Add(new SymbolRule { Query = new CSTQuery(queryStr), NameFn = nameFn, KindFn = kindFn, DatatypeFn = datatypeFn });
        }
        public void DefineReference(string queryStr, MatchSelectorDelegate nameFn)
        {
            _referenceRules.Add(new ReferenceRule { Query = new CSTQuery(queryStr), NameFn = nameFn });
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
                            Name = rule.NameFn(captures, match.Captures, match),
                            Type = rule.Type,
                            Start = targetNode.Start,
                            End = targetNode.End,
                            Node = targetNode
                        });
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
                            Name = rule.NameFn(captures, match.Captures, match),
                            Kind = rule.KindFn(captures, match.Captures, match),
                            Datatype = rule.DatatypeFn(captures, match.Captures, match),
                            Start = start,
                            End = end,
                            Node = targetNode,
                            ScopeId = parentScope.Id
                        });
                        mainDeclOffsets.Add(start);
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
                            Name = rule.NameFn(captures, match.Captures, match),
                            Start = start,
                            End = end,
                            Node = targetNode,
                            ScopeId = parentScope.Id
                        });
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
  const patternToVarName = new Map<string, string>();
  const patternToDfaMethodName = new Map<string, string>();
  // Pre-scan all RegExps to group by pattern key and assign beautiful shared names
  const patternToRuleIds = new Map<string, { regex: RegExp; types: Set<'Rule' | 'Spec'>; ruleIds: Set<number> }>();
  function registerPattern(p: RegExp, ruleId: number, type: 'Rule' | 'Spec') {
    const key = `${p.source}///${p.flags}`;
    let match = patternToRuleIds.get(key);
    if (!match) {
      match = { regex: p, types: new Set(), ruleIds: new Set() };
      patternToRuleIds.set(key, match);
    }
    match.types.add(type);
    match.ruleIds.add(ruleId);
  }
  // Scan all elements and their rules to find regexes
  for (const el of elements) {
    for (const rule of el.rules) {
      const ruleId = rule.id;
      if (rule.type === 'regex') {
        if (!isSimpleCaseInsensitiveRegex(rule.value)) {
          registerPattern(rule.value, ruleId, 'Rule');
        }
      } else if ((rule.type === 'choice' || rule.type === 'zeroOrMore' || rule.type === 'oneOrMore') && Array.isArray(rule.value)) {
        const patterns = rule.value as any[];
        for (const p of patterns) {
          if (p instanceof RegExp) {
            if (!isSimpleCaseInsensitiveRegex(p)) {
              registerPattern(p, ruleId, 'Spec');
            }
          }
        }
      } else if (
        rule.type === 'optional' ||
        rule.type === 'leadingTrivia' ||
        rule.type === 'trailingTrivia' ||
        rule.type === 'zeroOrMore' ||
        rule.type === 'oneOrMore' ||
        rule.type === 'not' ||
        rule.type === 'beginScope' ||
        rule.type === 'endScope' ||
        rule.type === 'assert'
      ) {
        if (rule.value instanceof RegExp) {
          if (!isSimpleCaseInsensitiveRegex(rule.value)) {
            registerPattern(rule.value, ruleId, 'Spec');
          }
        }
      } else if (rule.type === 'separatedBy' && rule.value) {
        if (rule.value.item instanceof RegExp) {
          if (!isSimpleCaseInsensitiveRegex(rule.value.item)) {
            registerPattern(rule.value.item, ruleId, 'Spec');
          }
        }
        if (rule.value.separator instanceof RegExp) {
          if (!isSimpleCaseInsensitiveRegex(rule.value.separator)) {
            registerPattern(rule.value.separator, ruleId, 'Spec');
          }
        }
      }
    }
  }
  // Generate names and C# code for each unique pattern
  for (const [key, match] of patternToRuleIds.entries()) {
    const ruleIdsString = Array.from(match.ruleIds).sort((a, b) => a - b).join('_');
    const primaryType = match.types.has('Rule') ? 'Rule' : 'Spec';
    const name = `MatchDFA_${primaryType}_${ruleIdsString}`;
    patternToDfaMethodName.set(key, name);
    const fallbackRuleId = Array.from(match.ruleIds)[0] || 0;
    const dfaMethod = generateDFACSharpMethod(name, match.regex, fallbackRuleId, primaryType);
    if (match.types.has('Rule')) {
      regexFields.push(dfaMethod);
    } else {
      speculativeRegexes.push(dfaMethod);
    }
  }
  function getOrCreateDfaMethod(p: RegExp, type: 'Rule' | 'Spec', fallbackRuleId: number): string {
    const key = `${p.source}///${p.flags}`;
    const name = patternToDfaMethodName.get(key);
    return name || `MatchDFA_${type}_${fallbackRuleId}`;
  }
  // Core & custom nodes elements list mapping to C# NodeType enum
  const customNodeTypes = Array.from(new Set(elements.map(el => el.astNodeName ? sanitize(el.astNodeName) : sanitize(el.name))));
  // Generate switch cases for RedNode mapping
  const factoryCases = elements.map(el => {
    const elName = el.astNodeName ? sanitize(el.astNodeName) : sanitize(el.name);
    return `                case NodeType.${elName}: return new ${elName}Node(green, parent, offset);`;
  }).join("\n");
  // Generate rule-flattened parser methods for each element
  let specIdCounter = 0;
  const nextSpecId = () => ++specIdCounter;
  const parserMethods = elements.map(el => {
    const elName = el.astNodeName ? sanitize(el.astNodeName) : sanitize(el.name);
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
      let ruleIsStructural = true;
      if (
        rule.type === 'whitespace' ||
        rule.type === 'leadingTrivia' ||
        rule.type === 'trailingTrivia' ||
        rule.type === 'optional' ||
        rule.type === 'zeroOrMore' ||
        rule.type === 'not' ||
        rule.type === 'assert'
      ) {
        ruleIsStructural = false;
      }
      const structUpdate = ``;
      const startOffsetForFailure = `currentOffset`;
      if (rule.type === 'literal') {
        const esc = escapeString(rule.value);
        return `
            // Literal Rule: "${esc}" (id: ${ruleId})
            if (!panicked)
            {
                int startOffset_${ruleId} = currentOffset;
                const string lit = "${esc}";
                const int litLen = ${rule.value.length};
                localMaxOffset = Math.Max(localMaxOffset, currentOffset + litLen);
                if (ctx.MatchLiteral(text, currentOffset, lit, litLen))
                {
                    results.Add(GreenNode.Create(NodeType.Literal, lit, ${ruleId}, litLen));
                    currentOffset += litLen;
                    hasCommitted = true;
                    ${structUpdate}
                }
                else
                {
                    if (!TryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected literal \\"${esc}\\\"", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                        return failRes; // Handled recovery boundary hit
                }
            }`;
      }
      if (rule.type === 'caseInsensitiveLiteral') {
        const esc = escapeString(rule.value.source);
        return `
            // Case-Insensitive Literal Rule: "${esc}" (id: ${ruleId})
            if (!panicked)
            {
                int startOffset_${ruleId} = currentOffset;
                const string lit = "${esc}";
                const int litLen = ${rule.value.source.length};
                localMaxOffset = Math.Max(localMaxOffset, currentOffset + litLen);
                if (ctx.MatchLiteralIgnoreCase(text, currentOffset, lit, litLen))
                {
                    string matchedText = text.GetText(currentOffset, litLen).ToString();
                    results.Add(GreenNode.Create(NodeType.Literal, matchedText, ${ruleId}, litLen));
                    currentOffset += litLen;
                    hasCommitted = true;
                    ${structUpdate}
                }
                else
                {
                    if (!TryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected case-insensitive literal \\"${esc}\\\"", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                        return failRes; // Handled recovery boundary hit
                }
            }`;
      }
      if (rule.type === 'regex') {
        const dfaMethodName = getOrCreateDfaMethod(rule.value, 'Rule', ruleId);
        return `
            // Regex Rule: ${rule.value.source} (id: ${ruleId})
            if (!panicked)
            {
                int startOffset_${ruleId} = currentOffset;
                string mval_${ruleId};
                if (${dfaMethodName}(text, currentOffset, out mval_${ruleId}))
                {
                    results.Add(GreenNode.Create(NodeType.Token, mval_${ruleId}, ${ruleId}, mval_${ruleId}.Length));
                    currentOffset += mval_${ruleId}.Length;
                    hasCommitted = true;
                    ${structUpdate}
                    localMaxOffset = Math.Max(localMaxOffset, currentOffset);
                }
                else
                {
                    if (!TryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected match for pattern", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                        return failRes;
                }
            }`;
      }
      if (rule.type === 'whitespace') {
        return `
            // Whitespace Rule (id: ${ruleId})
            if (!panicked)
            {
                int startOffset_${ruleId} = currentOffset;
                int wsStart = currentOffset;
                while (currentOffset < text.Length && char.IsWhiteSpace(text[currentOffset]))
                {
                    currentOffset++;
                }
                localMaxOffset = Math.Max(localMaxOffset, currentOffset);
                if (currentOffset > wsStart)
                {
                    results.Add(GreenNode.Create(NodeType.Whitespace, text.GetText(wsStart, currentOffset - wsStart).ToString(), ${ruleId}, currentOffset - wsStart));
                }
                else
                {
                    if (!TryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected whitespace", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                        return failRes;
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
                int startOffset_${ruleId} = currentOffset;
                ParseResult res = Parse${subName}(text, currentOffset, memo, ctx);
                localMaxOffset = Math.Max(localMaxOffset, res.DependencyLimit);
                if (res.Success)
                {
                    if (res.Ast != null && (res.Ast.Width > 0 || res.Ast.Type == NodeType.Eof))
                    {
                        results.Add(res.Ast);
                    }
                    currentOffset = res.NewOffset;
                    hasCommitted = true;
                    ${structUpdate}
                }
                else
                {
                    if (!TryRecover(text, ${startOffsetForFailure}, ${ruleId}, res.Error ?? "Expected sub-element ${rule.value.name}", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                        return failRes;
                }
            }`;
      }
      if (rule.type === 'choice') {
        const patterns = rule.value as any[];
        const baseErrorsVar = `baseErrors_${ruleId}`;
        const choiceChecks: string[] = [];
        patterns.forEach(p => {
          const sId = nextSpecId();
          let specificDfaName: string | undefined;
          if (p instanceof RegExp) {
            specificDfaName = getOrCreateDfaMethod(p, 'Spec', ruleId);
          }
          const spec = compileSpeculativeMatch(p, ruleId, sId, childElements, specificDfaName);
          choiceChecks.push(`
                // Speculative alternative check ${sId}
                if (!choiceMatched_${ruleId})
                {
                    ctx.RecoveredErrors.RemoveRange(${baseErrorsVar}, ctx.RecoveredErrors.Count - ${baseErrorsVar});
                    ${spec.code.trim()}
                    if (${spec.matchedName})
                    {
                        int branchErrorsCount = ctx.RecoveredErrors.Count - ${baseErrorsVar};
                        if (branchErrorsCount == 0)
                        {
                            if (${spec.parsedAstName} != null && (${spec.parsedAstName}.Width > 0 || ${spec.parsedAstName}.Type == NodeType.Eof))
                            {
                                results.Add(${spec.parsedAstName});
                            }
                            currentOffset = ${spec.newOffsetName};
                            hasCommitted = true;
                    ${structUpdate}
                            choiceMatched_${ruleId} = true;
                        }
                        else
                        {
                            if (backupAst_${ruleId} == null)
                            {
                                backupAst_${ruleId} = ${spec.parsedAstName};
                                backupOffset_${ruleId} = ${spec.newOffsetName};
                                backupErrors_${ruleId} = ctx.RecoveredErrors.GetRange(${baseErrorsVar}, branchErrorsCount);
                            }
                            ctx.RecoveredErrors.RemoveRange(${baseErrorsVar}, branchErrorsCount);
                        }
                    }
                }`);
        });
        return `
            // Choice Rule (id: ${ruleId})
            if (!panicked)
            {
                int startOffset_${ruleId} = currentOffset;
                bool choiceMatched_${ruleId} = false;
                int ${baseErrorsVar} = ctx.RecoveredErrors.Count;
                GreenNode backupAst_${ruleId} = null;
                int backupOffset_${ruleId} = -1;
                List<ParseError> backupErrors_${ruleId} = null;
${choiceChecks.join("\n")}
                if (!choiceMatched_${ruleId} && backupAst_${ruleId} != null)
                {
                    if (backupAst_${ruleId}.Width > 0 || backupAst_${ruleId}.Type == NodeType.Eof)
                    {
                        results.Add(backupAst_${ruleId});
                    }
                    currentOffset = backupOffset_${ruleId};
                    hasCommitted = true;
                    ${structUpdate}
                    ctx.RecoveredErrors.AddRange(backupErrors_${ruleId});
                    choiceMatched_${ruleId} = true;
                }
                if (!choiceMatched_${ruleId})
                {
                    ctx.RecoveredErrors.RemoveRange(${baseErrorsVar}, ctx.RecoveredErrors.Count - ${baseErrorsVar});
                    if (!TryRecover(text, ${startOffsetForFailure}, ${ruleId}, "None of the choices matched in rule ${ruleId}", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                        return failRes;
                }
            }`;
      }
      if (rule.type === 'optional' || rule.type === 'leadingTrivia' || rule.type === 'trailingTrivia') {
        const sId = nextSpecId();
        const escErrorsVar = `optErrors_${ruleId}`;
        let specificDfaName: string | undefined;
        if (rule.value instanceof RegExp) {
          specificDfaName = getOrCreateDfaMethod(rule.value, 'Spec', ruleId);
        }
        const spec = compileSpeculativeMatch(rule.value, ruleId, sId, childElements, specificDfaName);
        return `
            // Optional Rule (id: ${ruleId})
            if (!panicked)
            {
                int startOffset_${ruleId} = currentOffset;
                int ${escErrorsVar} = ctx.RecoveredErrors.Count;
                ${spec.code.trim()}
                if (${spec.matchedName})
                {
                    if (${spec.parsedAstName} != null && (${spec.parsedAstName}.Width > 0 || ${spec.parsedAstName}.Type == NodeType.Eof))
                    {
                        results.Add(${spec.parsedAstName});
                    }
                    currentOffset = ${spec.newOffsetName};
                    ${structUpdate}
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(${escErrorsVar}, ctx.RecoveredErrors.Count - ${escErrorsVar});
                }
            }`;
      }
      if (rule.type === 'zeroOrMore') {
        const isArray = Array.isArray(rule.value);
        const isToken = !!rule.isToken;
        if (isToken) {
          // compile leading trivia if present
          let leadCode = "";
          let leadMatchedName = "true";
          let leadAstName = "null";
          let leadNewOffsetName = "currentOffset";
          const leadId = nextSpecId();
          if (SyntaxElement.defaultLeadingTrivia) {
            let dfaName: string | undefined;
            if (SyntaxElement.defaultLeadingTrivia instanceof RegExp) {
              dfaName = getOrCreateDfaMethod(SyntaxElement.defaultLeadingTrivia, 'Spec', ruleId);
            }
            const specLead = compileSpeculativeMatch(SyntaxElement.defaultLeadingTrivia, ruleId, leadId, childElements, dfaName);
            leadCode = specLead.code;
            leadMatchedName = specLead.matchedName;
            leadAstName = specLead.parsedAstName;
            leadNewOffsetName = specLead.newOffsetName;
          }

          // compile trailing trivia if present
          let trailCode = "";
          let trailMatchedName = "true";
          let trailAstName = "null";
          let trailNewOffsetName = "branchNewOffset";
          const trailId = nextSpecId();
          if (SyntaxElement.defaultTrailingTrivia) {
            let dfaName: string | undefined;
            if (SyntaxElement.defaultTrailingTrivia instanceof RegExp) {
              dfaName = getOrCreateDfaMethod(SyntaxElement.defaultTrailingTrivia, 'Spec', ruleId);
            }
            const specTrail = compileSpeculativeMatch(SyntaxElement.defaultTrailingTrivia, ruleId, trailId, childElements, dfaName);
            trailCode = specTrail.code;
            trailMatchedName = specTrail.matchedName;
            trailAstName = specTrail.parsedAstName;
            trailNewOffsetName = specTrail.newOffsetName;
          }

          if (isArray) {
            const patterns = rule.value as any[];
            const escErrorsVar = `loopErrors_${ruleId}`;
            const activeScopeEndsVar = `loopScopeEnds_${ruleId}`;
            const branchChecks: string[] = [];
            
            patterns.forEach((p, idx) => {
              const sId = nextSpecId();
              let specificDfaName: string | undefined;
              if (p instanceof RegExp) {
                specificDfaName = getOrCreateDfaMethod(p, 'Spec', ruleId);
              }
              const spec = compileSpeculativeMatch(p, ruleId, sId, childElements, specificDfaName);
              branchChecks.push(`
                      {
                          int beforeBranchOffset = afterLeadOffset;
                          int ${escErrorsVar}_branch = ctx.RecoveredErrors.Count;
                          int ${activeScopeEndsVar}_branch = ctx.ActiveScopeEnds.Count;
                          int savedOffset = currentOffset;
                          currentOffset = afterLeadOffset;
                          ${spec.code.trim()}
                          currentOffset = savedOffset;
                          if (${spec.matchedName} && ${spec.newOffsetName} > beforeBranchOffset)
                          {
                              matchedBranch = true;
                              matchedAst = ${spec.parsedAstName};
                              branchNewOffset = ${spec.newOffsetName};
                          }
                          else
                          {
                              ctx.RecoveredErrors.RemoveRange(${escErrorsVar}_branch, ctx.RecoveredErrors.Count - ${escErrorsVar}_branch);
                              if (ctx.ActiveScopeEnds.Count > ${activeScopeEndsVar}_branch)
                              {
                                  ctx.ActiveScopeEnds.RemoveRange(${activeScopeEndsVar}_branch, ctx.ActiveScopeEnds.Count - ${activeScopeEndsVar}_branch);
                              }
                          }
                      }
                      if (matchedBranch) goto matched_branch_${ruleId};
              `);
            });

            return `
              // Zero Or More Token Rule (id: ${ruleId})
              if (!panicked)
              {
                  int startOffset_${ruleId} = currentOffset;
                  int startLoopOffset = currentOffset;
                  var loopResults = new List<GreenNode>();
                  while (currentOffset < text.Length)
                  {
                      int beforeLeadOffset = currentOffset;
                      int ${escErrorsVar}_lead = ctx.RecoveredErrors.Count;
                      
                      // Match leading trivia
                      ${leadCode}
                      int afterLeadOffset = ${leadMatchedName} ? ${leadNewOffsetName} : currentOffset;
                      
                      bool matchedBranch = false;
                      GreenNode matchedAst = null;
                      int branchNewOffset = afterLeadOffset;
                      
                      ${branchChecks.join("\n").trim()}
                      
                      matched_branch_${ruleId}:
                      if (matchedBranch)
                      {
                          // Commit leading trivia
                          if (${leadMatchedName} && ${leadNewOffsetName} > beforeLeadOffset)
                          {
                              loopResults.Add(${leadAstName});
                          }
                          
                          loopResults.Add(matchedAst);
                          
                          // Match trailing trivia
                          int beforeTrailOffset = branchNewOffset;
                          int savedOffsetTrail = currentOffset;
                          currentOffset = branchNewOffset;
                          ${trailCode}
                          currentOffset = savedOffsetTrail;
                          
                          if (${trailMatchedName} && ${trailNewOffsetName} > beforeTrailOffset)
                          {
                              loopResults.Add(${trailAstName});
                              currentOffset = ${trailNewOffsetName};
                          }
                          else
                          {
                              currentOffset = branchNewOffset;
                          }
                      }
                      else
                      {
                          // Revert leading trivia errors
                          ctx.RecoveredErrors.RemoveRange(${escErrorsVar}_lead, ctx.RecoveredErrors.Count - ${escErrorsVar}_lead);
                          break;
                      }
                  }
                  if (loopResults.Count > 0)
                  {
                      results.Add(GreenNode.Create(NodeType.ZeroOrMore, loopResults, ${ruleId}, currentOffset - startLoopOffset));
                      ${structUpdate}
                  }
              }`;
          } else {
            const sId = nextSpecId();
            const escErrorsVar = `loopErrors_${ruleId}`;
            let specificDfaName: string | undefined;
            if (rule.value instanceof RegExp) {
              specificDfaName = getOrCreateDfaMethod(rule.value, 'Spec', ruleId);
            }
            const spec = compileSpeculativeMatch(rule.value, ruleId, sId, childElements, specificDfaName);
            return `
              // Zero Or More Token Rule (id: ${ruleId})
              if (!panicked)
              {
                  int startOffset_${ruleId} = currentOffset;
                  int startLoopOffset = currentOffset;
                  var loopResults = new List<GreenNode>();
                  while (currentOffset < text.Length)
                  {
                      int beforeLeadOffset = currentOffset;
                      int ${escErrorsVar}_lead = ctx.RecoveredErrors.Count;
                      
                      // Match leading trivia
                      ${leadCode}
                      int afterLeadOffset = ${leadMatchedName} ? ${leadNewOffsetName} : currentOffset;
                      
                      // Speculative match starting from afterLeadOffset
                      int savedOffset = currentOffset;
                      currentOffset = afterLeadOffset;
                      ${spec.code.trim()}
                      currentOffset = savedOffset;
                      
                      if (${spec.matchedName} && ${spec.newOffsetName} > afterLeadOffset)
                      {
                          // Commit leading trivia
                          if (${leadMatchedName} && ${leadNewOffsetName} > beforeLeadOffset)
                          {
                              loopResults.Add(${leadAstName});
                          }
                          
                          loopResults.Add(${spec.parsedAstName});
                          
                          // Match trailing trivia
                          int beforeTrailOffset = ${spec.newOffsetName};
                          int savedOffsetTrail = currentOffset;
                          currentOffset = ${spec.newOffsetName};
                          ${trailCode}
                          currentOffset = savedOffsetTrail;
                          
                          if (${trailMatchedName} && ${trailNewOffsetName} > beforeTrailOffset)
                          {
                              loopResults.Add(${trailAstName});
                              currentOffset = ${trailNewOffsetName};
                          }
                          else
                          {
                              currentOffset = ${spec.newOffsetName};
                          }
                      }
                      else
                      {
                          // Revert leading trivia errors
                          ctx.RecoveredErrors.RemoveRange(${escErrorsVar}_lead, ctx.RecoveredErrors.Count - ${escErrorsVar}_lead);
                          break;
                      }
                  }
                  if (loopResults.Count > 0)
                  {
                      results.Add(GreenNode.Create(NodeType.ZeroOrMore, loopResults, ${ruleId}, currentOffset - startLoopOffset));
                      ${structUpdate}
                  }
              }`;
          }
        }

        if (isArray) {
          const patterns = rule.value as any[];
          const escErrorsVar = `loopErrors_${ruleId}`;
          const activeScopeEndsVar = `loopScopeEnds_${ruleId}`;
          
          const branchChecks: string[] = [];
          patterns.forEach((p, idx) => {
            const sId = nextSpecId();
            let specificDfaName: string | undefined;
            if (p instanceof RegExp) {
              specificDfaName = getOrCreateDfaMethod(p, 'Spec', ruleId);
            }
            const spec = compileSpeculativeMatch(p, ruleId, sId, childElements, specificDfaName);
            branchChecks.push(`
                    {
                        int beforeBranchOffset = currentOffset;
                        int ${escErrorsVar}_branch = ctx.RecoveredErrors.Count;
                        int ${activeScopeEndsVar}_branch = ctx.ActiveScopeEnds.Count;
                        ${spec.code.trim()}
                        if (${spec.matchedName} && ${spec.newOffsetName} > beforeBranchOffset)
                        {
                            matchedBranch = true;
                            matchedAst = ${spec.parsedAstName};
                            branchNewOffset = ${spec.newOffsetName};
                        }
                        else
                        {
                            ctx.RecoveredErrors.RemoveRange(${escErrorsVar}_branch, ctx.RecoveredErrors.Count - ${escErrorsVar}_branch);
                            if (ctx.ActiveScopeEnds.Count > ${activeScopeEndsVar}_branch)
                            {
                                ctx.ActiveScopeEnds.RemoveRange(${activeScopeEndsVar}_branch, ctx.ActiveScopeEnds.Count - ${activeScopeEndsVar}_branch);
                            }
                        }
                    }
                    if (matchedBranch) goto matched_branch_${ruleId};
            `);
          });

          return `
              // Zero Or More Rule (id: ${ruleId})
              if (!panicked)
              {
                  int startOffset_${ruleId} = currentOffset;
                  int startLoopOffset = currentOffset;
                  var loopResults = new List<GreenNode>();
                  while (currentOffset < text.Length)
                  {
                      bool matchedBranch = false;
                      GreenNode matchedAst = null;
                      int branchNewOffset = currentOffset;

                      ${branchChecks.join("\n").trim()}

                      matched_branch_${ruleId}:
                      if (matchedBranch)
                      {
                          loopResults.Add(matchedAst);
                          currentOffset = branchNewOffset;
                      }
                      else
                      {
                          break;
                      }
                  }
                  if (loopResults.Count > 0)
                  {
                      results.Add(GreenNode.Create(NodeType.ZeroOrMore, loopResults, ${ruleId}, currentOffset - startLoopOffset));
                      ${structUpdate}
                  }
              }`;
        } else {
          const sId = nextSpecId();
          const escErrorsVar = `loopErrors_${ruleId}`;
          let specificDfaName: string | undefined;
          if (rule.value instanceof RegExp) {
            specificDfaName = getOrCreateDfaMethod(rule.value, 'Spec', ruleId);
          }
          const spec = compileSpeculativeMatch(rule.value, ruleId, sId, childElements, specificDfaName);
          return `
              // Zero Or More Rule (id: ${ruleId})
              if (!panicked)
              {
                  int startOffset_${ruleId} = currentOffset;
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
                      ${structUpdate}
                  }
              }`;
        }
      }
      if (rule.type === 'oneOrMore') {
        const isArray = Array.isArray(rule.value);
        const isToken = !!rule.isToken;
        if (isToken) {
          // compile leading trivia if present
          let leadCode = "";
          let leadMatchedName = "true";
          let leadAstName = "null";
          let leadNewOffsetName = "currentOffset";
          const leadId = nextSpecId();
          if (SyntaxElement.defaultLeadingTrivia) {
            let dfaName: string | undefined;
            if (SyntaxElement.defaultLeadingTrivia instanceof RegExp) {
              dfaName = getOrCreateDfaMethod(SyntaxElement.defaultLeadingTrivia, 'Spec', ruleId);
            }
            const specLead = compileSpeculativeMatch(SyntaxElement.defaultLeadingTrivia, ruleId, leadId, childElements, dfaName);
            leadCode = specLead.code;
            leadMatchedName = specLead.matchedName;
            leadAstName = specLead.parsedAstName;
            leadNewOffsetName = specLead.newOffsetName;
          }

          // compile trailing trivia if present
          let trailCode = "";
          let trailMatchedName = "true";
          let trailAstName = "null";
          let trailNewOffsetName = "branchNewOffset";
          const trailId = nextSpecId();
          if (SyntaxElement.defaultTrailingTrivia) {
            let dfaName: string | undefined;
            if (SyntaxElement.defaultTrailingTrivia instanceof RegExp) {
              dfaName = getOrCreateDfaMethod(SyntaxElement.defaultTrailingTrivia, 'Spec', ruleId);
            }
            const specTrail = compileSpeculativeMatch(SyntaxElement.defaultTrailingTrivia, ruleId, trailId, childElements, dfaName);
            trailCode = specTrail.code;
            trailMatchedName = specTrail.matchedName;
            trailAstName = specTrail.parsedAstName;
            trailNewOffsetName = specTrail.newOffsetName;
          }

          if (isArray) {
            const patterns = rule.value as any[];
            const escErrorsVar = `loopErrors_${ruleId}`;
            const activeScopeEndsVar = `loopScopeEnds_${ruleId}`;
            const branchChecks: string[] = [];
            
            patterns.forEach((p, idx) => {
              const sId = nextSpecId();
              let specificDfaName: string | undefined;
              if (p instanceof RegExp) {
                specificDfaName = getOrCreateDfaMethod(p, 'Spec', ruleId);
              }
              const spec = compileSpeculativeMatch(p, ruleId, sId, childElements, specificDfaName);
              branchChecks.push(`
                      {
                          int beforeBranchOffset = afterLeadOffset;
                          int ${escErrorsVar}_branch = ctx.RecoveredErrors.Count;
                          int ${activeScopeEndsVar}_branch = ctx.ActiveScopeEnds.Count;
                          int savedOffset = currentOffset;
                          currentOffset = afterLeadOffset;
                          ${spec.code.trim()}
                          currentOffset = savedOffset;
                          if (${spec.matchedName} && ${spec.newOffsetName} > beforeBranchOffset)
                          {
                              matchedBranch = true;
                              matchedAst = ${spec.parsedAstName};
                              branchNewOffset = ${spec.newOffsetName};
                          }
                          else
                          {
                              ctx.RecoveredErrors.RemoveRange(${escErrorsVar}_branch, ctx.RecoveredErrors.Count - ${escErrorsVar}_branch);
                              if (ctx.ActiveScopeEnds.Count > ${activeScopeEndsVar}_branch)
                              {
                                  ctx.ActiveScopeEnds.RemoveRange(${activeScopeEndsVar}_branch, ctx.ActiveScopeEnds.Count - ${activeScopeEndsVar}_branch);
                              }
                          }
                      }
                      if (matchedBranch) goto matched_branch_${ruleId};
              `);
            });

            return `
              // One Or More Token Rule (id: ${ruleId})
              if (!panicked)
              {
                  int startOffset_${ruleId} = currentOffset;
                  int startLoopOffset = currentOffset;
                  var loopResults = new List<GreenNode>();
                  while (currentOffset < text.Length)
                  {
                      int beforeLeadOffset = currentOffset;
                      int ${escErrorsVar}_lead = ctx.RecoveredErrors.Count;
                      
                      // Match leading trivia
                      ${leadCode}
                      int afterLeadOffset = ${leadMatchedName} ? ${leadNewOffsetName} : currentOffset;
                      
                      bool matchedBranch = false;
                      GreenNode matchedAst = null;
                      int branchNewOffset = afterLeadOffset;
                      
                      ${branchChecks.join("\n").trim()}
                      
                      matched_branch_${ruleId}:
                      if (matchedBranch)
                      {
                          // Commit leading trivia
                          if (${leadMatchedName} && ${leadNewOffsetName} > beforeLeadOffset)
                          {
                              loopResults.Add(${leadAstName});
                          }
                          
                          loopResults.Add(matchedAst);
                          
                          // Match trailing trivia
                          int beforeTrailOffset = branchNewOffset;
                          int savedOffsetTrail = currentOffset;
                          currentOffset = branchNewOffset;
                          ${trailCode}
                          currentOffset = savedOffsetTrail;
                          
                          if (${trailMatchedName} && ${trailNewOffsetName} > beforeTrailOffset)
                          {
                              loopResults.Add(${trailAstName});
                              currentOffset = ${trailNewOffsetName};
                          }
                          else
                          {
                              currentOffset = branchNewOffset;
                          }
                      }
                      else
                      {
                          // Revert leading trivia errors
                          ctx.RecoveredErrors.RemoveRange(${escErrorsVar}_lead, ctx.RecoveredErrors.Count - ${escErrorsVar}_lead);
                          break;
                      }
                  }
                  if (loopResults.Count > 0)
                  {
                      results.Add(GreenNode.Create(NodeType.OneOrMore, loopResults, ${ruleId}, currentOffset - startLoopOffset));
                      hasCommitted = true;
                      ${structUpdate}
                  }
                  else
                  {
                      if (!TryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected at least one occurrence in loop", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                          return failRes;
                  }
              }`;
          } else {
            const sId = nextSpecId();
            const escErrorsVar = `loopErrors_${ruleId}`;
            let specificDfaName: string | undefined;
            if (rule.value instanceof RegExp) {
              specificDfaName = getOrCreateDfaMethod(rule.value, 'Spec', ruleId);
            }
            const spec = compileSpeculativeMatch(rule.value, ruleId, sId, childElements, specificDfaName);
            return `
              // One Or More Token Rule (id: ${ruleId})
              if (!panicked)
              {
                  int startOffset_${ruleId} = currentOffset;
                  int startLoopOffset = currentOffset;
                  var loopResults = new List<GreenNode>();
                  while (currentOffset < text.Length)
                  {
                      int beforeLeadOffset = currentOffset;
                      int ${escErrorsVar}_lead = ctx.RecoveredErrors.Count;
                      
                      // Match leading trivia
                      ${leadCode}
                      int afterLeadOffset = ${leadMatchedName} ? ${leadNewOffsetName} : currentOffset;
                      
                      // Speculative match starting from afterLeadOffset
                      int savedOffset = currentOffset;
                      currentOffset = afterLeadOffset;
                      ${spec.code.trim()}
                      currentOffset = savedOffset;
                      
                      if (${spec.matchedName} && ${spec.newOffsetName} > afterLeadOffset)
                      {
                          // Commit leading trivia
                          if (${leadMatchedName} && ${leadNewOffsetName} > beforeLeadOffset)
                          {
                              loopResults.Add(${leadAstName});
                          }
                          
                          loopResults.Add(${spec.parsedAstName});
                          
                          // Match trailing trivia
                          int beforeTrailOffset = ${spec.newOffsetName};
                          int savedOffsetTrail = currentOffset;
                          currentOffset = ${spec.newOffsetName};
                          ${trailCode}
                          currentOffset = savedOffsetTrail;
                          
                          if (${trailMatchedName} && ${trailNewOffsetName} > beforeTrailOffset)
                          {
                              loopResults.Add(${trailAstName});
                              currentOffset = ${trailNewOffsetName};
                          }
                          else
                          {
                              currentOffset = ${spec.newOffsetName};
                          }
                      }
                      else
                      {
                          // Revert leading trivia errors
                          ctx.RecoveredErrors.RemoveRange(${escErrorsVar}_lead, ctx.RecoveredErrors.Count - ${escErrorsVar}_lead);
                          break;
                      }
                  }
                  if (loopResults.Count > 0)
                  {
                      results.Add(GreenNode.Create(NodeType.OneOrMore, loopResults, ${ruleId}, currentOffset - startLoopOffset));
                      hasCommitted = true;
                      ${structUpdate}
                  }
                  else
                  {
                      if (!TryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected at least one occurrence in loop", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                          return failRes;
                  }
              }`;
          }
        }

        if (isArray) {
          const patterns = rule.value as any[];
          const escErrorsVar = `loopErrors_${ruleId}`;
          const activeScopeEndsVar = `loopScopeEnds_${ruleId}`;
          
          const branchChecks: string[] = [];
          patterns.forEach((p, idx) => {
            const sId = nextSpecId();
            let specificDfaName: string | undefined;
            if (p instanceof RegExp) {
              specificDfaName = getOrCreateDfaMethod(p, 'Spec', ruleId);
            }
            const spec = compileSpeculativeMatch(p, ruleId, sId, childElements, specificDfaName);
            branchChecks.push(`
                    {
                        int beforeBranchOffset = currentOffset;
                        int ${escErrorsVar}_branch = ctx.RecoveredErrors.Count;
                        int ${activeScopeEndsVar}_branch = ctx.ActiveScopeEnds.Count;
                        ${spec.code.trim()}
                        if (${spec.matchedName} && ${spec.newOffsetName} > beforeBranchOffset)
                        {
                            matchedBranch = true;
                            matchedAst = ${spec.parsedAstName};
                            branchNewOffset = ${spec.newOffsetName};
                        }
                        else
                        {
                            ctx.RecoveredErrors.RemoveRange(${escErrorsVar}_branch, ctx.RecoveredErrors.Count - ${escErrorsVar}_branch);
                            if (ctx.ActiveScopeEnds.Count > ${activeScopeEndsVar}_branch)
                            {
                                ctx.ActiveScopeEnds.RemoveRange(${activeScopeEndsVar}_branch, ctx.ActiveScopeEnds.Count - ${activeScopeEndsVar}_branch);
                            }
                        }
                    }
                    if (matchedBranch) goto matched_branch_${ruleId};
            `);
          });

          return `
              // One Or More Rule (id: ${ruleId})
              if (!panicked)
              {
                  int startOffset_${ruleId} = currentOffset;
                  int startLoopOffset = currentOffset;
                  var loopResults = new List<GreenNode>();
                  while (currentOffset < text.Length)
                  {
                      bool matchedBranch = false;
                      GreenNode matchedAst = null;
                      int branchNewOffset = currentOffset;

                      ${branchChecks.join("\n").trim()}

                      matched_branch_${ruleId}:
                      if (matchedBranch)
                      {
                          loopResults.Add(matchedAst);
                          currentOffset = branchNewOffset;
                      }
                      else
                      {
                          break;
                      }
                  }
                  if (loopResults.Count > 0)
                  {
                      results.Add(GreenNode.Create(NodeType.OneOrMore, loopResults, ${ruleId}, currentOffset - startLoopOffset));
                      hasCommitted = true;
                      ${structUpdate}
                  }
                  else
                  {
                      if (!TryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected at least one occurrence in loop", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                          return failRes;
                  }
              }`;
        } else {
          const sId = nextSpecId();
          const escErrorsVar = `loopErrors_${ruleId}`;
          let specificDfaName: string | undefined;
          if (rule.value instanceof RegExp) {
            specificDfaName = getOrCreateDfaMethod(rule.value, 'Spec', ruleId);
          }
          const spec = compileSpeculativeMatch(rule.value, ruleId, sId, childElements, specificDfaName);
          return `
              // One Or More Rule (id: ${ruleId})
              if (!panicked)
              {
                  int startOffset_${ruleId} = currentOffset;
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
                      ${structUpdate}
                  }
                  else
                  {
                      if (!TryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected at least one occurrence in loop", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                          return failRes;
                  }
              }`;
        }
      }
      if (rule.type === 'not') {
        const escErrorsVar = `notErrors_${ruleId}`;
        const isArray = Array.isArray(rule.value);

        let seqCode = "";
        let finalMatchCheck = "";
        if (isArray) {
          const patterns = rule.value as any[];
          seqCode = `bool seqMatched_${ruleId} = true;\n`;
          patterns.forEach((p, idx) => {
            const sId = nextSpecId();
            let specificDfaName: string | undefined;
            if (p instanceof RegExp) {
              specificDfaName = getOrCreateDfaMethod(p, 'Spec', ruleId);
            }
            const spec = compileSpeculativeMatch(p, ruleId, sId, childElements, specificDfaName);
            if (idx === 0) {
              seqCode += `
                {
                    ${spec.code.trim()}
                    if (${spec.matchedName})
                    {
                        currentOffset = ${spec.newOffsetName};
                    }
                    else
                    {
                        seqMatched_${ruleId} = false;
                    }
                }
              `;
            } else {
              seqCode += `
                if (seqMatched_${ruleId})
                {
                    ${spec.code.trim()}
                    if (${spec.matchedName})
                    {
                        currentOffset = ${spec.newOffsetName};
                    }
                    else
                    {
                        seqMatched_${ruleId} = false;
                    }
                }
              `;
            }
          });
          finalMatchCheck = `seqMatched_${ruleId}`;
        } else {
          const sId = nextSpecId();
          let specificDfaName: string | undefined;
          if (rule.value instanceof RegExp) {
            specificDfaName = getOrCreateDfaMethod(rule.value, 'Spec', ruleId);
          }
          const spec = compileSpeculativeMatch(rule.value, ruleId, sId, childElements, specificDfaName);
          seqCode = spec.code.trim();
          finalMatchCheck = spec.matchedName;
        }

        let triviaSkipCode = "";
        if (SyntaxElement.defaultLeadingTrivia instanceof SyntaxElement) {
          const triviaName = sanitize(SyntaxElement.defaultLeadingTrivia.name);
          childElements.add(triviaName);
          triviaSkipCode = `
                var skipRes_${ruleId} = Parse${triviaName}(text, scanOffset_${ruleId}, memo, ctx);
                if (skipRes_${ruleId}.Success)
                {
                    scanOffset_${ruleId} = skipRes_${ruleId}.NewOffset;
                }`;
        } else if (SyntaxElement.defaultLeadingTrivia instanceof RegExp) {
          const dfaName = getOrCreateDfaMethod(SyntaxElement.defaultLeadingTrivia, 'Spec', ruleId);
          triviaSkipCode = `
                if (${dfaName}(text, scanOffset_${ruleId}, out var matchedVal_${ruleId}))
                {
                    scanOffset_${ruleId} += matchedVal_${ruleId}.Length;
                }`;
        } else if (typeof SyntaxElement.defaultLeadingTrivia === 'string') {
          const escTrivia = escapeString(SyntaxElement.defaultLeadingTrivia);
          triviaSkipCode = `
                const string litTrivia_${ruleId} = "${escTrivia}";
                if (ctx.MatchLiteral(text, scanOffset_${ruleId}, litTrivia_${ruleId}, ${SyntaxElement.defaultLeadingTrivia.length}))
                {
                    scanOffset_${ruleId} += ${SyntaxElement.defaultLeadingTrivia.length};
                }`;
        }

        return `
            // Not Lookahead Rule: (id: ${ruleId})
            if (!panicked)
            {
                int ${escErrorsVar} = ctx.RecoveredErrors.Count;
                int backupOffset_${ruleId} = currentOffset;
                int scanOffset_${ruleId} = currentOffset;
                // ----- SKIP TRIVIA START -----
                ${triviaSkipCode.trim()}
                // ----- SKIP TRIVIA END -----
                currentOffset = scanOffset_${ruleId};
                ${seqCode.trim()}
                currentOffset = backupOffset_${ruleId};
                if (${finalMatchCheck})
                {
                    ctx.RecoveredErrors.RemoveRange(${escErrorsVar}, ctx.RecoveredErrors.Count - ${escErrorsVar});
                    return new ParseResult
                    {
                        Success = false,
                        Error = "Encountered forbidden lookahead pattern sequence",
                        NewOffset = backupOffset_${ruleId},
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
      if (rule.type === 'assert') {
        const escErrorsVar = `assertErrors_${ruleId}`;
        const isArray = Array.isArray(rule.value);

        let seqCode = "";
        let finalMatchCheck = "";
        if (isArray) {
          const patterns = rule.value as any[];
          seqCode = `bool seqMatched_${ruleId} = true;\n`;
          patterns.forEach((p, idx) => {
            const sId = nextSpecId();
            let specificDfaName: string | undefined;
            if (p instanceof RegExp) {
              specificDfaName = getOrCreateDfaMethod(p, 'Spec', ruleId);
            }
            const spec = compileSpeculativeMatch(p, ruleId, sId, childElements, specificDfaName);
            if (idx === 0) {
              seqCode += `
                {
                    ${spec.code.trim()}
                    if (${spec.matchedName})
                    {
                        currentOffset = ${spec.newOffsetName};
                    }
                    else
                    {
                        seqMatched_${ruleId} = false;
                    }
                }
              `;
            } else {
              seqCode += `
                if (seqMatched_${ruleId})
                {
                    ${spec.code.trim()}
                    if (${spec.matchedName})
                    {
                        currentOffset = ${spec.newOffsetName};
                    }
                    else
                    {
                        seqMatched_${ruleId} = false;
                    }
                }
              `;
            }
          });
          finalMatchCheck = `seqMatched_${ruleId}`;
        } else {
          const sId = nextSpecId();
          let specificDfaName: string | undefined;
          if (rule.value instanceof RegExp) {
            specificDfaName = getOrCreateDfaMethod(rule.value, 'Spec', ruleId);
          }
          const spec = compileSpeculativeMatch(rule.value, ruleId, sId, childElements, specificDfaName);
          seqCode = spec.code.trim();
          finalMatchCheck = spec.matchedName;
        }

        let triviaSkipCode = "";
        if (SyntaxElement.defaultLeadingTrivia instanceof SyntaxElement) {
          const triviaName = sanitize(SyntaxElement.defaultLeadingTrivia.name);
          childElements.add(triviaName);
          triviaSkipCode = `
                var skipRes_${ruleId} = Parse${triviaName}(text, scanOffset_${ruleId}, memo, ctx);
                if (skipRes_${ruleId}.Success)
                {
                    scanOffset_${ruleId} = skipRes_${ruleId}.NewOffset;
                }`;
        } else if (SyntaxElement.defaultLeadingTrivia instanceof RegExp) {
          const dfaName = getOrCreateDfaMethod(SyntaxElement.defaultLeadingTrivia, 'Spec', ruleId);
          triviaSkipCode = `
                if (${dfaName}(text, scanOffset_${ruleId}, out var matchedVal_${ruleId}))
                {
                    scanOffset_${ruleId} += matchedVal_${ruleId}.Length;
                }`;
        } else if (typeof SyntaxElement.defaultLeadingTrivia === 'string') {
          const escTrivia = escapeString(SyntaxElement.defaultLeadingTrivia);
          triviaSkipCode = `
                const string litTrivia_${ruleId} = "${escTrivia}";
                if (ctx.MatchLiteral(text, scanOffset_${ruleId}, litTrivia_${ruleId}, ${SyntaxElement.defaultLeadingTrivia.length}))
                {
                    scanOffset_${ruleId} += ${SyntaxElement.defaultLeadingTrivia.length};
                }`;
        }

        return `
            // Assert Lookahead Rule (id: ${ruleId})
            if (!panicked)
            {
                int ${escErrorsVar} = ctx.RecoveredErrors.Count;
                int backupOffset_${ruleId} = currentOffset;
                int scanOffset_${ruleId} = currentOffset;
                // ----- SKIP TRIVIA START -----
                ${triviaSkipCode.trim()}
                // ----- SKIP TRIVIA END -----
                currentOffset = scanOffset_${ruleId};
                ${seqCode.trim()}
                currentOffset = backupOffset_${ruleId};
                if (!${finalMatchCheck})
                {
                    ctx.RecoveredErrors.RemoveRange(${escErrorsVar}, ctx.RecoveredErrors.Count - ${escErrorsVar});
                    if (!TryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Assertion failed: expected positive lookahead pattern sequence", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                        return failRes;
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(${escErrorsVar}, ctx.RecoveredErrors.Count - ${escErrorsVar});
                }
            }`;
      }
      if (rule.type === 'separatedBy') {
        const { item, separator } = rule.value;
        const sIdItem = nextSpecId();
        const sIdSep = nextSpecId();
        const escErrorsVar = `listErrors_${ruleId}`;

        let itemDfaName: string | undefined;
        if (item instanceof RegExp) {
          itemDfaName = getOrCreateDfaMethod(item, 'Spec', ruleId);
        }
        let sepDfaName: string | undefined;
        if (separator instanceof RegExp) {
          sepDfaName = getOrCreateDfaMethod(separator, 'Spec', ruleId);
        }

        const specItem = compileSpeculativeMatch(item, ruleId, sIdItem, childElements, itemDfaName);
        const specSep = compileSpeculativeMatch(separator, ruleId, sIdSep, childElements, sepDfaName);

        return `
            // Separated By List Rule (id: ${ruleId})
            if (!panicked)
            {
                int startOffset_${ruleId} = currentOffset;
                var listResults = new List<GreenNode>();
                
                int ${escErrorsVar}_first = ctx.RecoveredErrors.Count;
                ${specItem.code.trim()}
                if (${specItem.matchedName})
                {
                    if (${specItem.parsedAstName} != null && (${specItem.parsedAstName}.Width > 0 || ${specItem.parsedAstName}.Type == NodeType.Eof))
                    {
                        listResults.Add(${specItem.parsedAstName});
                    }
                    currentOffset = ${specItem.newOffsetName};
                    ${structUpdate}

                    while (currentOffset < text.Length)
                    {
                        int beforeSepOffset = currentOffset;
                        int ${escErrorsVar}_sep = ctx.RecoveredErrors.Count;

                        ${specSep.code.trim()}
                        if (${specSep.matchedName})
                        {
                            int postSepOffset = ${specSep.newOffsetName};
                            int ${escErrorsVar}_item = ctx.RecoveredErrors.Count;

                            int orig_currentOffset = currentOffset;
                            currentOffset = postSepOffset;
                            ${specItem.code.trim()}
                            currentOffset = orig_currentOffset;

                            if (${specItem.matchedName})
                            {
                                if (${specSep.parsedAstName} != null && (${specSep.parsedAstName}.Width > 0 || ${specSep.parsedAstName}.Type == NodeType.Eof))
                                {
                                    listResults.Add(${specSep.parsedAstName});
                                }
                                if (${specItem.parsedAstName} != null && (${specItem.parsedAstName}.Width > 0 || ${specItem.parsedAstName}.Type == NodeType.Eof))
                                {
                                    listResults.Add(${specItem.parsedAstName});
                                }
                                currentOffset = ${specItem.newOffsetName};
                            }
                            else
                            {
                                ctx.RecoveredErrors.RemoveRange(${escErrorsVar}_sep, ctx.RecoveredErrors.Count - ${escErrorsVar}_sep);
                                break;
                            }
                        }
                        else
                        {
                            ctx.RecoveredErrors.RemoveRange(${escErrorsVar}_sep, ctx.RecoveredErrors.Count - ${escErrorsVar}_sep);
                            break;
                        }
                    }

                    if (listResults.Count > 0)
                    {
                        results.Add(GreenNode.Create(NodeType.ZeroOrMore, listResults, ${ruleId}, currentOffset - startOffset_${ruleId}));
                    }
                }
                else
                {
                    ctx.RecoveredErrors.RemoveRange(${escErrorsVar}_first, ctx.RecoveredErrors.Count - ${escErrorsVar}_first);
                    if (!TryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected first item in separated list", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                        return failRes;
                }
            }`;
      }
      if (rule.type === 'eof') {
        return `
            // EOF Rule (id: ${ruleId})
            if (!panicked)
            {
                int startOffset_${ruleId} = currentOffset;
                localMaxOffset = Math.Max(localMaxOffset, currentOffset + 1);
                if (currentOffset == text.Length)
                {
                    results.Add(GreenNode.Create(NodeType.Eof, null, ${ruleId}, 0));
                }
                else
                {
                    if (!TryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected EOF end of string", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                        return failRes;
                }
            }`;
      }
      if (rule.type === 'beginScope') {
        let patternCode = "";
        if (typeof rule.value === 'string') {
          const esc = escapeString(rule.value);
          patternCode = `
                const string lit = "${esc}";
                const int litLen = ${rule.value.length};
                localMaxOffset = Math.Max(localMaxOffset, currentOffset + litLen);
                if (ctx.MatchLiteral(text, currentOffset, lit, litLen))
                {
                    results.Add(GreenNode.Create(NodeType.Literal, lit, ${ruleId}, litLen));
                    currentOffset += litLen;
                    hasCommitted = true;
                    ${structUpdate}
                }
                else
                {
                    if (!TryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected scope start \\"${esc}\\\"", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                        return failRes;
                }`;
        } else if (rule.value instanceof RegExp) {
          const dfaMethodName = getOrCreateDfaMethod(rule.value, 'Rule', ruleId);
          patternCode = `
                string mval_${ruleId};
                if (${dfaMethodName}(text, currentOffset, out mval_${ruleId}))
                {
                    results.Add(GreenNode.Create(NodeType.Token, mval_${ruleId}, ${ruleId}, mval_${ruleId}.Length));
                    currentOffset += mval_${ruleId}.Length;
                    hasCommitted = true;
                    ${structUpdate}
                    localMaxOffset = Math.Max(localMaxOffset, currentOffset);
                }
                else
                {
                    if (!TryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected scope start pattern", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                        return failRes;
                }`;
        } else if (rule.value instanceof SyntaxElement) {
          const subName = sanitize(rule.value.name);
          childElements.add(subName);
          patternCode = `
                var res = Parse${subName}(text, currentOffset, memo, ctx);
                localMaxOffset = Math.Max(localMaxOffset, res.DependencyLimit);
                if (res.Success)
                {
                    if (res.Ast != null && (res.Ast.Width > 0 || res.Ast.Type == NodeType.Eof))
                    {
                        results.Add(res.Ast);
                    }
                    currentOffset = res.NewOffset;
                    hasCommitted = true;
                    ${structUpdate}
                }
                else
                {
                    if (!TryRecover(text, ${startOffsetForFailure}, ${ruleId}, res.Error ?? "Expected scope start element ${rule.value.name}", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                        return failRes;
                }`;
        }
        const myIndex = el.rules.indexOf(rule);
        const subsequentEndRules = el.rules.slice(myIndex + 1).filter(r => r.type === 'endScope');
        let pushScopeCode = "";
        if (subsequentEndRules.length > 0) {
          const nextEndRule = subsequentEndRules[0];
          if (typeof nextEndRule.value === 'string') {
            const escEnd = escapeString(nextEndRule.value);
            pushScopeCode = `
                    ctx.ActiveScopeEnds.Add("${escEnd}");`;
          } else {
            pushScopeCode = `
                    ctx.ActiveScopeEnds.Add("}");`;
          }
        }
        return `
            // BeginScope Rule (id: ${ruleId})
            if (!panicked)
            {
                int startOffset_${ruleId} = currentOffset;
                ${patternCode.trim()}
                if (!panicked)
                {
                    ${pushScopeCode.trim()}
                }
            }`;
      }
      if (rule.type === 'endScope') {
        let patternCode = "";
        if (typeof rule.value === 'string') {
          const esc = escapeString(rule.value);
          patternCode = `
                const string lit = "${esc}";
                const int litLen = ${rule.value.length};
                localMaxOffset = Math.Max(localMaxOffset, currentOffset + litLen);
                if (ctx.MatchLiteral(text, currentOffset, lit, litLen))
                {
                    results.Add(GreenNode.Create(NodeType.Literal, lit, ${ruleId}, litLen));
                    currentOffset += litLen;
                    hasCommitted = true;
                    ${structUpdate}
                }
                else
                {
                    if (!TryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected scope end \\"${esc}\\\"", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                        return failRes;
                }`;
        } else if (rule.value instanceof RegExp) {
          const dfaMethodName = getOrCreateDfaMethod(rule.value, 'Rule', ruleId);
          patternCode = `
                string mval_${ruleId};
                if (${dfaMethodName}(text, currentOffset, out mval_${ruleId}))
                {
                    results.Add(GreenNode.Create(NodeType.Token, mval_${ruleId}, ${ruleId}, mval_${ruleId}.Length));
                    currentOffset += mval_${ruleId}.Length;
                    hasCommitted = true;
                    ${structUpdate}
                    localMaxOffset = Math.Max(localMaxOffset, currentOffset);
                }
                else
                {
                    if (!TryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected scope end pattern", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                        return failRes;
                }`;
        } else if (rule.value instanceof SyntaxElement) {
          const subName = sanitize(rule.value.name);
          childElements.add(subName);
          patternCode = `
                var res = Parse${subName}(text, currentOffset, memo, ctx);
                localMaxOffset = Math.Max(localMaxOffset, res.DependencyLimit);
                if (res.Success)
                {
                    if (res.Ast != null && (res.Ast.Width > 0 || res.Ast.Type == NodeType.Eof))
                    {
                        results.Add(res.Ast);
                    }
                    currentOffset = res.NewOffset;
                    hasCommitted = true;
                    ${structUpdate}
                }
                else
                {
                    if (!TryRecover(text, ${startOffsetForFailure}, ${ruleId}, res.Error ?? "Expected scope end element ${rule.value.name}", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, ${boundariesExpr}, ctx, out var failRes))
                        return failRes;
                }`;
        }
        let popScopeCode = "";
        if (typeof rule.value === 'string') {
          const escEnd = escapeString(rule.value);
          popScopeCode = `
                int popIdx = ctx.ActiveScopeEnds.LastIndexOf("${escEnd}");
                if (popIdx != -1) ctx.ActiveScopeEnds.RemoveAt(popIdx);`;
        } else {
          popScopeCode = `
                if (ctx.ActiveScopeEnds.Count > 0) ctx.ActiveScopeEnds.RemoveAt(ctx.ActiveScopeEnds.Count - 1);`;
        }
        return `
            // EndScope Rule (id: ${ruleId})
            if (!panicked)
            {
                int startOffset_${ruleId} = currentOffset;
                ${patternCode.trim()}
                ${popScopeCode.trim()}
            }`;
      }
      return "            // Unsupported rule type";
    }).join("\n");
    const instantiator = `GreenNode.Create(NodeType.${elName}, results, ruleId, currentOffset - offset)`;
    return `        public ParseResult Parse${elName}(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            int ruleId = ${el.id};
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
  const combinedRegexes = Array.from(new Set([...regexFields, ...speculativeRegexes]));
  return `using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Linq;
using System.Runtime.CompilerServices;
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
        public int Width { get; }
        public object Value { get; }
        public GreenNodeKey(NodeType type, int width, object value)
        {
            Type = type;
            Width = width;
            Value = value;
        }
        public bool Equals(GreenNodeKey other)
        {
            if (Type != other.Type || Width != other.Width)
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
            GreenNodeKey key = new GreenNodeKey(type, width, value);
            
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
        public GreenNode ReplaceChild(GreenNode oldChild, GreenNode newChild)
        {
            if (Value is List<GreenNode> list)
            {
                var newList = new List<GreenNode>(list.Count);
                int wDiff = 0;
                bool found = false;
                foreach (var child in list)
                {
                    if (!found && child == oldChild)
                    {
                        if (newChild != null) newList.Add(newChild);
                        wDiff = (newChild?.Width ?? 0) - (oldChild?.Width ?? 0);
                        found = true;
                    }
                    else
                    {
                        newList.Add(child);
                    }
                }
                if (found)
                {
                    return GreenNode.Create(Type, newList, RuleId, Width + wDiff);
                }
            }
            return this;
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
        public static AstNode CreateTerminal(string text, NodeType type = NodeType.Token)
        {
            var green = GreenNode.Create(type, text, 0, text.Length);
            return new AstNode(green, null, 0);
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
${combinedRegexes.join("\n")}
        public ParseResult Parse(ITextDocument text, int offset, SpatialCSTIndex memo, ParserContext ctx)
        {
            return Parse${rootName}(text, offset, memo, ctx);
        }
${parserMethods}
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
                    int idx = text.IndexOf(failStartOffset, boundary, lookaheadLimit);
                    if (idx != -1)
                    {
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
                    string msg = $"Syntax Error in parser: {errorMsg} at offset {failStartOffset}. Skipped \\\"{snippet}\\\" to sync.";
                    ctx.RecoveredErrors.Add(new ParseError { Message = msg, Offset = failStartOffset });
                    var errNode = GreenNode.Create(NodeType.ErrorNode, msg, 0, bestRecoveryOffset - failStartOffset);
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
`;
}
