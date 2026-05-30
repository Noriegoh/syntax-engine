import { matchRegex, WS_REGEX, nextRuleId } from './utils';

// ==========================================
// SECTION 1: GLOBAL TYPE & INTERFACE DEFINITIONS
// ==========================================

export type RuleType = 
  | 'literal' 
  | 'regex' 
  | 'element' 
  | 'not' 
  | 'assert'
  | 'separatedBy'
  | 'whitespace' 
  | 'choice' 
  | 'optional' 
  | 'leadingTrivia' 
  | 'trailingTrivia' 
  | 'zeroOrMore' 
  | 'oneOrMore' 
  | 'zeroOrMoreOneOf'
  | 'oneOrMoreOneOf'
  | 'eof' 
  | 'beginScope' 
  | 'endScope';

export interface Rule {
  id: number;
  type: RuleType;
  value?: any;
  label?: string;
  ignored?: boolean;
}

export interface ParseError {
  message: string;
  offset: number;
}

export interface ParseResult {
  ast: GreenNode | null;
  newOffset: number;
  error?: string;
  ruleId?: number;
  dependencyLimit: number;
  recoveredErrors?: ParseError[];
  astDelta?: number;
}

// ==========================================
// SECTION 2: GREEN NODE & RED NODE DATA STRUCTURES
// ==========================================

export class GreenNode {
  private static cache = new Map<string, GreenNode>();
  private static lastId = 0;

  public readonly id: number;

  private constructor(
    public readonly type: string,
    public readonly value: any,
    public readonly ruleId: number,
    public readonly width: number
  ) {
    this.id = ++GreenNode.lastId;
  }

  public static create(
    type: string,
    value: any,
    ruleId: number,
    width: number
  ): GreenNode {
    let valueKey = "";
    if (value === null || value === undefined) {
      valueKey = "null";
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      valueKey = String(value);
    } else if (Array.isArray(value)) {
      valueKey = `[${value.map((c) => (c ? (c as any).id || "0" : "0")).join(",")}]`;
    } else {
      valueKey = "obj";
    }

    // SPEED REMEDY: ruleId removed from the GreenNode hash key to leverage structural caching reuse
    const key = `${type}:${width}:${valueKey}`;
    let cached = GreenNode.cache.get(key);
    if (!cached) {
      cached = new GreenNode(type, value, ruleId, width);
      GreenNode.cache.set(key, cached);
    }
    return cached;
  }

  public static clearCache() {
    GreenNode.cache.clear();
  }
}

export class RedNode {
  public readonly type: string;
  public readonly width: number;
  private _value: any = null;
  private _isResolved = false;

  constructor(
    public readonly green: GreenNode,
    public readonly parent: RedNode | null,
    public readonly offset: number
  ) {
    this.type = green.type;
    this.width = green.width;
  }

  public get value(): any {
    if (this._isResolved) {
      return this._value;
    }
    const val = this.green.value;
    if (Array.isArray(val)) {
      let currentOffset = this.offset;
      this._value = val.map((g) => {
        if (!g) return null;
        const redChild = new RedNode(g, this, currentOffset);
        currentOffset += g.width;
        return redChild;
      });
    } else {
      this._value = val;
    }
    this._isResolved = true;
    return this._value;
  }
}

// AST Transformer cache helpers
export function wrapASTTransformerWithIncrementalCache(userAstCode: string): string {
  return `
    if (!globalThis.__astCache) {
      globalThis.__astCache = new WeakMap();
    }
    const cache = globalThis.__astCache;
    
    function transform(node, fullText) {
      if (!node) return null;
      if (cache.has(node.green)) {
        return cache.get(node.green);
      }
      
      const innerTransform = (cst, fullText) => {
        ${userAstCode}
      };
      
      const res = innerTransform(node, fullText);
      cache.set(node.green, res);
      return res;
    }
    
    return transform(cst, fullText);
  `;
}

// ==========================================
// SECTION 3: SYNTAXELEMENT (ENGINE BACKBONE)
// ==========================================

export class SyntaxElement {
  public static defaultLeadingTrivia?: string | RegExp | SyntaxElement;
  public static defaultTrailingTrivia?: string | RegExp | SyntaxElement;

  private static lastId = 0;
  
  public readonly id: number;
  public readonly name: string;
  public readonly rules: Rule[] = [];
  
  public isHiddenElement: boolean = false;
  public enumName: string | null = null;
  public astNodeName: string | null = null;
  public isIgnoredElement: boolean = false;
  public isAutoHealing: boolean = false;

