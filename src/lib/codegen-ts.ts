// PAUSED - I have decided to perfect codegen-cs first.

import { SyntaxElement, unwrapToken } from './syntax-element';
import { ScopeBuilder } from './scope';
import { 
  sanitize, 
  compileDFA, 
  formatChar, 
  escapeString, 
  collectElements,
  BaseCodeGenerator,
  compileDFATransitions
} from './codegen-core';
import { isSimpleCaseInsensitiveRegex } from './utils';

export class TypeScriptCodeGenerator extends BaseCodeGenerator {
  constructor(rootElement: SyntaxElement, scopeBuilder?: ScopeBuilder) {
    super(rootElement, scopeBuilder);
  }

  public generate(): string {
    const parserCode = generateParserAndAstTypeScriptCode(this.rootElement);
    const astCode = generateStronglyTypedAstTypeScriptClasses(this.rootElement);
    
    return `/**
 * Generated Standalone TypeScript Parser, Lexer and Strongly-Typed AST Node classes.
 * This file contains zero external dependencies and runs at maximum native speed.
 */

${parserCode}

${astCode}
`;
  }
}

/**
 * Generates an optimized, stand-alone, high-performance TypeScript parser/AST file.
 */
let specIdCounter = 0;
const nextSpecId = () => ++specIdCounter;

export function generateFullTypeScript(rootElement: SyntaxElement, scopeBuilder?: ScopeBuilder): string {
  const generator = new TypeScriptCodeGenerator(rootElement, scopeBuilder);
  return generator.generate();
}

