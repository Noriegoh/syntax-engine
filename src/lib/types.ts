/**
 * Core types and utilities for SyntaxEngine.
 */

export type RuleType = 'literal' | 'regex' | 'element' | 'not' | 'whitespace' | 'choice' | 'optional' | 'zeroOrMore' | 'oneOrMore' | 'eof';

let lastRuleId = 0;
export function nextRuleId(): number {
  return ++lastRuleId;
}

export interface Rule {
  id: number;
  type: RuleType;
  value?: any;
}

export interface ParseError {
  message: string;
  offset: number;
}

export interface ParseResult {
  ast: any;
  newOffset: number;
  error?: string;
  ruleId?: number;
  recoveredErrors?: ParseError[];
  astDelta?: number;
  dependencyLimit?: number;
}

const stickyCache = new WeakMap<RegExp, RegExp>();

export function matchRegex(pattern: RegExp, text: string, offset: number): string[] | null {
  let sticky = stickyCache.get(pattern);
  if (sticky === undefined) {
    let source = pattern.source;
    if (source.startsWith('^')) {
      source = source.slice(1);
    }
    let flags = pattern.flags;
    if (!flags.includes('y')) {
      flags += 'y';
    }
    try {
      sticky = new RegExp(source, flags);
      stickyCache.set(pattern, sticky);
    } catch (e) {
      sticky = null;
    }
  }

  if (sticky) {
    sticky.lastIndex = offset;
    const match = sticky.exec(text);
    if (match) {
      return match;
    }
    return null;
  }

  // Fallback
  const remaining = text.slice(offset);
  const source = pattern.source.startsWith('^') ? pattern.source : '^(?:' + pattern.source + ')';
  const anchoredRegex = new RegExp(source, pattern.flags);
  const match = remaining.match(anchoredRegex);
  return match;
}

export const WS_REGEX = /\s+/;

export function findDiff(oldStr: string, newStr: string): { editOffset: number; removedLength: number; insertedText: string } {
  let prefix = 0;
  while (prefix < oldStr.length && prefix < newStr.length && oldStr[prefix] === newStr[prefix]) {
    prefix++;
  }

  const oldSuffix = oldStr.slice(prefix);
  const newSuffix = newStr.slice(prefix);

  let oldLen = oldSuffix.length;
  let newLen = newSuffix.length;
  let suffix = 0;
  while (suffix < oldLen && suffix < newLen && oldSuffix[oldLen - 1 - suffix] === newSuffix[newLen - 1 - suffix]) {
    suffix++;
  }

  const removedLength = oldLen - suffix;
  const insertedText = newSuffix.slice(0, newLen - suffix);

  return {
    editOffset: prefix,
    removedLength,
    insertedText
  };
}

export function shiftASTOffsets(ast: any, delta: number): any {
  if (!ast || typeof ast !== 'object') return ast;
  if (Array.isArray(ast)) {
    return ast.map(item => shiftASTOffsets(item, delta));
  }
  const shifted = { ...ast };
  if (typeof shifted.start === 'number') shifted.start += delta;
  if (typeof shifted.end === 'number') shifted.end += delta;
  if (typeof shifted.deepestOffset === 'number') shifted.deepestOffset += delta;
  
  if (shifted.value !== undefined) {
    if (Array.isArray(shifted.value)) {
      shifted.value = shifted.value.map((v: any) => shiftASTOffsets(v, delta));
    } else {
      shifted.value = shiftASTOffsets(shifted.value, delta);
    }
  }
  return shifted;
}