  public get isEnumTarget(): boolean {
    return this.enumName !== null;
  }

  public recoveryPatterns: (string | RegExp | SyntaxElement)[] | null = null;
  public autoHealingBoundaries: (string | RegExp | SyntaxElement)[] | null = null;

  constructor(name: string) {
    this.id = ++SyntaxElement.lastId;
    this.name = name;
  }

  // Builder Methods
  AsNode(nodeName: string): this {
    this.astNodeName = nodeName;
    return this;
  }

  MapToEnum(enumName: string): this {
    this.enumName = enumName;
    return this;
  }

  As(fieldName: string): this {
    if (this.rules.length > 0) {
      this.rules[this.rules.length - 1].label = fieldName;
    }
    return this;
  }

  Ignore(): this {
    if (this.rules.length > 0) {
      this.rules[this.rules.length - 1].ignored = true;
    }
    return this;
  }

  Inline(): this {
    this.isHiddenElement = true;
    return this;
  }

  IgnoreSelf(): this {
    this.isIgnoredElement = true;
    return this;
  }

  RecoverWith(...boundaries: (string | RegExp | SyntaxElement)[]): this {
    this.recoveryPatterns = boundaries;
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

  Expects(pattern: string | RegExp | SyntaxElement | TokenMarker): this {
    if (pattern && typeof pattern === 'object' && '__isTokenMarker' in pattern) {
      const inner = pattern.pattern;
      const lead = SyntaxElement.defaultLeadingTrivia;
      const trail = SyntaxElement.defaultTrailingTrivia;
      if (lead) this.LeadingTrivia(lead);
      this.Expects(inner as any);
      if (trail) this.TrailingTrivia(trail);
    } else {
      const id = nextRuleId();
      if (pattern instanceof SyntaxElement) {
        this.rules.push({ id, type: 'element', value: pattern });
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

  Unexpects(pattern: string | SyntaxElement | TokenMarker): this {
    const unwrapped = unwrapToken(pattern);
    const id = nextRuleId();
    this.rules.push({ id, type: 'not', value: unwrapped });
    return this;
  }

  ExpectsOneOf(...patterns: any[]): this {
    const flatten = (arr: any[]): any[] => {
      const res: any[] = [];
      for (const item of arr) {
        if (Array.isArray(item)) {
          res.push(...flatten(item));
        } else {
          res.push(item);
        }
      }
      return res;
    };
    
    const flatPatterns = flatten(patterns);
      
    let hasToken = false;
    const unwrapped: (string | RegExp | SyntaxElement)[] = [];
    for (const p of flatPatterns) {
      if (p && typeof p === 'object' && '__isTokenMarker' in p) {
        hasToken = true;
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

  Optional(pattern: string | RegExp | SyntaxElement | TokenMarker): this {
    if (pattern && typeof pattern === 'object' && '__isTokenMarker' in pattern) {
      const inner = pattern.pattern;
      const lead = SyntaxElement.defaultLeadingTrivia;
      const trail = SyntaxElement.defaultTrailingTrivia;
      if (lead) this.LeadingTrivia(lead);
      this.Optional(inner as any);
      if (trail) this.TrailingTrivia(trail);
    } else {
      const id = nextRuleId();
      this.rules.push({ id, type: 'optional', value: pattern });
    }
    return this;
  }

  ZeroOrMore(pattern: any, ...additional: any[]): this {
    if (additional.length > 0 || Array.isArray(pattern)) {
      const all = Array.isArray(pattern) ? pattern : [pattern, ...additional];
      return this.ZeroOrMoreOneOf(...all);
    }
    if (pattern && typeof pattern === 'object' && '__isTokenMarker' in pattern) {
      const inner = pattern.pattern;
      const lead = SyntaxElement.defaultLeadingTrivia;
      const trail = SyntaxElement.defaultTrailingTrivia;
      if (lead) this.LeadingTrivia(lead);
      this.ZeroOrMore(inner as any);
      if (trail) this.TrailingTrivia(trail);
    } else {
      const id = nextRuleId();
      this.rules.push({ id, type: 'zeroOrMore', value: pattern });
    }
    return this;
  }

  ZeroOrMoreOneOf(...patterns: any[]): this {
    const flatten = (arr: any[]): any[] => {
      const res: any[] = [];
      for (const item of arr) {
        if (Array.isArray(item)) {
          res.push(...flatten(item));
        } else {
          res.push(item);
        }
      }
      return res;
    };
    
    const flatPatterns = flatten(patterns);
      
    let hasToken = false;
    const unwrapped: (string | RegExp | SyntaxElement)[] = [];
    for (const p of flatPatterns) {
      if (p && typeof p === 'object' && '__isTokenMarker' in p) {
        hasToken = true;
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
      this.rules.push({ id, type: 'zeroOrMoreOneOf', value: unwrapped });
      
      if (trail) this.TrailingTrivia(trail);
    } else {
      const id = nextRuleId();
      this.rules.push({ id, type: 'zeroOrMoreOneOf', value: unwrapped as any });
    }
    return this;
  }

  OneOrMore(pattern: any, ...additional: any[]): this {
    if (additional.length > 0 || Array.isArray(pattern)) {
      const all = Array.isArray(pattern) ? pattern : [pattern, ...additional];
      return this.OneOrMoreOneOf(...all);
    }
    if (pattern && typeof pattern === 'object' && '__isTokenMarker' in pattern) {
      const inner = pattern.pattern;
      const lead = SyntaxElement.defaultLeadingTrivia;
      const trail = SyntaxElement.defaultTrailingTrivia;
      if (lead) this.LeadingTrivia(lead);
      this.OneOrMore(inner as any);
      if (trail) this.TrailingTrivia(trail);
    } else {
      const id = nextRuleId();
      this.rules.push({ id, type: 'oneOrMore', value: pattern });
    }
    return this;
  }

  OneOrMoreOneOf(...patterns: any[]): this {
    const flatten = (arr: any[]): any[] => {
      const res: any[] = [];
      for (const item of arr) {
        if (Array.isArray(item)) {
          res.push(...flatten(item));
        } else {
          res.push(item);
        }
      }
      return res;
    };
    
    const flatPatterns = flatten(patterns);
      
    let hasToken = false;
    const unwrapped: (string | RegExp | SyntaxElement)[] = [];
    for (const p of flatPatterns) {
      if (p && typeof p === 'object' && '__isTokenMarker' in p) {
        hasToken = true;
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
      this.rules.push({ id, type: 'oneOrMoreOneOf', value: unwrapped });
      
      if (trail) this.TrailingTrivia(trail);
    } else {
      const id = nextRuleId();
      this.rules.push({ id, type: 'oneOrMoreOneOf', value: unwrapped as any });
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

  SeparatedBy(item: any, separator: any): this {
    const id = nextRuleId();
    let unwrappedItem = item;
    let unwrappedSep = separator;
    if (item && typeof item === 'object' && '__isTokenMarker' in item) {
      unwrappedItem = unwrapToken(item);
    }
    if (separator && typeof separator === 'object' && '__isTokenMarker' in separator) {
      unwrappedSep = unwrapToken(separator);
    }
    this.rules.push({ id, type: 'separatedBy', value: { item: unwrappedItem, separator: unwrappedSep } });
    return this;
  }

  Assert(pattern: string | RegExp | SyntaxElement | TokenMarker): this {
    const unwrapped = unwrapToken(pattern);
    const id = nextRuleId();
    this.rules.push({ id, type: 'assert', value: unwrapped });
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

  getHierarchy(visited = new Set<number>()): any {
    if (visited.has(this.id)) return { name: this.name, id: this.id, isLoop: true };
    const nextVisited = new Set(visited);
    nextVisited.add(this.id);
    
    return {
      id: this.id,
      name: this.name,
      rules: this.rules.map(r => {
        let val = r.value;
        if (r.type === 'choice' || r.type === 'zeroOrMoreOneOf' || r.type === 'oneOrMoreOneOf') {
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

    const patternOverlaps = (startPat: any, followPat: any): boolean => {
      if (!startPat || !followPat) return false;
      
      const sp = unwrapToken(startPat);
      const fp = unwrapToken(followPat);
      
      if (typeof sp === 'string' && typeof fp === 'string') {
        return sp === fp || fp.startsWith(sp) || sp.startsWith(fp);
      }
      
      if (sp instanceof RegExp && typeof fp === 'string') {
        try {
          const anchored = new RegExp('^(?:' + sp.source + ')');
          const m = anchored.exec(fp);
          return m !== null && m[0].length > 0;
        } catch (_) {
          return true;
        }
      }
      
      if (typeof sp === 'string' && fp instanceof RegExp) {
        try {
          const anchored = new RegExp('^(?:' + fp.source + ')');
          const m = anchored.exec(sp);
          return m !== null && m[0].length > 0;
        } catch (_) {
          return true;
        }
      }
      
      if (sp instanceof RegExp && fp instanceof RegExp) {
        if (sp.source === fp.source) return true;
        return true;
      }
      
      return false;
    };

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
      } else if ((rule.type === 'zeroOrMoreOneOf' || rule.type === 'oneOrMoreOneOf') && Array.isArray(rule.value)) {
        for (const choice of rule.value) {
          if (choice instanceof SyntaxElement) {
            choice.autoInjectLoopBoundaries(visited);
          }
        }
      } else if (rule.type === 'optional' && rule.value instanceof SyntaxElement) {
        rule.value.autoInjectLoopBoundaries(visited);
      }
    }

    const someStartPatternOverlaps = (loopElement: SyntaxElement, followPat: any): boolean => {
      const startingPats = this.collectElementStartPatterns(loopElement, new Set());
      for (const startPat of startingPats) {
        if (patternOverlaps(startPat, followPat)) {
          return true;
        }
      }
      return false;
    };

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
              if (someStartPatternOverlaps(loopChild, pattern)) {
                const alreadyHasNot = loopChild.rules.some(r => r.type === 'not' && r.value === pattern);
                if (!alreadyHasNot) {
                  const notRuleId = nextRuleId();
                  loopChild.rules.unshift({ id: notRuleId, type: 'not', value: pattern });
                }
              }
            }
          }
        }
      } else if ((rule.type === 'zeroOrMoreOneOf' || rule.type === 'oneOrMoreOneOf') && Array.isArray(rule.value)) {
        const followPatterns = this.gatherFollowPatterns(this.rules, i + 1, new Set());
        if (followPatterns.length > 0) {
          for (const rawPattern of followPatterns) {
            const pattern = unwrapToken(rawPattern);
            if (typeof pattern === 'string' || pattern instanceof RegExp) {
              for (const choice of rule.value) {
                if (choice instanceof SyntaxElement) {
                  if (someStartPatternOverlaps(choice, pattern)) {
                    const alreadyHasNot = choice.rules.some(r => r.type === 'not' && r.value === pattern);
                    if (!alreadyHasNot) {
                      const notRuleId = nextRuleId();
                      choice.rules.unshift({ id: notRuleId, type: 'not', value: pattern });
                    }
                  }
                }
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
    if ((rule.type === 'zeroOrMoreOneOf' || rule.type === 'oneOrMoreOneOf') && Array.isArray(rule.value)) {
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
    if (rule.type === 'optional' || rule.type === 'zeroOrMore' || rule.type === 'zeroOrMoreOneOf' || rule.type === 'leadingTrivia' || rule.type === 'trailingTrivia' || rule.type === 'whitespace') {
      return true;
    }
    return false;
  }

  // ==========================================
  // SECTION 4: CORE PARSING MECHANICS (REFACTORED OOD DECOUPLED)
  // ==========================================

  private parsePattern(
    pattern: string | RegExp | SyntaxElement, 
    text: string, 
    currentOffset: number, 
    memo: Map<string, ParseResult>, 
    ruleId: number, 
    context?: any
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
    // 2. Fallback auto-recovery (self-healing)
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
    context?: any
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
      
      if (cached.astDelta && cached.astDelta !== 0) {
        const d = cached.astDelta;
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
          if (!ctx.recoveredErrors.some((e: any) => e.offset === err.offset && e.message === err.message)) {
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
      ctx.recoveredErrors.length = initialErrorsLength;
    } else if (res) {
      const newErrors = ctx.recoveredErrors.slice(initialErrorsLength);
      if (newErrors.length > 0) {
        res.recoveredErrors = newErrors.map((err: any) => ({ ...err }));
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

  private isRuleStructural(rule: Rule): boolean {
    if (rule.type === 'whitespace' || rule.type === 'leadingTrivia' || rule.type === 'trailingTrivia') return false;
    if (rule.type === 'optional' || rule.type === 'zeroOrMore' || rule.type === 'zeroOrMoreOneOf') return false;
    if (rule.type === 'not') return false;
    return true;
  }

  private parseInternal(
    text: string, 
    offset: number, 
    memo: Map<string, ParseResult>, 
    ctx: any
  ): ParseResult {
    let currentOffset = offset;
    let localMaxOffset = offset;
    let results: any[] = [];
    let panicked = false;
    let hasCommitted = false;
    const initialActiveScopeEndsLength = ctx.activeScopeEnds ? ctx.activeScopeEnds.length : 0;

    for (const rule of this.rules) {
      if (panicked) break;

      const ruleIsStructural = this.isRuleStructural(rule);
      const startOffset = currentOffset;

      type RuleResult = {
        success: boolean;
        newOffset: number;
        dependencyLimit: number;
        error?: string;
        panicked?: boolean;
        hasCommittedUpdate?: boolean;
      };

      let res: RuleResult;

      switch (rule.type) {
        case 'element':
        case 'literal':
        case 'regex':
        case 'beginScope':
        case 'endScope':
          res = this.evaluatePatternRule(rule, text, currentOffset, memo, ctx, results);
          break;

        case 'whitespace':
          res = this.evaluateWhitespaceRule(rule, text, currentOffset, results);
          break;

        case 'choice':
          res = this.evaluateChoiceRule(rule, text, currentOffset, memo, ctx, results);
          break;

        case 'optional':
        case 'leadingTrivia':
        case 'trailingTrivia':
          res = this.evaluateOptionalRule(rule, text, currentOffset, memo, ctx, results);
          break;

        case 'zeroOrMore':
          res = this.evaluateZeroOrMoreRule(rule, text, currentOffset, memo, ctx, results);
          break;

        case 'zeroOrMoreOneOf':
          res = this.evaluateZeroOrMoreOneOfRule(rule, text, currentOffset, memo, ctx, results);
          break;

        case 'oneOrMore':
          res = this.evaluateOneOrMoreRule(rule, text, currentOffset, memo, ctx, results);
          break;

        case 'oneOrMoreOneOf':
          res = this.evaluateOneOrMoreOneOfRule(rule, text, currentOffset, memo, ctx, results);
          break;

        case 'eof':
          res = this.evaluateEofRule(rule, text, currentOffset, results);
          break;

        case 'not':
          res = this.evaluateNotRule(rule, text, currentOffset, memo, ctx);
          break;

        case 'assert':
          res = this.evaluateAssertRule(rule, text, currentOffset, memo, ctx);
          break;

        case 'separatedBy':
          res = this.evaluateSeparatedByRule(rule, text, currentOffset, memo, ctx, results);
          break;

        default:
          res = { success: false, newOffset: currentOffset, dependencyLimit: currentOffset + 1, error: `Unknown rule type: ${rule.type}` };
          break;
      }

      localMaxOffset = Math.max(localMaxOffset, res.dependencyLimit);
      
      if (res.success) {
        currentOffset = res.newOffset;
        if (ruleIsStructural && (res.hasCommittedUpdate || currentOffset > startOffset)) {
          hasCommitted = true;
        }
      } else {
        if (res.panicked) {
          panicked = true;
          currentOffset = res.newOffset;
          if (res.newOffset > offset) hasCommitted = true;
          break;
        }

        if (ctx.activeScopeEnds) {
          ctx.activeScopeEnds.length = initialActiveScopeEndsLength;
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

    const finalResult: ParseResult = { 
      ast: GreenNode.create(this.name, results, this.id, currentOffset - offset), 
      newOffset: currentOffset,
      recoveredErrors: [...ctx.recoveredErrors],
      dependencyLimit: localMaxOffset
    };

    return finalResult;
  }

  // ==========================================
  // SECTION 5: MODULAR PRIVATE RULE EVALUATORS
  // ==========================================

  private evaluatePatternRule(
    rule: Rule,
    text: string,
    currentOffset: number,
    memo: Map<string, ParseResult>,
    ctx: any,
    results: any[]
  ) {
    const res = this.parsePattern(rule.value, text, currentOffset, memo, rule.id, ctx);
    if (res.success) {
      if (res.value && (res.value.width > 0 || res.value.type === 'eof')) {
        results.push(res.value);
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
          const idx = ctx.activeScopeEnds.findIndex((e: any) => e.ruleId === rule.id);
          if (idx !== -1) {
            ctx.activeScopeEnds.splice(idx, 1);
          }
        }
      }

      return { success: true, newOffset: res.newOffset, dependencyLimit: res.dependencyLimit };
    } else {
      let offsetToUse = currentOffset;
      if (res.newOffset && res.newOffset > currentOffset) {
        offsetToUse = res.newOffset;
      }
      if (rule.type === 'endScope') {
        if (ctx.activeScopeEnds) {
          const idx = ctx.activeScopeEnds.findIndex((e: any) => e.ruleId === rule.id);
          if (idx !== -1) {
            ctx.activeScopeEnds.splice(idx, 1);
          }
        }
      }
      return { success: false, newOffset: offsetToUse, dependencyLimit: res.dependencyLimit, error: res.error };
    }
  }

  private evaluateWhitespaceRule(
    rule: Rule,
    text: string,
    currentOffset: number,
    results: any[]
  ) {
    const match = matchRegex(WS_REGEX, text, currentOffset);
    if (match) {
      const wsNode = GreenNode.create('whitespace', match[0], rule.id, match[0].length);
      if (wsNode.width > 0) {
        results.push(wsNode);
      }
      const newOffset = currentOffset + match[0].length;
      return { success: true, newOffset, dependencyLimit: newOffset };
    } else {
      return { success: false, newOffset: currentOffset, dependencyLimit: currentOffset + 1, error: "Expected whitespace" };
    }
  }

  private evaluateChoiceRule(
    rule: Rule,
    text: string,
    currentOffset: number,
    memo: Map<string, ParseResult>,
    ctx: any,
    results: any[]
  ) {
    const startOffset = currentOffset;
    const patterns = rule.value as (string | RegExp | SyntaxElement)[];
    let matched = false;
    let maxFailedOffset = currentOffset;
    let choiceErrorMsg = "None of the choices matched";
    let localMaxOffset = currentOffset;

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
            results.push(res.value);
          }
          currentOffset = res.newOffset;
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
        results.push(backupMatch.resVal);
      }
      currentOffset = backupMatch.newOffset;
      ctx.recoveredErrors.push(...backupMatch.errors);
      if (ctx.activeScopeEnds) {
        ctx.activeScopeEnds.length = backupMatch.activeScopeEndsLength;
      }
      matched = true;
    }

    if (matched) {
      return { success: true, newOffset: currentOffset, dependencyLimit: localMaxOffset };
    } else {
      let offsetToUse = currentOffset;
      if (maxFailedOffset > currentOffset) {
        offsetToUse = maxFailedOffset;
      }
      return { success: false, newOffset: offsetToUse, dependencyLimit: localMaxOffset, error: choiceErrorMsg };
    }
  }

  private evaluateOptionalRule(
    rule: Rule,
    text: string,
    currentOffset: number,
    memo: Map<string, ParseResult>,
    ctx: any,
    results: any[]
  ) {
    const beforeOptErrorsLength = ctx.recoveredErrors.length;
    const res = this.parsePattern(rule.value, text, currentOffset, memo, rule.id, ctx);
    if (res.success) {
      if (res.value && (res.value.width > 0 || res.value.type === 'eof')) {
        results.push(res.value);
      }
      return { success: true, newOffset: res.newOffset, dependencyLimit: res.dependencyLimit };
    } else {
      ctx.recoveredErrors.length = beforeOptErrorsLength;
      return { success: true, newOffset: currentOffset, dependencyLimit: res.dependencyLimit };
    }
  }

  private evaluateZeroOrMoreRule(
    rule: Rule,
    text: string,
    currentOffset: number,
    memo: Map<string, ParseResult>,
    ctx: any,
    results: any[]
  ) {
    const matches = [];
    const loopStartOffset = currentOffset;
    let localMaxOffset = currentOffset;

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
      }
    }
    return { success: true, newOffset: currentOffset, dependencyLimit: localMaxOffset };
  }

  private evaluateZeroOrMoreOneOfRule(
    rule: Rule,
    text: string,
    currentOffset: number,
    memo: Map<string, ParseResult>,
    ctx: any,
    results: any[]
  ) {
    const matches = [];
    const loopStartOffset = currentOffset;
    let localMaxOffset = currentOffset;
    const patterns = rule.value as (string | RegExp | SyntaxElement)[];

    while (currentOffset < text.length) {
      let matchedBranch = false;
      let matchedRes: any = null;
      let branchNewOffset = currentOffset;
      const beforeLoopErrorsLength = ctx.recoveredErrors.length;
      const baseActiveScopeEndsLength = ctx.activeScopeEnds ? ctx.activeScopeEnds.length : 0;

      for (const pattern of patterns) {
        const res = this.parsePattern(pattern, text, currentOffset, memo, rule.id, ctx);
        localMaxOffset = Math.max(localMaxOffset, res.dependencyLimit);
        if (res.success && res.newOffset > currentOffset) {
          matchedBranch = true;
          matchedRes = res.value;
          branchNewOffset = res.newOffset;
          break;
        } else {
          ctx.recoveredErrors.length = beforeLoopErrorsLength;
          if (ctx.activeScopeEnds) {
            ctx.activeScopeEnds.length = baseActiveScopeEndsLength;
          }
        }
      }

      if (!matchedBranch) {
        break;
      }

      if (matchedRes && (matchedRes.width > 0 || matchedRes.type === 'eof')) {
        matches.push(matchedRes);
      }
      currentOffset = branchNewOffset;
    }

    if (matches.length > 0) {
      const loopWidth = currentOffset - loopStartOffset;
      if (loopWidth > 0) {
        results.push(GreenNode.create('zeroOrMoreOneOf', matches, rule.id, loopWidth));
      }
    }
    return { success: true, newOffset: currentOffset, dependencyLimit: localMaxOffset };
  }

  private evaluateOneOrMoreRule(
    rule: Rule,
    text: string,
    currentOffset: number,
    memo: Map<string, ParseResult>,
    ctx: any,
    results: any[]
  ) {
    const matches = [];
    const loopStartOffset = currentOffset;
    let localMaxOffset = currentOffset;

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
      }
      return { success: true, newOffset: currentOffset, dependencyLimit: localMaxOffset, hasCommittedUpdate: true };
    } else {
      return { success: false, newOffset: currentOffset, dependencyLimit: localMaxOffset, error: "Expected at least one match" };
    }
  }

  private evaluateOneOrMoreOneOfRule(
    rule: Rule,
    text: string,
    currentOffset: number,
    memo: Map<string, ParseResult>,
    ctx: any,
    results: any[]
  ) {
    const matches = [];
    const loopStartOffset = currentOffset;
    let localMaxOffset = currentOffset;
    const patterns = rule.value as (string | RegExp | SyntaxElement)[];

    while (currentOffset < text.length) {
      let matchedBranch = false;
      let matchedRes: any = null;
      let branchNewOffset = currentOffset;
      const beforeLoopErrorsLength = ctx.recoveredErrors.length;
      const baseActiveScopeEndsLength = ctx.activeScopeEnds ? ctx.activeScopeEnds.length : 0;

      for (const pattern of patterns) {
        const res = this.parsePattern(pattern, text, currentOffset, memo, rule.id, ctx);
        localMaxOffset = Math.max(localMaxOffset, res.dependencyLimit);
        if (res.success && res.newOffset > currentOffset) {
          matchedBranch = true;
          matchedRes = res.value;
          branchNewOffset = res.newOffset;
          break;
        } else {
          ctx.recoveredErrors.length = beforeLoopErrorsLength;
          if (ctx.activeScopeEnds) {
            ctx.activeScopeEnds.length = baseActiveScopeEndsLength;
          }
        }
      }

      if (!matchedBranch) {
        break;
      }

      if (matchedRes && (matchedRes.width > 0 || matchedRes.type === 'eof')) {
        matches.push(matchedRes);
      }
      currentOffset = branchNewOffset;
    }

    if (matches.length > 0) {
      const loopWidth = currentOffset - loopStartOffset;
      if (loopWidth > 0) {
        results.push(GreenNode.create('oneOrMoreOneOf', matches, rule.id, loopWidth));
      }
      return { success: true, newOffset: currentOffset, dependencyLimit: localMaxOffset, hasCommittedUpdate: true };
    } else {
      return { success: false, newOffset: currentOffset, dependencyLimit: localMaxOffset, error: "Expected at least one match" };
    }
  }

  private evaluateEofRule(
    rule: Rule,
    text: string,
    currentOffset: number,
    results: any[]
  ) {
    if (currentOffset === text.length) {
      results.push(GreenNode.create('eof', null, rule.id, 0));
      return { success: true, newOffset: currentOffset, dependencyLimit: currentOffset + 1 };
    } else {
      return { success: false, newOffset: currentOffset, dependencyLimit: currentOffset + 1, error: "Expected EOF" };
    }
  }

  private evaluateNotRule(
    rule: Rule,
    text: string,
    currentOffset: number,
    memo: Map<string, ParseResult>,
    ctx: any
  ) {
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
    if (res.success) {
      return { success: false, newOffset: currentOffset, dependencyLimit: res.dependencyLimit, error: "Encountered forbidden pattern" };
    }
    return { success: true, newOffset: currentOffset, dependencyLimit: res.dependencyLimit };
  }

  private evaluateAssertRule(
    rule: Rule,
    text: string,
    currentOffset: number,
    memo: Map<string, ParseResult>,
    ctx: any
  ) {
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
    if (res.success) {
      return { success: true, newOffset: currentOffset, dependencyLimit: res.dependencyLimit };
    }
    return { success: false, newOffset: currentOffset, dependencyLimit: res.dependencyLimit, error: "Assertion failed" };
  }

  private evaluateSeparatedByRule(
    rule: Rule,
    text: string,
    currentOffset: number,
    memo: Map<string, ParseResult>,
    ctx: any,
    results: any[]
  ) {
    const { item, separator } = rule.value;
    const matches = [];
    const loopStartOffset = currentOffset;
    let localMaxOffset = currentOffset;

    // Parse first item
    const res1 = this.parsePattern(item, text, currentOffset, memo, rule.id, ctx);
    localMaxOffset = Math.max(localMaxOffset, res1.dependencyLimit);
    if (!res1.success) {
      return { success: false, newOffset: currentOffset, dependencyLimit: localMaxOffset, error: "Expected first item in separated list" };
    }

    if (res1.value && (res1.value.width > 0 || res1.value.type === 'eof')) {
      matches.push(res1.value);
    }
    currentOffset = res1.newOffset;

    // Loop for (separator item)*
    while (currentOffset < text.length) {
      const beforeSepOffset = currentOffset;
      const beforeSepErrorsLength = ctx.recoveredErrors.length;

      // Parse separator
      const resSep = this.parsePattern(separator, text, currentOffset, memo, rule.id, ctx);
      localMaxOffset = Math.max(localMaxOffset, resSep.dependencyLimit);
      if (!resSep.success) {
        ctx.recoveredErrors.length = beforeSepErrorsLength;
        break;
      }

      // Parse subsequent item
      const resItem = this.parsePattern(item, text, resSep.newOffset, memo, rule.id, ctx);
      localMaxOffset = Math.max(localMaxOffset, resItem.dependencyLimit);
      if (!resItem.success) {
        ctx.recoveredErrors.length = beforeSepErrorsLength;
        break;
      }

      // Succeeded matching both!
      if (resSep.value && (resSep.value.width > 0 || resSep.value.type === 'eof')) {
        matches.push(resSep.value);
      }
      if (resItem.value && (resItem.value.width > 0 || resItem.value.type === 'eof')) {
        matches.push(resItem.value);
      }
      currentOffset = resItem.newOffset;
    }

    if (matches.length > 0) {
      const loopWidth = currentOffset - loopStartOffset;
      if (loopWidth > 0) {
        results.push(GreenNode.create('zeroOrMore', matches, rule.id, loopWidth));
      }
    }
    return { success: true, newOffset: currentOffset, dependencyLimit: localMaxOffset };
  }

  private attemptRecovery(
    text: string, 
    offset: number, 
    patterns: (string | RegExp | SyntaxElement)[], 
    memo: Map<string, ParseResult>, 
    context: any
  ): { newOffset: number, dependencyLimit: number } | null {
    let earliestIndex = text.length;
    let earliestNewOffset = -1;
    let maxEvalOffset = offset;
    
    for (const pattern of patterns) {
      if (typeof pattern === 'string') {
        const idx = text.indexOf(pattern, offset);
        if (idx !== -1 && idx <= earliestIndex) {
          earliestIndex = idx;
          earliestNewOffset = idx;
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
            earliestNewOffset = absoluteIndex;
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
              earliestNewOffset = i;
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
    context?: any
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

    if (!patterns.includes(";")) patterns.push(";");
    
    const hasNewlineRegExp = patterns.some(p => p instanceof RegExp && p.source.includes("\\n"));
    if (!hasNewlineRegExp) {
      patterns.push(/\r?\n/);
    }

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
}

// ==========================================
// SECTION 6: GLOBAL FUNCTIONS & BUILDER ACCENTS
// ==========================================

export function Sort(...patterns: (string | RegExp | SyntaxElement)[] | [(string | RegExp | SyntaxElement)[]]): (string | RegExp | SyntaxElement)[] {
  const list = (patterns.length === 1 && Array.isArray(patterns[0]))
    ? patterns[0]
    : patterns as (string | RegExp | SyntaxElement)[];

  return [...list].sort((a, b) => {
    const lenA = typeof a === 'string' ? a.length : (a instanceof RegExp ? a.source.length : (a instanceof SyntaxElement ? a.name.length : 0));
    const lenB = typeof b === 'string' ? b.length : (b instanceof RegExp ? b.source.length : (b instanceof SyntaxElement ? b.name.length : 0));
    return lenB - lenA;
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

export function unwrapToken(pattern: any): any {
  if (pattern && typeof pattern === 'object' && '__isTokenMarker' in pattern) {
    return unwrapToken(pattern.pattern);
  }
  if (pattern && typeof pattern === 'object' && 'type' in pattern && (pattern.type === 'beginScope' || pattern.type === 'endScope')) {
    return unwrapToken(pattern.value);
  }
  return pattern;
}

export { findDiff } from './utils';
