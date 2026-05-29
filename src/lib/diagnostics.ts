import { SyntaxElement } from "./syntax-element";

export interface Diagnostic {
  type: "error" | "warning" | "info";
  nodeName: string;
  message: string;
  suggestion: string;
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
      } else if (rule.type === 'choice') {
        for (const choice of rule.value) {
          if (choice instanceof SyntaxElement) {
            visit(choice);
          }
        }
      } else if (
        rule.type === 'optional' ||
        rule.type === 'leadingTrivia' ||
        rule.type === 'trailingTrivia' ||
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

  visit(rootElement);

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
  }

  return diagnostics;
}