function compileSpeculativeMatchTypeScript(
  pattern: any,
  ruleId: number,
  varId: number,
  childElements: Set<string>,
  dfaMethodName?: string,
  getOrCreateDfaMethod?: (p: RegExp, type: 'Rule' | 'Spec', fallbackRuleId: number) => string
): { code: string; matchedName: string; parsedAstName: string; newOffsetName: string; precName: string; maxDepName: string } {
  const mVar = `matched_${varId}`;
  const astVar = `parsedAst_${varId}`;
  const offsetVar = `newOffset_${varId}`;
  const precVar = `prec_${varId}`;
  let code = "";
  if (pattern && typeof pattern === 'object' && '__isTokenMarker' in pattern) {
    const innerPattern = pattern.pattern;
    const tokenName = pattern.name;
    const innerSpecId = nextSpecId();
    const innerSpec = compileSpeculativeMatchTypeScript(innerPattern, ruleId, innerSpecId, childElements, dfaMethodName, getOrCreateDfaMethod);

    let leadCode = "";
    if (SyntaxElement.defaultLeadingTrivia) {
      const leadId = nextSpecId();
      let leadDfaName;
      if (SyntaxElement.defaultLeadingTrivia instanceof RegExp) {
         leadDfaName = getOrCreateDfaMethod ? getOrCreateDfaMethod(SyntaxElement.defaultLeadingTrivia, 'Spec', ruleId) : undefined;
      }
      const leadSpec = compileSpeculativeMatchTypeScript(SyntaxElement.defaultLeadingTrivia, ruleId, leadId, childElements, leadDfaName, getOrCreateDfaMethod);
      leadCode = `
        ${leadSpec.code.trim()}
        if (${leadSpec.matchedName}) {
           currentOffset = ${leadSpec.newOffsetName};
        }
      `;
    }

    let trailCode = "";
    if (SyntaxElement.defaultTrailingTrivia) {
      const trailId = nextSpecId();
      let trailDfaName;
      if (SyntaxElement.defaultTrailingTrivia instanceof RegExp) {
         trailDfaName = getOrCreateDfaMethod ? getOrCreateDfaMethod(SyntaxElement.defaultTrailingTrivia, 'Spec', ruleId) : undefined;
      }
      const trailSpec = compileSpeculativeMatchTypeScript(SyntaxElement.defaultTrailingTrivia, ruleId, trailId, childElements, trailDfaName, getOrCreateDfaMethod);
      trailCode = `
        ${trailSpec.code.trim()}
        if (${trailSpec.matchedName}) {
           currentOffset = ${trailSpec.newOffsetName};
        }
      `;
    }

    let astCode = `let ${astVar}: any = ${innerSpec.parsedAstName};`;
    if (tokenName) {
      astCode += `
        if (${innerSpec.matchedName}) {
            const wrappedNode_${varId} = {
                type: NodeType.Struct,
                start: savedOffsetBefInner_${varId},
                end: ${innerSpec.newOffsetName},
                _fields: {},
                value: ${astVar}
            };
            wrappedNode_${varId}._fields[${JSON.stringify(tokenName)}] = ${astVar};
            ${astVar} = wrappedNode_${varId};
        }
      `;
    }

    code = `
      let startOffset_${varId} = currentOffset;
      ${leadCode}
      let savedOffsetBefInner_${varId} = currentOffset;
      ${innerSpec.code.trim()}
      let ${mVar} = ${innerSpec.matchedName};
      let ${offsetVar} = ${innerSpec.newOffsetName};
      ${astCode}
      if (${mVar}) {
          currentOffset = ${offsetVar};
          ${trailCode}
          ${offsetVar} = currentOffset;
          ${tokenName ? `${astVar}.end = ${innerSpec.newOffsetName};` : ''}
          currentOffset = startOffset_${varId};
      } else {
          currentOffset = startOffset_${varId};
      }
      let ${precVar} = typeof ${innerSpec.precName} !== 'undefined' ? ${innerSpec.precName} : 0;
      let maxDep_${varId} = ${innerSpec.maxDepName};
    `;
    return { code, matchedName: mVar, parsedAstName: astVar, newOffsetName: offsetVar, precName: precVar, maxDepName: `maxDep_${varId}` };
  }

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
  } else if (pattern && typeof pattern === 'object' && 'literal' in pattern && 'pattern' in pattern) {
    const fnName = dfaMethodName || `matchDFA_Spec_${ruleId}`;
    const targetLiteral = escapeString(pattern.literal);
    code = `
                        const resDFA_${varId} = this.${fnName}(text, currentOffset);
                        const ${mVar} = resDFA_${varId}.success && resDFA_${varId}.matchedValue === "${targetLiteral}";
                        const ${astVar} = ${mVar} ? new GreenNode(NodeType.Literal, resDFA_${varId}.matchedValue, ${ruleId}, resDFA_${varId}.matchedValue.length) : null;
                        const ${offsetVar} = ${mVar} ? currentOffset + resDFA_${varId}.matchedValue.length : currentOffset;
                        const maxDep_${varId} = ${mVar} ? currentOffset + resDFA_${varId}.matchedValue.length : currentOffset + 1;
                        localMaxOffset = Math.max(localMaxOffset, maxDep_${varId});
                        const ${precVar} = 0;`;
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
    const { acceptingStateIds, transitions } = compileDFATransitions(regex);
    
    const acceptingStatesCases = acceptingStateIds
      .map(id => `                case ${id}: finalMatchLength = i - offset; break;`)
      .join('\n');
    
    const transitionCasesList: string[] = [];
    for (const trans of transitions) {
      const conditions: string[] = [];
      for (const t of trans.targets) {
        if (t.isFallback) {
          conditions.push(`                    state = ${t.targetId}; break; // Fallback transition`);
        } else {
          const rangeExprs = t.ranges.map(r => {
            if (r.start === r.end) {
              return `cp === ${r.start}`;
            } else {
              return `(cp >= ${r.start} && cp <= ${r.end})`;
            }
          });
          const condStr = rangeExprs.join(' || ');
          const ifKeyword = conditions.length === 0 ? 'if' : 'else if';
          conditions.push(`                    ${ifKeyword} (${condStr}) { state = ${t.targetId}; break; }`);
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
      
      transitionCasesList.push(`            case ${trans.dStateId}:
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

  const visibleElements = elements.filter(el => !el.isHiddenElement);

  const nodesCode = visibleElements.map(el => {
    const elName = sanitize(el.name);
    
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
            tsType = sanitize(leafValue.name) + "Node";
          } else if (Array.isArray(leafValue)) {
            const elNames = leafValue.filter(v => v instanceof SyntaxElement).map(v => sanitize(v.name) + "Node");
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
            tsType = sanitize(leafValue.name) + "Node";
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
          if (!rule.value.isHiddenElement) {
            childrenNodeTypes.add(sanitize(rule.value.name));
          }
        } else if (rule.type === 'choice') {
          for (const child of rule.value) {
            if (child instanceof SyntaxElement) {
              if (!child.isHiddenElement) {
                childrenNodeTypes.add(sanitize(child.name));
              }
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
            if (!rule.value.isHiddenElement) {
              childrenNodeTypes.add(sanitize(rule.value.name));
            }
          } else if (Array.isArray(rule.value)) {
            for (const sub of rule.value) {
              if (sub instanceof SyntaxElement) {
                if (!sub.isHiddenElement) {
                  childrenNodeTypes.add(sanitize(sub.name));
                }
              }
            }
          }
        } else if (rule.type === 'separatedBy' && rule.value) {
          const collectTypes = (p: any) => {
            if (p instanceof SyntaxElement) {
              if (!p.isHiddenElement) {
                childrenNodeTypes.add(sanitize(p.name));
              }
            } else if (Array.isArray(p)) {
              p.forEach(collectTypes);
            }
          };
          collectTypes(rule.value.item);
          if (rule.value.separator instanceof SyntaxElement) {
            if (!rule.value.separator.isHiddenElement) {
              childrenNodeTypes.add(sanitize(rule.value.separator.name));
            }
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

  function getRecoveryErrorExpr(rule: any, defaultMsgExpr: string): string {
    if (rule.customErrorMessage) {
      return `"${escapeString(rule.customErrorMessage)}"`;
    }
    if (rule.type === 'regex' || rule.type === 'caseInsensitiveLiteral') {
      const pat = rule.value;
      if (pat && typeof pat === 'object') {
        if ('overrideName' in pat && typeof pat.overrideName === 'string') {
          return `"${escapeString(`Expected ${pat.overrideName}`)}"`;
        }
        return `"${escapeString(`Expected match for pattern: ${pat.source}`)}"`;
      }
    }
    return defaultMsgExpr;
  }
  
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
      } else if (rule.type === 'literalMatch' || rule.type === 'caseInsensitiveLiteralMatch') {
        if (!isSimpleCaseInsensitiveRegex(rule.value.pattern)) {
          registerPattern(rule.value.pattern, ruleId, 'Rule');
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
        rule.type === 'assert'
      ) {
        if (rule.value instanceof RegExp) {
          if (!isSimpleCaseInsensitiveRegex(rule.value)) {
            registerPattern(rule.value, ruleId, 'Spec');
          }
        }
      } else if (rule.type === 'separatedBy' && rule.value) {
        const registerPatterns = (p: any) => {
          if (p instanceof RegExp) {
            if (!isSimpleCaseInsensitiveRegex(p)) {
              registerPattern(p, ruleId, 'Spec');
            }
          } else if (Array.isArray(p)) {
            p.forEach(registerPatterns);
          }
        };
        registerPatterns(rule.value.item);
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
  
  
  
  const parserMethods = elements.map(el => {
    const elName = sanitize(el.name);
    const childElements = new Set<string>();

    const ruleBlocks = el.rules.map((rule, ruleIndex) => {
      const ruleId = rule.id;
      
      const boundariesExpr = rule.recoveryPatterns.length > 0
        ? `[${rule.recoveryPatterns.map(b => `"${escapeString(b)}"`).join(", ")}]`
        : "null";
      let ruleIsStructural = true;
      if (
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
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, ${getRecoveryErrorExpr(rule, `"Expected literal \\"${esc}\\""`)}, localMaxOffset, results, lastStructuralResultsCount, hasCommitted || isRoot, ${boundariesExpr}, ctx);
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
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, ${getRecoveryErrorExpr(rule, `"Expected case-insensitive literal \\"${esc}\\""`)}, localMaxOffset, results, lastStructuralResultsCount, hasCommitted || isRoot, ${boundariesExpr}, ctx);
                    if (rec.recovered) {
                        currentOffset = rec.recoveredOffset;
                        panicked = true;
                    } else {
                        return rec.failResult!;
                    }
                }
            }`;
      }
      
      if (rule.type === 'literalMatch') {
        const dfaMethodName = getOrCreateDfaMethod(rule.value.pattern, 'Rule', ruleId);
        const targetLiteral = escapeString(rule.value.literal);
        return `
            // LiteralMatch Rule: "${targetLiteral}" /${rule.value.pattern.source}/ (id: ${ruleId})
            if (!panicked) {
                const startOffset_${ruleId} = currentOffset;
                const dfaRes_${ruleId} = this.${dfaMethodName}(text, currentOffset);
                if (dfaRes_${ruleId}.success && dfaRes_${ruleId}.matchedValue === "${targetLiteral}") {
                    const mval = dfaRes_${ruleId}.matchedValue;
                    this.addNode(results, new GreenNode(NodeType.Literal, mval, ${ruleId}, mval.length), ${isInline});
                    currentOffset += mval.length;
                    hasCommitted = true;
                    ${structUpdate}
                    localMaxOffset = Math.max(localMaxOffset, currentOffset);
                } else {
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, ${getRecoveryErrorExpr(rule, `"Expected strict literal \\"${targetLiteral}\\""`)}, localMaxOffset, results, lastStructuralResultsCount, hasCommitted || isRoot, ${boundariesExpr}, ctx);
                    if (rec.recovered) {
                        currentOffset = rec.recoveredOffset;
                        panicked = true;
                    } else {
                        return rec.failResult!;
                    }
                }
            }`;
      }
      
      if (rule.type === 'caseInsensitiveLiteralMatch') {
        const dfaMethodName = getOrCreateDfaMethod(rule.value.pattern, 'Rule', ruleId);
        const targetLiteral = escapeString(rule.value.literal);
        return `
            // CaseInsensitiveLiteralMatch Rule: "${targetLiteral}" /${rule.value.pattern.source}/ (id: ${ruleId})
            if (!panicked) {
                const startOffset_${ruleId} = currentOffset;
                const dfaRes_${ruleId} = this.${dfaMethodName}(text, currentOffset);
                if (dfaRes_${ruleId}.success && dfaRes_${ruleId}.matchedValue.toLowerCase() === "${targetLiteral}".toLowerCase()) {
                    const mval = dfaRes_${ruleId}.matchedValue;
                    this.addNode(results, new GreenNode(NodeType.Literal, mval, ${ruleId}, mval.length), ${isInline});
                    currentOffset += mval.length;
                    hasCommitted = true;
                    ${structUpdate}
                    localMaxOffset = Math.max(localMaxOffset, currentOffset);
                } else {
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, ${getRecoveryErrorExpr(rule, `"Expected case-insensitive strict literal \\"${targetLiteral}\\""`)}, localMaxOffset, results, lastStructuralResultsCount, hasCommitted || isRoot, ${boundariesExpr}, ctx);
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
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, ${getRecoveryErrorExpr(rule, `"Expected match for pattern"`)}, localMaxOffset, results, lastStructuralResultsCount, hasCommitted || isRoot, ${boundariesExpr}, ctx);
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
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, ${getRecoveryErrorExpr(rule, `res.error || "Expected sub-element ${rule.value.name}"`)}, localMaxOffset, results, lastStructuralResultsCount, hasCommitted || isRoot, ${boundariesExpr}, ctx);
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
        const expectedDesc = patterns.map(p => SyntaxElement.getPatternDescription(p)).join(", ");
        const expectedMsg = `Expected one of: ${expectedDesc}`;
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
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, ${getRecoveryErrorExpr(rule, `expectedMsg`)}, localMaxOffset, results, lastStructuralResultsCount, hasCommitted || isRoot, ${boundariesExpr}, ctx);
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
        const isArray = Array.isArray(rule.value);
        if (!isArray) {
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
        } else {
          const patterns = rule.value as any[];
          const escErrorsVar = `optListErrors_${ruleId}`;
          const branchChecks: string[] = [];
          
          patterns.forEach((p, idx) => {
            const sId = nextSpecId();
            let specificDfaName: string | undefined;
            if (p instanceof RegExp) {
              specificDfaName = getOrCreateDfaMethod(p, 'Spec', ruleId);
            }
            const spec = compileSpeculativeMatchTypeScript(p, ruleId, sId, childElements, specificDfaName);
            const isOptInline = p instanceof SyntaxElement && p.isHiddenElement;
            branchChecks.push(`
                    if (!matchedItems_${ruleId}[${idx}]) {
                        const ${escErrorsVar}_branch = ctx.recoveredErrors.length;
                        const savedOffset_${sId} = currentOffset;
                        ${spec.code.trim()}
                        if (${spec.matchedName} && ${spec.newOffsetName} > savedOffset_${sId}) {
                            matchedValidationVar_${ruleId} = true;
                            matchedItems_${ruleId}[${idx}] = true;
                            if (${spec.parsedAstName} !== null && (${spec.parsedAstName}.width > 0 || ${spec.parsedAstName}.type === NodeType.Eof)) {
                                this.addNode(results, ${spec.parsedAstName}, ${isOptInline});
                            }
                            currentOffset = ${spec.newOffsetName};
                            continue;
                        } else {
                            ctx.recoveredErrors.splice(${escErrorsVar}_branch, ctx.recoveredErrors.length - ${escErrorsVar}_branch);
                            currentOffset = savedOffset_${sId};
                        }
                    }
            `);
          });

          const requiredChecks: string[] = [];
          if (rule.requiredIndices && rule.requiredIndices.size > 0) {
            rule.requiredIndices.forEach(idx => {
              const reqPattern = patterns[idx];
              const name = reqPattern instanceof SyntaxElement ? reqPattern.name : String(reqPattern);
              requiredChecks.push(`
                  if (!matchedItems_${ruleId}[${idx}]) {
                      allRequiredMatched_${ruleId} = false;
                      missingLabel_${ruleId} = "${escapeString(name)}";
                  }`);
            });
          }

          const validationBlock = requiredChecks.length > 0 ? `
                  let allRequiredMatched_${ruleId} = true;
                  let missingLabel_${ruleId} = "";
                  ${requiredChecks.join('\n')}
                  if (!allRequiredMatched_${ruleId}) {
                      results.length = initialResultsCount_${ruleId};
                      currentOffset = startOffset_${ruleId};
                      const rec = this.tryRecover(text, startOffset_${ruleId}, ${ruleId}, ${getRecoveryErrorExpr(rule, `"Missing required element in unordered list: " + missingLabel_${ruleId}`)}, localMaxOffset, results, lastStructuralResultsCount, hasCommitted || isRoot, ${boundariesExpr}, ctx);
                      if (rec.recovered) {
                          currentOffset = rec.recoveredOffset;
                          panicked = true;
                      } else {
                          return rec.failResult!;
                      }
                  }
          ` : '';

          return `
              // Optional List Rule (id: ${ruleId})
              if (!panicked) {
                  const startOffset_${ruleId} = currentOffset;
                  const initialResultsCount_${ruleId} = results.length;
                  const matchedItems_${ruleId} = new Array(${patterns.length}).fill(false);
                  let matchedValidationVar_${ruleId} = true;
                  
                  while (matchedValidationVar_${ruleId} && currentOffset < text.length) {
                      matchedValidationVar_${ruleId} = false;
                      ${branchChecks.join('\n')}
                  }
                  ${validationBlock}
              }`;
        }
      }
      
      if (rule.type === 'zeroOrMore') {
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
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, ${getRecoveryErrorExpr(rule, `"Expected at least one occurrence in loop"`)}, localMaxOffset, results, lastStructuralResultsCount, hasCommitted || isRoot, ${boundariesExpr}, ctx);
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
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, ${getRecoveryErrorExpr(rule, `"Expected at least one occurrence in loop"`)}, localMaxOffset, results, lastStructuralResultsCount, hasCommitted || isRoot, ${boundariesExpr}, ctx);
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
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, ${getRecoveryErrorExpr(rule, `"Rule negative constraint matched"`)}, localMaxOffset, results, lastStructuralResultsCount, hasCommitted || isRoot, ${boundariesExpr}, ctx);
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
                    const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, ${getRecoveryErrorExpr(rule, `"Assertion check failed"`)}, localMaxOffset, results, lastStructuralResultsCount, hasCommitted || isRoot, ${boundariesExpr}, ctx);
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
        const isItemArray = Array.isArray(rule.value.item);
        let specItemCode = "";
        let specItemMatchedName = "";
        let specItemParsedAstName = "";
        let specItemNewOffsetName = "";
        let isItemInlineExpr = "";

        if (isItemArray) {
          const sIdMatched = `matched_item_${ruleId}`;
          const sIdAst = `parsedAst_item_${ruleId}`;
          const sIdNewOffset = `newOffset_item_${ruleId}`;
          const sIdInline = `isInline_item_${ruleId}`;

          const patterns = rule.value.item as any[];
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
                if (!${sIdMatched}) {
                    const beforeBranchOffset = currentOffset;
                    const errCount_branch = ctx.recoveredErrors.length;
                    ${spec.code.trim()}
                    if (${spec.matchedName} && ${spec.newOffsetName} > beforeBranchOffset) {
                        ${sIdMatched} = true;
                        ${sIdAst} = ${spec.parsedAstName};
                        ${sIdNewOffset} = ${spec.newOffsetName};
                        ${sIdInline} = ${isIterInline};
                    } else {
                        ctx.recoveredErrors.splice(errCount_branch, ctx.recoveredErrors.length - errCount_branch);
                    }
                }`);
          });

          specItemCode = `
            let ${sIdMatched} = false;
            let ${sIdAst}: any = null;
            let ${sIdNewOffset} = currentOffset;
            let ${sIdInline} = false;
            ${branchChecks.join('\n')}
          `;
          specItemMatchedName = sIdMatched;
          specItemParsedAstName = sIdAst;
          specItemNewOffsetName = sIdNewOffset;
          isItemInlineExpr = sIdInline;
        } else {
          const sIdItem = nextSpecId();
          let specificDfaNameItem: string | undefined;
          if (rule.value.item instanceof RegExp) {
            specificDfaNameItem = getOrCreateDfaMethod(rule.value.item, 'Spec', ruleId);
          }
          const spec = compileSpeculativeMatchTypeScript(rule.value.item, ruleId, sIdItem, childElements, specificDfaNameItem);
          const isItemInline = rule.value.item instanceof SyntaxElement && rule.value.item.isHiddenElement;

          specItemCode = spec.code;
          specItemMatchedName = spec.matchedName;
          specItemParsedAstName = spec.parsedAstName;
          specItemNewOffsetName = spec.newOffsetName;
          isItemInlineExpr = String(isItemInline);
        }

        const sIdSep = nextSpecId();
        let specificDfaNameSep: string | undefined;
        if (rule.value.separator instanceof RegExp) {
          specificDfaNameSep = getOrCreateDfaMethod(rule.value.separator, 'Spec', ruleId);
        }
        const specSep = compileSpeculativeMatchTypeScript(rule.value.separator, ruleId, sIdSep, childElements, specificDfaNameSep);
        const isSepInline = rule.value.separator instanceof SyntaxElement && rule.value.separator.isHiddenElement;
        
        const allowLeading = !!rule.value.allowLeading;
        const allowTrailing = !!rule.value.allowTrailing;
        
        return `
            // Separated By Rule (id: ${ruleId}, allowLeading: ${allowLeading}, allowTrailing: ${allowTrailing})
            if (!panicked) {
                const startLoopOffset = currentOffset;
                const loopResults: GreenNode[] = [];
                let isFirst = true;

                ${allowLeading ? `
                // Optional leading separator
                const beforeLeadSepOffset_${ruleId} = currentOffset;
                const leadSepErrorsCount_${ruleId} = ctx.recoveredErrors.length;
                ${specSep.code.trim()}
                if (${specSep.matchedName} && ${specSep.newOffsetName} > beforeLeadSepOffset_${ruleId}) {
                    // Try to match item next
                    const tempOffset_${ruleId} = currentOffset;
                    currentOffset = ${specSep.newOffsetName};
                    ${specItemCode.trim()}
                    if (${specItemMatchedName} && ${specItemNewOffsetName} > currentOffset) {
                        currentOffset = tempOffset_${ruleId};
                        this.addNode(loopResults, ${specSep.parsedAstName}, ${isSepInline});
                        this.addNode(loopResults, ${specItemParsedAstName}, ${isItemInlineExpr});
                        currentOffset = ${specItemNewOffsetName};
                        isFirst = false;
                    } else {
                        // Backtrack leading separator
                        currentOffset = tempOffset_${ruleId};
                        ctx.recoveredErrors.splice(leadSepErrorsCount_${ruleId}, ctx.recoveredErrors.length - leadSepErrorsCount_${ruleId});
                    }
                }
                ` : ''}

                if (isFirst) {
                    // Expect first item directly
                    ${specItemCode.trim()}
                    if (${specItemMatchedName} && ${specItemNewOffsetName} > currentOffset) {
                        this.addNode(loopResults, ${specItemParsedAstName}, ${isItemInlineExpr});
                        currentOffset = ${specItemNewOffsetName};
                        isFirst = false;
                    } else {
                        const rec = this.tryRecover(text, ${startOffsetForFailure}, ${ruleId}, ${getRecoveryErrorExpr(rule, `"Expected first item in separator list"`)}, localMaxOffset, results, lastStructuralResultsCount, hasCommitted || isRoot, ${boundariesExpr}, ctx);
                        if (rec.recovered) {
                            currentOffset = rec.recoveredOffset;
                            panicked = true;
                        } else {
                            return rec.failResult!;
                        }
                    }
                }

                if (!panicked) {
                    // Loop for (separator item)*
                    while (currentOffset < text.length) {
                        const beforeSepOffset = currentOffset;
                        const sepErrorsCount = ctx.recoveredErrors.length;
                        ${specSep.code.trim()}
                        if (${specSep.matchedName} && ${specSep.newOffsetName} > beforeSepOffset) {
                            // Separator matched, try subsequently matching item
                            const afterSepOffset = ${specSep.newOffsetName};
                            const beforeItemOffset = afterSepOffset;
                            const tempOffset = currentOffset;
                            currentOffset = afterSepOffset;
                            
                            ${specItemCode.trim()}
                            if (${specItemMatchedName} && ${specItemNewOffsetName} > beforeItemOffset) {
                                currentOffset = tempOffset;
                                this.addNode(loopResults, ${specSep.parsedAstName}, ${isSepInline});
                                this.addNode(loopResults, ${specItemParsedAstName}, ${isItemInlineExpr});
                                currentOffset = ${specItemNewOffsetName};
                            } else {
                                // Separator matched but subsequent item failed
                                currentOffset = tempOffset;
                                if (${allowTrailing}) {
                                    this.addNode(loopResults, ${specSep.parsedAstName}, ${isSepInline});
                                    currentOffset = afterSepOffset;
                                } else {
                                    ctx.recoveredErrors.splice(sepErrorsCount, ctx.recoveredErrors.length - sepErrorsCount);
                                }
                                break;
                            }
                        } else {
                            ctx.recoveredErrors.splice(sepErrorsCount, ctx.recoveredErrors.length - sepErrorsCount);
                            break;
                        }
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
        const isRoot = ${el === rootElement ? "true" : "false"};
        
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
  const visibleElements = elements.filter(el => !el.isHiddenElement);
  const customNodeTypes = Array.from(new Set(visibleElements.map(el => sanitize(el.name))));

  // Factory cases map NodeType to concrete subclass node
  const factoryCases = visibleElements.map(el => {
    const elName = sanitize(el.name);
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
    recoveredOffset?: number;
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

    private ensureTerminal(): void {
        if (typeof this.green.value !== "string") {
            throw new Error("This operation is only valid on a terminal token.");
        }
    }

    public asText(): string {
        this.ensureTerminal();
        return this.text;
    }

    public asLiteral(): string {
        this.ensureTerminal();
        return this.text;
    }

    public asInteger(): number {
        this.ensureTerminal();
        return parseInt(this.text, 10);
    }

    public asFloat(): number {
        this.ensureTerminal();
        return parseFloat(this.text);
    }

    public asByte(): number {
        this.ensureTerminal();
        return parseInt(this.text, 10);
    }

    public asSByte(): number {
        this.ensureTerminal();
        return parseInt(this.text, 10);
    }

    public asInt16(): number {
        this.ensureTerminal();
        return parseInt(this.text, 10);
    }

    public asUInt16(): number {
        this.ensureTerminal();
        return parseInt(this.text, 10);
    }

    public asInt32(): number {
        this.ensureTerminal();
        return parseInt(this.text, 10);
    }

    public asUInt32(): number {
        this.ensureTerminal();
        return parseInt(this.text, 10);
    }

    public asInt64(): number {
        this.ensureTerminal();
        return parseInt(this.text, 10);
    }

    public asUInt64(): number {
        this.ensureTerminal();
        return parseInt(this.text, 10);
    }

    public asSingle(): number {
        this.ensureTerminal();
        return parseFloat(this.text);
    }

    public asDouble(): number {
        this.ensureTerminal();
        return parseFloat(this.text);
    }

    public asBoolean(): boolean {
        this.ensureTerminal();
        return this.text === "true";
    }

    public static asLiteral(text: string): RedNode {
        const green = new GreenNode("Literal", text, 0, text.length);
        return new RedNode(green, null, 0);
    }

    public static asText(text: string): RedNode {
        const green = new GreenNode("Token", text, 0, text.length);
        return new RedNode(green, null, 0);
    }

    public static asInteger(value: number): RedNode {
        const green = new GreenNode("Token", String(value), 0, String(value).length);
        return new RedNode(green, null, 0);
    }

    public static asFloat(value: number): RedNode {
        const green = new GreenNode("Token", String(value), 0, String(value).length);
        return new RedNode(green, null, 0);
    }

    public static asByte(value: number): RedNode {
        const green = new GreenNode("Token", String(value), 0, String(value).length);
        return new RedNode(green, null, 0);
    }

    public static asSByte(value: number): RedNode {
        const green = new GreenNode("Token", String(value), 0, String(value).length);
        return new RedNode(green, null, 0);
    }

    public static asInt16(value: number): RedNode {
        const green = new GreenNode("Token", String(value), 0, String(value).length);
        return new RedNode(green, null, 0);
    }

    public static asUInt16(value: number): RedNode {
        const green = new GreenNode("Token", String(value), 0, String(value).length);
        return new RedNode(green, null, 0);
    }

    public static asInt32(value: number): RedNode {
        const green = new GreenNode("Token", String(value), 0, String(value).length);
        return new RedNode(green, null, 0);
    }

    public static asUInt32(value: number): RedNode {
        const green = new GreenNode("Token", String(value), 0, String(value).length);
        return new RedNode(green, null, 0);
    }

    public static asInt64(value: number): RedNode {
        const green = new GreenNode("Token", String(value), 0, String(value).length);
        return new RedNode(green, null, 0);
    }

    public static asUInt64(value: number): RedNode {
        const green = new GreenNode("Token", String(value), 0, String(value).length);
        return new RedNode(green, null, 0);
    }

    public static asSingle(value: number): RedNode {
        const green = new GreenNode("Token", String(value), 0, String(value).length);
        return new RedNode(green, null, 0);
    }

    public static asDouble(value: number): RedNode {
        const green = new GreenNode("Token", String(value), 0, String(value).length);
        return new RedNode(green, null, 0);
    }

    public static asBoolean(value: boolean): RedNode {
        const str = value ? "true" : "false";
        const green = new GreenNode("Token", str, 0, str.length);
        return new RedNode(green, null, 0);
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
                ctx.recoveredErrors.push({ message: msg, offset: failStartOffset, recoveredOffset: bestRecoveryOffset });
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
