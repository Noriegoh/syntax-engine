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
  static defaultLeadingTrivia?: string | RegExp | SyntaxElement;
  static defaultTrailingTrivia?: string | RegExp | SyntaxElement;

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

  astNodeName?: string;
  isEnumTarget: boolean = false;
  enumName?: string;
  
  AsNode(name: string): this {
    this.astNodeName = name;
    return this;
  }
  
  MapToEnum(name: string): this {
    this.isEnumTarget = true;
    this.enumName = name;
    return this;
  }
  
  As(name: string): this {
    if (this.rules.length > 0) {
      this.rules[this.rules.length - 1].label = name;
    }
    return this;
  }

  Ignore(): this {
    if (this.rules.length > 0) {
      this.rules[this.rules.length - 1].ignored = true;
    }
    return this;
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

  isInlineElement: boolean = false;

  Inline(): InlineMarker {
    this.isInlineElement = true;
    return {
      __isInlineMarker: true,
      element: this
    };
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

  BeginScope(pattern: string | RegExp | SyntaxElement | TokenMarker): this {
    if (pattern && typeof pattern === 'object' && '__isTokenMarker' in pattern) {
      const inner = pattern.pattern;
      const lead = SyntaxElement.defaultLeadingTrivia;
      const trail = SyntaxElement.defaultTrailingTrivia;
      if (lead) this.LeadingTrivia(lead);
      this.BeginScope(inner as any);
      if (trail) this.TrailingTrivia(trail);
    } else {
      const id = nextRuleId();
      this.rules.push({ id, type: 'beginScope', value: pattern });
    }
    return this;
  }

  EndScope(pattern: string | RegExp | SyntaxElement | TokenMarker): this {
    if (pattern && typeof pattern === 'object' && '__isTokenMarker' in pattern) {
      const inner = pattern.pattern;
      const lead = SyntaxElement.defaultLeadingTrivia;
      const trail = SyntaxElement.defaultTrailingTrivia;
      if (lead) this.LeadingTrivia(lead);
      this.EndScope(inner as any);
      if (trail) this.TrailingTrivia(trail);
    } else {
      const id = nextRuleId();
      this.rules.push({ id, type: 'endScope', value: pattern });
    }
    return this;
  }

  Expects(pattern: string | RegExp | SyntaxElement | TokenMarker | InlineMarker): this {
    if (pattern && typeof pattern === 'object' && '__isTokenMarker' in pattern) {
      const inner = pattern.pattern;
      const lead = SyntaxElement.defaultLeadingTrivia;
      const trail = SyntaxElement.defaultTrailingTrivia;
      if (lead) this.LeadingTrivia(lead);
      this.Expects(inner as any);
      if (trail) this.TrailingTrivia(trail);
    } else if (pattern && typeof pattern === 'object' && '__isInlineMarker' in pattern) {
      const el = pattern.element;
      for (const rule of el.rules) {
        this.rules.push({ ...rule, id: nextRuleId() });
      }
    } else {
      const id = nextRuleId();
      if (pattern instanceof SyntaxElement) {
        if (pattern.isInlineElement) {
          for (const rule of pattern.rules) {
            this.rules.push({ ...rule, id: nextRuleId() });
          }
        } else {
          this.rules.push({ id, type: 'element', value: pattern });
        }
      } else if (pattern instanceof RegExp) {
        this.rules.push({ id, type: 'regex', value: pattern });
      } else {
        this.rules.push({ id, type: 'literal', value: pattern });
      }
    }
    return this;
  }

  ExpectsWhitespace(): this {
    const id = nextRuleId();
    this.rules.push({ id, type: 'whitespace' });
    return this;
  }

  Unexpects(pattern: string | SyntaxElement | TokenMarker | InlineMarker): this {
    const unwrapped = unwrapToken(pattern);
    const id = nextRuleId();
    this.rules.push({ id, type: 'not', value: unwrapped });
    return this;
  }

  ExpectsOneOf(...patterns: (string | RegExp | SyntaxElement | TokenMarker | InlineMarker)[] | [(string | RegExp | SyntaxElement | TokenMarker | InlineMarker)[]]): this {
    const flatPatterns = (patterns.length === 1 && Array.isArray(patterns[0]))
      ? patterns[0]
      : patterns as (string | RegExp | SyntaxElement | TokenMarker | InlineMarker)[];
      
    let hasToken = false;
    const unwrapped: (string | RegExp | SyntaxElement)[] = [];
    for (const p of flatPatterns) {
      if (p && typeof p === 'object' && '__isTokenMarker' in p) {
        hasToken = true;
        unwrapped.push(unwrapToken(p));
      } else if (p && typeof p === 'object' && '__isInlineMarker' in p) {
        unwrapped.push(unwrapToken(p));
      } else {
        unwrapped.push(p as any);
      }
    }
    
    if (hasToken) {
      const lead = SyntaxElement.defaultLeadingTrivia;
      const trail = SyntaxElement.defaultTrailingTrivia;
      if (lead) this.LeadingTrivia(lead);
      
      const id = nextRuleId();
      this.rules.push({ id, type: 'choice', value: unwrapped });
      
      if (trail) this.TrailingTrivia(trail);
    } else {
      const id = nextRuleId();
      this.rules.push({ id, type: 'choice', value: unwrapped as any });
    }
    return this;
  }

  Optional(pattern: string | RegExp | SyntaxElement | TokenMarker | InlineMarker): this {
    if (pattern && typeof pattern === 'object' && '__isTokenMarker' in pattern) {
      const inner = pattern.pattern;
      const lead = SyntaxElement.defaultLeadingTrivia;
      const trail = SyntaxElement.defaultTrailingTrivia;
      if (lead) this.LeadingTrivia(lead);
      this.Optional(inner as any);
      if (trail) this.TrailingTrivia(trail);
    } else if (pattern && typeof pattern === 'object' && '__isInlineMarker' in pattern) {
      const el = pattern.element;
      const id = nextRuleId();
      this.rules.push({ id, type: 'optional', value: el });
    } else {
      const id = nextRuleId();
      this.rules.push({ id, type: 'optional', value: pattern });
    }
    return this;
  }

  ZeroOrMore(pattern: string | RegExp | SyntaxElement | TokenMarker | InlineMarker): this {
    if (pattern && typeof pattern === 'object' && '__isTokenMarker' in pattern) {
      const inner = pattern.pattern;
      const lead = SyntaxElement.defaultLeadingTrivia;
      const trail = SyntaxElement.defaultTrailingTrivia;
      if (lead) this.LeadingTrivia(lead);
      this.ZeroOrMore(inner as any);
      if (trail) this.TrailingTrivia(trail);
    } else if (pattern && typeof pattern === 'object' && '__isInlineMarker' in pattern) {
      const el = pattern.element;
      const id = nextRuleId();
      this.rules.push({ id, type: 'zeroOrMore', value: el });
    } else {
      const id = nextRuleId();
      this.rules.push({ id, type: 'zeroOrMore', value: pattern });
    }
    return this;
  }

  OneOrMore(pattern: string | RegExp | SyntaxElement | TokenMarker | InlineMarker): this {
    if (pattern && typeof pattern === 'object' && '__isTokenMarker' in pattern) {
      const inner = pattern.pattern;
      const lead = SyntaxElement.defaultLeadingTrivia;
      const trail = SyntaxElement.defaultTrailingTrivia;
      if (lead) this.LeadingTrivia(lead);
      this.OneOrMore(inner as any);
      if (trail) this.TrailingTrivia(trail);
    } else if (pattern && typeof pattern === 'object' && '__isInlineMarker' in pattern) {
      const el = pattern.element;
      const id = nextRuleId();
      this.rules.push({ id, type: 'oneOrMore', value: el });
    } else {
      const id = nextRuleId();
      this.rules.push({ id, type: 'oneOrMore', value: pattern });
    }
    return this;
  }

  ExpectsEOF(): this {
    const id = nextRuleId();
    this.rules.push({ id, type: 'eof' });
    return this;
  }

  LeadingTrivia(pattern: string | RegExp | SyntaxElement): this {
    const id = nextRuleId();
    this.rules.push({ id, type: 'leadingTrivia', value: pattern });
    return this;
  }

  TrailingTrivia(pattern: string | RegExp | SyntaxElement): this {
    const id = nextRuleId();
    this.rules.push({ id, type: 'trailingTrivia', value: pattern });
    return this;
  }

  Token(pattern: string | RegExp | SyntaxElement | ScopeMarker | TokenMarker, leading?: string | RegExp | SyntaxElement, trailing?: string | RegExp | SyntaxElement): this {
    const lead = leading !== undefined ? leading : SyntaxElement.defaultLeadingTrivia;
    const trail = trailing !== undefined ? trailing : SyntaxElement.defaultTrailingTrivia;
    if (lead) this.LeadingTrivia(lead);
    
    const realPattern = (pattern && typeof pattern === 'object' && '__isTokenMarker' in pattern) ? pattern.pattern : pattern;
    
    if (realPattern && typeof realPattern === 'object' && 'type' in realPattern && (realPattern.type === 'beginScope' || realPattern.type === 'endScope')) {
      const id = nextRuleId();
      this.rules.push({ id, type: realPattern.type, value: realPattern.value });
    } else {
      if (realPattern instanceof SyntaxElement) {
        const id = nextRuleId();
        this.rules.push({ id, type: 'element', value: realPattern });
      } else if (realPattern instanceof RegExp) {
        const id = nextRuleId();
        this.rules.push({ id, type: 'regex', value: realPattern });
      } else {
        const id = nextRuleId();
        this.rules.push({ id, type: 'literal', value: realPattern });
      }
    }
    
    if (trail) this.TrailingTrivia(trail);
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
                const lits = scopeEnd.value.getTerminalLiterals();
                if (lits.some(lit => char === lit[0])) {
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
    context?: { maxOffset?: number; maxError?: ParseResult | null; expectedPaths?: string[]; recoveredErrors?: ParseError[]; activeScopeEnds?: any[]; cacheHits?: number; cacheMisses?: number; profile?: boolean; profileStack?: any[]; profileRoot?: any }
  ): ParseResult | null {
    const memoKey = `${this.id}-${offset}`;
    const ctx: any = context || { maxOffset: -1, maxError: null, expectedPaths: [], recoveredErrors: [], activeScopeEnds: [] };
    if (ctx.maxOffset === undefined) ctx.maxOffset = -1;
    if (ctx.maxError === undefined) ctx.maxError = null;
    if (ctx.expectedPaths === undefined) ctx.expectedPaths = [];
    if (ctx.recoveredErrors === undefined) ctx.recoveredErrors = [];
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
      } else if ((rule.type === 'element' || rule.type === 'optional' || rule.type === 'leadingTrivia' || rule.type === 'trailingTrivia' || rule.type === 'zeroOrMore' || rule.type === 'oneOrMore' || rule.type === 'not') && rule.value instanceof SyntaxElement && rule.value.isHiddenElement) {
        ruleIsStructural = false;
      }

      if (rule.type === 'element' || rule.type === 'literal' || rule.type === 'regex' || rule.type === 'beginScope' || rule.type === 'endScope') {
        const startOffset = currentOffset;
        const res = this.parsePattern(rule.value, text, currentOffset, memo, rule.id, ctx);
        localMaxOffset = Math.max(localMaxOffset, res.dependencyLimit);
        if (res.success) {
          if (res.value && (res.value.width > 0 || res.value.type === 'eof')) {
            if (rule.value instanceof SyntaxElement && rule.value.isInlineElement && Array.isArray(res.value.value)) {
              results.push(...res.value.value);
            } else {
              results.push(res.value);
            }
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
          pattern: any;
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
                if (pattern instanceof SyntaxElement && pattern.isInlineElement && Array.isArray(res.value.value)) {
                  results.push(...res.value.value);
                } else {
                  results.push(res.value);
                }
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
                  pattern: pattern,
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
            const pattern = backupMatch.pattern;
            if (pattern instanceof SyntaxElement && pattern.isInlineElement && Array.isArray(backupMatch.resVal.value)) {
              results.push(...backupMatch.resVal.value);
            } else {
              results.push(backupMatch.resVal);
            }
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

      else if (rule.type === 'optional' || rule.type === 'leadingTrivia' || rule.type === 'trailingTrivia') {
        const startOffset = currentOffset;
        const beforeOptErrorsLength = ctx.recoveredErrors.length;
        const res = this.parsePattern(rule.value, text, currentOffset, memo, rule.id, ctx);
        localMaxOffset = Math.max(localMaxOffset, res.dependencyLimit);
        if (res.success) {
          if (res.value && (res.value.width > 0 || res.value.type === 'eof')) {
            if (rule.value instanceof SyntaxElement && rule.value.isInlineElement && Array.isArray(res.value.value)) {
              results.push(...res.value.value);
            } else {
              results.push(res.value);
            }
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
            if (rule.value instanceof SyntaxElement && rule.value.isInlineElement && Array.isArray(res.value.value)) {
              matches.push(...res.value.value);
            } else {
              matches.push(res.value);
            }
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
            if (rule.value instanceof SyntaxElement && rule.value.isInlineElement && Array.isArray(res.value.value)) {
              matches.push(...res.value.value);
            } else {
              matches.push(res.value);
            }
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
        let scanOffset = currentOffset;
        if (SyntaxElement.defaultLeadingTrivia) {
          const skipRes = this.parsePattern(SyntaxElement.defaultLeadingTrivia, text, scanOffset, memo, rule.id, ctx);
          if (skipRes.success) {
            scanOffset = skipRes.newOffset;
          }
        } else {
          while (scanOffset < text.length && /\s/.test(text[scanOffset])) {
            scanOffset++;
          }
        }
        const res = this.parsePattern(rule.value, text, scanOffset, memo, rule.id, ctx);
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
      } else if (r.type === 'optional' || r.type === 'leadingTrivia' || r.type === 'trailingTrivia' || r.type === 'zeroOrMore') {
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
        } else if (scopeEnd.value instanceof SyntaxElement) {
          for (const lit of scopeEnd.value.getTerminalLiterals()) {
            if (!patterns.includes(lit)) {
              patterns.push(lit);
            }
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
      } else if ((rule.type === 'optional' || rule.type === 'leadingTrivia' || rule.type === 'trailingTrivia' || rule.type === 'zeroOrMore' || rule.type === 'oneOrMore' || rule.type === 'not') && rule.value) {
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

  autoInjectLoopBoundaries(visited: Set<number> = new Set()): void {
    if (visited.has(this.id)) return;
    visited.add(this.id);

    // 1. Process all sub-elements first
    for (const rule of this.rules) {
      if (rule.value instanceof SyntaxElement) {
        rule.value.autoInjectLoopBoundaries(visited);
      } else if (rule.type === 'choice' && Array.isArray(rule.value)) {
        for (const choice of rule.value) {
          if (choice instanceof SyntaxElement) {
            choice.autoInjectLoopBoundaries(visited);
          }
        }
      } else if (rule.type === 'zeroOrMore' && rule.value instanceof SyntaxElement) {
        rule.value.autoInjectLoopBoundaries(visited);
      } else if (rule.type === 'oneOrMore' && rule.value instanceof SyntaxElement) {
        rule.value.autoInjectLoopBoundaries(visited);
      } else if (rule.type === 'optional' && rule.value instanceof SyntaxElement) {
        rule.value.autoInjectLoopBoundaries(visited);
      }
    }

    // 2. Scan for loops to inject boundaries
    for (let i = 0; i < this.rules.length; i++) {
      const rule = this.rules[i];
      if ((rule.type === 'zeroOrMore' || rule.type === 'oneOrMore') && rule.value instanceof SyntaxElement) {
        const loopChild = rule.value;
        const followPatterns = this.gatherFollowPatterns(this.rules, i + 1, new Set());
        if (followPatterns.length > 0) {
          for (const rawPattern of followPatterns) {
            const pattern = unwrapToken(rawPattern);
            if (typeof pattern === 'string' || pattern instanceof RegExp) {
              const alreadyHasNot = loopChild.rules.some(r => r.type === 'not' && r.value === pattern);
              if (!alreadyHasNot) {
                const notRuleId = nextRuleId();
                loopChild.rules.unshift({ id: notRuleId, type: 'not', value: pattern });
              }
            }
          }
        }
      }
    }
  }

  private gatherFollowPatterns(rules: Rule[], startIndex: number, visitedElements: Set<number>): any[] {
    const patterns: any[] = [];
    for (let j = startIndex; j < rules.length; j++) {
      const rule = rules[j];
      const subPatterns = this.collectStartPatterns(rule, visitedElements);
      patterns.push(...subPatterns);
      if (!this.isOptionalRule(rule)) {
        break;
      }
    }
    return patterns;
  }

  private collectStartPatterns(rule: Rule, visitedElements: Set<number>): any[] {
    if (!rule) return [];
    if (rule.type === 'literal' || rule.type === 'beginScope' || rule.type === 'endScope') {
      return [rule.value];
    }
    if (rule.type === 'regex') {
      return [rule.value];
    }
    if (rule.type === 'choice' && Array.isArray(rule.value)) {
      const pats: any[] = [];
      for (const choice of rule.value) {
        if (choice instanceof SyntaxElement) {
          pats.push(...this.collectElementStartPatterns(choice, visitedElements));
        } else {
          pats.push(choice);
        }
      }
      return pats;
    }
    if (rule.type === 'element' && rule.value instanceof SyntaxElement) {
      return this.collectElementStartPatterns(rule.value, visitedElements);
    }
    if ((rule.type === 'optional' || rule.type === 'zeroOrMore' || rule.type === 'oneOrMore') && rule.value) {
      if (rule.value instanceof SyntaxElement) {
        return this.collectElementStartPatterns(rule.value, visitedElements);
      } else {
        return [rule.value];
      }
    }
    return [];
  }

  private collectElementStartPatterns(element: SyntaxElement, visitedElements: Set<number>): any[] {
    if (visitedElements.has(element.id)) return [];
    visitedElements.add(element.id);
    const pats: any[] = [];
    for (let i = 0; i < element.rules.length; i++) {
      const r = element.rules[i];
      const startPats = this.collectStartPatterns(r, visitedElements);
      pats.push(...startPats);
      if (!this.isOptionalRule(r)) {
        break;
      }
    }
    return pats;
  }

  private isOptionalRule(rule: Rule): boolean {
    if (!rule) return true;
    if (rule.type === 'optional' || rule.type === 'zeroOrMore' || rule.type === 'leadingTrivia' || rule.type === 'trailingTrivia' || rule.type === 'whitespace') {
      return true;
    }
    return false;
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

export function DefaultLeadingTrivia(pattern: string | RegExp | SyntaxElement): void {
  SyntaxElement.defaultLeadingTrivia = pattern;
}

export function DefaultTrailingTrivia(pattern: string | RegExp | SyntaxElement): void {
  SyntaxElement.defaultTrailingTrivia = pattern;
}

export interface ScopeMarker {
  type: 'beginScope' | 'endScope';
  value: string | RegExp | SyntaxElement;
}

export function BeginScope(pattern: string | RegExp | SyntaxElement): ScopeMarker {
  return { type: 'beginScope', value: pattern };
}

export function EndScope(pattern: string | RegExp | SyntaxElement): ScopeMarker {
  return { type: 'endScope', value: pattern };
}

export interface TokenMarker {
  __isTokenMarker: true;
  pattern: string | RegExp | SyntaxElement | ScopeMarker;
}

export function Token(pattern: string | RegExp | SyntaxElement | ScopeMarker): TokenMarker {
  return {
    __isTokenMarker: true,
    pattern
  };
}

export interface InlineMarker {
  __isInlineMarker: true;
  element: SyntaxElement;
}

export function Inline(element: SyntaxElement): InlineMarker {
  return {
    __isInlineMarker: true,
    element
  };
}

export function unwrapToken(pattern: any): any {
  if (pattern && typeof pattern === 'object' && '__isTokenMarker' in pattern) {
    return unwrapToken(pattern.pattern);
  }
  if (pattern && typeof pattern === 'object' && '__isInlineMarker' in pattern) {
    return unwrapToken(pattern.element);
  }
  if (pattern && typeof pattern === 'object' && 'type' in pattern && (pattern.type === 'beginScope' || pattern.type === 'endScope')) {
    return unwrapToken(pattern.value);
  }
  return pattern;
}

