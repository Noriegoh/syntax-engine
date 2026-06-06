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

function arePatternsEquivalent(a: any, b: any): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  const ua = unwrapPattern(a);
  const ub = unwrapPattern(b);

  if (ua === ub) return true;
  if (!ua || !ub) return false;

  if (ua instanceof RegExp && ub instanceof RegExp) {
    return ua.source === ub.source && ua.flags === ub.flags;
  }

  if (ua instanceof SyntaxElement && ub instanceof SyntaxElement) {
    return ua.name === ub.name;
  }

  if (Array.isArray(ua) && Array.isArray(ub)) {
    if (ua.length !== ub.length) return false;
    for (let i = 0; i < ua.length; i++) {
      if (!arePatternsEquivalent(ua[i], ub[i])) return false;
    }
    return true;
  }

  return false;
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
      return false; // Requires at least one whitespace character (\s+) in syntax engine matching
    case 'optional':
    case 'zeroOrMore':
      return true;
    case 'separatedBy':
      return isPatternNullable(unwrapPattern(rule.value.item), nullable);
    case 'oneOrMore':
      if (Array.isArray(rule.value)) {
        return rule.value.some((alt: any) => isPatternNullable(unwrapPattern(alt), nullable));
      }
      return isPatternNullable(unwrapPattern(rule.value), nullable);
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
      rule.type === 'zeroOrMore' || 
      rule.type === 'oneOrMore'
    ) {
      if (Array.isArray(rule.value)) {
        for (const alt of rule.value) {
          const unwrapped = unwrapPattern(alt);
          if (unwrapped instanceof SyntaxElement) {
            referenced.add(unwrapped);
          }
        }
      } else {
        const unwrapped = unwrapPattern(rule.value);
        if (unwrapped instanceof SyntaxElement) {
          referenced.add(unwrapped);
        }
      }
    } else if (
      rule.type === 'optional' ||
      rule.type === 'leadingTrivia' ||
      rule.type === 'trailingTrivia' ||
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
      } else if (rule.type === 'choice' || rule.type === 'zeroOrMore' || rule.type === 'oneOrMore') {
        if (Array.isArray(rule.value)) {
          for (const choice of rule.value) {
            if (choice instanceof SyntaxElement) {
              visit(choice);
            }
          }
        } else if (rule.value instanceof SyntaxElement) {
          visit(rule.value);
        }
      } else if (
        rule.type === 'optional' ||
        rule.type === 'leadingTrivia' ||
        rule.type === 'trailingTrivia' ||
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

  // Check for unbalanced default trivia rules
  const hasLeading = !!SyntaxElement.defaultLeadingTrivia;
  const hasTrailing = !!SyntaxElement.defaultTrailingTrivia;

  // Find if they have explicitly added LeadingTrivia() or TrailingTrivia() to explicitly consume boundaries
  const hasExplicitLeading = elements.some(el => el.rules.some(r => r.type === 'leadingTrivia'));
  const hasExplicitTrailing = elements.some(el => el.rules.some(r => r.type === 'trailingTrivia'));

  if (hasLeading && !hasTrailing && !hasExplicitLeading) {
    const warningMsg = "Unbalanced trivia warning: DefaultLeadingTrivia is defined but DefaultTrailingTrivia is not. Since trailing trivia is never used, the last trivia at the ending of the token (if it exists) is never consumed.";
    console.warn(warningMsg);
    diagnostics.push({
      type: "warning",
      nodeName: "Global (" + rootElement.name + ")",
      message: warningMsg,
      suggestion: "To consume the final trailing whitespace/comments explicitly, either define DefaultTrailingTrivia, or add an explicit root.LeadingTrivia(...) at the end of your root element sequence."
    });
  } else if (!hasLeading && hasTrailing && !hasExplicitTrailing) {
    const warningMsg = "Unbalanced trivia warning: DefaultTrailingTrivia is defined but DefaultLeadingTrivia is not. The first leading trivia preceding your first token will never satisfy the leading/trailing patterns and is never automatically consumed.";
    console.warn(warningMsg);
    diagnostics.push({
      type: "warning",
      nodeName: "Global (" + rootElement.name + ")",
      message: warningMsg,
      suggestion: "To consume the starting leading whitespace/comments explicitly, either define DefaultLeadingTrivia, or add an explicit root.TrailingTrivia(...) at the start of your root element sequence."
    });
  }

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
        // Warning check for Token() wrappers when used inside ExpectsOneOf
        if (rule.hasTokenWarning) {
          diagnostics.push({
            type: "warning",
            nodeName: elName,
            message: `Mixed Token wrapper inside ExpectsOneOf: Calling ExpectsOneOf with Token(...) wrapping individual choices runs with trivia rules on the parent block instead. This causes non-Token choices to unexpectedly parse with trivas too.`,
            suggestion: `Avoid wrapping choice alternatives of ExpectsOneOf inside Token(). Instead, call root.ExpectsOneOfToken(...) to explicitly match any choice branch with default leading and trailing trivas.`
          });
        }

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
      } else if (rule.type === 'zeroOrMore' || rule.type === 'oneOrMore') {
        if (rule.hasTokenWarning) {
          diagnostics.push({
            type: "warning",
            nodeName: elName,
            message: `Mixed Token wrapper inside ${rule.type === 'zeroOrMore' ? 'ZeroOrMore' : 'OneOrMore'}: Calling ${rule.type === 'zeroOrMore' ? 'ZeroOrMore' : 'OneOrMore'} with Token(...) wrapping individual elements runs with trivia rules on the parent block instead. This causes non-Token elements to unexpectedly parse with trivas too.`,
            suggestion: `Avoid wrapping option elements of ${rule.type === 'zeroOrMore' ? 'ZeroOrMore' : 'OneOrMore'} inside Token(). Instead, call root.${rule.type === 'zeroOrMore' ? 'ZeroOrMoreToken' : 'OneOrMoreToken'}(...) to explicitly match elements with default leading and trailing trivas per match.`
          });
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
          if (rule.type === 'choice') {
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
                suggestion: `To prevent parser lockup or eating the close delimiter, refine your body pattern (e.g. use [^${delimStr}] instead of wildcard matching), balance it using BeginScope/EndScope helpers on nested elements, or prefix your body block with a negative lookahead "Not(Token('${delimStr}'))" guard.`
              });
            }
          }
        }
      }
    }

    // New Custom Checking: Unreachable rules after EOF
    const eofIndex = el.rules.findIndex(r => r.type === 'eof');
    if (eofIndex !== -1 && eofIndex < el.rules.length - 1) {
      diagnostics.push({
        type: "warning",
        nodeName: elName,
        message: "Unreachable grammar rules: There are rules defined after an EOF rule. Since the parser terminates at EOF, these rules will never match.",
        suggestion: "Place the EOF rule at the very end of your sequence, or move the unreachable rules before the EOF expectation."
      });
    }

    // New Custom Checking: Consecutive / Contradictory Lookaheads (Not & Assert)
    for (let i = 0; i < el.rules.length - 1; i++) {
      const currentRule = el.rules[i];
      const nextRule = el.rules[i + 1];

      if (
        (currentRule.type === 'not' || currentRule.type === 'assert') &&
        (nextRule.type === 'not' || nextRule.type === 'assert')
      ) {
        const eq = arePatternsEquivalent(currentRule.value, nextRule.value);
        if (eq) {
          if (currentRule.type === nextRule.type) {
            diagnostics.push({
              type: "warning",
              nodeName: elName,
              message: `Redundant consecutive lookaheads: Consecutive '${currentRule.type === 'not' ? 'Not' : 'Assert'}' rules verify the same pattern. The second is completely redundant.`,
              suggestion: "Remove the duplicate lookahead rule to simplify the grammar and improve parsing performance."
            });
          } else {
            diagnostics.push({
              type: "warning",
              nodeName: elName,
              message: `Contradictory consecutive lookaheads: Consecutive '${currentRule.type === 'not' ? 'Not' : 'Assert'}' and '${nextRule.type === 'not' ? 'Not' : 'Assert'}' rules check the same pattern at the same offset. This sequence will always fail.`,
              suggestion: "Confirm your lookahead logic. A pattern cannot be both present and absent at the exact same location in the input string."
            });
          }
        }
      }
    }

    // New Custom Checking: Infinite loops inside loops (ZeroOrMore, OneOrMore)
    for (const rule of el.rules) {
      if (rule.type === 'zeroOrMore' || rule.type === 'oneOrMore') {
        const unwrapped = unwrapPattern(rule.value);
        let isNullable = false;
        
        if (Array.isArray(unwrapped)) {
          isNullable = unwrapped.every(p => isPatternNullable(p, nullable));
        } else {
          isNullable = isPatternNullable(unwrapped, nullable);
        }

        if (isNullable) {
          diagnostics.push({
            type: "warning",
            nodeName: elName,
            message: `Potential infinite loop: Loop rule ('${rule.type}') contains a nullable pattern. It can match empty input repeatedly without consuming characters, causing parser lockup.`,
            suggestion: "Ensure the pattern inside the loop is not nullable (i.e. it must match at least one character) to prevent the parser from freezing."
          });
        }

        // Check if the loop inner consists entirely of lookaheads or assertions:
        const isLookahead = (val: any): boolean => {
          if (!val) return false;
          if (Array.isArray(val)) {
            return val.some(isLookahead);
          }
          if (val instanceof SyntaxElement) {
            return val.rules && val.rules.length > 0 && val.rules.every(r => r.type === 'not' || r.type === 'assert');
          }
          return false;
        };

        if (isLookahead(unwrapped)) {
          diagnostics.push({
            type: "warning",
            nodeName: elName,
            message: `Infinite loop hazard: Loop rule ('${rule.type}') contains lookahead/assertion rules. Since lookaheads do not consume input, this loop will repeat infinitely.`,
            suggestion: "Avoid invoking lookaheads ('Not' or 'Assert') as the main repeating elements of a loop since they do not consume characters."
          });
        }
      }
    }

    // New Custom Checking: Duplicate choices & Lookahead inside choices
    for (const rule of el.rules) {
      if (rule.type === 'choice') {
        const choiceList = rule.value;
        if (Array.isArray(choiceList)) {
          const seen = new Set<string>();
          for (const choice of choiceList) {
            const unwrapped = unwrapPattern(choice);
            let repr = "";
            if (typeof unwrapped === 'string') {
              repr = `literal:${unwrapped}`;
            } else if (unwrapped instanceof RegExp) {
              repr = `regex:${unwrapped.source}`;
            } else if (unwrapped instanceof SyntaxElement) {
              repr = `element:${unwrapped.name}`;
            } else if (unwrapped && typeof unwrapped === 'object' && 'pattern' in unwrapped) {
              repr = `token:${JSON.stringify(unwrapped)}`;
            }

            if (repr) {
              if (seen.has(repr)) {
                diagnostics.push({
                  type: "warning",
                  nodeName: elName,
                  message: `Duplicate alternative: The choice list contains a duplicate entry for "${repr.split(':')[1]}".`,
                  suggestion: "Remove the duplicate choice from the alternative list since it is redundant and can never be reached."
                });
              } else {
                seen.add(repr);
              }
            }

            // Lookahead inside choice suggestion
            if (unwrapped instanceof SyntaxElement) {
              const isPureLookahead = unwrapped.rules && unwrapped.rules.length > 0 && unwrapped.rules.every(r => r.type === 'not' || r.type === 'assert');
              if (isPureLookahead) {
                diagnostics.push({
                  type: "warning",
                  nodeName: elName,
                  message: `Lookahead inside choice alternative: Option "${unwrapped.name}" is a pure lookahead/assertion node.`,
                  suggestion: "Having zero-width lookahead components inside choice alternatives can lead to surprising behavior since they succeed without consuming characters, potentially masking other valid branches. Place lookaheads outside the choice expression instead."
                });
              }
            }
          }
        }
      }
    }

    // New Custom Checking: Performance suggestions / Info diagnostics
    for (const rule of el.rules) {
      if (rule.type === 'choice') {
        const choiceList = rule.value;
        if (Array.isArray(choiceList)) {
          // Large choice lists warning/info
          if (choiceList.length >= 8) {
            diagnostics.push({
              type: "info",
              nodeName: elName,
              message: `Large target alternatives: Choice rule has ${choiceList.length} different options.`,
              suggestion: "Having many nested alternatives can slow down parsing. Consider ordering them by probability of occurrence (most common first) to speed up matching, or grouping them with common prefixes."
            });
          }

          // Non-sorted literals check & prefix masking warnings
          const stringChoicesWithIndices = choiceList
            .map((c, index) => ({ value: unwrapPattern(c), index }))
            .filter(item => typeof item.value === 'string') as { value: string, index: number }[];

          let hasMaskingWarning = false;
          for (let i = 0; i < stringChoicesWithIndices.length; i++) {
            for (let j = i + 1; j < stringChoicesWithIndices.length; j++) {
              const shorter = stringChoicesWithIndices[i];
              const longer = stringChoicesWithIndices[j];
              if (longer.value.startsWith(shorter.value) && shorter.value !== longer.value) {
                diagnostics.push({
                  type: "warning",
                  nodeName: elName,
                  message: `Greedy match masking: The choice alternative '${shorter.value}' (index ${shorter.index}) is a prefix of '${longer.value}' (index ${longer.index}). The parser will always match the shorter prefix and fail to recognize the longer option.`,
                  suggestion: `Move the longer option '${longer.value}' before the shorter prefix '${shorter.value}' in the ExpectsOneOf list.`
                });
                hasMaskingWarning = true;
              }
            }
          }



          // Single choice rule check
          if (choiceList.length === 1) {
            diagnostics.push({
              type: "info",
              nodeName: elName,
              message: "Trivial choice alternative: ExpectsOneOf is used with only 1 choice option.",
              suggestion: "Simplify your rule definition by replacing ExpectsOneOf with a direct Expects() call."
            });
          }
        }
      }
    }
  }

  return diagnostics;
}
