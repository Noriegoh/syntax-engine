/**
 * Core engine for the SyntaxEngine Workbench.
 * Implements a scannerless parser with a fluent API.
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

function matchRegex(pattern: RegExp, text: string, offset: number): string[] | null {
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

const WS_REGEX = /\s+/;

export class SyntaxElement {
  id: number;
  name: string;
  rules: Rule[];
  isHidden: boolean = false;
  precedence: number = 0;
  recoveryPatterns?: (string | RegExp | SyntaxElement)[];
  isAutoHealing: boolean = false;
  autoHealingBoundaries?: (string | RegExp | SyntaxElement)[];

  constructor(name: string = "anonymous") {
    this.id = nextRuleId();
    this.name = name;
    this.rules = [];
  }

  Prec(level: number): this {
    this.precedence = level;
    return this;
  }

  Hide(): this {
    this.isHidden = true;
    return this;
  }

  RecoverWith(...patterns: (string | RegExp | SyntaxElement)[]): this {
    this.recoveryPatterns = patterns;
    return this;
  }

  SelfHeals(...boundaries: (string | RegExp | SyntaxElement)[]): this {
    this.isAutoHealing = true;
    if (boundaries.length > 0) {
      this.autoHealingBoundaries = boundaries;
    }
    return this;
  }

  Expects(pattern: string | RegExp | SyntaxElement): this {
    const id = nextRuleId();
    if (pattern instanceof SyntaxElement) {
      this.rules.push({ id, type: 'element', value: pattern });
    } else if (pattern instanceof RegExp) {
      this.rules.push({ id, type: 'regex', value: pattern });
    } else {
      this.rules.push({ id, type: 'literal', value: pattern });
    }
    return this;
  }

  ExpectsWhitespace(): this {
    const id = nextRuleId();
    this.rules.push({ id, type: 'whitespace' });
    return this;
  }

  Unexpects(pattern: string | SyntaxElement): this {
    const id = nextRuleId();
    this.rules.push({ id, type: 'not', value: pattern });
    return this;
  }

  ExpectsOneOf(...patterns: (string | RegExp | SyntaxElement)[]): this {
    const id = nextRuleId();
    this.rules.push({ id, type: 'choice', value: patterns });
    return this;
  }

  Optional(pattern: string | RegExp | SyntaxElement): this {
    const id = nextRuleId();
    this.rules.push({ id, type: 'optional', value: pattern });
    return this;
  }

  ZeroOrMore(pattern: string | RegExp | SyntaxElement): this {
    const id = nextRuleId();
    this.rules.push({ id, type: 'zeroOrMore', value: pattern });
    return this;
  }

  OneOrMore(pattern: string | RegExp | SyntaxElement): this {
    const id = nextRuleId();
    this.rules.push({ id, type: 'oneOrMore', value: pattern });
    return this;
  }

  ExpectsEOF(): this {
    const id = nextRuleId();
    this.rules.push({ id, type: 'eof' });
    return this;
  }

  // Helper for walker/visualizer
  getHierarchy(visited = new Set<number>()): any {
    if (visited.has(this.id)) return { name: this.name, id: this.id, isLoop: true };
    const nextVisited = new Set(visited);
    nextVisited.add(this.id);
    
    return {
      id: this.id,
      name: this.name,
      precedence: this.precedence,
      rules: this.rules.map(r => {
        let val = r.value;
        if (r.type === 'choice') {
           val = (r.value as any[]).map(p => p instanceof SyntaxElement ? p.getHierarchy(nextVisited) : p);
        } else if (r.value instanceof SyntaxElement) {
           val = r.value.getHierarchy(nextVisited);
        }
        return {
          ...r,
          value: val
        };
      })
    };
  }

  private parsePattern(pattern: string | RegExp | SyntaxElement, text: string, currentOffset: number, memo: Map<string, ParseResult>, ruleId: number, context?: { maxOffset: number; maxError: ParseResult | null; expectedPaths: string[]; recoveredErrors: ParseError[] }) {
    if (pattern instanceof SyntaxElement) {
      const subResult = pattern.parse(text, currentOffset, memo, context);
      if (subResult && !subResult.error) {
        return { success: true, value: subResult.ast, newOffset: subResult.newOffset, skipped: pattern.isHidden, dependencyLimit: subResult.dependencyLimit !== undefined ? subResult.dependencyLimit : subResult.newOffset };
      } else {
        return { success: false, error: subResult?.error || `Failed sub-element: ${pattern.name}`, newOffset: subResult ? subResult.newOffset : currentOffset, dependencyLimit: subResult ? (subResult.dependencyLimit !== undefined ? subResult.dependencyLimit : subResult.newOffset) : currentOffset };
      }
    } else if (pattern instanceof RegExp) {
      const match = matchRegex(pattern, text, currentOffset);
      if (match) {
        return { success: true, value: { type: 'token', value: match[0], ruleId, start: currentOffset, end: currentOffset + match[0].length }, newOffset: currentOffset + match[0].length, dependencyLimit: currentOffset + match[0].length };
      } else {
        return { success: false, error: `Regex failed: ${pattern.source}`, newOffset: currentOffset, dependencyLimit: currentOffset + 1 };
      }
    } else {
      if (text.startsWith(pattern as string, currentOffset)) {
        return { success: true, value: { type: 'literal', value: pattern, ruleId, start: currentOffset, end: currentOffset + (pattern as string).length }, newOffset: currentOffset + (pattern as string).length, dependencyLimit: currentOffset + (pattern as string).length };
      } else {
        return { success: false, error: `Expected literal: ${pattern}`, newOffset: currentOffset, dependencyLimit: currentOffset + (pattern as string).length };
      }
    }
  }

  private handleFailure(text: string, currentOffset: number, ruleId: number, errorMsg: string, memo: Map<string, ParseResult>, ctx: any, hasCommitted: boolean, localMaxOffset: number): { action: 'break' | 'fail', err: ParseResult, res?: any, dependencyLimit: number } {
    let err = this.fail(errorMsg, currentOffset, ruleId, ctx);
    let currentLimit = localMaxOffset;

    // 1. Explicit recovery patterns if defined
    if (this.recoveryPatterns) {
      let shouldRecover = hasCommitted;
      if (!shouldRecover) {
        // Recover if we are inside a block list of statements without slicing (finding next non-whitespace char index)
        let nextCharIndex = currentOffset;
        while (nextCharIndex < text.length && /\s/.test(text[nextCharIndex])) {
          nextCharIndex++;
        }
        if (nextCharIndex < text.length) {
          const char = text[nextCharIndex];
          if (char !== '}' && char !== ')') {
            shouldRecover = true;
          }
        }
      }

      if (shouldRecover) {
        const r = this.attemptRecovery(text, currentOffset, this.recoveryPatterns, memo, ctx);
        if (r) {
          currentLimit = Math.max(currentLimit, r.dependencyLimit);
          const msg = `Syntax Error in ${this.name}: ${err.error} at offset ${currentOffset}. Recovered at offset ${r.newOffset}`;
          ctx.recoveredErrors.push({ message: msg, offset: currentOffset });
          const res = { type: 'error_node', message: msg, start: currentOffset, end: r.newOffset, deepestOffset: currentOffset };
          err.dependencyLimit = currentLimit;
          return { action: 'break', err, res: { newOffset: r.newOffset, node: res }, dependencyLimit: currentLimit };
        }
      }
    } 
    // 2. Fallback auto-recovery (self-healing) for elements explicitly designated as auto-healing
    else if (hasCommitted && this.isAutoHealing) {
      const fallbackPatterns = this.autoHealingBoundaries || ["}", ";", "\n"];
      const r = this.attemptRecovery(text, currentOffset, fallbackPatterns, memo, ctx);
      if (r && r.newOffset > currentOffset) {
        currentLimit = Math.max(currentLimit, r.dependencyLimit);
        const skippedContent = text.slice(currentOffset, r.newOffset).trim();
        const cleanSnippet = skippedContent.length > 25 ? skippedContent.slice(0, 22) + '...' : skippedContent;
        const msg = `Self-Healed: Malformed structure in ${this.name}. Skipped "${cleanSnippet}" to sync at next boundary.`;
        ctx.recoveredErrors.push({ message: msg, offset: currentOffset });
        const res = { type: 'error_node', message: msg, start: currentOffset, end: r.newOffset, deepestOffset: currentOffset };
        err.dependencyLimit = currentLimit;
        return { action: 'break', err, res: { newOffset: r.newOffset, node: res }, dependencyLimit: currentLimit };
      }
    }
    err.dependencyLimit = currentLimit;
    return { action: 'fail', err, dependencyLimit: currentLimit };
  }

  parse(text: string, offset: number = 0, memo: Map<string, ParseResult> = new Map(), context?: { maxOffset: number; maxError: ParseResult | null; expectedPaths: string[]; recoveredErrors: ParseError[]; cacheHits?: number; cacheMisses?: number }): ParseResult | null {
    const memoKey = `${this.id}-${offset}`;
    const ctx = context || { maxOffset: -1, maxError: null, expectedPaths: [], recoveredErrors: [] };

    if (memo.has(memoKey)) {
      if (typeof ctx.cacheHits === 'number') {
        ctx.cacheHits++;
      }
      const cached = memo.get(memoKey)!;
      
      // Lazily shift AST offsets and recoveredErrors on cache hit
      if (cached.astDelta && cached.astDelta !== 0) {
        const d = cached.astDelta;
        if (cached.ast) {
          cached.ast = shiftASTOffsets(cached.ast, d);
        }
        if (cached.recoveredErrors) {
          cached.recoveredErrors = cached.recoveredErrors.map(err => ({
            ...err,
            offset: err.offset + d
          }));
        }
        cached.astDelta = 0;
      }

      if (ctx.recoveredErrors && cached.recoveredErrors) {
        for (const err of cached.recoveredErrors) {
          if (!ctx.recoveredErrors.some(e => e.offset === err.offset && e.message === err.message)) {
            ctx.recoveredErrors.push(err);
          }
        }
      }
      return cached;
    }

    if (typeof ctx.cacheMisses === 'number') {
      ctx.cacheMisses++;
    }

    const initialErrorsLength = ctx.recoveredErrors.length;

    const res = this.parseInternal(text, offset, memo, ctx);

    if (res && res.error) {
      // Restore errors array to ignore speculative/failed branch errors
      ctx.recoveredErrors.length = initialErrorsLength;
    } else if (res) {
      // Save any recovered errors that occurred during our subtree parse
      const newErrors = ctx.recoveredErrors.slice(initialErrorsLength);
      if (newErrors.length > 0) {
        res.recoveredErrors = newErrors.map(err => ({ ...err }));
      }
    }

    memo.set(memoKey, res);
    return res;
  }

  private parseInternal(text: string, offset: number, memo: Map<string, ParseResult>, ctx: { maxOffset: number; maxError: ParseResult | null; expectedPaths: string[]; recoveredErrors: ParseError[] }): ParseResult {
    let currentOffset = offset;
    let localMaxOffset = offset;
    let results: any[] = [];
    let panicked = false;
    let hasCommitted = false;

    for (const rule of this.rules) {
      if (panicked) break;

      if (rule.type === 'element' || rule.type === 'literal' || rule.type === 'regex') {
        const startOffset = currentOffset;
        const res = this.parsePattern(rule.value, text, currentOffset, memo, rule.id, ctx);
        localMaxOffset = Math.max(localMaxOffset, res.dependencyLimit);
        if (res.success) {
          if (!res.skipped) {
            results.push(res.value);
          }
          currentOffset = res.newOffset;
          if (currentOffset > offset) hasCommitted = true;
        } else {
          if (res.newOffset && res.newOffset > currentOffset) {
            currentOffset = res.newOffset;
            if (currentOffset > offset) hasCommitted = true;
          }
          const rec = this.handleFailure(text, currentOffset, rule.id, res.error || "Match failed", memo, ctx, hasCommitted, localMaxOffset);
          localMaxOffset = Math.max(localMaxOffset, rec.dependencyLimit);
          if (rec.action === 'break') {
            results.push(rec.res.node);
            currentOffset = rec.res.newOffset;
            panicked = true;
            break;
          }
          return rec.err;
        }
      } 
      
      else if (rule.type === 'whitespace') {
        const match = matchRegex(WS_REGEX, text, currentOffset);
        if (match) {
          results.push({ type: 'whitespace', value: match[0], ruleId: rule.id, start: currentOffset, end: currentOffset + match[0].length });
          currentOffset += match[0].length;
          localMaxOffset = Math.max(localMaxOffset, currentOffset);
          // whitespace usually doesn't commit alone
        } else {
          localMaxOffset = Math.max(localMaxOffset, currentOffset + 1);
          const rec = this.handleFailure(text, currentOffset, rule.id, "Expected whitespace", memo, ctx, hasCommitted, localMaxOffset);
          localMaxOffset = Math.max(localMaxOffset, rec.dependencyLimit);
          if (rec.action === 'break') {
            results.push(rec.res.node);
            currentOffset = rec.res.newOffset;
            panicked = true;
            break;
          }
          return rec.err;
        }
      }

      else if (rule.type === 'choice') {
        const patterns = rule.value as (string | RegExp | SyntaxElement)[];
        const successes: { res: any; newOffset: number; precedence: number; skipped: boolean; errorsAdded: ParseError[]; dependencyLimit: number }[] = [];
        let maxFailedOffset = currentOffset;
        let choiceErrorMsg = "None of the choices matched";

        const baseErrorsLength = ctx.recoveredErrors.length;

        for (const pattern of patterns) {
          const beforeBranchLength = ctx.recoveredErrors.length;
          const res = this.parsePattern(pattern, text, currentOffset, memo, rule.id, ctx);
          localMaxOffset = Math.max(localMaxOffset, res.dependencyLimit);
          
          if (res.success) {
            const prec = pattern instanceof SyntaxElement ? pattern.precedence : 0;
            const branchErrors = ctx.recoveredErrors.slice(beforeBranchLength);
            successes.push({ 
              res: res.value, 
              newOffset: res.newOffset, 
              precedence: prec,
              skipped: !!res.skipped,
              errorsAdded: branchErrors,
              dependencyLimit: res.dependencyLimit
            });
          } else {
            if (res.newOffset && res.newOffset > maxFailedOffset) {
              maxFailedOffset = res.newOffset;
              choiceErrorMsg = res.error || choiceErrorMsg;
            }
          }
          // Backtrack any speculative errors added during this branch
          ctx.recoveredErrors.length = baseErrorsLength;
        }

        if (successes.length > 0) {
          // Sort successes:
          // 1. Prioritize clean matches (errorsAdded.length === 0) over recovered matches
          // 2. Prioritize higher precedence
          // 3. Prioritize fewer recovered errors
          // 4. Prioritize longest consumed match
          successes.sort((a, b) => {
            const aClean = a.errorsAdded.length === 0 ? 1 : 0;
            const bClean = b.errorsAdded.length === 0 ? 1 : 0;
            if (bClean !== aClean) return bClean - aClean;
            
            if (b.precedence !== a.precedence) return b.precedence - a.precedence;
            if (a.errorsAdded.length !== b.errorsAdded.length) return a.errorsAdded.length - b.errorsAdded.length;
            return (b.newOffset - currentOffset) - (a.newOffset - currentOffset);
          });

          const best = successes[0];
          if (!best.skipped) {
            results.push(best.res);
          }
          currentOffset = best.newOffset;
          if (currentOffset > offset) hasCommitted = true;
          
          // Apply recovered errors of only the chosen branch
          ctx.recoveredErrors.push(...best.errorsAdded);
        } else {
          // Ensure speculative errors are cleared if no choices matched
          ctx.recoveredErrors.length = baseErrorsLength;

          if (maxFailedOffset > currentOffset) {
            currentOffset = maxFailedOffset;
            if (currentOffset > offset) hasCommitted = true;
          }
          const rec = this.handleFailure(text, currentOffset, rule.id, choiceErrorMsg, memo, ctx, hasCommitted, localMaxOffset);
          localMaxOffset = Math.max(localMaxOffset, rec.dependencyLimit);
          if (rec.action === 'break') {
            results.push(rec.res.node);
            currentOffset = rec.res.newOffset;
            panicked = true;
            break;
          }
          return rec.err;
        }
      }

      else if (rule.type === 'optional') {
        const beforeOptErrorsLength = ctx.recoveredErrors.length;
        const res = this.parsePattern(rule.value, text, currentOffset, memo, rule.id, ctx);
        localMaxOffset = Math.max(localMaxOffset, res.dependencyLimit);
        if (res.success) {
          if (!res.skipped) {
            results.push(res.value);
          }
          currentOffset = res.newOffset;
        } else {
          ctx.recoveredErrors.length = beforeOptErrorsLength;
        }
      }

      else if (rule.type === 'zeroOrMore') {
        const matches = [];
        const loopStartOffset = currentOffset;
        while (currentOffset < text.length) {
          const beforeLoopErrorsLength = ctx.recoveredErrors.length;
          const res = this.parsePattern(rule.value, text, currentOffset, memo, rule.id, ctx);
          localMaxOffset = Math.max(localMaxOffset, res.dependencyLimit);
          if (!res.success || res.newOffset === currentOffset) {
            ctx.recoveredErrors.length = beforeLoopErrorsLength;
            break;
          }
          if (!res.skipped) {
            matches.push(res.value);
          }
          currentOffset = res.newOffset;
        }
        if (matches.length > 0) results.push({ type: 'zeroOrMore', value: matches, ruleId: rule.id, start: loopStartOffset, end: currentOffset });
      }

      else if (rule.type === 'oneOrMore') {
        const matches = [];
        const loopStartOffset = currentOffset;
        while (currentOffset < text.length) {
          const beforeLoopErrorsLength = ctx.recoveredErrors.length;
          const res = this.parsePattern(rule.value, text, currentOffset, memo, rule.id, ctx);
          localMaxOffset = Math.max(localMaxOffset, res.dependencyLimit);
          if (!res.success || res.newOffset === currentOffset) {
            ctx.recoveredErrors.length = beforeLoopErrorsLength;
            break;
          }
          if (!res.skipped) {
            matches.push(res.value);
          }
          currentOffset = res.newOffset;
        }
        if (matches.length > 0) {
          results.push({ type: 'oneOrMore', value: matches, ruleId: rule.id, start: loopStartOffset, end: currentOffset });
          if (currentOffset > offset) hasCommitted = true;
        } else {
          const rec = this.handleFailure(text, currentOffset, rule.id, "Expected at least one match", memo, ctx, hasCommitted, localMaxOffset);
          localMaxOffset = Math.max(localMaxOffset, rec.dependencyLimit);
          if (rec.action === 'break') {
            results.push(rec.res.node);
            currentOffset = rec.res.newOffset;
            panicked = true;
            break;
          }
          return rec.err;
        }
      }

      else if (rule.type === 'eof') {
        if (currentOffset === text.length) {
          results.push({ type: 'eof', ruleId: rule.id, start: currentOffset, end: currentOffset });
          localMaxOffset = Math.max(localMaxOffset, currentOffset + 1);
        } else {
          localMaxOffset = Math.max(localMaxOffset, currentOffset + 1);
          const rec = this.handleFailure(text, currentOffset, rule.id, "Expected EOF", memo, ctx, hasCommitted, localMaxOffset);
          localMaxOffset = Math.max(localMaxOffset, rec.dependencyLimit);
          if (rec.action === 'break') {
            results.push(rec.res.node);
            currentOffset = rec.res.newOffset;
            panicked = true;
            break;
          }
          return rec.err;
        }
      }

      else if (rule.type === 'not') {
        const res = this.parsePattern(rule.value, text, currentOffset, memo, rule.id, ctx);
        localMaxOffset = Math.max(localMaxOffset, res.dependencyLimit);
        if (res.success) {
          return this.fail("Encountered forbidden pattern", currentOffset, rule.id, ctx);
        }
      }
    }

    const finalResult: ParseResult = { 
      ast: { type: this.name, value: results, ruleId: this.id, start: offset, end: currentOffset }, 
      newOffset: currentOffset,
      recoveredErrors: [...ctx.recoveredErrors],
      dependencyLimit: localMaxOffset
    };

    return finalResult;
  }

  private attemptRecovery(text: string, offset: number, patterns: (string | RegExp | SyntaxElement)[], memo: Map<string, ParseResult>, context: any): { newOffset: number, dependencyLimit: number } | null {
    // Find the first index >= offset where any pattern matched
    let earliestIndex = text.length;
    let earliestNewOffset = -1;
    let maxEvalOffset = offset;

    for (const pattern of patterns) {
      if (typeof pattern === 'string') {
        const idx = text.indexOf(pattern, offset);
        if (idx !== -1 && idx < earliestIndex) {
          earliestIndex = idx;
          earliestNewOffset = idx + pattern.length;
        }
        maxEvalOffset = Math.max(maxEvalOffset, idx !== -1 ? idx + pattern.length : text.length);
      } else if (pattern instanceof RegExp) {
        const source = pattern.source;
        const flags = pattern.flags.replace('y', '');
        const searchRegex = new RegExp(source, flags);
        const match = searchRegex.exec(text.slice(offset));
        if (match && match.index !== undefined) {
          const absoluteIndex = offset + match.index;
          if (absoluteIndex < earliestIndex) {
            earliestIndex = absoluteIndex;
            earliestNewOffset = absoluteIndex + match[0].length;
          }
        }
        maxEvalOffset = Math.max(maxEvalOffset, match ? offset + match.index + match[0].length : text.length);
      } else if (pattern instanceof SyntaxElement) {
        for (let i = offset; i < earliestIndex; i++) {
          const res = this.parsePattern(pattern, text, i, memo, 0, context);
          maxEvalOffset = Math.max(maxEvalOffset, res.dependencyLimit);
          if (res.success) {
            if (i < earliestIndex) {
              earliestIndex = i;
              earliestNewOffset = res.newOffset;
            }
            break;
          }
        }
      }
    }

    if (earliestNewOffset !== -1) {
      return { newOffset: earliestNewOffset, dependencyLimit: Math.max(earliestNewOffset, maxEvalOffset) };
    }
    return null;
  }

  private fail(message: string, offset: number, ruleId: number, context?: { maxOffset: number; maxError: ParseResult | null; expectedPaths: string[]; recoveredErrors: ParseError[] }): ParseResult {
    const error = {
      ast: null,
      newOffset: offset,
      error: message,
      ruleId,
      dependencyLimit: offset + 1
    };

    if (context) {
      if (offset > context.maxOffset) {
        context.maxOffset = offset;
        context.maxError = error;
        context.expectedPaths = [message];
      } else if (offset === context.maxOffset) {
        if (!context.expectedPaths.includes(message)) {
          context.expectedPaths.push(message);
        }
      }
    }

    return error;
  }

  // Code Generation Helpers
  getAllElements(visited = new Set<number>()): SyntaxElement[] {
    if (visited.has(this.id)) return [];
    visited.add(this.id);
    let elements = [this as SyntaxElement];
    for (const rule of this.rules) {
      if (rule.type === 'element') {
        elements = [...elements, ...rule.value.getAllElements(visited)];
      }
    }
    return elements;
  }

  static generateFullCSharp(root: SyntaxElement): string {
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
}

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

export interface CSTNode {
  ruleId: number;
  start: number;
  end: number;
  dependencyLimit: number;
  result: ParseResult;
}

export class SpatialCSTIndex extends Map<string, ParseResult> {
  private nodesByOffset = new Map<number, Map<number, CSTNode>>();
  private totalNodes = 0;

  override has(key: string): boolean {
    const dashIndex = key.lastIndexOf('-');
    if (dashIndex === -1) return false;
    const ruleId = parseInt(key.substring(0, dashIndex), 10);
    const offset = parseInt(key.substring(dashIndex + 1), 10);
    return this.nodesByOffset.get(offset)?.has(ruleId) ?? false;
  }

  override get(key: string): ParseResult | undefined {
    const dashIndex = key.lastIndexOf('-');
    if (dashIndex === -1) return undefined;
    const ruleId = parseInt(key.substring(0, dashIndex), 10);
    const offset = parseInt(key.substring(dashIndex + 1), 10);
    return this.nodesByOffset.get(offset)?.get(ruleId)?.result;
  }

  override set(key: string, value: ParseResult): this {
    const dashIndex = key.lastIndexOf('-');
    if (dashIndex === -1) return this;
    const ruleId = parseInt(key.substring(0, dashIndex), 10);
    const offset = parseInt(key.substring(dashIndex + 1), 10);

    const dependencyLimit = value.dependencyLimit !== undefined ? value.dependencyLimit : value.newOffset;
    const cstNode: CSTNode = {
      ruleId,
      start: offset,
      end: value.newOffset,
      dependencyLimit,
      result: value
    };

    let ruleMap = this.nodesByOffset.get(offset);
    if (!ruleMap) {
      ruleMap = new Map<number, CSTNode>();
      this.nodesByOffset.set(offset, ruleMap);
    }
    if (!ruleMap.has(ruleId)) {
      this.totalNodes++;
    }
    ruleMap.set(ruleId, cstNode);
    return this;
  }

  override clear(): void {
    this.nodesByOffset.clear();
    this.totalNodes = 0;
  }

  override get size(): number {
    return this.totalNodes;
  }

  override *entries(): IterableIterator<[string, ParseResult]> {
    for (const [startOffset, ruleMap] of this.nodesByOffset.entries()) {
      for (const [ruleId, node] of ruleMap.entries()) {
        yield [`${ruleId}-${startOffset}`, node.result];
      }
    }
  }

  override *keys(): IterableIterator<string> {
    for (const [startOffset, ruleMap] of this.nodesByOffset.entries()) {
      for (const ruleId of ruleMap.keys()) {
        yield `${ruleId}-${startOffset}`;
      }
    }
  }

  override *values(): IterableIterator<ParseResult> {
    for (const ruleMap of this.nodesByOffset.values()) {
      for (const node of ruleMap.values()) {
        yield node.result;
      }
    }
  }

  override [Symbol.iterator](): IterableIterator<[string, ParseResult]> {
    return this.entries();
  }

  applyEdit(editOffset: number, removedLength: number, delta: number) {
    const nextNodesByOffset = new Map<number, Map<number, CSTNode>>();
    let nextTotalNodes = 0;

    for (const [startOffset, ruleMap] of this.nodesByOffset.entries()) {
      for (const [ruleId, node] of ruleMap.entries()) {
        const dependencyLimit = node.dependencyLimit;

        // Scenario 1: Parse started before the edit point
        if (node.start < editOffset) {
          if (dependencyLimit >= editOffset) {
            continue; // Overlaps with edit, discard
          }
          let nextRuleMap = nextNodesByOffset.get(node.start);
          if (!nextRuleMap) {
            nextRuleMap = new Map<number, CSTNode>();
            nextNodesByOffset.set(node.start, nextRuleMap);
          }
          nextRuleMap.set(ruleId, node);
          nextTotalNodes++;
        }
        // Scenario 2: Parse started inside the edited/deleted range
        else if (node.start >= editOffset && node.start < editOffset + removedLength) {
          continue; // Discard completely
        }
        // Scenario 3: Parse started after the edited/deleted range
        else {
          const newStart = node.start + delta;
          const newEnd = node.end + delta;
          const newDependencyLimit = node.dependencyLimit + delta;

          // Eagerly shift the offsets in result, AST and errors
          const shiftedResult: ParseResult = {
            ...node.result,
            newOffset: node.result.newOffset + delta,
            dependencyLimit: newDependencyLimit,
            astDelta: 0,
          };

          if (node.result.ast) {
            shiftedResult.ast = shiftASTOffsets(node.result.ast, delta);
          }

          if (node.result.recoveredErrors) {
            shiftedResult.recoveredErrors = node.result.recoveredErrors.map(err => ({
              ...err,
              offset: err.offset + delta
            }));
          }

          const shiftedNode: CSTNode = {
            ruleId,
            start: newStart,
            end: newEnd,
            dependencyLimit: newDependencyLimit,
            result: shiftedResult
          };

          let nextRuleMap = nextNodesByOffset.get(newStart);
          if (!nextRuleMap) {
            nextRuleMap = new Map<number, CSTNode>();
            nextNodesByOffset.set(newStart, nextRuleMap);
          }
          nextRuleMap.set(ruleId, shiftedNode);
          nextTotalNodes++;
        }
      }
    }

    this.nodesByOffset = nextNodesByOffset;
    this.totalNodes = nextTotalNodes;
  }
}

export class IncrementalParser {
  private lastText: string = "";
  private memo: SpatialCSTIndex = new SpatialCSTIndex();
  private lastResult: ParseResult | null = null;
  private lastContext: any = null;

  constructor() {}

  getMemoTable(): SpatialCSTIndex {
    return this.memo;
  }

  clear() {
    this.lastText = "";
    this.memo.clear();
    this.lastResult = null;
    this.lastContext = null;
  }

  parse(
    root: SyntaxElement,
    newText: string,
    context?: {
      maxOffset: number;
      maxError: ParseResult | null;
      expectedPaths: string[];
      recoveredErrors: ParseError[];
      cacheHits?: number;
      cacheMisses?: number;
    }
  ): ParseResult {
    const ctx = context || {
      maxOffset: -1,
      maxError: null,
      expectedPaths: [],
      recoveredErrors: [],
      cacheHits: 0,
      cacheMisses: 0
    };

    if (this.lastText === "") {
      // First parse: build full memo
      ctx.cacheHits = 0;
      ctx.cacheMisses = 0;
      
      const res = root.parse(newText, 0, this.memo, ctx);
      this.lastText = newText;
      this.lastResult = res || { ast: null, newOffset: 0, error: "Parsing failed" };
      this.lastContext = ctx;
      return this.lastResult;
    }

    // Incremental parse: calculate the diff
    const { editOffset, removedLength, insertedText } = findDiff(this.lastText, newText);
    const delta = insertedText.length - removedLength;

    // Shift/invalidate the spatial CST index
    if (removedLength > 0 || insertedText.length > 0) {
      this.memo.applyEdit(editOffset, removedLength, delta);
    }

    // Parse with the updated memo cache
    ctx.cacheHits = 0;
    ctx.cacheMisses = 0;

    const res = root.parse(newText, 0, this.memo, ctx);
    
    this.lastText = newText;
    this.lastResult = res || { ast: null, newOffset: 0, error: "Parsing failed" };
    this.lastContext = ctx;
    return this.lastResult;
  }
}

export interface QueryPattern {
  type: string;
  children?: QueryPattern[];
  capture?: string;
  literalValue?: string;
}

export interface QueryCapture {
  name: string;
  node: any;
}

export interface QueryMatch {
  patternIndex: number;
  captures: QueryCapture[];
}

export function getStructuralNodes(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) {
    return node.flatMap(getStructuralNodes);
  }
  if (node.type && node.type !== 'zeroOrMore' && node.type !== 'oneOrMore' && node.type !== 'choice' && node.type !== 'optional' && node.type !== 'whitespace') {
    return [node];
  }
  if (node.value !== undefined) {
    return getStructuralNodes(node.value);
  }
  return [];
}

export function parseQuery(queryStr: string): QueryPattern[] {
  let offset = 0;
  
  function skipWhitespace() {
    while (offset < queryStr.length && /\s/.test(queryStr[offset])) {
      offset++;
    }
  }
  
  function parsePattern(): QueryPattern | null {
    skipWhitespace();
    if (offset >= queryStr.length) return null;
    
    if (queryStr[offset] === '"' || queryStr[offset] === "'") {
      const quote = queryStr[offset];
      offset++;
      let val = "";
      while (offset < queryStr.length && queryStr[offset] !== quote) {
        val += queryStr[offset];
        offset++;
      }
      if (offset < queryStr.length) offset++;
      skipWhitespace();
      let capture: string | undefined;
      if (queryStr[offset] === '@') {
        const start = offset;
        offset++;
        while (offset < queryStr.length && /[a-zA-Z0-9_]/.test(queryStr[offset])) {
          offset++;
        }
        capture = queryStr.substring(start + 1, offset);
      }
      return { type: 'literal', literalValue: val, capture };
    }
    
    if (queryStr[offset] !== '(') {
      let start = offset;
      while (offset < queryStr.length && /[a-zA-Z0-9_*-]/.test(queryStr[offset])) {
        offset++;
      }
      const type = queryStr.substring(start, offset);
      if (!type) return null;
      
      skipWhitespace();
      let capture: string | undefined;
      if (queryStr[offset] === '@') {
        const capStart = offset;
        offset++;
        while (offset < queryStr.length && /[a-zA-Z0-9_]/.test(queryStr[offset])) {
          offset++;
        }
        capture = queryStr.substring(capStart + 1, offset);
      }
      return { type, capture };
    }
    
    offset++; // skip '('
    skipWhitespace();
    
    let start = offset;
    while (offset < queryStr.length && /[a-zA-Z0-9_*-]/.test(queryStr[offset])) {
      offset++;
    }
    const type = queryStr.substring(start, offset) || '_';
    
    const children: QueryPattern[] = [];
    skipWhitespace();
    while (offset < queryStr.length && queryStr[offset] !== ')') {
      const child = parsePattern();
      if (!child) break;
      children.push(child);
      skipWhitespace();
    }
    
    if (queryStr[offset] === ')') {
      offset++;
    }
    
    skipWhitespace();
    let capture: string | undefined;
    if (queryStr[offset] === '@') {
      const capStart = offset;
      offset++;
      while (offset < queryStr.length && /[a-zA-Z0-9_]/.test(queryStr[offset])) {
        offset++;
      }
      capture = queryStr.substring(capStart + 1, offset);
    }
    
    return { type, children, capture };
  }
  
  const patterns: QueryPattern[] = [];
  while (offset < queryStr.length) {
    skipWhitespace();
    if (offset >= queryStr.length) break;
    const pat = parsePattern();
    if (pat) {
      patterns.push(pat);
    } else {
      break;
    }
  }
  return patterns;
}

function matchChildren(flattenedChildren: any[], childPatterns: QueryPattern[], patternIndex: number, currentCaptures: QueryCapture[]): QueryCapture[] | null {
  if (patternIndex >= childPatterns.length) {
    return currentCaptures;
  }
  
  const pat = childPatterns[patternIndex];
  for (let i = 0; i < flattenedChildren.length; i++) {
    const child = flattenedChildren[i];
    const localCaptures: QueryCapture[] = [];
    const matched = executePatternMatch(child, pat, localCaptures);
    if (matched) {
      const restCaptures = matchChildren(flattenedChildren.slice(i + 1), childPatterns, patternIndex + 1, [...currentCaptures, ...localCaptures]);
      if (restCaptures !== null) {
        return restCaptures;
      }
    }
  }
  return null;
}

export function executePatternMatch(node: any, pat: QueryPattern, captures: QueryCapture[]): boolean {
  if (!node || typeof node !== 'object') return false;
  
  if (pat.type === 'literal') {
    const textVal = typeof node === 'string' ? node : (node.value && typeof node.value === 'string' ? node.value : null);
    if (textVal && textVal === pat.literalValue) {
      if (pat.capture) {
        captures.push({ name: pat.capture, node });
      }
      return true;
    }
    return false;
  }
  
  if (pat.type !== '_' && node.type !== pat.type) {
    return false;
  }
  
  if (pat.children && pat.children.length > 0) {
    const childrenNodes = getStructuralNodes(node.value);
    const childMatchCaptures = matchChildren(childrenNodes, pat.children, 0, []);
    if (childMatchCaptures === null) {
      return false;
    }
    captures.push(...childMatchCaptures);
  }
  
  if (pat.capture) {
    captures.push({ name: pat.capture, node });
  }
  
  return true;
}

export class CSTQuery {
  private patterns: QueryPattern[];

  constructor(queryString: string) {
    this.patterns = parseQuery(queryString);
  }

  run(ast: any): QueryMatch[] {
    const matches: QueryMatch[] = [];
    
    const traverse = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const item of node) {
          traverse(item);
        }
        return;
      }
      
      for (let i = 0; i < this.patterns.length; i++) {
        const pat = this.patterns[i];
        const captures: QueryCapture[] = [];
        if (executePatternMatch(node, pat, captures)) {
          matches.push({
            patternIndex: i,
            captures
          });
        }
      }
      
      if (node.value !== undefined) {
        traverse(node.value);
      }
    };
    
    traverse(ast);
    return matches;
  }
}

export interface SymbolDefinition {
  id: string;
  name: string;
  kind: 'variable' | 'parameter' | 'function' | 'struct' | 'member' | 'other';
  datatype: string;
  start: number;
  end: number;
  node: any;
  scopeId: string;
  references: SymbolReference[];
}

export interface SymbolReference {
  id: string;
  name: string;
  start: number;
  end: number;
  node: any;
  scopeId: string;
  resolvedSymbolId?: string;
}

export interface LexicalScope {
  id: string;
  name: string;
  type: 'global' | 'function' | 'struct' | 'block';
  start: number;
  end: number;
  node: any;
  parentId: string | null;
  children: LexicalScope[];
  symbols: SymbolDefinition[];
  references: SymbolReference[];
}

function findFirstIdString(node: any): string | null {
  if (!node) return null;
  if (typeof node === 'string') return node;
  if (node.type === 'id' && typeof node.value === 'string') return node.value;
  if (Array.isArray(node)) {
    for (const item of node) {
      const res = findFirstIdString(item);
      if (res) return res;
    }
  } else if (typeof node === 'object') {
    if (node.value !== undefined) {
      return findFirstIdString(node.value);
    }
    for (const key of Object.keys(node)) {
      if (key !== 'parent' && key !== 'ruleId') {
        const res = findFirstIdString(node[key]);
        if (res) return res;
      }
    }
  }
  return null;
}

function findTypeAndIdOfDecl(node: any): { dataType: string; idNode: any | null } {
  let dataType = "auto";
  let idNode: any | null = null;
  
  function scan(n: any) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'hlsl_type' || n.type === 'type') {
      if (typeof n.value === 'string') dataType = n.value;
      else if (n.value && typeof n.value.value === 'string') dataType = n.value.value;
      else {
        const childId = findFirstIdString(n);
        if (childId) dataType = childId;
      }
    }
    if (n.type === 'id') {
      idNode = n;
      return;
    }
    if (Array.isArray(n)) {
      for (const item of n) {
        scan(item);
        if (idNode && dataType !== "auto") break;
      }
    } else if (n.value !== undefined) {
      scan(n.value);
    }
  }
  scan(node);
  return { dataType, idNode };
}

export function buildScopeChainAndSymbols(ast: any, fullText: string): LexicalScope {
  const globalScope: LexicalScope = {
    id: "global",
    name: "Global Scope",
    type: 'global',
    start: 0,
    end: fullText.length,
    node: ast,
    parentId: null,
    children: [],
    symbols: [],
    references: []
  };

  const allScopes = new Map<string, LexicalScope>();
  allScopes.set("global", globalScope);

  let scopeCounter = 0;
  function createScope(name: string, type: 'struct' | 'function' | 'block', start: number, end: number, node: any, parentId: string): LexicalScope {
    const id = `scope-${type}-${++scopeCounter}`;
    const scope: LexicalScope = {
      id,
      name,
      type,
      start,
      end,
      node,
      parentId,
      children: [],
      symbols: [],
      references: []
    };
    allScopes.set(id, scope);
    return scope;
  }

  let symbolCounter = 0;
  
  function traverse(node: any, currentScope: LexicalScope) {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (const child of node) {
        traverse(child, currentScope);
      }
      return;
    }

    const type = node.type;
    const start = node.start ?? 0;
    const end = node.end ?? 0;

    let activeScope = currentScope;

    if (type === 'struct') {
      const idStr = findFirstIdString(node) || "AnonymousStruct";
      const newScope = createScope(`struct ${idStr}`, 'struct', start, end, node, currentScope.id);
      currentScope.children.push(newScope);
      activeScope = newScope;

      const symId = `sym-${++symbolCounter}`;
      currentScope.symbols.push({
        id: symId,
        name: idStr,
        kind: 'struct',
        datatype: 'struct',
        start,
        end,
        node,
        scopeId: currentScope.id,
        references: []
      });
    } 
    else if (type === 'function') {
      const idStr = findFirstIdString(node) || "AnonymousFunc";
      const { dataType } = findTypeAndIdOfDecl(node);
      const newScope = createScope(`func ${idStr}: ${dataType}`, 'function', start, end, node, currentScope.id);
      currentScope.children.push(newScope);
      activeScope = newScope;

      const symId = `sym-${++symbolCounter}`;
      currentScope.symbols.push({
        id: symId,
        name: idStr,
        kind: 'function',
        datatype: dataType,
        start,
        end,
        node,
        scopeId: currentScope.id,
        references: []
      });
    }
    else if (type === 'code_block') {
      let label = "Local Block";
      if (currentScope.type === 'function') {
        const funcId = currentScope.name.replace("func ", "");
        label = `Block in ${funcId}`;
      }
      const newScope = createScope(label, 'block', start, end, node, currentScope.id);
      currentScope.children.push(newScope);
      activeScope = newScope;
    }

    if (type === 'variable' || type === 'struct_member') {
      const { dataType, idNode } = findTypeAndIdOfDecl(node);
      if (idNode) {
        const name = findFirstIdString(idNode) || "unnamed";
        const symId = `sym-${++symbolCounter}`;
        
        let kind: 'member' | 'variable' = 'variable';
        if (activeScope.type === 'struct') {
          kind = 'member';
        }

        activeScope.symbols.push({
          id: symId,
          name,
          kind,
          datatype: dataType,
          start: idNode.start ?? start,
          end: idNode.end ?? end,
          node: idNode,
          scopeId: activeScope.id,
          references: []
        });
      }
    } 
    else if (type === 'param') {
      const { dataType, idNode } = findTypeAndIdOfDecl(node);
      if (idNode) {
        const name = findFirstIdString(idNode) || "unnamed";
        const symId = `sym-${++symbolCounter}`;

        activeScope.symbols.push({
          id: symId,
          name,
          kind: 'parameter',
          datatype: dataType,
          start: idNode.start ?? start,
          end: idNode.end ?? end,
          node: idNode,
          scopeId: activeScope.id,
          references: []
        });
      }
    }

    if (node.value !== undefined) {
      traverse(node.value, activeScope);
    }
  }

  traverse(ast, globalScope);

  const mainDeclOffsets = new Set<number>();
  const allSymbols: SymbolDefinition[] = [];
  
  function collectSymbols(scope: LexicalScope) {
    for (const sym of scope.symbols) {
      mainDeclOffsets.add(sym.start);
      allSymbols.push(sym);
    }
    for (const child of scope.children) {
      collectSymbols(child);
    }
  }
  collectSymbols(globalScope);

  let refCounter = 0;
  function findReferences(node: any, currentScope: LexicalScope) {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (const child of node) {
        findReferences(child, currentScope);
      }
      return;
    }

    const type = node.type;
    const start = node.start ?? 0;
    const end = node.end ?? 0;

    let activeScope = currentScope;
    if (type === 'struct' || type === 'function' || type === 'code_block') {
      const childScope = currentScope.children.find(c => c.node === node);
      if (childScope) {
        activeScope = childScope;
      }
    }

    if (type === 'id') {
      if (!mainDeclOffsets.has(start)) {
        const idStr = findFirstIdString(node);
        if (idStr) {
          activeScope.references.push({
            id: `ref-${++refCounter}`,
            name: idStr,
            start,
            end,
            node,
            scopeId: activeScope.id
          });
        }
      }
    }

    if (node.value !== undefined) {
      findReferences(node.value, activeScope);
    }
  }

  findReferences(ast, globalScope);

  function resolveRef(ref: SymbolReference, scopeId: string): SymbolDefinition | null {
    let currentId: string | null = scopeId;
    while (currentId !== null) {
      const scope = allScopes.get(currentId);
      if (!scope) break;
      
      const matchedSym = scope.symbols.find(s => s.name === ref.name);
      if (matchedSym) {
        return matchedSym;
      }
      
      currentId = scope.parentId;
    }
    return null;
  }

  function resolveAllScopeReferences(scope: LexicalScope) {
    for (const ref of scope.references) {
      const resolvedSym = resolveRef(ref, scope.id);
      if (resolvedSym) {
        ref.resolvedSymbolId = resolvedSym.id;
        resolvedSym.references.push(ref);
      }
    }
    for (const child of scope.children) {
      resolveAllScopeReferences(child);
    }
  }

  resolveAllScopeReferences(globalScope);

  return globalScope;
}

