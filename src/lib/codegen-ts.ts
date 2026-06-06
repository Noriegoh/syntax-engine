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

/**
 * Generates an optimized, stand-alone, high-performance TypeScript parser/AST file.
 */
export function generateFullTypeScript(rootElement: SyntaxElement, scopeBuilder?: ScopeBuilder): string {
  const parserCode = generateParserAndAstTypeScriptCode(rootElement);
  const astCode = generateStronglyTypedAstTypeScriptClasses(rootElement);
  
  return `/**
 * Generated Standalone TypeScript Parser, Lexer and Strongly-Typed AST Node classes.
 * This file contains zero external dependencies and runs at maximum native speed.
 */

${parserCode}

${astCode}
`;
}

function compileSpeculativeMatchTypeScript(
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
                        const lit_${varId} = "${esc}";
                        const litLen_${varId} = ${pattern.source.length};
                        const ${mVar} = ctx.matchLiteralIgnoreCase(text, currentOffset, lit_${varId}, litLen_${varId});
                        const ${astVar} = ${mVar} ? new GreenNode(NodeType.Literal, text.substring(currentOffset, currentOffset + litLen_${varId}), ${ruleId}, litLen_${varId}) : null;
                        const ${offsetVar} = ${mVar} ? currentOffset + litLen_${varId} : currentOffset;
                        const maxDep_${varId} = ${mVar} ? currentOffset + litLen_${varId} : currentOffset + 1;
                        localMaxOffset = Math.max(localMaxOffset, maxDep_${varId});
                        const ${precVar} = 0;`;
    } else {
      const fnName = dfaMethodName || `matchDFA_Spec_${ruleId}`;
      code = `
                        const resDFA_${varId} = this.${fnName}(text, currentOffset);
                        const ${mVar} = resDFA_${varId}.success;
                        const ${astVar} = ${mVar} ? new GreenNode(NodeType.Token, resDFA_${varId}.matchedValue, ${ruleId}, resDFA_${varId}.matchedValue.length) : null;
                        const ${offsetVar} = ${mVar} ? currentOffset + resDFA_${varId}.matchedValue.length : currentOffset;
                        const maxDep_${varId} = ${mVar} ? currentOffset + resDFA_${varId}.matchedValue.length : currentOffset + 1;
                        localMaxOffset = Math.max(localMaxOffset, maxDep_${varId});
                        const ${precVar} = 0;`;
    }
  } else if (typeof pattern === 'string') {
    const esc = escapeString(pattern);
    code = `
                        const lit_${varId} = "${esc}";
                        const litLen_${varId} = ${pattern.length};
                        const ${mVar} = ctx.matchLiteral(text, currentOffset, lit_${varId}, litLen_${varId});
                        const ${astVar} = ${mVar} ? new GreenNode(NodeType.Literal, lit_${varId}, ${ruleId}, litLen_${varId}) : null;
                        const ${offsetVar} = ${mVar} ? currentOffset + litLen_${varId} : currentOffset;
                        const maxDep_${varId} = ${mVar} ? currentOffset + litLen_${varId} : currentOffset + 1;
                        localMaxOffset = Math.max(localMaxOffset, maxDep_${varId});
                        const ${precVar} = 0;`;
  } else {
    // SyntaxElement
    const cname = sanitize(pattern.name);
    childElements.add(cname);
    code = `
                        const res_${varId} = this.parse${cname}(text, currentOffset, memo, ctx);
                        const ${mVar} = res_${varId}.success;
                        const ${astVar} = ${mVar} ? res_${varId}.ast : null;
                        const ${offsetVar} = ${mVar} ? res_${varId}.newOffset : currentOffset;
                        const maxDep_${varId} = res_${varId}.dependencyLimit;
                        localMaxOffset = Math.max(localMaxOffset, maxDep_${varId});
                        const ${precVar} = ${pattern.precedence || 0};`;
  }
  return { code, matchedName: mVar, parsedAstName: astVar, newOffsetName: offsetVar, precName: precVar, maxDepName: `maxDep_${varId}` };
}

export function generateDFATypeScriptMethod(methodName: string, regex: RegExp, ruleId: number, type: 'Rule' | 'Spec'): string {
  const patternStr = regex.source;
  try {
    const { dfaStates, intervals } = compileDFA(regex);
    
    const acceptingCases: string[] = [];
    for (const dState of dfaStates) {
      if (dState.isAccepting) {
        acceptingCases.push(`                case ${dState.id}: finalMatchLength = i - offset; break;`);
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
            return `cp === ${r.start}`;
          } else {
            return `(cp >= ${r.start} && cp <= ${r.end})`;
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
          conditions.push(`                    else { state = -1; break; }`);
        }
      } else {
        conditions.push(`                    state = -1; break;`);
      }
      
      transitionCasesList.push(`            case ${dState.id}:
${conditions.join('\n')}
`);
    }
    const transitionsCases = transitionCasesList.join('\n');
    
    return `
    private ${methodName}(text: ITextDocument, offset: number): { success: boolean; matchedValue: string } {
        const textLength = text.length;
        if (offset >= textLength) return { success: false, matchedValue: "" };
        let state = 0;
        let finalMatchLength = -1;
        let i = offset;
        while (i < textLength) {
            switch (state) {
${acceptingStatesCases}
            }
            const cp = text.charCodeAt(i);
            if (isNaN(cp)) break;
            switch (state) {
${transitionsCases}
                default:
                    state = -1;
                    break;
            }
            if (state === -1) break;
            i++;
        }
        if (state !== -1) {
            switch (state) {
${acceptingStatesCases}
            }
        }
        if (finalMatchLength !== -1) {
            return { success: true, matchedValue: text.substring(offset, offset + finalMatchLength) };
        }
        return { success: false, matchedValue: "" };
    }
`;
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    const escapedPattern = patternStr.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `
    // Regular Expression Fallback
    // DFA Compilation Failed: ${errMsg.replace(/\n/g, ' ')}
    private ${methodName}(text: ITextDocument, offset: number): { success: boolean; matchedValue: string } {
        if (offset >= text.length) return { success: false, matchedValue: "" };
        const slice = text.substring(offset, text.length);
        const regex = new RegExp('^' + '${escapedPattern}', '${regex.flags}');
        const match = regex.exec(slice);
        if (match && match.index === 0) {
            return { success: true, matchedValue: match[0] };
        }
        return { success: false, matchedValue: "" };
    }
`;
  }
}

export function generateStronglyTypedAstTypeScriptClasses(rootElement: SyntaxElement): string {
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
      
      enumsCode += `export enum ${el.enumName} {\n    None = "None",\n${Array.from(enumValues).map(v => `    ${v} = "${v}"`).join(",\n")}\n}\n\n`;
    }
  }

  const nodesCode = elements.map(el => {
    const elName = el.astNodeName ? sanitize(el.astNodeName) : sanitize(el.name);
    
    let propertiesStr = "";
    
    const propertyGroups: Map<string, { type: string, isList: boolean, ruleId: number }> = new Map();
    let hasExplicitBindings = false;
    for (const rule of el.rules) {
      if (rule.label && !rule.ignored) {
        hasExplicitBindings = true;
        let tsType = "RedNode";
        let isList = false;
        
        if (rule.type === 'zeroOrMore' || rule.type === 'oneOrMore' || rule.type === 'separatedBy') {
          isList = true;
          const leafValue = rule.type === 'separatedBy' ? rule.value.item : rule.value;
          if (leafValue instanceof SyntaxElement) {
            tsType = (leafValue.astNodeName ? sanitize(leafValue.astNodeName) : sanitize(leafValue.name)) + "Node";
          } else if (Array.isArray(leafValue)) {
            const elNames = leafValue.filter(v => v instanceof SyntaxElement).map(v => (v.astNodeName ? sanitize(v.astNodeName) : sanitize(v.name)) + "Node");
            if (elNames.length > 0) {
              const uniqueNames = Array.from(new Set(elNames));
              if (uniqueNames.length === 1) {
                tsType = uniqueNames[0];
              } else {
                tsType = "RedNode";
              }
            } else {
              tsType = "RedNode";
            }
          }
        } else if (rule.type === 'element' || rule.type === 'optional' || rule.type === 'assert') {
          const leafValue = rule.value;
          if (leafValue instanceof SyntaxElement) {
            tsType = (leafValue.astNodeName ? sanitize(leafValue.astNodeName) : sanitize(leafValue.name)) + "Node";
          }
        } else if (rule.type === 'choice') {
          tsType = "RedNode";
        }
        
        propertyGroups.set(rule.label, { type: tsType, isList, ruleId: rule.id });
      }
    }
    
    if (hasExplicitBindings) {
      propertiesStr = Array.from(propertyGroups.entries()).map(([label, mapping]) => {
         const capLabel = label.charAt(0).toUpperCase() + label.slice(1);
         if (mapping.isList) {
             return `    public get ${label}(): ${mapping.type}[] {\n        return this.children.filter((c): c is ${mapping.type} => c instanceof ${mapping.type});\n    }`;
         } else {
             return `    public get ${label}(): ${mapping.type} | null {\n        return this.children.find((c): c is ${mapping.type} => c instanceof ${mapping.type}) || null;\n    }`;
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
      
      propertiesStr = Array.from(childrenNodeTypes).map(childName => {
        const typeNode = childName + "Node";
        const plural = childName.endsWith('s') ? childName + 'List' : childName + 's';
        return `    public get ${plural}(): ${typeNode}[] {\n        return this.children.filter((c): c is ${typeNode} => c instanceof ${typeNode});\n    }\n    public get ${childName}(): ${typeNode} | null {\n        return this.children.find((c): c is ${typeNode} => c instanceof ${typeNode}) || null;\n    }`;
      }).join("\n\n");
    }
    
    return `export class ${elName}Node extends RedNode {\n${propertiesStr}\n}`;
  }).join("\n\n");

  return `${enumsCode}${nodesCode}`;
}

export function generateParserAndAstTypeScriptCode(rootElement: SyntaxElement): string {
  const elements = collectElements(rootElement);
  const regexFields: string[] = [];
  const speculativeRegexes: string[] = [];
  const patternToDfaMethodName = new Map<string, string>();
  
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
  
  for (const [key, match] of patternToRuleIds.entries()) {
    const ruleIdsString = Array.from(match.ruleIds).sort((a, b) => a - b).join('_');
    const primaryType = match.types.has('Rule') ? 'Rule' : 'Spec';
    const name = `matchDFA_${primaryType}_${ruleIdsString}`;
    patternToDfaMethodName.set(key, name);
    
    const fallbackRuleId = Array.from(match.ruleIds)[0] || 0;
    const dfaMethod = generateDFATypeScriptMethod(name, match.regex, fallbackRuleId, primaryType);
    if (match.types.has('Rule')) {
      regexFields.push(dfaMethod);
    } else {
      speculativeRegexes.push(dfaMethod);
    }
  }
  
  function getOrCreateDfaMethod(p: RegExp, type: 'Rule' | 'Spec', fallbackRuleId: number): string {
    const key = `${p.source}///${p.flags}`;
    const name = patternToDfaMethodName.get(key);
    return name || `matchDFA_${type}_${fallbackRuleId}`;
  }
  
  let specIdCounter = 0;
  const nextSpecId = () => ++specIdCounter;
  
  const parserMethods = elements.map(el => {
    const elName = el.astNodeName ? sanitize(el.astNodeName) : sanitize(el.name);
    const childElements = new Set<string>();
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
      ? `[${boundaries.map(b => `"${escapeString(b)}"`).join(", ")}]`
      : "null";
      
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
      
      const structUpdate = ruleIsStructural ? `            lastStructuralResultsCount = results.length;\n            lastStructuralOffset = currentOffset;` : ``;
      const startOffsetForFailure = `startOffset_${ruleId}`;
      const isInline = rule.type === 'element' && rule.value instanceof SyntaxElement && rule.value.isHiddenElement;
      
      if (rule.type === 'literal') {
        const esc = escapeString(rule.value);
        return `
            // Literal Rule: "${esc}" (id: ${ruleId})
            if (!panicked) {
                const startOffset_${ruleId} = currentOffset;
                const lit = "${esc}";
                const litLen = ${rule.value.length};
                localMaxOffset = Math.max(localMaxOffset, currentOffset + litLen);
                if (ctx.matchLiteral(text, currentOffset, lit, litLen)) {
                    this.addNode(results, new GreenNode(NodeType.Literal, lit, ${ruleId}, litLen), ${isInline});
                    currentOffset += litLen;
                    hasCommitted = true;
                    ${structUpdate}
                } else {
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected literal \\"${esc}\\\"", localMaxOffset, results, lastStructuralResultsCount, hasCommitted, ${boundariesExpr}, ctx);
                    if (rec.recovered) {
                        currentOffset = rec.recoveredOffset;
                        panicked = true;
                    } else {
                        return rec.failResult!;
                    }
                }
            }`;
      }
      
      if (rule.type === 'caseInsensitiveLiteral') {
        const esc = escapeString(rule.value.source);
        return `
            // Case-Insensitive Literal Rule: "${esc}" (id: ${ruleId})
            if (!panicked) {
                const startOffset_${ruleId} = currentOffset;
                const lit = "${esc}";
                const litLen = ${rule.value.source.length};
                localMaxOffset = Math.max(localMaxOffset, currentOffset + litLen);
                if (ctx.matchLiteralIgnoreCase(text, currentOffset, lit, litLen)) {
                    const matchedText = text.substring(currentOffset, currentOffset + litLen);
                    this.addNode(results, new GreenNode(NodeType.Literal, matchedText, ${ruleId}, litLen), ${isInline});
                    currentOffset += litLen;
                    hasCommitted = true;
                    ${structUpdate}
                } else {
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected case-insensitive literal \\"${esc}\\\"", localMaxOffset, results, lastStructuralResultsCount, hasCommitted, ${boundariesExpr}, ctx);
                    if (rec.recovered) {
                        currentOffset = rec.recoveredOffset;
                        panicked = true;
                    } else {
                        return rec.failResult!;
                    }
                }
            }`;
      }
      
      if (rule.type === 'regex') {
        const dfaMethodName = getOrCreateDfaMethod(rule.value, 'Rule', ruleId);
        return `
            // Regex Rule: ${rule.value.source} (id: ${ruleId})
            if (!panicked) {
                const startOffset_${ruleId} = currentOffset;
                const dfaRes_${ruleId} = this.${dfaMethodName}(text, currentOffset);
                if (dfaRes_${ruleId}.success) {
                    const mval = dfaRes_${ruleId}.matchedValue;
                    this.addNode(results, new GreenNode(NodeType.Token, mval, ${ruleId}, mval.length), ${isInline});
                    currentOffset += mval.length;
                    hasCommitted = true;
                    ${structUpdate}
                    localMaxOffset = Math.max(localMaxOffset, currentOffset);
                } else {
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected match for pattern", localMaxOffset, results, lastStructuralResultsCount, hasCommitted, ${boundariesExpr}, ctx);
                    if (rec.recovered) {
                        currentOffset = rec.recoveredOffset;
                        panicked = true;
                    } else {
                        return rec.failResult!;
                    }
                }
            }`;
      }
      
      if (rule.type === 'whitespace') {
        return `
            // Whitespace Rule (id: ${ruleId})
            if (!panicked) {
                const startOffset_${ruleId} = currentOffset;
                const wsStart = currentOffset;
                while (currentOffset < text.length) {
                    const cp = text.charCodeAt(currentOffset);
                    if (cp === 32 || (cp >= 9 && cp <= 13) || cp === 160 || cp === 0xFEFF) {
                        currentOffset++;
                    } else {
                        break;
                    }
                }
                localMaxOffset = Math.max(localMaxOffset, currentOffset);
                if (currentOffset > wsStart) {
                    const len = currentOffset - wsStart;
                    const wsVal = text.substring(wsStart, currentOffset);
                    this.addNode(results, new GreenNode(NodeType.Whitespace, wsVal, ${ruleId}, len), ${isInline});
                } else {
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected whitespace", localMaxOffset, results, lastStructuralResultsCount, hasCommitted, ${boundariesExpr}, ctx);
                    if (rec.recovered) {
                        currentOffset = rec.recoveredOffset;
                        panicked = true;
                    } else {
                        return rec.failResult!;
                    }
                }
            }`;
      }
      
      if (rule.type === 'element') {
        const subName = sanitize(rule.value.name);
        childElements.add(subName);
        return `
            // Element Rule: ${rule.value.name} (id: ${ruleId})
            if (!panicked) {
                const startOffset_${ruleId} = currentOffset;
                const res = this.parse${subName}(text, currentOffset, memo, ctx);
                localMaxOffset = Math.max(localMaxOffset, res.dependencyLimit);
                if (res.success) {
                    if (res.ast !== null && (res.ast.width > 0 || res.ast.type === NodeType.Eof)) {
                        this.addNode(results, res.ast, ${isInline});
                    }
                    currentOffset = res.newOffset;
                    hasCommitted = true;
                    ${structUpdate}
                } else {
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, res.error || "Expected sub-element ${rule.value.name}", localMaxOffset, results, lastStructuralResultsCount, hasCommitted, ${boundariesExpr}, ctx);
                    if (rec.recovered) {
                        currentOffset = rec.recoveredOffset;
                        panicked = true;
                    } else {
                        return rec.failResult!;
                    }
                }
            }`;
      }
      
      if (rule.type === 'choice') {
        const patterns = rule.value as any[];
        const choiceChecks: string[] = [];
        patterns.forEach((p, idx) => {
          const sId = nextSpecId();
          let specificDfaName: string | undefined;
          if (p instanceof RegExp) {
            specificDfaName = getOrCreateDfaMethod(p, 'Spec', ruleId);
          }
          const spec = compileSpeculativeMatchTypeScript(p, ruleId, sId, childElements, specificDfaName);
          const isAltInline = p instanceof SyntaxElement && p.isHiddenElement;
          choiceChecks.push(`
                // Speculative alternative check ${sId}
                if (!choiceMatched_${ruleId}) {
                    ctx.recoveredErrors.splice(baseErrorsVarCount, ctx.recoveredErrors.length - baseErrorsVarCount);
                    ${spec.code.trim()}
                    if (${spec.matchedName}) {
                        const branchErrorsCount = ctx.recoveredErrors.length - baseErrorsVarCount;
                        if (branchErrorsCount === 0) {
                            if (${spec.parsedAstName} !== null && (${spec.parsedAstName}.width > 0 || ${spec.parsedAstName}.type === NodeType.Eof)) {
                                this.addNode(results, ${spec.parsedAstName}, ${isAltInline});
                            }
                            currentOffset = ${spec.newOffsetName};
                            hasCommitted = true;
                            choiceMatched_${ruleId} = true;
                        } else {
                            if (backupAst_${ruleId} === null) {
                                backupAst_${ruleId} = ${spec.parsedAstName};
                                backupOffset_${ruleId} = ${spec.newOffsetName};
                                backupErrors_${ruleId} = ctx.recoveredErrors.slice(baseErrorsVarCount, baseErrorsVarCount + branchErrorsCount);
                            }
                            ctx.recoveredErrors.splice(baseErrorsVarCount, branchErrorsCount);
                        }
                    }
                }`);
        });
        
        return `
            // Choice Rule (id: ${ruleId})
            if (!panicked) {
                const startOffset_${ruleId} = currentOffset;
                let choiceMatched_${ruleId} = false;
                const baseErrorsVarCount = ctx.recoveredErrors.length;
                let backupAst_${ruleId}: GreenNode | null = null;
                let backupOffset_${ruleId} = -1;
                let backupErrors_${ruleId}: ParseError[] = [];
                
                ${choiceChecks.join("\n")}
                
                if (!choiceMatched_${ruleId} && backupAst_${ruleId} !== null) {
                    if (backupAst_${ruleId}.width > 0 || backupAst_${ruleId}.type === NodeType.Eof) {
                        this.addNode(results, backupAst_${ruleId}, ${isInline});
                    }
                    currentOffset = backupOffset_${ruleId};
                    hasCommitted = true;
                    ctx.recoveredErrors.push(...backupErrors_${ruleId});
                    choiceMatched_${ruleId} = true;
                }
                if (!choiceMatched_${ruleId}) {
                    ctx.recoveredErrors.splice(baseErrorsVarCount, ctx.recoveredErrors.length - baseErrorsVarCount);
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, "None of the choices matched", localMaxOffset, results, lastStructuralResultsCount, hasCommitted, ${boundariesExpr}, ctx);
                    if (rec.recovered) {
                        currentOffset = rec.recoveredOffset;
                        panicked = true;
                    } else {
                        return rec.failResult!;
                    }
                }
            }`;
      }
      
      if (rule.type === 'optional') {
        const sId = nextSpecId();
        let specificDfaName: string | undefined;
        if (rule.value instanceof RegExp) {
          specificDfaName = getOrCreateDfaMethod(rule.value, 'Spec', ruleId);
        }
        const spec = compileSpeculativeMatchTypeScript(rule.value, ruleId, sId, childElements, specificDfaName);
        const isOptInline = rule.value instanceof SyntaxElement && rule.value.isHiddenElement;
        return `
            // Optional Rule (id: ${ruleId})
            if (!panicked) {
                const startOffset_${ruleId} = currentOffset;
                const optErrorsCount_${ruleId} = ctx.recoveredErrors.length;
                ${spec.code.trim()}
                if (${spec.matchedName}) {
                    if (${spec.parsedAstName} !== null && (${spec.parsedAstName}.width > 0 || ${spec.parsedAstName}.type === NodeType.Eof)) {
                        this.addNode(results, ${spec.parsedAstName}, ${isOptInline});
                    }
                    currentOffset = ${spec.newOffsetName};
                } else {
                    ctx.recoveredErrors.splice(optErrorsCount_${ruleId}, ctx.recoveredErrors.length - optErrorsCount_${ruleId});
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
            const specLead = compileSpeculativeMatchTypeScript(SyntaxElement.defaultLeadingTrivia, ruleId, leadId, childElements, dfaName);
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
            const specTrail = compileSpeculativeMatchTypeScript(SyntaxElement.defaultTrailingTrivia, ruleId, trailId, childElements, dfaName);
            trailCode = specTrail.code;
            trailMatchedName = specTrail.matchedName;
            trailAstName = specTrail.parsedAstName;
            trailNewOffsetName = specTrail.newOffsetName;
          }

          if (isArray) {
            const patterns = rule.value as any[];
            const escErrorsVar = `loopErrors_${ruleId}`;
            const branchChecks: string[] = [];
            
            patterns.forEach((p, idx) => {
              const sId = nextSpecId();
              let specificDfaName: string | undefined;
              if (p instanceof RegExp) {
                specificDfaName = getOrCreateDfaMethod(p, 'Spec', ruleId);
              }
              const spec = compileSpeculativeMatchTypeScript(p, ruleId, sId, childElements, specificDfaName);
              const isIterInline = p instanceof SyntaxElement && p.isHiddenElement;
              branchChecks.push(`
                      if (!matchedBranch) {
                          const beforeBranchOffset = afterLeadOffset;
                          const ${escErrorsVar}_branch = ctx.recoveredErrors.length;
                          const savedOffset = currentOffset;
                          currentOffset = afterLeadOffset;
                          ${spec.code.trim()}
                          currentOffset = savedOffset;
                          if (${spec.matchedName} && ${spec.newOffsetName} > beforeBranchOffset) {
                              matchedBranch = true;
                              matchedAst = ${spec.parsedAstName};
                              branchNewOffset = ${spec.newOffsetName};
                              isItemInline = ${isIterInline};
                          } else {
                              ctx.recoveredErrors.splice(${escErrorsVar}_branch, ctx.recoveredErrors.length - ${escErrorsVar}_branch);
                          }
                      }`);
            });

            return `
              // Zero Or More Token Rule (id: ${ruleId})
              if (!panicked) {
                  const startOffset_${ruleId} = currentOffset;
                  const startLoopOffset = currentOffset;
                  const loopResults: GreenNode[] = [];
                  while (currentOffset < text.length) {
                      const beforeLeadOffset = currentOffset;
                      const ${escErrorsVar}_lead = ctx.recoveredErrors.length;
                      
                      // Match leading trivia
                      ${leadCode}
                      const afterLeadOffset = ${leadMatchedName} ? ${leadNewOffsetName} : currentOffset;
                      
                      let matchedBranch = false;
                      let matchedAst: GreenNode | null = null;
                      let branchNewOffset = afterLeadOffset;
                      let isItemInline = false;
                      
                      ${branchChecks.join("\n").trim()}
                      
                      if (matchedBranch) {
                          // Commit leading trivia
                          if (${leadMatchedName} && ${leadNewOffsetName} > beforeLeadOffset) {
                              const isLeadInline = ${SyntaxElement.defaultLeadingTrivia instanceof SyntaxElement && SyntaxElement.defaultLeadingTrivia.isHiddenElement};
                              this.addNode(loopResults, ${leadAstName}, isLeadInline);
                          }
                          
                          this.addNode(loopResults, matchedAst, isItemInline);
                          
                          // Match trailing trivia
                          const beforeTrailOffset = branchNewOffset;
                          const savedOffsetTrail = currentOffset;
                          currentOffset = branchNewOffset;
                          ${trailCode}
                          currentOffset = savedOffsetTrail;
                          
                          if (${trailMatchedName} && ${trailNewOffsetName} > beforeTrailOffset) {
                              const isTrailInline = ${SyntaxElement.defaultTrailingTrivia instanceof SyntaxElement && SyntaxElement.defaultTrailingTrivia.isHiddenElement};
                              this.addNode(loopResults, ${trailAstName}, isTrailInline);
                              currentOffset = ${trailNewOffsetName};
                          } else {
                              currentOffset = branchNewOffset;
                          }
                      } else {
                          // Revert leading trivia errors
                          ctx.recoveredErrors.splice(${escErrorsVar}_lead, ctx.recoveredErrors.length - ${escErrorsVar}_lead);
                          break;
                      }
                  }
                  if (loopResults.length > 0) {
                      this.addNode(results, new GreenNode(NodeType.ZeroOrMore, loopResults, ${ruleId}, currentOffset - startLoopOffset), ${isInline});
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
            const spec = compileSpeculativeMatchTypeScript(rule.value, ruleId, sId, childElements, specificDfaName);
            const isIterInline = rule.value instanceof SyntaxElement && rule.value.isHiddenElement;

            return `
              // Zero Or More Token Rule (id: ${ruleId})
              if (!panicked) {
                  const startOffset_${ruleId} = currentOffset;
                  const startLoopOffset = currentOffset;
                  const loopResults: GreenNode[] = [];
                  while (currentOffset < text.length) {
                      const beforeLeadOffset = currentOffset;
                      const ${escErrorsVar}_lead = ctx.recoveredErrors.length;
                      
                      // Match leading trivia
                      ${leadCode}
                      const afterLeadOffset = ${leadMatchedName} ? ${leadNewOffsetName} : currentOffset;
                      
                      // Speculatively match pattern starting from afterLeadOffset
                      const savedOffset = currentOffset;
                      currentOffset = afterLeadOffset;
                      ${spec.code.trim()}
                      currentOffset = savedOffset;
                      
                      if (${spec.matchedName} && ${spec.newOffsetName} > afterLeadOffset) {
                          // Commit leading trivia
                          if (${leadMatchedName} && ${leadNewOffsetName} > beforeLeadOffset) {
                              const isLeadInline = ${SyntaxElement.defaultLeadingTrivia instanceof SyntaxElement && SyntaxElement.defaultLeadingTrivia.isHiddenElement};
                              this.addNode(loopResults, ${leadAstName}, isLeadInline);
                          }
                          
                          this.addNode(loopResults, ${spec.parsedAstName}, ${isIterInline});
                          
                          // Match trailing trivia
                          const beforeTrailOffset = ${spec.newOffsetName};
                          const savedOffsetTrail = currentOffset;
                          currentOffset = ${spec.newOffsetName};
                          ${trailCode}
                          currentOffset = savedOffsetTrail;
                          
                          if (${trailMatchedName} && ${trailNewOffsetName} > beforeTrailOffset) {
                              const isTrailInline = ${SyntaxElement.defaultTrailingTrivia instanceof SyntaxElement && SyntaxElement.defaultTrailingTrivia.isHiddenElement};
                              this.addNode(loopResults, ${trailAstName}, isTrailInline);
                              currentOffset = ${trailNewOffsetName};
                          } else {
                              currentOffset = ${spec.newOffsetName};
                          }
                      } else {
                          // Revert leading trivia errors
                          ctx.recoveredErrors.splice(${escErrorsVar}_lead, ctx.recoveredErrors.length - ${escErrorsVar}_lead);
                          break;
                      }
                  }
                  if (loopResults.length > 0) {
                      this.addNode(results, new GreenNode(NodeType.ZeroOrMore, loopResults, ${ruleId}, currentOffset - startLoopOffset), ${isInline});
                      ${structUpdate}
                  }
              }`;
          }
        } else {

        if (isArray) {
          const patterns = rule.value as any[];
          const escErrorsVar = `loopErrors_${ruleId}`;
          const branchChecks: string[] = [];
          patterns.forEach((p, idx) => {
            const sId = nextSpecId();
            let specificDfaName: string | undefined;
            if (p instanceof RegExp) {
              specificDfaName = getOrCreateDfaMethod(p, 'Spec', ruleId);
            }
            const spec = compileSpeculativeMatchTypeScript(p, ruleId, sId, childElements, specificDfaName);
            const isIterInline = p instanceof SyntaxElement && p.isHiddenElement;
            branchChecks.push(`
                    if (!matchedBranch) {
                        const beforeBranchOffset = currentOffset;
                        const ${escErrorsVar}_branch = ctx.recoveredErrors.length;
                        ${spec.code.trim()}
                        if (${spec.matchedName} && ${spec.newOffsetName} > beforeBranchOffset) {
                            matchedBranch = true;
                            matchedAst = ${spec.parsedAstName};
                            branchNewOffset = ${spec.newOffsetName};
                            isItemInline = ${isIterInline};
                        } else {
                            ctx.recoveredErrors.splice(${escErrorsVar}_branch, ctx.recoveredErrors.length - ${escErrorsVar}_branch);
                        }
                    }`);
          });
          
          return `
            // Zero Or More Rule (id: ${ruleId})
            if (!panicked) {
                const startOffset_${ruleId} = currentOffset;
                const startLoopOffset = currentOffset;
                const loopResults: GreenNode[] = [];
                while (currentOffset < text.length) {
                    let matchedBranch = false;
                    let matchedAst: GreenNode | null = null;
                    let branchNewOffset = currentOffset;
                    let isItemInline = false;
                    
                    ${branchChecks.join("\n").trim()}
                    
                    if (matchedBranch) {
                        this.addNode(loopResults, matchedAst, isItemInline);
                        currentOffset = branchNewOffset;
                    } else {
                        break;
                    }
                }
                if (loopResults.length > 0) {
                    this.addNode(results, new GreenNode(NodeType.ZeroOrMore, loopResults, ${ruleId}, currentOffset - startLoopOffset), ${isInline});
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
          const spec = compileSpeculativeMatchTypeScript(rule.value, ruleId, sId, childElements, specificDfaName);
          const isIterInline = rule.value instanceof SyntaxElement && rule.value.isHiddenElement;
          return `
            // Zero Or More Rule (id: ${ruleId})
            if (!panicked) {
                const startOffset_${ruleId} = currentOffset;
                const startLoopOffset = currentOffset;
                const loopResults: GreenNode[] = [];
                while (currentOffset < text.length) {
                    const beforeIterOffset = currentOffset;
                    const ${escErrorsVar} = ctx.recoveredErrors.length;
                    ${spec.code.trim()}
                    if (${spec.matchedName} && ${spec.newOffsetName} > beforeIterOffset) {
                        this.addNode(loopResults, ${spec.parsedAstName}, ${isIterInline});
                        currentOffset = ${spec.newOffsetName};
                    } else {
                        ctx.recoveredErrors.splice(${escErrorsVar}, ctx.recoveredErrors.length - ${escErrorsVar});
                        break;
                    }
                }
                if (loopResults.length > 0) {
                    this.addNode(results, new GreenNode(NodeType.ZeroOrMore, loopResults, ${ruleId}, currentOffset - startLoopOffset), ${isInline});
                    ${structUpdate}
                }
            }`;
        }
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
            const specLead = compileSpeculativeMatchTypeScript(SyntaxElement.defaultLeadingTrivia, ruleId, leadId, childElements, dfaName);
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
            const specTrail = compileSpeculativeMatchTypeScript(SyntaxElement.defaultTrailingTrivia, ruleId, trailId, childElements, dfaName);
            trailCode = specTrail.code;
            trailMatchedName = specTrail.matchedName;
            trailAstName = specTrail.parsedAstName;
            trailNewOffsetName = specTrail.newOffsetName;
          }

          if (isArray) {
            const patterns = rule.value as any[];
            const escErrorsVar = `loopErrors_${ruleId}`;
            const branchChecks: string[] = [];
            
            patterns.forEach((p, idx) => {
              const sId = nextSpecId();
              let specificDfaName: string | undefined;
              if (p instanceof RegExp) {
                specificDfaName = getOrCreateDfaMethod(p, 'Spec', ruleId);
              }
              const spec = compileSpeculativeMatchTypeScript(p, ruleId, sId, childElements, specificDfaName);
              const isIterInline = p instanceof SyntaxElement && p.isHiddenElement;
              branchChecks.push(`
                      if (!matchedBranch) {
                          const beforeBranchOffset = afterLeadOffset;
                          const ${escErrorsVar}_branch = ctx.recoveredErrors.length;
                          const savedOffset = currentOffset;
                          currentOffset = afterLeadOffset;
                          ${spec.code.trim()}
                          currentOffset = savedOffset;
                          if (${spec.matchedName} && ${spec.newOffsetName} > beforeBranchOffset) {
                              matchedBranch = true;
                              matchedAst = ${spec.parsedAstName};
                              branchNewOffset = ${spec.newOffsetName};
                              isItemInline = ${isIterInline};
                          } else {
                              ctx.recoveredErrors.splice(${escErrorsVar}_branch, ctx.recoveredErrors.length - ${escErrorsVar}_branch);
                          }
                      }`);
            });

            return `
              // One Or More Token Rule (id: ${ruleId})
              if (!panicked) {
                  const startOffset_${ruleId} = currentOffset;
                  const startLoopOffset = currentOffset;
                  const loopResults: GreenNode[] = [];
                  while (currentOffset < text.length) {
                      const beforeLeadOffset = currentOffset;
                      const ${escErrorsVar}_lead = ctx.recoveredErrors.length;
                      
                      // Match leading trivia
                      ${leadCode}
                      const afterLeadOffset = ${leadMatchedName} ? ${leadNewOffsetName} : currentOffset;
                      
                      let matchedBranch = false;
                      let matchedAst: GreenNode | null = null;
                      let branchNewOffset = afterLeadOffset;
                      let isItemInline = false;
                      
                      ${branchChecks.join("\n").trim()}
                      
                      if (matchedBranch) {
                          // Commit leading trivia
                          if (${leadMatchedName} && ${leadNewOffsetName} > beforeLeadOffset) {
                              const isLeadInline = ${SyntaxElement.defaultLeadingTrivia instanceof SyntaxElement && SyntaxElement.defaultLeadingTrivia.isHiddenElement};
                              this.addNode(loopResults, ${leadAstName}, isLeadInline);
                          }
                          
                          this.addNode(loopResults, matchedAst, isItemInline);
                          
                          // Match trailing trivia
                          const beforeTrailOffset = branchNewOffset;
                          const savedOffsetTrail = currentOffset;
                          currentOffset = branchNewOffset;
                          ${trailCode}
                          currentOffset = savedOffsetTrail;
                          
                          if (${trailMatchedName} && ${trailNewOffsetName} > beforeTrailOffset) {
                              const isTrailInline = ${SyntaxElement.defaultTrailingTrivia instanceof SyntaxElement && SyntaxElement.defaultTrailingTrivia.isHiddenElement};
                              this.addNode(loopResults, ${trailAstName}, isTrailInline);
                              currentOffset = ${trailNewOffsetName};
                          } else {
                              currentOffset = branchNewOffset;
                          }
                      } else {
                          // Revert leading trivia errors
                          ctx.recoveredErrors.splice(${escErrorsVar}_lead, ctx.recoveredErrors.length - ${escErrorsVar}_lead);
                          break;
                      }
                  }
                  if (loopResults.length > 0) {
                      this.addNode(results, new GreenNode(NodeType.OneOrMore, loopResults, ${ruleId}, currentOffset - startLoopOffset), ${isInline});
                      hasCommitted = true;
                      ${structUpdate}
                  } else {
                      const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected at least one occurrence in loop", localMaxOffset, results, lastStructuralResultsCount, hasCommitted, ${boundariesExpr}, ctx);
                      if (rec.recovered) {
                          currentOffset = rec.recoveredOffset;
                          panicked = true;
                      } else {
                          return rec.failResult!;
                      }
                  }
              }`;
          } else {
            const sId = nextSpecId();
            const escErrorsVar = `loopErrors_${ruleId}`;
            let specificDfaName: string | undefined;
            if (rule.value instanceof RegExp) {
              specificDfaName = getOrCreateDfaMethod(rule.value, 'Spec', ruleId);
            }
            const spec = compileSpeculativeMatchTypeScript(rule.value, ruleId, sId, childElements, specificDfaName);
            const isIterInline = rule.value instanceof SyntaxElement && rule.value.isHiddenElement;

            return `
              // One Or More Token Rule (id: ${ruleId})
              if (!panicked) {
                  const startOffset_${ruleId} = currentOffset;
                  const startLoopOffset = currentOffset;
                  const loopResults: GreenNode[] = [];
                  while (currentOffset < text.length) {
                      const beforeLeadOffset = currentOffset;
                      const ${escErrorsVar}_lead = ctx.recoveredErrors.length;
                      
                      // Match leading trivia
                      ${leadCode}
                      const afterLeadOffset = ${leadMatchedName} ? ${leadNewOffsetName} : currentOffset;
                      
                      // Speculatively match pattern starting from afterLeadOffset
                      const savedOffset = currentOffset;
                      currentOffset = afterLeadOffset;
                      ${spec.code.trim()}
                      currentOffset = savedOffset;
                      
                      if (${spec.matchedName} && ${spec.newOffsetName} > afterLeadOffset) {
                          // Commit leading trivia
                          if (${leadMatchedName} && ${leadNewOffsetName} > beforeLeadOffset) {
                              const isLeadInline = ${SyntaxElement.defaultLeadingTrivia instanceof SyntaxElement && SyntaxElement.defaultLeadingTrivia.isHiddenElement};
                              this.addNode(loopResults, ${leadAstName}, isLeadInline);
                          }
                          
                          this.addNode(loopResults, ${spec.parsedAstName}, ${isIterInline});
                          
                          // Match trailing trivia
                          const beforeTrailOffset = ${spec.newOffsetName};
                          const savedOffsetTrail = currentOffset;
                          currentOffset = ${spec.newOffsetName};
                          ${trailCode}
                          currentOffset = savedOffsetTrail;
                          
                          if (${trailMatchedName} && ${trailNewOffsetName} > beforeTrailOffset) {
                              const isTrailInline = ${SyntaxElement.defaultTrailingTrivia instanceof SyntaxElement && SyntaxElement.defaultTrailingTrivia.isHiddenElement};
                              this.addNode(loopResults, ${trailAstName}, isTrailInline);
                              currentOffset = ${trailNewOffsetName};
                          } else {
                              currentOffset = ${spec.newOffsetName};
                          }
                      } else {
                          // Revert leading trivia errors
                          ctx.recoveredErrors.splice(${escErrorsVar}_lead, ctx.recoveredErrors.length - ${escErrorsVar}_lead);
                          break;
                      }
                  }
                  if (loopResults.length > 0) {
                      this.addNode(results, new GreenNode(NodeType.OneOrMore, loopResults, ${ruleId}, currentOffset - startLoopOffset), ${isInline});
                      hasCommitted = true;
                      ${structUpdate}
                  } else {
                      const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected at least one occurrence in loop", localMaxOffset, results, lastStructuralResultsCount, hasCommitted, ${boundariesExpr}, ctx);
                      if (rec.recovered) {
                          currentOffset = rec.recoveredOffset;
                          panicked = true;
                      } else {
                          return rec.failResult!;
                      }
                  }
              }`;
          }
        } else {

        if (isArray) {
          const patterns = rule.value as any[];
          const escErrorsVar = `loopErrors_${ruleId}`;
          const branchChecks: string[] = [];
          patterns.forEach((p, idx) => {
            const sId = nextSpecId();
            let specificDfaName: string | undefined;
            if (p instanceof RegExp) {
              specificDfaName = getOrCreateDfaMethod(p, 'Spec', ruleId);
            }
            const spec = compileSpeculativeMatchTypeScript(p, ruleId, sId, childElements, specificDfaName);
            const isIterInline = p instanceof SyntaxElement && p.isHiddenElement;
            branchChecks.push(`
                    if (!matchedBranch) {
                        const beforeBranchOffset = currentOffset;
                        const ${escErrorsVar}_branch = ctx.recoveredErrors.length;
                        ${spec.code.trim()}
                        if (${spec.matchedName} && ${spec.newOffsetName} > beforeBranchOffset) {
                            matchedBranch = true;
                            matchedAst = ${spec.parsedAstName};
                            branchNewOffset = ${spec.newOffsetName};
                            isItemInline = ${isIterInline};
                        } else {
                            ctx.recoveredErrors.splice(${escErrorsVar}_branch, ctx.recoveredErrors.length - ${escErrorsVar}_branch);
                        }
                    }`);
          });
          
          return `
            // Zero Or More Rule (id: ${ruleId})
            if (!panicked) {
                const startOffset_${ruleId} = currentOffset;
                const startLoopOffset = currentOffset;
                const loopResults: GreenNode[] = [];
                while (currentOffset < text.length) {
                    let matchedBranch = false;
                    let matchedAst: GreenNode | null = null;
                    let branchNewOffset = currentOffset;
                    let isItemInline = false;
                    
                    ${branchChecks.join("\n").trim()}
                    
                    if (matchedBranch) {
                        this.addNode(loopResults, matchedAst, isItemInline);
                        currentOffset = branchNewOffset;
                    } else {
                        break;
                    }
                }
                if (loopResults.length > 0) {
                    this.addNode(results, new GreenNode(NodeType.ZeroOrMore, loopResults, ${ruleId}, currentOffset - startLoopOffset), ${isInline});
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
          const spec = compileSpeculativeMatchTypeScript(rule.value, ruleId, sId, childElements, specificDfaName);
          const isIterInline = rule.value instanceof SyntaxElement && rule.value.isHiddenElement;
          return `
            // Zero Or More Rule (id: ${ruleId})
            if (!panicked) {
                const startOffset_${ruleId} = currentOffset;
                const startLoopOffset = currentOffset;
                const loopResults: GreenNode[] = [];
                while (currentOffset < text.length) {
                    const beforeIterOffset = currentOffset;
                    const ${escErrorsVar} = ctx.recoveredErrors.length;
                    ${spec.code.trim()}
                    if (${spec.matchedName} && ${spec.newOffsetName} > beforeIterOffset) {
                        this.addNode(loopResults, ${spec.parsedAstName}, ${isIterInline});
                        currentOffset = ${spec.newOffsetName};
                    } else {
                        ctx.recoveredErrors.splice(${escErrorsVar}, ctx.recoveredErrors.length - ${escErrorsVar});
                        break;
                    }
                }
                if (loopResults.length > 0) {
                    this.addNode(results, new GreenNode(NodeType.ZeroOrMore, loopResults, ${ruleId}, currentOffset - startLoopOffset), ${isInline});
                    ${structUpdate}
                }
            }`;
        }
      }
      
      if (rule.type === 'oneOrMore') {
        const isArray = Array.isArray(rule.value);
        if (isArray) {
          const patterns = rule.value as any[];
          const escErrorsVar = `loopErrors_${ruleId}`;
          const branchChecks: string[] = [];
          patterns.forEach((p, idx) => {
            const sId = nextSpecId();
            let specificDfaName: string | undefined;
            if (p instanceof RegExp) {
              specificDfaName = getOrCreateDfaMethod(p, 'Spec', ruleId);
            }
            const spec = compileSpeculativeMatchTypeScript(p, ruleId, sId, childElements, specificDfaName);
            const isIterInline = p instanceof SyntaxElement && p.isHiddenElement;
            branchChecks.push(`
                    if (!matchedBranch) {
                        const beforeBranchOffset = currentOffset;
                        const ${escErrorsVar}_branch = ctx.recoveredErrors.length;
                        ${spec.code.trim()}
                        if (${spec.matchedName} && ${spec.newOffsetName} > beforeBranchOffset) {
                            matchedBranch = true;
                            matchedAst = ${spec.parsedAstName};
                            branchNewOffset = ${spec.newOffsetName};
                            isItemInline = ${isIterInline};
                        } else {
                            ctx.recoveredErrors.splice(${escErrorsVar}_branch, ctx.recoveredErrors.length - ${escErrorsVar}_branch);
                        }
                    }`);
          });
          
          return `
            // One Or More Rule (id: ${ruleId})
            if (!panicked) {
                const startOffset_${ruleId} = currentOffset;
                const startLoopOffset = currentOffset;
                const loopResults: GreenNode[] = [];
                while (currentOffset < text.length) {
                    let matchedBranch = false;
                    let matchedAst: GreenNode | null = null;
                    let branchNewOffset = currentOffset;
                    let isItemInline = false;
                    
                    ${branchChecks.join("\n").trim()}
                    
                    if (matchedBranch) {
                        this.addNode(loopResults, matchedAst, isItemInline);
                        currentOffset = branchNewOffset;
                    } else {
                        break;
                    }
                }
                if (loopResults.length > 0) {
                    this.addNode(results, new GreenNode(NodeType.OneOrMore, loopResults, ${ruleId}, currentOffset - startLoopOffset), ${isInline});
                    hasCommitted = true;
                    ${structUpdate}
                } else {
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected at least one occurrence in loop", localMaxOffset, results, lastStructuralResultsCount, hasCommitted, ${boundariesExpr}, ctx);
                    if (rec.recovered) {
                        currentOffset = rec.recoveredOffset;
                        panicked = true;
                    } else {
                        return rec.failResult!;
                    }
                }
            }`;
        } else {
          const sId = nextSpecId();
          const escErrorsVar = `loopErrors_${ruleId}`;
          let specificDfaName: string | undefined;
          if (rule.value instanceof RegExp) {
            specificDfaName = getOrCreateDfaMethod(rule.value, 'Spec', ruleId);
          }
          const spec = compileSpeculativeMatchTypeScript(rule.value, ruleId, sId, childElements, specificDfaName);
          const isIterInline = rule.value instanceof SyntaxElement && rule.value.isHiddenElement;
          return `
            // One Or More Rule (id: ${ruleId})
            if (!panicked) {
                const startOffset_${ruleId} = currentOffset;
                const startLoopOffset = currentOffset;
                const loopResults: GreenNode[] = [];
                while (currentOffset < text.length) {
                    const beforeIterOffset = currentOffset;
                    const ${escErrorsVar} = ctx.recoveredErrors.length;
                    ${spec.code.trim()}
                    if (${spec.matchedName} && ${spec.newOffsetName} > beforeIterOffset) {
                        this.addNode(loopResults, ${spec.parsedAstName}, ${isIterInline});
                        currentOffset = ${spec.newOffsetName};
                    } else {
                        ctx.recoveredErrors.splice(${escErrorsVar}, ctx.recoveredErrors.length - ${escErrorsVar});
                        break;
                    }
                }
                if (loopResults.length > 0) {
                    this.addNode(results, new GreenNode(NodeType.OneOrMore, loopResults, ${ruleId}, currentOffset - startLoopOffset), ${isInline});
                    hasCommitted = true;
                    ${structUpdate}
                } else {
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected at least one occurrence in loop", localMaxOffset, results, lastStructuralResultsCount, hasCommitted, ${boundariesExpr}, ctx);
                    if (rec.recovered) {
                        currentOffset = rec.recoveredOffset;
                        panicked = true;
                    } else {
                        return rec.failResult!;
                    }
                }
            }`;
        }
      }
      }
      
      if (rule.type === 'not') {
        const sId = nextSpecId();
        let specificDfaName: string | undefined;
        if (rule.value instanceof RegExp) {
          specificDfaName = getOrCreateDfaMethod(rule.value, 'Spec', ruleId);
        }
        const spec = compileSpeculativeMatchTypeScript(rule.value, ruleId, sId, childElements, specificDfaName);

        let triviaSkipCode = "";
        if (SyntaxElement.defaultLeadingTrivia instanceof SyntaxElement) {
          const triviaName = sanitize(SyntaxElement.defaultLeadingTrivia.name);
          childElements.add(triviaName);
          triviaSkipCode = `
                const skipRes_${ruleId} = this.parse${triviaName}(text, scanOffset_${ruleId}, memo, ctx);
                if (skipRes_${ruleId}.success) {
                    scanOffset_${ruleId} = skipRes_${ruleId}.newOffset;
                }`;
        } else if (SyntaxElement.defaultLeadingTrivia instanceof RegExp) {
          const dfaName = getOrCreateDfaMethod(SyntaxElement.defaultLeadingTrivia, 'Spec', ruleId);
          triviaSkipCode = `
                const resDFA_${ruleId} = this.${dfaName}(text, scanOffset_${ruleId});
                if (resDFA_${ruleId}.success) {
                    scanOffset_${ruleId} += resDFA_${ruleId}.matchedValue.length;
                }`;
        } else if (typeof SyntaxElement.defaultLeadingTrivia === 'string') {
          const escTrivia = escapeString(SyntaxElement.defaultLeadingTrivia);
          triviaSkipCode = `
                const litTrivia_${ruleId} = "${escTrivia}";
                if (ctx.matchLiteral(text, scanOffset_${ruleId}, litTrivia_${ruleId}, ${SyntaxElement.defaultLeadingTrivia.length})) {
                    scanOffset_${ruleId} += ${SyntaxElement.defaultLeadingTrivia.length};
                }`;
        }

        return `
            // Not Rule (id: ${ruleId})
            if (!panicked) {
                const optErrorsCount_${ruleId} = ctx.recoveredErrors.length;
                let scanOffset_${ruleId} = currentOffset;
                // ----- SKIP TRIVIA START -----
                ${triviaSkipCode.trim()}
                // ----- SKIP TRIVIA END -----
                const savedOffset_${ruleId} = currentOffset;
                currentOffset = scanOffset_${ruleId};
                ${spec.code.trim()}
                currentOffset = savedOffset_${ruleId};
                ctx.recoveredErrors.splice(optErrorsCount_${ruleId}, ctx.recoveredErrors.length - optErrorsCount_${ruleId});
                if (${spec.matchedName}) {
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Rule negative constraint matched", localMaxOffset, results, lastStructuralResultsCount, hasCommitted, ${boundariesExpr}, ctx);
                    if (rec.recovered) {
                        currentOffset = rec.recoveredOffset;
                        panicked = true;
                    } else {
                        return rec.failResult!;
                    }
                }
            }`;
      }
      
      if (rule.type === 'assert') {
        const sId = nextSpecId();
        let specificDfaName: string | undefined;
        if (rule.value instanceof RegExp) {
          specificDfaName = getOrCreateDfaMethod(rule.value, 'Spec', ruleId);
        }
        const spec = compileSpeculativeMatchTypeScript(rule.value, ruleId, sId, childElements, specificDfaName);

        let triviaSkipCode = "";
        if (SyntaxElement.defaultLeadingTrivia instanceof SyntaxElement) {
          const triviaName = sanitize(SyntaxElement.defaultLeadingTrivia.name);
          childElements.add(triviaName);
          triviaSkipCode = `
                const skipRes_${ruleId} = this.parse${triviaName}(text, scanOffset_${ruleId}, memo, ctx);
                if (skipRes_${ruleId}.success) {
                    scanOffset_${ruleId} = skipRes_${ruleId}.newOffset;
                }`;
        } else if (SyntaxElement.defaultLeadingTrivia instanceof RegExp) {
          const dfaName = getOrCreateDfaMethod(SyntaxElement.defaultLeadingTrivia, 'Spec', ruleId);
          triviaSkipCode = `
                const resDFA_${ruleId} = this.${dfaName}(text, scanOffset_${ruleId});
                if (resDFA_${ruleId}.success) {
                    scanOffset_${ruleId} += resDFA_${ruleId}.matchedValue.length;
                }`;
        } else if (typeof SyntaxElement.defaultLeadingTrivia === 'string') {
          const escTrivia = escapeString(SyntaxElement.defaultLeadingTrivia);
          triviaSkipCode = `
                const litTrivia_${ruleId} = "${escTrivia}";
                if (ctx.matchLiteral(text, scanOffset_${ruleId}, litTrivia_${ruleId}, ${SyntaxElement.defaultLeadingTrivia.length})) {
                    scanOffset_${ruleId} += ${SyntaxElement.defaultLeadingTrivia.length};
                }`;
        }

        return `
            // Assert Rule (id: ${ruleId})
            if (!panicked) {
                const optErrorsCount_${ruleId} = ctx.recoveredErrors.length;
                let scanOffset_${ruleId} = currentOffset;
                // ----- SKIP TRIVIA START -----
                ${triviaSkipCode.trim()}
                // ----- SKIP TRIVIA END -----
                const savedOffset_${ruleId} = currentOffset;
                currentOffset = scanOffset_${ruleId};
                ${spec.code.trim()}
                currentOffset = savedOffset_${ruleId};
                ctx.recoveredErrors.splice(optErrorsCount_${ruleId}, ctx.recoveredErrors.length - optErrorsCount_${ruleId});
                if (!${spec.matchedName}) {
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Assertion check failed", localMaxOffset, results, lastStructuralResultsCount, hasCommitted, ${boundariesExpr}, ctx);
                    if (rec.recovered) {
                        currentOffset = rec.recoveredOffset;
                        panicked = true;
                    } else {
                        return rec.failResult!;
                    }
                }
            }`;
      }
      
      if (rule.type === 'separatedBy' && rule.value) {
        const sIdItem = nextSpecId();
        const sIdSep = nextSpecId();
        let specificDfaNameItem: string | undefined;
        if (rule.value.item instanceof RegExp) {
          specificDfaNameItem = getOrCreateDfaMethod(rule.value.item, 'Spec', ruleId);
        }
        const specItem = compileSpeculativeMatchTypeScript(rule.value.item, ruleId, sIdItem, childElements, specificDfaNameItem);
        let specificDfaNameSep: string | undefined;
        if (rule.value.separator instanceof RegExp) {
          specificDfaNameSep = getOrCreateDfaMethod(rule.value.separator, 'Spec', ruleId);
        }
        const specSep = compileSpeculativeMatchTypeScript(rule.value.separator, ruleId, sIdSep, childElements, specificDfaNameSep);
        const isItemInline = rule.value.item instanceof SyntaxElement && rule.value.item.isHiddenElement;
        const isSepInline = rule.value.separator instanceof SyntaxElement && rule.value.separator.isHiddenElement;
        
        return `
            // Separated By Rule (id: ${ruleId})
            if (!panicked) {
                const startOffset_${ruleId} = currentOffset;
                const startLoopOffset = currentOffset;
                const loopResults: GreenNode[] = [];
                let isFirst = true;
                while (currentOffset < text.length) {
                    if (!isFirst) {
                        const beforeSepOffset = currentOffset;
                        const sepErrorsCount = ctx.recoveredErrors.length;
                        ${specSep.code.trim()}
                        if (${specSep.matchedName} && ${specSep.newOffsetName} > beforeSepOffset) {
                            this.addNode(loopResults, ${specSep.parsedAstName}, ${isSepInline});
                            currentOffset = ${specSep.newOffsetName};
                        } else {
                            ctx.recoveredErrors.splice(sepErrorsCount, ctx.recoveredErrors.length - sepErrorsCount);
                            break;
                        }
                    }
                    const beforeItemOffset = currentOffset;
                    const itemErrorsCount = ctx.recoveredErrors.length;
                    ${specItem.code.trim()}
                    if (${specItem.matchedName} && ${specItem.newOffsetName} > beforeItemOffset) {
                        this.addNode(loopResults, ${specItem.parsedAstName}, ${isItemInline});
                        currentOffset = ${specItem.newOffsetName};
                        isFirst = false;
                    } else {
                        ctx.recoveredErrors.splice(itemErrorsCount, ctx.recoveredErrors.length - itemErrorsCount);
                        // If we parsed separator but failed item, that's error!
                        if (!isFirst) {
                            const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected trailing item in separator list", localMaxOffset, results, lastStructuralResultsCount, hasCommitted, ${boundariesExpr}, ctx);
                            if (rec.recovered) {
                                currentOffset = rec.recoveredOffset;
                                panicked = true;
                            } else {
                                return rec.failResult!;
                            }
                        }
                        break;
                    }
                }
                if (loopResults.length > 0) {
                    this.addNode(results, new GreenNode(NodeType.ZeroOrMore, loopResults, ${ruleId}, currentOffset - startLoopOffset), ${isInline});
                    hasCommitted = true;
                    ${structUpdate}
                }
            }`;
      }
      
      if (rule.type === 'leadingTrivia' || rule.type === 'trailingTrivia') {
        const sId = nextSpecId();
        let dfaName: string | undefined;
        if (rule.value instanceof RegExp) {
          dfaName = getOrCreateDfaMethod(rule.value, 'Spec', ruleId);
        }
        const spec = compileSpeculativeMatchTypeScript(rule.value, ruleId, sId, childElements, dfaName);
        const isTriviaInline = rule.value instanceof SyntaxElement && rule.value.isHiddenElement;
        return `
            // Trivia Rule (id: ${ruleId})
            if (!panicked) {
                const triviaErrorsCount = ctx.recoveredErrors.length;
                ${spec.code.trim()}
                if (${spec.matchedName}) {
                    this.addNode(results, ${spec.parsedAstName}, ${isTriviaInline});
                    currentOffset = ${spec.newOffsetName};
                    localMaxOffset = Math.max(localMaxOffset, currentOffset);
                } else {
                    ctx.recoveredErrors.splice(triviaErrorsCount, ctx.recoveredErrors.length - triviaErrorsCount);
                }
            }`;
      }
      
      if (rule.type === 'beginScope') {
        let patternCode = "";
        if (typeof rule.value === 'string') {
          const esc = escapeString(rule.value);
          patternCode = `
                const lit = "${esc}";
                const litLen = ${rule.value.length};
                localMaxOffset = Math.max(localMaxOffset, currentOffset + litLen);
                if (ctx.matchLiteral(text, currentOffset, lit, litLen)) {
                    this.addNode(results, new GreenNode(NodeType.Literal, lit, ${ruleId}, litLen), false);
                    currentOffset += litLen;
                    hasCommitted = true;
                    ${structUpdate}
                } else {
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected scope start literal", localMaxOffset, results, lastStructuralResultsCount, hasCommitted, ${boundariesExpr}, ctx);
                    if (rec.recovered) {
                        currentOffset = rec.recoveredOffset;
                        panicked = true;
                    } else {
                        return rec.failResult!;
                    }
                }`;
        } else if (rule.value instanceof SyntaxElement) {
          const subName = sanitize(rule.value.name);
          childElements.add(subName);
          patternCode = `
                const res = this.parse${subName}(text, currentOffset, memo, ctx);
                localMaxOffset = Math.max(localMaxOffset, res.dependencyLimit);
                if (res.success) {
                    if (res.ast !== null && (res.ast.width > 0 || res.ast.type === NodeType.Eof)) {
                        this.addNode(results, res.ast, ${isInline});
                    }
                    currentOffset = res.newOffset;
                    hasCommitted = true;
                    ${structUpdate}
                } else {
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, res.error || "Expected scope start element", localMaxOffset, results, lastStructuralResultsCount, hasCommitted, ${boundariesExpr}, ctx);
                    if (rec.recovered) {
                        currentOffset = rec.recoveredOffset;
                        panicked = true;
                    } else {
                        return rec.failResult!;
                    }
                }`;
        }
        
        const subsequentEndRules = el.rules.slice(el.rules.indexOf(rule) + 1).filter(r => r.type === 'endScope');
        let pushScopeCode = "";
        if (subsequentEndRules.length > 0) {
          const nextEndRule = subsequentEndRules[0];
          const escEnd = typeof nextEndRule.value === 'string' ? escapeString(nextEndRule.value) : "}";
          pushScopeCode = `
                    ctx.activeScopeEnds.push("${escEnd}");`;
        }
        
        return `
            // BeginScope Rule (id: ${ruleId})
            if (!panicked) {
                const startOffset_${ruleId} = currentOffset;
                ${patternCode.trim()}
                if (!panicked) {
                    ${pushScopeCode.trim()}
                }
            }`;
      }
      
      if (rule.type === 'endScope') {
        let patternCode = "";
        if (typeof rule.value === 'string') {
          const esc = escapeString(rule.value);
          patternCode = `
                const lit = "${esc}";
                const litLen = ${rule.value.length};
                localMaxOffset = Math.max(localMaxOffset, currentOffset + litLen);
                if (ctx.matchLiteral(text, currentOffset, lit, litLen)) {
                    this.addNode(results, new GreenNode(NodeType.Literal, lit, ${ruleId}, litLen), false);
                    currentOffset += litLen;
                    hasCommitted = true;
                    ${structUpdate}
                } else {
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, "Expected scope end literal \\"${esc}\\\"", localMaxOffset, results, lastStructuralResultsCount, hasCommitted, ${boundariesExpr}, ctx);
                    if (rec.recovered) {
                        currentOffset = rec.recoveredOffset;
                        panicked = true;
                    } else {
                        return rec.failResult!;
                    }
                }`;
        } else if (rule.value instanceof SyntaxElement) {
          const subName = sanitize(rule.value.name);
          childElements.add(subName);
          patternCode = `
                const res = this.parse${subName}(text, currentOffset, memo, ctx);
                localMaxOffset = Math.max(localMaxOffset, res.dependencyLimit);
                if (res.success) {
                    if (res.ast !== null && (res.ast.width > 0 || res.ast.type === NodeType.Eof)) {
                        this.addNode(results, res.ast, ${isInline});
                    }
                    currentOffset = res.newOffset;
                    hasCommitted = true;
                    ${structUpdate}
                } else {
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, res.error || "Expected scope end element", localMaxOffset, results, lastStructuralResultsCount, hasCommitted, ${boundariesExpr}, ctx);
                    if (rec.recovered) {
                        currentOffset = rec.recoveredOffset;
                        panicked = true;
                    } else {
                        return rec.failResult!;
                    }
                }`;
        }
        
        const popScopeCode = `ctx.activeScopeEnds.pop();`;
        return `
            // EndScope Rule (id: ${ruleId})
            if (!panicked) {
                const startOffset_${ruleId} = currentOffset;
                ${patternCode.trim()}
                if (!panicked) {
                    ${popScopeCode}
                }
            }`;
      }
      
      return "            // Unsupported rule type";
    }).join("\n");
    
    const instantiator = `new GreenNode(NodeType.${elName}, results, ruleId, currentOffset - offset)`;
    return `
    public parse${elName}(text: ITextDocument, offset: number, memo: MemoizationTable, ctx: ParserContext): ParseResult {
        const ruleId = ${el.id};
        const cached = memo.get(ruleId, offset);
        if (cached !== undefined && cached !== null) {
            if (cached.recoveredErrors) {
                ctx.recoveredErrors.push(...cached.recoveredErrors);
            }
            return cached;
        }
        
        let currentOffset = offset;
        let localMaxOffset = offset;
        let panicked = false;
        let hasCommitted = false;
        const initialErrorsLength = ctx.recoveredErrors.length;
        
        let lastStructuralOffset = offset;
        let lastStructuralResultsCount = 0;
        const results: GreenNode[] = [];
        
${ruleBlocks}
        
        if (panicked) {
            ctx.recoveredErrors.splice(initialErrorsLength, ctx.recoveredErrors.length - initialErrorsLength);
        }
        
        const nextRes: ParseResult = {
            success: true,
            ast: ${instantiator},
            newOffset: currentOffset,
            dependencyLimit: localMaxOffset,
            ruleId: ruleId,
            recoveredErrors: ctx.recoveredErrors.slice(initialErrorsLength)
        };
        memo.set(ruleId, offset, nextRes);
        return nextRes;
    }`;
  }).join("\n\n");
  
  const combinedRegexes = Array.from(new Set([...regexFields, ...speculativeRegexes]));
  const customNodeTypes = Array.from(new Set(elements.map(el => el.astNodeName ? sanitize(el.astNodeName) : sanitize(el.name))));
  
  // Factory cases map NodeType to concrete subclass node
  const factoryCases = elements.map(el => {
    const elName = el.astNodeName ? sanitize(el.astNodeName) : sanitize(el.name);
    return `            case NodeType.${elName}: return new ${elName}Node(green, parent, offset);`;
  }).join("\n");
  
  return `
export enum NodeType {
    Literal = "Literal",
    Token = "Token",
    Whitespace = "Whitespace",
    Eof = "Eof",
    ErrorNode = "ErrorNode",
    ZeroOrMore = "ZeroOrMore",
    OneOrMore = "OneOrMore",
    ${customNodeTypes.map(name => `${name} = "${name}"`).join(",\n    ")}
}

export interface ParseError {
    message: string;
    offset: number;
}

export interface ITextDocument {
    readonly length: number;
    charCodeAt(index: number): number;
    substring(start: number, end: number): string;
}

export class StringTextDocument implements ITextDocument {
    constructor(private readonly text: string) {}
    public get length(): number { return this.text.length; }
    public charCodeAt(index: number): number { return this.text.charCodeAt(index); }
    public substring(start: number, end: number): string { return this.text.substring(start, end); }
}

export class GreenNode {
    constructor(
        public readonly type: NodeType | string,
        public readonly value: string | GreenNode[] | null,
        public readonly ruleId: number,
        public readonly width: number,
        public readonly id: number = ++GreenNode.nextNodeId
    ) {}
    private static nextNodeId = 0;
}

export interface ParseResult {
    success: boolean;
    ast: GreenNode | null;
    newOffset: number;
    dependencyLimit: number;
    ruleId?: number;
    error?: string;
    recoveredErrors?: ParseError[];
}

export class ParserContext {
    public recoveredErrors: ParseError[] = [];
    public activeScopeEnds: string[] = [];
    public matchLiteral(text: ITextDocument, offset: number, literal: string, length: number): boolean {
        if (offset + length > text.length) return false;
        return text.substring(offset, offset + length) === literal;
    }
    public matchLiteralIgnoreCase(text: ITextDocument, offset: number, literal: string, length: number): boolean {
        if (offset + length > text.length) return false;
        return text.substring(offset, offset + length).toLowerCase() === literal.toLowerCase();
    }
}

export class MemoizationTable {
    private table = new Map<string, ParseResult>();
    public get(ruleId: number, offset: number): ParseResult | undefined {
        return this.table.get(\`\${ruleId}_\${offset}\`);
    }
    public set(ruleId: number, offset: number, result: ParseResult): void {
        this.table.set(\`\${ruleId}_\${offset}\`, result);
    }
    public clear(): void {
        this.table.clear();
    }
}

export class RedNode {
    private _children: RedNode[] | null = null;
    constructor(
        public readonly green: GreenNode,
        public readonly parent: RedNode | null,
        public readonly offset: number
    ) {}
    public get type(): NodeType | string { return this.green.type; }
    public get width(): number { return this.green.width; }
    public get text(): string {
        if (typeof this.green.value === "string") return this.green.value;
        if (Array.isArray(this.green.value)) return this.children.map(c => c.text).join("");
        return "";
    }
    public get children(): RedNode[] {
        if (this._children !== null) return this._children;
        const val = this.green.value;
        if (Array.isArray(val)) {
            let currOffset = this.offset;
            this._children = val.map(g => {
                const child = RedNode.create(g, this, currOffset);
                currOffset += g.width;
                return child;
            });
        } else {
            this._children = [];
        }
        return this._children;
    }
    public static create(green: GreenNode, parent: RedNode | null, offset: number): RedNode {
        switch (green.type) {
${factoryCases}
            default: return new RedNode(green, parent, offset);
        }
    }
}

export class CompiledParser {
    private memo = new MemoizationTable();
    private lastText = "";
    private lastResult: ParseResult | null = null;

    public clear(): void {
        this.lastText = "";
        this.memo.clear();
        this.lastResult = null;
    }

    public parse(textStr: string): ParseResult {
        const text = new StringTextDocument(textStr);
        const ctx = new ParserContext();
        const res = this.parse${sanitize(rootElement.name)}(text, 0, this.memo, ctx);
        if (res.success && res.ast) {
            return {
                ...res,
                ast: RedNode.create(res.ast, null, 0) as any
            };
        }
        return res;
    }

    private addNode(results: GreenNode[], node: GreenNode | null, isInline: boolean): void {
        if (!node) return;
        if (isInline && Array.isArray(node.value)) {
            results.push(...node.value);
        } else {
            results.push(node);
        }
    }

    private tryRecover(
        text: ITextDocument,
        failStartOffset: number,
        ruleId: number,
        errorMsg: string,
        localMaxOffset: number,
        results: GreenNode[],
        truncateResultsCount: number,
        hasCommitted: boolean,
        recoveryBoundaries: string[] | null,
        ctx: ParserContext
    ): { recovered: boolean; recoveredOffset: number; failResult: ParseResult | null } {
        let shouldRecover = hasCommitted;
        if (!shouldRecover) {
            let nextCharIndex = failStartOffset;
            while (nextCharIndex < text.length) {
                const cp = text.charCodeAt(nextCharIndex);
                if (cp === 32 || (cp >= 9 && cp <= 13) || cp === 160 || cp === 0xFEFF) {
                    nextCharIndex++;
                } else {
                    break;
                }
            }
            if (nextCharIndex < text.length) {
                const c = text.substring(nextCharIndex, nextCharIndex + 1);
                let isScopeEnd = c === '}' || c === ')';
                if (ctx.activeScopeEnds && ctx.activeScopeEnds.length > 0) {
                    for (const scopeEnd of ctx.activeScopeEnds) {
                        if (scopeEnd.length > 0 && c === scopeEnd[0]) {
                            isScopeEnd = true;
                            break;
                        }
                    }
                }
                if (!isScopeEnd) {
                    shouldRecover = true;
                }
            }
        }

        if (shouldRecover && recoveryBoundaries && recoveryBoundaries.length > 0) {
            let bestRecoveryOffset = -1;
            for (const boundary of recoveryBoundaries) {
                const lookaheadLimit = Math.min(text.length - failStartOffset, 2048);
                const textSlice = text.substring(failStartOffset, failStartOffset + lookaheadLimit);
                const idx = textSlice.indexOf(boundary);
                if (idx !== -1) {
                    const actualIdx = failStartOffset + idx;
                    if (bestRecoveryOffset === -1 || actualIdx < bestRecoveryOffset) {
                        bestRecoveryOffset = actualIdx;
                    }
                }
            }
            if (bestRecoveryOffset !== -1) {
                const len = bestRecoveryOffset - failStartOffset;
                const skipped = text.substring(failStartOffset, failStartOffset + len);
                const snippet = skipped.length > 25 ? skipped.substring(0, 22) + "..." : skipped;
                const msg = \`Syntax Error in parser: \${errorMsg} at offset \${failStartOffset}. Skipped "\\\${snippet}\\\" to sync.\`;
                ctx.recoveredErrors.push({ message: msg, offset: failStartOffset });
                const errNode = new GreenNode(NodeType.ErrorNode, msg, 0, bestRecoveryOffset - failStartOffset);
                results.push(errNode);
                return { recovered: true, recoveredOffset: bestRecoveryOffset, failResult: null };
            }
        }

        const failResult: ParseResult = {
            success: false,
            ast: null,
            newOffset: failStartOffset,
            dependencyLimit: localMaxOffset,
            ruleId: ruleId,
            error: errorMsg
        };
        return { recovered: false, recoveredOffset: failStartOffset, failResult };
    }

${combinedRegexes.join("\n")}

${parserMethods}
}
`;
}
