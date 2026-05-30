import { SyntaxElement } from "./syntax-element";

export interface Diagnostic {
  type: "error" | "warning" | "info";
  nodeName: string;
  message: string;
  suggestion: string;
}

function unwrapPattern(p: any): any {
  if (p && typeof p === 'object' && 'pattern' in p) {
    return p.pattern;
  }
  return p;
}

function isPatternNullable(pattern: any, nullable: Map<SyntaxElement, boolean>): boolean {
  if (!pattern) return true;
  if (pattern instanceof SyntaxElement) {
    return nullable.get(pattern) === true;
  }
  if (typeof pattern === 'string') {
    return pattern === ""; // Only empty string is nullable
  }
  if (pattern instanceof RegExp) {
    try {
      const anchored = new RegExp('^(?:' + pattern.source + ')');
      return anchored.test("");
    } catch (_) {
      return false;
    }
  }
  return false;
}

function isRuleNullable(rule: any, nullable: Map<SyntaxElement, boolean>): boolean {
  switch (rule.type) {
    case 'literal':
    case 'regex':
    case 'element':
    case 'beginScope':
    case 'endScope':
      return isPatternNullable(unwrapPattern(rule.value), nullable);
    case 'not':
    case 'assert':
    case 'eof':
    case 'leadingTrivia':
    case 'trailingTrivia':
      return true; // zero-width
    case 'whitespace':
      return true; // typically nullable or ignorable whitespace
    case 'optional':
    case 'zeroOrMore':
    case 'zeroOrMoreOneOf':
      return true;
    case 'separatedBy':
      return isPatternNullable(unwrapPattern(rule.value.item), nullable);
    case 'oneOrMore':
      return isPatternNullable(unwrapPattern(rule.value), nullable);
    case 'oneOrMoreOneOf':
    case 'choice':
      if (Array.isArray(rule.value)) {
        return rule.value.some((alt: any) => isPatternNullable(unwrapPattern(alt), nullable));
      }
      return false;
    default:
      return false;
  }
}

