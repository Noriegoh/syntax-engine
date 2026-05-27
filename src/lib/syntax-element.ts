import { 
  Rule, 
  ParseError, 
  ParseResult, 
  nextRuleId, 
  matchRegex, 
  WS_REGEX, 
  GreenNode
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

  isHiddenElement: boolean = false;

  Hide(): this {
    this.isHiddenElement = true;
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

  BeginScope(pattern: string | RegExp | SyntaxElement): this {
    const id = nextRuleId();
    if (pattern instanceof SyntaxElement) {
      this.rules.push({ id, type: 'beginScope', value: pattern });
    } else if (pattern instanceof RegExp) {
      this.rules.push({ id, type: 'beginScope', value: pattern });
    } else {
      this.rules.push({ id, type: 'beginScope', value: pattern });
    }
    return this;
  }

  EndScope(pattern: string | RegExp | SyntaxElement): this {
    const id = nextRuleId();
    if (pattern instanceof SyntaxElement) {
      this.rules.push({ id, type: 'endScope', value: pattern });
    } else if (pattern instanceof RegExp) {
      this.rules.push({ id, type: 'endScope', value: pattern });
    } else {
      this.rules.push({ id, type: 'endScope', value: pattern });
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

  ExpectsOneOf(...patterns: (string | RegExp | SyntaxElement)[] | [(string | RegExp | SyntaxElement)[]]): this {
    const id = nextRuleId();
    const flatPatterns = (patterns.length === 1 && Array.isArray(patterns[0]))
      ? patterns[0]
      : patterns as (string | RegExp | SyntaxElement)[];
    this.rules.push({ id, type: 'choice', value: flatPatterns });
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
        return { success: true, value: subResult.ast, newOffset: subResult.newOffset, skipped: false, dependencyLimit: subResult.dependencyLimit !== undefined ? subResult.dependencyLimit : subResult.newOffset };
      } else {
        return { success: false, error: subResult?.error || `Failed sub-element: ${pattern.name}`, newOffset: subResult ? subResult.newOffset : currentOffset, dependencyLimit: subResult ? (subResult.dependencyLimit !== undefined ? subResult.dependencyLimit : subResult.newOffset) : currentOffset };
      }
    } else if (pattern instanceof RegExp) {
      const match = matchRegex(pattern, text, currentOffset);
      if (match) {
        return { success: true, value: GreenNode.create('token', match[0], ruleId, match[0].length), newOffset: currentOffset + match[0].length, dependencyLimit: currentOffset + match[0].length };
      } else {
        return { success: false, error: `Regex failed: ${pattern.source}`, newOffset: currentOffset, dependencyLimit: currentOffset + 1 };
      }
    } else {
      if (text.startsWith(pattern as string, currentOffset)) {
        return { success: true, value: GreenNode.create('literal', pattern, ruleId, (pattern as string).length), newOffset: currentOffset + (pattern as string).length, dependencyLimit: currentOffset + (pattern as string).length };
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

    // 1. Explicit or auto-derived recovery patterns
    const isExplicit = !this.recoveryPatterns ? false : true;
    let derivedRecovery = this.recoveryPatterns;
    if (!derivedRecovery) {
      derivedRecovery = this.getAutoRecoveryPatterns(ctx);
    }

    if (derivedRecovery) {
      let shouldRecover = hasCommitted;
      if (!shouldRecover && isExplicit) {
        // Recover if we are inside a block list of statements without slicing (finding next non-whitespace char index)
        let nextCharIndex = currentOffset;
        while (nextCharIndex < text.length && /\s/.test(text[nextCharIndex])) {
          nextCharIndex++;
        }
        if (nextCharIndex < text.length) {
          const char = text[nextCharIndex];
          let isScopeEnd = (char === '}' || char === ')');
          if (ctx.activeScopeEnds && ctx.activeScopeEnds.length > 0) {
            for (const scopeEnd of ctx.activeScopeEnds) {
              if (typeof scopeEnd.value === 'string') {
                if (char === scopeEnd.value[0]) {
                  isScopeEnd = true;
                  break;
                }
              } else if (scopeEnd.value instanceof RegExp) {
                const refObj = new RegExp('^(?:' + scopeEnd.value.source + ')', scopeEnd.value.flags);
                if (refObj.test(text.slice(nextCharIndex))) {
                  isScopeEnd = true;
                  break;
                }
              } else if (scopeEnd.value instanceof SyntaxElement) {
                if (scopeEnd.value.name && (scopeEnd.value.name.toLowerCase().includes('end') || scopeEnd.value.name === '}')) {
                  isScopeEnd = true;
                  break;
                }
              }
            }
          }
          if (!isScopeEnd) {
            shouldRecover = true;
          }
        }
      }

      if (shouldRecover) {
        const r = this.attemptRecovery(text, currentOffset, derivedRecovery, memo, ctx);
        if (r) {
          currentLimit = Math.max(currentLimit, r.dependencyLimit);
          const msg = `Syntax Error in ${this.name}: ${err.error} at offset ${currentOffset}. Recovered at offset ${r.newOffset}`;
          ctx.recoveredErrors.push({ message: msg, offset: currentOffset });
          const res = GreenNode.create('error_node', msg, 0, r.newOffset - currentOffset);
          err.dependencyLimit = currentLimit;
          return { action: 'break', err, res: { newOffset: r.newOffset, node: res }, dependencyLimit: currentLimit };
        }
      }
    } 
    // 2. Fallback auto-recovery (self-healing) for elements explicitly designated as auto-healing
    // Or if there is an active scope end from any BeginScope block!
    else if (hasCommitted && (this.isAutoHealing || (ctx.activeScopeEnds && ctx.activeScopeEnds.length > 0))) {
      let fallbackPatterns = this.autoHealingBoundaries;
      if (!fallbackPatterns) {
        if (ctx.activeScopeEnds && ctx.activeScopeEnds.length > 0) {
          fallbackPatterns = ctx.activeScopeEnds.map((e: any) => e.value);
        } else {
          fallbackPatterns = ["}", ";", "\n"];
        }
      }
      const r = this.attemptRecovery(text, currentOffset, fallbackPatterns, memo, ctx);
      if (r && r.newOffset >= currentOffset) {
        currentLimit = Math.max(currentLimit, r.dependencyLimit);
        const skippedContent = text.slice(currentOffset, r.newOffset).trim();
        const cleanSnippet = skippedContent.length > 25 ? skippedContent.slice(0, 22) + '...' : skippedContent;
        const msg = `Self-Healed: Malformed structure in ${this.name}. Skipped "${cleanSnippet}" to sync at next boundary.`;
        ctx.recoveredErrors.push({ message: msg, offset: currentOffset });
        const res = GreenNode.create('error_node', msg, 0, r.newOffset - currentOffset);
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
    context?: { maxOffset: number; maxError: ParseResult | null; expectedPaths: string[]; recoveredErrors: ParseError[]; activeScopeEnds?: any[]; cacheHits?: number; cacheMisses?: number; profile?: boolean; profileStack?: any[]; profileRoot?: any }
  ): ParseResult | null {
    const memoKey = `${this.id}-${offset}`;
    const ctx = context || { maxOffset: -1, maxError: null, expectedPaths: [], recoveredErrors: [], activeScopeEnds: [] };
    if (!ctx.activeScopeEnds) {
      ctx.activeScopeEnds = [];
    }
    const initialActiveScopeEndsLength = ctx.activeScopeEnds.length;

    let profilerNode: any = null;
    let profilerStartTime = 0;
    if (ctx.profile) {
      profilerNode = {
        name: this.name,
        id: this.id,
        offset: offset,
        duration: 0,
        selfTime: 0,
        cacheHit: false,
        children: []
      };
      if (ctx.profileStack && ctx.profileStack.length > 0) {
        ctx.profileStack[ctx.profileStack.length - 1].children.push(profilerNode);
      } else {
        ctx.profileRoot = profilerNode;
      }
      ctx.profileStack = ctx.profileStack || [];
      ctx.profileStack.push(profilerNode);
      profilerStartTime = performance.now();
    }

    if (memo.has(memoKey)) {
      if (typeof ctx.cacheHits === 'number') {
        ctx.cacheHits++;
      }
      const cached = memo.get(memoKey)!;
      
      // Lazily shift recoveredErrors on cache hit
      if (cached.astDelta && cached.astDelta !== 0) {
        const d = cached.astDelta;
        if (cached.recoveredErrors) {
          cached.recoveredErrors = cached.recoveredErrors.map(err => ({
            ...err,
            offset: err.offset + d
          }));
        }
        // NOTE: Red-Green trees do not need AST offset shifting!
        cached.astDelta = 0;
      }

      if (ctx.recoveredErrors && cached.recoveredErrors) {
        for (const err of cached.recoveredErrors) {
          if (!ctx.recoveredErrors.some(e => e.offset === err.offset && e.message === err.message)) {
            ctx.recoveredErrors.push(err);
          }
        }
      }

      if (ctx.profile && profilerNode) {
        profilerNode.duration = performance.now() - profilerStartTime;
        profilerNode.selfTime = profilerNode.duration;
        profilerNode.cacheHit = true;
        ctx.profileStack.pop();
      }
      if (ctx.activeScopeEnds.length > initialActiveScopeEndsLength) {
        ctx.activeScopeEnds.length = initialActiveScopeEndsLength;
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

    if (ctx.profile && profilerNode) {
      profilerNode.duration = performance.now() - profilerStartTime;
      const childrenDuration = profilerNode.children.reduce((acc: number, c: any) => acc + c.duration, 0);
      profilerNode.selfTime = Math.max(0, profilerNode.duration - childrenDuration);
      ctx.profileStack.pop();
    }

    if (ctx.activeScopeEnds.length > initialActiveScopeEndsLength) {
      ctx.activeScopeEnds.length = initialActiveScopeEndsLength;
    }
    return res;
  }

  private parseInternal(
    text: string, 
    offset: number, 
    memo: Map<string, ParseResult>, 
    ctx: { maxOffset: number; maxError: ParseResult | null; expectedPaths: string[]; recoveredErrors: ParseError[]; activeScopeEnds?: any[] }
  ): ParseResult {
    let currentOffset = offset;
    let localMaxOffset = offset;
    let results: any[] = [];
    let panicked = false;
    let hasCommitted = false;
    const initialActiveScopeEndsLength = ctx.activeScopeEnds ? ctx.activeScopeEnds.length : 0;

    let lastStructuralOffset = offset;
    let lastStructuralResultsCount = 0;

    for (const rule of this.rules) {
      if (panicked) break;

      let ruleIsStructural = true;
      if (rule.type === 'whitespace') {
        ruleIsStructural = false;
      } else if ((rule.type === 'element' || rule.type === 'optional' || rule.type === 'zeroOrMore' || rule.type === 'oneOrMore' || rule.type === 'not') && rule.value instanceof SyntaxElement && rule.value.isHiddenElement) {
        ruleIsStructural = false;
      }

      if (rule.type === 'element' || rule.type === 'literal' || rule.type === 'regex' || rule.type === 'beginScope' || rule.type === 'endScope') {
        const startOffset = currentOffset;
        const res = this.parsePattern(rule.value, text, currentOffset, memo, rule.id, ctx);
        localMaxOffset = Math.max(localMaxOffset, res.dependencyLimit);
        if (res.success) {
          if (res.value && (res.value.width > 0 || res.value.type === 'eof')) {
            results.push(res.value);
          }
          currentOffset = res.newOffset;
          if (currentOffset > offset) hasCommitted = true;

          if (ruleIsStructural && currentOffset > startOffset) {
            lastStructuralOffset = currentOffset;
            lastStructuralResultsCount = results.length;
          }

          if (rule.type === 'beginScope') {
            const myIndex = this.rules.indexOf(rule);
            const subsequentEndRules = this.rules.slice(myIndex + 1).filter(r => r.type === 'endScope');
            if (subsequentEndRules.length > 0) {
              const nextEndRule = subsequentEndRules[0];
              ctx.activeScopeEnds = ctx.activeScopeEnds || [];
              ctx.activeScopeEnds.push({ ruleId: nextEndRule.id, value: nextEndRule.value });
            }
          } else if (rule.type === 'endScope') {
            if (ctx.activeScopeEnds) {
              const idx = ctx.activeScopeEnds.findIndex(e => e.ruleId === rule.id);
              if (idx !== -1) {
                ctx.activeScopeEnds.splice(idx, 1);
              }
            }
          }
        } else {
          if (res.newOffset && res.newOffset > currentOffset) {
            currentOffset = res.newOffset;
            if (currentOffset > offset) hasCommitted = true;
          }

          if (rule.type === 'endScope') {
            if (ctx.activeScopeEnds) {
              const idx = ctx.activeScopeEnds.findIndex(e => e.ruleId === rule.id);
              if (idx !== -1) {
                ctx.activeScopeEnds.splice(idx, 1);
              }
            }
          }

          if (ctx.activeScopeEnds) {
            ctx.activeScopeEnds.length = initialActiveScopeEndsLength;
          }
          const startOffsetForFailure = ruleIsStructural && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset;
          const rec = this.handleFailure(text, startOffsetForFailure, rule.id, res.error || "Match failed", memo, ctx, hasCommitted, localMaxOffset);
          localMaxOffset = Math.max(localMaxOffset, rec.dependencyLimit);
          if (rec.action === 'break') {
            if (startOffsetForFailure < currentOffset) {
              results.length = lastStructuralResultsCount;
            }
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
          const wsNode = GreenNode.create('whitespace', match[0], rule.id, match[0].length);
          if (wsNode.width > 0) {
            results.push(wsNode);
          }
          currentOffset += match[0].length;
          localMaxOffset = Math.max(localMaxOffset, currentOffset);
          // whitespace usually doesn't commit alone
        } else {
          localMaxOffset = Math.max(localMaxOffset, currentOffset + 1);
          if (ctx.activeScopeEnds) {
            ctx.activeScopeEnds.length = initialActiveScopeEndsLength;
          }
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
        const startOffset = currentOffset;
        const patterns = rule.value as (string | RegExp | SyntaxElement)[];
        let matched = false;
        let maxFailedOffset = currentOffset;
        let choiceErrorMsg = "None of the choices matched";

        const baseErrorsLength = ctx.recoveredErrors.length;
        const baseActiveScopeEndsLength = ctx.activeScopeEnds ? ctx.activeScopeEnds.length : 0;

        let backupMatch: { 
          resVal: any; 
          newOffset: number; 
          errors: ParseError[]; 
          activeScopeEndsLength: number;
        } | null = null;

        for (const pattern of patterns) {
          const beforeBranchErrors = ctx.recoveredErrors.length;
          const res = this.parsePattern(pattern, text, currentOffset, memo, rule.id, ctx);
          localMaxOffset = Math.max(localMaxOffset, res.dependencyLimit);
          
          if (res.success) {
            const branchErrorsCount = ctx.recoveredErrors.length - beforeBranchErrors;
            if (branchErrorsCount === 0) {
              if (res.value && (res.value.width > 0 || res.value.type === 'eof')) {
                results.push(res.value);
              }
              currentOffset = res.newOffset;
              if (currentOffset > offset) hasCommitted = true;

              if (ruleIsStructural && currentOffset > startOffset) {
                lastStructuralOffset = currentOffset;
                lastStructuralResultsCount = results.length;
              }

              matched = true;
              break;
            } else {
              if (!backupMatch) {
                backupMatch = {
                  resVal: res.value,
                  newOffset: res.newOffset,
                  errors: ctx.recoveredErrors.slice(beforeBranchErrors),
                  activeScopeEndsLength: ctx.activeScopeEnds ? ctx.activeScopeEnds.length : 0
                };
              }
              ctx.recoveredErrors.length = beforeBranchErrors;
              if (ctx.activeScopeEnds) {
                ctx.activeScopeEnds.length = baseActiveScopeEndsLength;
              }
            }
          } else {
            if (res.newOffset && res.newOffset > maxFailedOffset) {
              maxFailedOffset = res.newOffset;
              choiceErrorMsg = res.error || choiceErrorMsg;
            }
            ctx.recoveredErrors.length = baseErrorsLength;
            if (ctx.activeScopeEnds) {
              ctx.activeScopeEnds.length = baseActiveScopeEndsLength;
            }
          }
        }

        if (!matched && backupMatch) {
          if (backupMatch.resVal && (backupMatch.resVal.width > 0 || backupMatch.resVal.type === 'eof')) {
            results.push(backupMatch.resVal);
          }
          currentOffset = backupMatch.newOffset;
          if (currentOffset > offset) hasCommitted = true;

          if (ruleIsStructural && currentOffset > startOffset) {
            lastStructuralOffset = currentOffset;
            lastStructuralResultsCount = results.length;
          }

          ctx.recoveredErrors.push(...backupMatch.errors);
          if (ctx.activeScopeEnds) {
            ctx.activeScopeEnds.length = backupMatch.activeScopeEndsLength;
          }
          matched = true;
        }

        if (!matched) {
          if (ctx.activeScopeEnds) {
            ctx.activeScopeEnds.length = baseActiveScopeEndsLength;
          }
          if (maxFailedOffset > currentOffset) {
            currentOffset = maxFailedOffset;
            if (currentOffset > offset) hasCommitted = true;
          }
          if (ctx.activeScopeEnds) {
            ctx.activeScopeEnds.length = initialActiveScopeEndsLength;
          }
          const startOffsetForFailure = ruleIsStructural && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset;
          const rec = this.handleFailure(text, startOffsetForFailure, rule.id, choiceErrorMsg, memo, ctx, hasCommitted, localMaxOffset);
          localMaxOffset = Math.max(localMaxOffset, rec.dependencyLimit);
          if (rec.action === 'break') {
            if (startOffsetForFailure < currentOffset) {
              results.length = lastStructuralResultsCount;
            }
            results.push(rec.res.node);
            currentOffset = rec.res.newOffset;
            panicked = true;
            break;
          }
          return rec.err;
        }
      }

      else if (rule.type === 'optional') {
        const startOffset = currentOffset;
        const beforeOptErrorsLength = ctx.recoveredErrors.length;
        const res = this.parsePattern(rule.value, text, currentOffset, memo, rule.id, ctx);
        localMaxOffset = Math.max(localMaxOffset, res.dependencyLimit);
        if (res.success) {
          if (res.value && (res.value.width > 0 || res.value.type === 'eof')) {
            results.push(res.value);
          }
          currentOffset = res.newOffset;
          if (ruleIsStructural && currentOffset > startOffset) {
            lastStructuralOffset = currentOffset;
            lastStructuralResultsCount = results.length;
          }
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
          if (res.value && (res.value.width > 0 || res.value.type === 'eof')) {
            matches.push(res.value);
          }
          currentOffset = res.newOffset;
        }
        if (matches.length > 0) {
          const loopWidth = currentOffset - loopStartOffset;
          if (loopWidth > 0) {
            results.push(GreenNode.create('zeroOrMore', matches, rule.id, loopWidth));
            if (ruleIsStructural && currentOffset > loopStartOffset) {
              lastStructuralOffset = currentOffset;
              lastStructuralResultsCount = results.length;
            }
          }
        }
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
          if (res.value && (res.value.width > 0 || res.value.type === 'eof')) {
            matches.push(res.value);
          }
          currentOffset = res.newOffset;
        }
        if (matches.length > 0) {
          const loopWidth = currentOffset - loopStartOffset;
          if (loopWidth > 0) {
            results.push(GreenNode.create('oneOrMore', matches, rule.id, loopWidth));
            if (ruleIsStructural && currentOffset > loopStartOffset) {
              lastStructuralOffset = currentOffset;
              lastStructuralResultsCount = results.length;
            }
          }
          if (currentOffset > offset) hasCommitted = true;
        } else {
          if (ctx.activeScopeEnds) {
            ctx.activeScopeEnds.length = initialActiveScopeEndsLength;
          }
          const startOffsetForFailure = ruleIsStructural && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset;
          const rec = this.handleFailure(text, startOffsetForFailure, rule.id, "Expected at least one match", memo, ctx, hasCommitted, localMaxOffset);
          localMaxOffset = Math.max(localMaxOffset, rec.dependencyLimit);
          if (rec.action === 'break') {
            if (startOffsetForFailure < currentOffset) {
              results.length = lastStructuralResultsCount;
            }
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
          results.push(GreenNode.create('eof', null, rule.id, 0));
          localMaxOffset = Math.max(localMaxOffset, currentOffset + 1);
        } else {
          localMaxOffset = Math.max(localMaxOffset, currentOffset + 1);
          if (ctx.activeScopeEnds) {
            ctx.activeScopeEnds.length = initialActiveScopeEndsLength;
          }
          const startOffsetForFailure = ruleIsStructural && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset;
          const rec = this.handleFailure(text, startOffsetForFailure, rule.id, "Expected EOF", memo, ctx, hasCommitted, localMaxOffset);
          localMaxOffset = Math.max(localMaxOffset, rec.dependencyLimit);
          if (rec.action === 'break') {
            if (startOffsetForFailure < currentOffset) {
              results.length = lastStructuralResultsCount;
            }
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
      ast: GreenNode.create(this.name, results, this.id, currentOffset - offset), 
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
    
    // DEBUG
    console.log(`attemptRecovery for ${this.name} at offset ${offset}. Patterns:`, patterns.map(p => typeof p === 'string' ? p : p instanceof RegExp ? p.source : (p as SyntaxElement).name));

    for (const pattern of patterns) {
      if (typeof pattern === 'string') {
        const idx = text.indexOf(pattern, offset);
        if (idx !== -1 && idx <= earliestIndex) {
          earliestIndex = idx;
          earliestNewOffset = idx; // Do not consume the boundary
        }
        maxEvalOffset = Math.max(maxEvalOffset, idx !== -1 ? idx + pattern.length : text.length);
      } else if (pattern instanceof RegExp) {
        const source = pattern.source;
        const flags = pattern.flags.replace('y', '');
        const searchRegex = new RegExp(source, flags);
        const match = searchRegex.exec(text.slice(offset));
        if (match && match.index !== undefined) {
          const absoluteIndex = offset + match.index;
          if (absoluteIndex <= earliestIndex) {
            earliestIndex = absoluteIndex;
            earliestNewOffset = absoluteIndex; // Do not consume the boundary
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
              earliestNewOffset = i; // Do NOT consume SyntaxElement! Wait, earlier it was res.newOffset. Let's fix to i!
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

  getAutoRecoveryPatterns(ctx: any): (string | RegExp | SyntaxElement)[] {
    const patterns: (string | RegExp | SyntaxElement)[] = [];
    
    // 1. Trace the trailing rules to find block terminators and closing markers
    for (let i = this.rules.length - 1; i >= 0; i--) {
      const r = this.rules[i];
      if (r.type === 'literal' && typeof r.value === 'string') {
        const val = r.value;
        if (val === ";" || val === "}" || val === "]" || val.startsWith("END")) {
          if (!patterns.includes(val)) patterns.push(val);
        }
        break;
      } else if (r.type === 'endScope' && typeof r.value === 'string') {
        const val = r.value;
        if (!patterns.includes(val)) patterns.push(val);
        break;
      } else if (r.type === 'choice' && Array.isArray(r.value)) {
        for (const choiceVal of r.value) {
          if (typeof choiceVal === 'string' && (choiceVal === ";" || choiceVal === "}" || choiceVal === "]" || choiceVal.startsWith("END"))) {
            if (!patterns.includes(choiceVal)) patterns.push(choiceVal);
          }
        }
        break;
      } else if (r.type === 'optional' || r.type === 'zeroOrMore') {
        continue;
      } else {
        break;
      }
    }

    // 2. Always include statement terminators: semicolon and newline
    if (!patterns.includes(";")) patterns.push(";");
    
    const hasNewlineRegExp = patterns.some(p => p instanceof RegExp && p.source.includes("\\n"));
    if (!hasNewlineRegExp) {
      patterns.push(/\r?\n/);
    }

    // 3. Include active scope ends (e.g. "}" of the surrounding block)
    if (ctx.activeScopeEnds && ctx.activeScopeEnds.length > 0) {
      for (const scopeEnd of ctx.activeScopeEnds) {
        if (typeof scopeEnd.value === 'string') {
          if (!patterns.includes(scopeEnd.value)) {
            patterns.push(scopeEnd.value);
          }
        }
      }
    }

    return patterns;
  }

  getTerminalLiterals(visited: Set<number> = new Set()): string[] {
    if (visited.has(this.id)) return [];
    visited.add(this.id);
    const literals: string[] = [];
    for (const rule of this.rules) {
      if ((rule.type === 'literal' || rule.type === 'endScope' || rule.type === 'beginScope') && typeof rule.value === 'string') {
        if (!literals.includes(rule.value)) {
          literals.push(rule.value);
        }
      } else if (rule.type === 'element' && rule.value instanceof SyntaxElement) {
        for (const lit of rule.value.getTerminalLiterals(visited)) {
          if (!literals.includes(lit)) {
            literals.push(lit);
          }
        }
      } else if (rule.type === 'choice' && Array.isArray(rule.value)) {
        for (const option of rule.value) {
          if (option instanceof SyntaxElement) {
            for (const lit of option.getTerminalLiterals(visited)) {
              if (!literals.includes(lit)) {
                literals.push(lit);
              }
            }
          } else if (typeof option === 'string') {
            if (!literals.includes(option)) {
              literals.push(option);
            }
          }
        }
      } else if ((rule.type === 'optional' || rule.type === 'zeroOrMore' || rule.type === 'oneOrMore' || rule.type === 'not') && rule.value) {
        if (rule.value instanceof SyntaxElement) {
          for (const lit of rule.value.getTerminalLiterals(visited)) {
            if (!literals.includes(lit)) {
              literals.push(lit);
            }
          }
        } else if (typeof rule.value === 'string') {
          if (!literals.includes(rule.value)) {
            literals.push(rule.value);
          }
        }
      }
    }
    return literals;
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

/**
 * Sorts patterns descending by their string representation/matching length.
 * This helper function prevents shadowing in first-ordered choice parsing
 * (e.g. matching 'float' before 'float4x4').
 */
export function Sort(...patterns: (string | RegExp | SyntaxElement)[] | [(string | RegExp | SyntaxElement)[]]): (string | RegExp | SyntaxElement)[] {
  const list = (patterns.length === 1 && Array.isArray(patterns[0]))
    ? patterns[0]
    : patterns as (string | RegExp | SyntaxElement)[];

  return [...list].sort((a, b) => {
    const lenA = typeof a === 'string' ? a.length : (a instanceof RegExp ? a.source.length : (a instanceof SyntaxElement ? a.name.length : 0));
    const lenB = typeof b === 'string' ? b.length : (b instanceof RegExp ? b.source.length : (b instanceof SyntaxElement ? b.name.length : 0));
    return lenB - lenA; // Sort descending (longest first)
  });
}

