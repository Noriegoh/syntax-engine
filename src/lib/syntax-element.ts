import { 
  Rule, 
  ParseError, 
  ParseResult, 
  nextRuleId, 
  matchRegex, 
  WS_REGEX, 
  shiftASTOffsets 
} from './types';

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

  private parsePattern(
    pattern: string | RegExp | SyntaxElement, 
    text: string, 
    currentOffset: number, 
    memo: Map<string, ParseResult>, 
    ruleId: number, 
    context?: { maxOffset: number; maxError: ParseResult | null; expectedPaths: string[]; recoveredErrors: ParseError[] }
  ) {
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

  private handleFailure(
    text: string, 
    currentOffset: number, 
    ruleId: number, 
    errorMsg: string, 
    memo: Map<string, ParseResult>, 
    ctx: any, 
    hasCommitted: boolean, 
    localMaxOffset: number
  ): { action: 'break' | 'fail', err: ParseResult, res?: any, dependencyLimit: number } {
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

  parse(
    text: string, 
    offset: number = 0, 
    memo: Map<string, ParseResult> = new Map(), 
    context?: { maxOffset: number; maxError: ParseResult | null; expectedPaths: string[]; recoveredErrors: ParseError[]; cacheHits?: number; cacheMisses?: number }
  ): ParseResult | null {
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

  private parseInternal(
    text: string, 
    offset: number, 
    memo: Map<string, ParseResult>, 
    ctx: { maxOffset: number; maxError: ParseResult | null; expectedPaths: string[]; recoveredErrors: ParseError[] }
  ): ParseResult {
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

  private attemptRecovery(
    text: string, 
    offset: number, 
    patterns: (string | RegExp | SyntaxElement)[], 
    memo: Map<string, ParseResult>, 
    context: any
  ): { newOffset: number, dependencyLimit: number } | null {
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

  private fail(
    message: string, 
    offset: number, 
    ruleId: number, 
    context?: { maxOffset: number; maxError: ParseResult | null; expectedPaths: string[]; recoveredErrors: ParseError[] }
  ): ParseResult {
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


}
