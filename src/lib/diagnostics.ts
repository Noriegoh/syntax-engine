import { SyntaxElement, RuleHelper } from "./syntax-element";
import { isSimpleCaseInsensitiveRegex, matchRegex } from "./utils";

export interface Diagnostic {
  type: "error" | "warning" | "info";
  nodeName: string;
  message: string;
  suggestion: string;
}

// Local helper functions moved to SyntaxElement in syntax-element.ts for decoupling
function unwrapPattern(p: any): any {
  return SyntaxElement.unwrapPattern(p);
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
        const visitPattern = (p: any) => {
          if (p instanceof SyntaxElement) {
            visit(p);
          } else if (Array.isArray(p)) {
            p.forEach(visitPattern);
          }
        };
        visitPattern(rule.value.item);
        visitPattern(rule.value.separator);
      }
    }
  }

  visit(rootElement);

  // Compute callers mapped for element analysis
  const callers = new Map<SyntaxElement, Set<SyntaxElement>>();
  for (const el of elements) {
    callers.set(el, new Set<SyntaxElement>());
  }

  function addCaller(target: any, caller: SyntaxElement) {
    if (!target) return;
    if (target instanceof SyntaxElement) {
      callers.get(target)?.add(caller);
    } else if (Array.isArray(target)) {
      for (const item of target) {
        addCaller(item, caller);
      }
    } else if (typeof target === 'object') {
      if ('pattern' in target) {
        addCaller(target.pattern, caller);
      }
      if ('item' in target) {
        addCaller(target.item, caller);
      }
      if ('separator' in target) {
        addCaller(target.separator, caller);
      }
    }
  }

  for (const el of elements) {
    for (const rule of el.rules) {
      if (rule.type === 'element') {
        addCaller(rule.value, el);
      } else if (rule.type === 'choice' || rule.type === 'zeroOrMore' || rule.type === 'oneOrMore') {
        addCaller(rule.value, el);
      } else if (
        rule.type === 'optional' ||
        rule.type === 'leadingTrivia' ||
        rule.type === 'trailingTrivia' ||
        rule.type === 'not' ||
        rule.type === 'assert' ||
        rule.type === 'beginScope' ||
        rule.type === 'endScope'
      ) {
        addCaller(rule.value, el);
      } else if (rule.type === 'separatedBy' && rule.value) {
        addCaller(rule.value.item, el);
        addCaller(rule.value.separator, el);
      }
    }
  }

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
          if (!SyntaxElement.isRuleNullable(rule, nullable)) {
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

      const nextElements = current.getFirstReachableElements(nullable);
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
        suggestion: "Add rules using expects, oneof, token, or other expectation methods in your grammar builder."
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
        // Warning check for LiteralMatch() wrappers when used inside OneOff
        if (rule.hasLiteralMatchWarning) {
          diagnostics.push({
            type: "warning",
            nodeName: elName,
            message: `Mixed LiteralMatch wrapper inside OneOff: Calling OneOff with LiteralMatch(...) wrapping individual choices runs with trivia rules on the parent block instead. This causes non-strict choices to unexpectedly parse with trivas too.`,
            suggestion: `Avoid wrapping choice alternatives of OneOff inside LiteralMatch(). Instead, call root.OneOffToken(...) to explicitly match any choice branch with default leading and trailing trivas.`
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
        if (rule.hasLiteralMatchWarning) {
          diagnostics.push({
            type: "warning",
            nodeName: elName,
            message: `Mixed LiteralMatch wrapper inside ${rule.type === 'zeroOrMore' ? 'ZeroOrMore' : 'OneOrMore'}: Calling ${rule.type === 'zeroOrMore' ? 'ZeroOrMore' : 'OneOrMore'} with LiteralMatch(...) wrapping individual elements runs with trivia rules on the parent block instead. This causes non-strict elements to unexpectedly parse with trivas too.`,
            suggestion: `Avoid wrapping option elements of ${rule.type === 'zeroOrMore' ? 'ZeroOrMore' : 'OneOrMore'} inside LiteralMatch(). Instead, call root.${rule.type === 'zeroOrMore' ? 'ZeroOrMoreToken' : 'OneOrMoreToken'}(...) to explicitly match elements with default leading and trailing trivas per match.`
          });
        }
        if (rule.value instanceof SyntaxElement) {
          const innerEl = rule.value;
          const structuralRules = innerEl.rules.filter(r => !['leadingTrivia', 'trailingTrivia', 'nodeName', 'fieldName'].includes(r.type as string));
          if (structuralRules.length === 1 && structuralRules[0].type === 'choice') {
            diagnostics.push({
              type: "info",
              nodeName: elName,
              message: `Redundant OneOff wrapper inside ${rule.type === 'zeroOrMore' ? 'ZeroOrMore' : 'OneOrMore'}.`,
              suggestion: `Use ${rule.type === 'zeroOrMore' ? 'ZeroOrMore' : 'OneOrMore'} directly, as it supports arrays and multiple arguments natively. E.g. ${rule.type === 'zeroOrMore' ? '.ZeroOrMore(rule1, rule2)' : '.OneOrMore(rule1, rule2)'} rather than ${rule.type === 'zeroOrMore' ? '.ZeroOrMore(new SyntaxElement(...).OneOff(rule1, rule2))' : '.OneOrMore(new SyntaxElement(...).OneOff(rule1, rule2))'}.`
            });
          }
        }
      }
    }

    // Rule D: Regex inside an Enum-mapped SyntaxElement (Warning)
    if (el.isEnumTarget) {
      let notLiteral = false;
      let regexPattern = "";
      for (const rule of el.rules) {
        if (!RuleHelper.isLiteral(rule)) {
          notLiteral = true;
          regexPattern = String(rule.value);
        } else if (rule.type === 'choice') {
          const choiceList = rule.value;
          if (Array.isArray(choiceList)) {
            for (const c of choiceList) {
              if (c instanceof RegExp) {
                notLiteral = true;
                regexPattern = String(c);
                break;
              }
            }
          }
        }
      }

      if (notLiteral) {
        diagnostics.push({
          type: "warning",
          nodeName: elName,
          message: `Enum-mapped element contains a non-literal rule "${regexPattern}".`,
          suggestion: "Enums should strictly represent constant string keywords. Consider separating the rule into its own Node (e.g. ExpectsOneOf(builtin_type, custom_identifier))."
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
        const eq = SyntaxElement.arePatternsEquivalent(currentRule.value, nextRule.value);
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
        const unwrapped = SyntaxElement.unwrapPattern(rule.value);

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
          let hasDuplicateWarning = false;
          for (const choice of choiceList) {
            const unwrapped = unwrapPattern(choice);
            let repr = "";
            if (typeof unwrapped === 'string') {
              repr = `literal:${unwrapped}`;
            } else if (unwrapped instanceof RegExp) {
              repr = `regex:${unwrapped.source}`;
            } else if (unwrapped instanceof SyntaxElement) {
              repr = `element:${unwrapped.name}`;
            } else if (unwrapped && typeof unwrapped === 'object') {
              let innerRepr = "";
              if ('pattern' in unwrapped) {
                const subP = (unwrapped as any).pattern;
                innerRepr += `pattern:${subP instanceof RegExp ? subP.source : typeof subP === 'string' ? "str:"+subP : "obj"}`;
              }
              if ('literal' in unwrapped) {
                const subL = (unwrapped as any).literal;
                innerRepr += `literal:${subL instanceof RegExp ? subL.source : typeof subL === 'string' ? "str:"+subL : "obj"}`;
              }
              repr = `token:${innerRepr}`;
            }

            if (repr) {
              if (seen.has(repr)) {
                if (!hasDuplicateWarning) {
                  let disp = repr;
                  if (repr.startsWith("literal:")) disp = repr.slice(8);
                  else if (repr.startsWith("regex:")) disp = repr.slice(6);
                  else if (repr.startsWith("element:")) disp = repr.slice(8);
                  else if (repr.startsWith("token:")) disp = repr.slice(6);

                  diagnostics.push({
                    type: "warning",
                    nodeName: elName,
                    message: `Duplicate alternative: The choice list contains a duplicate entry for "${disp}".`,
                    suggestion: "Remove the duplicate choice from the alternative list since it is redundant and can never be reached."
                  });
                  hasDuplicateWarning = true;
                }
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
          // Non-sorted literals check & prefix masking warnings
          const stringChoicesWithIndices = choiceList
            .map((c, index) => ({ value: unwrapPattern(c), index }))
            .filter(item => typeof item.value === 'string') as { value: string, index: number }[];

          for (let i = 0; i < stringChoicesWithIndices.length; i++) {
            for (let j = i + 1; j < stringChoicesWithIndices.length; j++) {
              const shorter = stringChoicesWithIndices[i];
              const longer = stringChoicesWithIndices[j];
              if (longer.value.startsWith(shorter.value) && shorter.value !== longer.value) {
                diagnostics.push({
                  type: "warning",
                  nodeName: elName,
                  message: `Greedy match masking: The choice alternative '${shorter.value}' (index ${shorter.index}) is a prefix of '${longer.value}' (index ${longer.index}). The parser will always match the shorter prefix and fail to recognize the longer option.`,
                  suggestion: `Move the longer option '${longer.value}' before the shorter prefix '${shorter.value}' in the OneOff list.`
                });
              }
            }
          }



          // Single choice rule check
          if (choiceList.length === 1) {
            diagnostics.push({
              type: "info",
              nodeName: elName,
              message: "Trivial choice alternative: OneOff is used with only 1 choice option.",
              suggestion: "Simplify your rule definition by replacing OneOff with a direct Expects() call."
            });
          }
        }
      }
    }

    // Rule 3: Loop rule cannot target inlined element
    for (const rule of el.rules) {
      if (rule.type === 'zeroOrMore' || rule.type === 'oneOrMore') {
        const unwrapped = unwrapPattern(rule.value);
        const checkTargetInlined = (p: any) => {
          if (p instanceof SyntaxElement && p.isHiddenElement) {
            diagnostics.push({
              type: "error",
              nodeName: elName,
              message: `Loop rule '${rule.type}' cannot target inlined element "${p.name}".`,
              suggestion: `An inlined rule cannot be processed under loops since it flattens multiple parsed items at once. Remove .Inline() from "${p.name}".`
            });
          }
        };
        if (Array.isArray(unwrapped)) {
          unwrapped.forEach(checkTargetInlined);
        } else {
          checkTargetInlined(unwrapped);
        }
      } else if (rule.type === 'separatedBy' && rule.value) {
        const checkTargetInlined = (p: any, role: string) => {
          if (p instanceof SyntaxElement && p.isHiddenElement) {
            diagnostics.push({
              type: "error",
              nodeName: elName,
              message: `SeparatedBy list rule cannot use inlined element "${p.name}" as ${role}.`,
              suggestion: `An inlined rule cannot be processed under loops since it flattens multiple parsed items at once. Remove .Inline() from "${p.name}".`
            });
          }
        };
        const checkItem = (itemPat: any) => {
          const unwrapped = unwrapPattern(itemPat);
          if (Array.isArray(unwrapped)) {
            unwrapped.forEach(p => checkTargetInlined(p, "list item"));
          } else {
            checkTargetInlined(unwrapped, "list item");
          }
        };
        checkItem(rule.value.item);
        checkTargetInlined(unwrapPattern(rule.value.separator), "separator");
      }
    }

    // Rule 4: Suggest ignoring if exactly one caller
    if (!el.isHiddenElement && el !== rootElement) {
      const elCallers = callers.get(el);
      if (elCallers && elCallers.size === 1) {
        const parent = Array.from(elCallers)[0];

        let parentUsesInLoop = false;
        for (const rule of parent.rules) {
          if (rule.type === 'zeroOrMore' || rule.type === 'oneOrMore' || rule.type === 'choice') {
            const unwrapped = unwrapPattern(rule.value);
            const isTarget = (p: any): boolean => p === el || (Array.isArray(p) && p.includes(el));
            if (isTarget(unwrapped)) {
              parentUsesInLoop = true;
            }
          } else if (rule.type === 'separatedBy' && rule.value) {
            const isTarget = (p: any): boolean => {
              const unwrapped = unwrapPattern(p);
              return unwrapped === el || (Array.isArray(unwrapped) && unwrapped.includes(el));
            };
            if (isTarget(rule.value.item) || isTarget(rule.value.separator)) {
              parentUsesInLoop = true;
            }
          } else if(rule.type == 'optional')
          {
            parentUsesInLoop=true;
          }
        }

        if (!parentUsesInLoop) {
          diagnostics.push({
            type: "info",
            nodeName: elName,
            message: `Rule "${elName}" has exactly one caller ("${parent.name}").`,
            suggestion: `To optimize parsing performance and simplify generated code, consider ignoring/inlining it by appending .Inline() to its definition.`
          });
        }
      }
    }

    // Custom check: Consecutive LiteralMatch rules
    const structuralRules = el.structuralRules;

    for (let i = 0; i < structuralRules.length - 1; i++) {
      const r1 = structuralRules[i];
      const r2 = structuralRules[i + 1];
      const isR1Strict = r1.type === 'literalMatch' || r1.type === 'caseInsensitiveLiteralMatch';
      const isR2Strict = r2.type === 'literalMatch' || r2.type === 'caseInsensitiveLiteralMatch';
      if (isR1Strict && isR2Strict) {
        const p1 = r1.type === 'literalMatch' ? r1.value?.literal : r1.value?.pattern;
        const p2 = r2.type === 'literalMatch' ? r2.value?.literal : r2.value?.pattern;
        diagnostics.push({
          type: "warning",
          nodeName: elName,
          message: `Consecutive LiteralMatch warning: A literal match rule for "${p1}" is placed directly adjacent to another literal match rule for "${p2}".`,
          suggestion: "Only the boundary word/keyword adjacent to an identifier usually needs to perform a strict-literal check. Placing consecutive literal matchs can be redundant or logically incorrect. Combine them if they form a single token, or use standard Token/literal rules."
        });
      }
    }

    // New Custom Checking: LiteralMatch usage and boundary/character set overlapping triggers
    for (let i = 0; i < el.rules.length; i++) {
      const rule = el.rules[i];
      if (rule.type === 'literalMatch' || rule.type === 'caseInsensitiveLiteralMatch') {
        const literal = rule.value?.literal;
        const pattern = rule.value?.pattern;

        if (literal && pattern instanceof RegExp) {
          const prevRule = el.rules[i - 1];
          const nextRule = el.rules[i + 1];
          const isTokenized = prevRule?.type === 'leadingTrivia' && nextRule?.type === 'trailingTrivia';

          if (!isTokenized) {
            diagnostics.push({
              type: "warning",
              nodeName: elName,
              message: `LiteralMatch without Token wrapper: LiteralMatch for "${literal}" is used directly on the SyntaxElement chain without parsing/skipping layout trivia. Whitespaces and comments preceding or succeeding "${literal}" won't be parsed correctly.`,
              suggestion: `Wrap key phrases/boundary matchers in a Token: use .Token(LiteralMatch(/${literal}/i, id_exp)) or .LiteralMatch(Token(/${literal}/i, id_exp)) to handle trivias.`
            });
          }

          // Compute starting idx of subsequent rules in the sequence
          const nextIdx = isTokenized ? i + 2 : i + 1;

          // Collect all subsequent rules in the current element sequence
          // ignoring standard trivia rules for cleaner matching
          const subsequentRules = el.rules.slice(nextIdx).filter(r => r.type !== 'leadingTrivia' && r.type !== 'trailingTrivia');

          if (subsequentRules.length > 0) {
            // Find the first structural rule
            const firstSubsequent = subsequentRules[0];
            const nextTriggers = getStartingPatterns(firstSubsequent);
            const overlaps = nextRuleOverlapsBoundary(nextTriggers, pattern, literal);

            if (!overlaps) {
              diagnostics.push({
                type: "info",
                nodeName: elName,
                message: `Avoid unnecessary boundary checks: The next rule starts with triggers [${nextTriggers.strings.slice(0, 3).map(s => `"${s}"`).join(", ")}${nextTriggers.strings.length > 3 ? ", ..." : ""}] which do NOT match the identifier boundary /^[a-zA-Z_]/. Since they cannot blend, a full LiteralMatch is redundant here.`,
                suggestion: `Simplify the parser and speed up matching by replacing this rule with a direct token call, like .Token(/${literal}/i) or .Token("${literal}").`
              });
            }
          }
        }
      }
    }
  }

  return diagnostics;
}

function getStartingPatterns(ruleValue: any, visited = new Set<any>()): { strings: string[], regexes: RegExp[] } {
  const result: { strings: string[], regexes: RegExp[] } = { strings: [], regexes: [] };
  if (!ruleValue) return result;
  if (visited.has(ruleValue)) return result;
  visited.add(ruleValue);

  const unwrapped = SyntaxElement.unwrapPattern(ruleValue);
  if (unwrapped instanceof SyntaxElement) {
    for (const r of unwrapped.rules) {
      if ((r.type as string) === 'leadingTrivia' || (r.type as string) === 'trailingTrivia') continue;
      const sub = getStartingPatterns(r, visited);
      result.strings.push(...sub.strings);
      result.regexes.push(...sub.regexes);
      if (r.type !== 'optional' && r.type !== 'zeroOrMore' && (r.type as string) !== 'leadingTrivia' && (r.type as string) !== 'trailingTrivia') {
        break;
      }
    }
  } else if (Array.isArray(unwrapped)) {
    for (const item of unwrapped) {
      const sub = getStartingPatterns(item, visited);
      result.strings.push(...sub.strings);
      result.regexes.push(...sub.regexes);
    }
  } else if (typeof unwrapped === 'string') {
    result.strings.push(unwrapped);
  } else if (unwrapped instanceof RegExp) {
    if (isSimpleCaseInsensitiveRegex(unwrapped)) {
      result.strings.push(unwrapped.source);
    } else {
      result.regexes.push(unwrapped);
    }
  } else if (typeof unwrapped === 'object' && unwrapped !== null) {
    if ('type' in unwrapped) {
      const type = unwrapped.type;
      const value = unwrapped.value;
      if (type === 'literal' || type === 'beginScope' || type === 'endScope') {
        if (typeof value === 'string') {
          result.strings.push(value);
        } else if (value instanceof RegExp) {
          if (isSimpleCaseInsensitiveRegex(value)) {
            result.strings.push(value.source);
          } else {
            result.regexes.push(value);
          }
        } else if (value instanceof SyntaxElement) {
          const sub = getStartingPatterns(value, visited);
          result.strings.push(...sub.strings);
          result.regexes.push(...sub.regexes);
        }
      } else if (type === 'literalMatch' || type === 'caseInsensitiveLiteralMatch') {
        if (value && typeof value === 'object') {
          if (value.literal) result.strings.push(value.literal);
        }
      } else if (type === 'regex' || type === 'caseInsensitiveLiteral') {
        if (value instanceof RegExp) {
          if (isSimpleCaseInsensitiveRegex(value)) {
            result.strings.push(value.source);
          } else {
            result.regexes.push(value);
          }
        }
      } else if (type === 'choice' || type === 'zeroOrMore' || type === 'oneOrMore') {
        const sub = getStartingPatterns(value, visited);
        result.strings.push(...sub.strings);
        result.regexes.push(...sub.regexes);
      } else if (type === 'optional' || type === 'not' || type === 'assert') {
        const sub = getStartingPatterns(value, visited);
        result.strings.push(...sub.strings);
        result.regexes.push(...sub.regexes);
      } else if (type === 'element') {
        const sub = getStartingPatterns(value, visited);
        result.strings.push(...sub.strings);
        result.regexes.push(...sub.regexes);
      } else if (type === 'separatedBy' && value) {
        if (value.allowLeading) {
          const subSep = getStartingPatterns(value.separator, visited);
          result.strings.push(...subSep.strings);
          result.regexes.push(...subSep.regexes);
        }
        const subItem = getStartingPatterns(value.item, visited);
        result.strings.push(...subItem.strings);
        result.regexes.push(...subItem.regexes);
      }
    } else if ('literal' in unwrapped && 'pattern' in unwrapped) {
      if (typeof unwrapped.literal === 'string') {
        result.strings.push(unwrapped.literal);
      } else if (unwrapped.literal instanceof RegExp) {
        if (isSimpleCaseInsensitiveRegex(unwrapped.literal)) {
          result.strings.push(unwrapped.literal.source);
        } else {
          result.regexes.push(unwrapped.literal);
        }
      }
    } else if ('__isTokenMarker' in unwrapped && unwrapped.pattern) {
      const sub = getStartingPatterns(unwrapped.pattern, visited);
      result.strings.push(...sub.strings);
      result.regexes.push(...sub.regexes);
    }
  }

  return result;
}

function canCharBlend(literal: string, char: string, boundaryRegex: RegExp): boolean {
  const testStr = literal + char;
  const match = matchRegex(boundaryRegex, testStr, 0);
  if (match && match[0].length > literal.length) {
    return true;
  }
  return false;
}

function nextRuleOverlapsBoundary(nextTriggers: { strings: string[], regexes: RegExp[] }, boundaryRegex: RegExp, literal: string): boolean {
  for (const s of nextTriggers.strings) {
    if (s.length > 0) {
      if (canCharBlend(literal, s.charAt(0), boundaryRegex)) {
        return true;
      }
    }
  }
  const sampleChars = ["a", "z", "A", "Z", "0", "9", "_"];
  for (const r of nextTriggers.regexes) {
    for (const char of sampleChars) {
      if (r.test(char) && canCharBlend(literal, char, boundaryRegex)) {
        return true;
      }
    }
  }
  return false;
}