function getFirstReachableElements(el: SyntaxElement, nullable: Map<SyntaxElement, boolean>): Set<SyntaxElement> {
  const referenced = new Set<SyntaxElement>();
  if (!el.rules) return referenced;
  
  for (const rule of el.rules) {
    if (rule.type === 'element' && rule.value instanceof SyntaxElement) {
      referenced.add(rule.value);
    } else if (
      rule.type === 'choice' || 
      rule.type === 'zeroOrMoreOneOf' || 
      rule.type === 'oneOrMoreOneOf'
    ) {
      if (Array.isArray(rule.value)) {
        for (const alt of rule.value) {
          const unwrapped = unwrapPattern(alt);
          if (unwrapped instanceof SyntaxElement) {
            referenced.add(unwrapped);
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
      const unwrapped = unwrapPattern(rule.value);
      if (unwrapped instanceof SyntaxElement) {
        referenced.add(unwrapped);
      }
    } else if (rule.type === 'separatedBy' && rule.value) {
      const unwrappedItem = unwrapPattern(rule.value.item);
      if (unwrappedItem instanceof SyntaxElement) {
        referenced.add(unwrappedItem);
      }
      if (isPatternNullable(unwrappedItem, nullable)) {
        const unwrappedSep = unwrapPattern(rule.value.separator);
        if (unwrappedSep instanceof SyntaxElement) {
          referenced.add(unwrappedSep);
        }
      }
    }
    
    if (!isRuleNullable(rule, nullable)) {
      break;
    }
  }
  
  return referenced;
}

export function runGrammarDiagnostics(rootElement: SyntaxElement | null): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!rootElement) return diagnostics;

  // 1. Collect all reachable elements
  const visited = new Set<SyntaxElement>();
  const elements: SyntaxElement[] = [];

  function visit(el: SyntaxElement) {
    if (!el || visited.has(el)) return;
    visited.add(el);
    elements.push(el);

    for (const rule of el.rules) {
      if (rule.type === 'element' && rule.value instanceof SyntaxElement) {
        visit(rule.value);
      } else if (rule.type === 'choice' || rule.type === 'zeroOrMoreOneOf' || rule.type === 'oneOrMoreOneOf') {
        if (Array.isArray(rule.value)) {
          for (const choice of rule.value) {
            if (choice instanceof SyntaxElement) {
              visit(choice);
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
        if (rule.value instanceof SyntaxElement) {
          visit(rule.value);
        }
      } else if (rule.type === 'separatedBy' && rule.value) {
        if (rule.value.item instanceof SyntaxElement) {
          visit(rule.value.item);
        }
        if (rule.value.separator instanceof SyntaxElement) {
          visit(rule.value.separator);
        }
      }
    }
  }

  visit(rootElement);

  // 1.5. Calculate nullability of elements for left-recursion and cycle analysis
  const nullable = new Map<SyntaxElement, boolean>();
  for (const el of elements) {
    nullable.set(el, false);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const el of elements) {
      if (nullable.get(el)) continue;

      let elNullable = true;
      if (el.rules && el.rules.length > 0) {
        for (const rule of el.rules) {
          if (!isRuleNullable(rule, nullable)) {
            elNullable = false;
            break;
          }
        }
      } else {
        elNullable = true;
      }

      if (elNullable) {
        nullable.set(el, true);
        changed = true;
      }
    }
  }

  // Detect direct, indirect, and dynamic left-recursion cycles using targeted DFS per element
  for (const el of elements) {
    const stack: SyntaxElement[] = [];
    const localVisited = new Set<SyntaxElement>();
    let cycleFound = false;

    function dfs(current: SyntaxElement) {
      if (cycleFound) return;
      
      if (current === el && stack.length > 0) {
        const cyclePath = [...stack, el];
        const pathStr = cyclePath.map(node => node.name).join(" ➔ ");
        diagnostics.push({
          type: "error",
          nodeName: el.name,
          message: `Left recursion cycle detected: ${pathStr}`,
          suggestion: "Left-recursion (direct, indirect, or dynamic nullable-prefixed) causes stack overflow in PEG recursion. Move recursive rules or match a literal/regex first to consume characters before recursing."
        });
        cycleFound = true;
        return;
      }

      if (localVisited.has(current)) return;
      localVisited.add(current);
      stack.push(current);

      const nextElements = getFirstReachableElements(current, nullable);
      for (const nextEl of nextElements) {
        dfs(nextEl);
        if (cycleFound) return;
      }

      stack.pop();
    }

    dfs(el);
  }

  // 2. Perform validation checks on each element
  for (const el of elements) {
    const elName = el.name;

    // Rule A: Empty element rules (Error)
    if (!el.rules || el.rules.length === 0) {
      diagnostics.push({
        type: "error",
        nodeName: elName,
        message: "This SyntaxElement has no grammar rules defined.",
        suggestion: "Add rules using expects, expectsOneOf, token, or other expectation methods in your grammar builder."
      });
      continue;
    }

    // Rule B: Direct Left Recursion Cycle (Error)
    const firstRule = el.rules[0];
    if (firstRule && firstRule.type === 'element' && firstRule.value === el) {
      diagnostics.push({
        type: "error",
        nodeName: elName,
        message: "Left recursion detected: the first rule of this element is a direct recursive reference to itself.",
        suggestion: "Move the recursive rule or match a literal first so the parser consumes input, preventing infinite recursion."
      });
    }

    // Rule C: Shadowing & Sorting Hazard in Choices (Warning)
    for (const rule of el.rules) {
      if (rule.type === 'choice') {
        const choiceList = rule.value;
        if (Array.isArray(choiceList)) {
          const stringChoices = choiceList.filter(c => typeof c === 'string') as string[];
          
          for (let i = 0; i < stringChoices.length; i++) {
            for (let j = i + 1; j < stringChoices.length; j++) {
              const first = stringChoices[i];
              const second = stringChoices[j];
              
              if (second.startsWith(first) && second !== first) {
                diagnostics.push({
                  type: 'warning',
                  nodeName: elName,
                  message: `Shadowing hazard: literal "${second}" appears after its prefix "${first}" in choices list.`,
                  suggestion: `Use Sort(...) to order choice literals descending by length, so "${second}" (matching length ${second.length}) is tried before "${first}" (matching length ${first.length}).`
                });
              }
            }
          }
        }
      }
    }

    // Rule D: Regex inside an Enum-mapped SyntaxElement (Warning)
    if (el.isEnumTarget) {
      let hasRegex = false;
      let regexPattern = "";
      for (const rule of el.rules) {
        if (rule.type === 'regex') {
          hasRegex = true;
          regexPattern = String(rule.value);
        } else if (rule.type === 'choice') {
          const choiceList = rule.value;
          if (Array.isArray(choiceList)) {
            for (const c of choiceList) {
              if (c instanceof RegExp) {
                hasRegex = true;
                regexPattern = String(c);
                break;
              }
            }
          }
        }
      }

      if (hasRegex) {
        diagnostics.push({
          type: "warning",
          nodeName: elName,
          message: `Enum-mapped element contains a regular expression pattern "${regexPattern}".`,
          suggestion: "Enums should strictly represent constant string keywords. Consider separating the regex into its own Node (e.g. ExpectsOneOf(builtin_type, custom_identifier))."
        });
      }
    }

    // Rule E: Balanced Scopes (Warning)
    const hasBegin = el.rules.some(r => r.type === 'beginScope');
    const hasEnd = el.rules.some(r => r.type === 'endScope');
    if (hasBegin !== hasEnd) {
      diagnostics.push({
        type: "warning",
        nodeName: elName,
        message: `Mismatched Scope block helpers: ${hasBegin ? "BeginScope is used without an EndScope" : "EndScope is used without a BeginScope"}.`,
        suggestion: "Ensure scope nodes declare both BeginScope and EndScope to reliably maintain the scope boundaries."
      });
    }

    // Rule F: Scope End Boundary Conflict (Warning)
    const beginScopeIdx = el.rules.findIndex(r => r.type === 'beginScope');
    const endScopeIdx = el.rules.findIndex(r => r.type === 'endScope');
    if (beginScopeIdx !== -1 && endScopeIdx !== -1 && beginScopeIdx < endScopeIdx) {
      const endRule = el.rules[endScopeIdx];
      const endPattern = endRule.value; // string, RegExp, or token marker
      
      // Extract delimiter string if possible
      let delimStr: string | null = null;
      if (typeof endPattern === 'string') {
        delimStr = endPattern;
      } else if (endPattern && typeof endPattern === 'object' && 'pattern' in endPattern) {
        const unwrapped = (endPattern as any).pattern;
        if (typeof unwrapped === 'string') {
          delimStr = unwrapped;
        }
      } else if (endPattern instanceof SyntaxElement) {
        const lits = endPattern.getTerminalLiterals();
        if (lits.length > 0) {
          delimStr = lits[0];
        }
      }

      if (delimStr) {
        // Collect patterns inside body elements between begin and end scope
        const getReachablePatterns = (rule: any): { pattern: any; path: string }[] => {
          const results: { pattern: any; path: string }[] = [];
          const vis = new Set<SyntaxElement>();
          
          function collect(val: any, currentPath: string) {
            if (!val) return;
            if (val instanceof SyntaxElement) {
              if (vis.has(val)) return;
              vis.add(val);
              // Avoid scanning inside elements that have bounded balanced scopes
              if (val.rules) {
                const hasBegin = val.rules.some((r: any) => r.type === 'beginScope');
                const hasEnd = val.rules.some((r: any) => r.type === 'endScope');
                if (hasBegin && hasEnd) {
                  return;
                }
              }
              for (const r of val.rules) {
                if (r.type === 'beginScope' || r.type === 'endScope' || r.type === 'not') {
                  continue;
                }
                collect(r.value, `${currentPath} -> Node(${val.name})`);
              }
            } else if (Array.isArray(val)) {
              for (let idx = 0; idx < val.length; idx++) {
                collect(val[idx], `${currentPath}[choice ${idx + 1}]`);
              }
            } else if (typeof val === 'string') {
              results.push({ pattern: val, path: `${currentPath} (literal "${val}")` });
            } else if (val instanceof RegExp) {
              results.push({ pattern: val, path: `${currentPath} (regex /${val.source}/)` });
            } else if (val && typeof val === 'object' && 'pattern' in val) {
              const unwrapped = val.pattern;
              if (typeof unwrapped === 'string') {
                results.push({ pattern: unwrapped, path: `${currentPath} (token "${unwrapped}")` });
              } else if (unwrapped instanceof RegExp) {
                results.push({ pattern: unwrapped, path: `${currentPath} (token /${unwrapped.source}/)` });
              } else {
                results.push({ pattern: unwrapped, path: `${currentPath} (token)` });
              }
            }
          }
          
          const initialPath = `Rule(${rule.type})`;
          if (rule.type === 'choice' || rule.type === 'zeroOrMoreOneOf' || rule.type === 'oneOrMoreOneOf') {
            collect(rule.value, initialPath);
          } else if (rule.type !== 'beginScope' && rule.type !== 'endScope' && rule.type !== 'not') {
            collect(rule.value, initialPath);
          }
          return results;
        };

        for (let i = beginScopeIdx + 1; i < endScopeIdx; i++) {
          const bodyRule = el.rules[i];
          const bodyPatterns = getReachablePatterns(bodyRule);
          for (const item of bodyPatterns) {
            const pat = item.pattern;
            const path = item.path;
            let conflict = false;
            let reason = "";
            
            if (typeof pat === 'string') {
              if (pat === delimStr || delimStr.startsWith(pat)) {
                conflict = true;
                reason = `literal pattern "${pat}" directly matches or overlaps with EndScope delimiter "${delimStr}"`;
              }
            } else if (pat instanceof RegExp) {
              try {
                // If the regex can match and consume at least 1 character of the delimiter
                const anchored = new RegExp('^(?:' + pat.source + ')');
                const m = anchored.exec(delimStr);
                if (m && m[0].length > 0) {
                  conflict = true;
                  reason = `regular expression ${pat.source} matches and consumes the EndScope delimiter "${delimStr}"`;
                }
              } catch (e) {}
            }
            
            if (conflict) {
              diagnostics.push({
                type: "warning",
                nodeName: elName,
                message: `Potential infinite loop or boundary overlap: Sibling rule can consume the EndScope delimiter.\nCulprit Sibling Path: ${path}\nConflict detail: ${reason}`,
                suggestion: `To prevent parser lockup or eating the close delimiter, refine your body pattern (e.g. use [^${delimStr}] instead of wildcard matching), balance it using BeginScope/EndScope helpers on nested elements, or prefix your body block with a negative lookahead "Unexpects(Token('${delimStr}'))" guard.`
              });
            }
          }
        }
      }
    }
  }

  return diagnostics;
}
