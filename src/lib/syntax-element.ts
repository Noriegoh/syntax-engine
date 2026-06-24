import { matchRegex, WS_REGEX, nextRuleId, isSimpleCaseInsensitiveRegex } from './utils';

export interface SuggestionItem {
  label: string; 
  insertText: string; 
  type: 'method' | 'class' | 'variable' | 'keyword';
  description: string;
}

export const GRAMMAR_SUGGESTIONS: SuggestionItem[] = [
  { label: 'Expects', insertText: 'Expects(', type: 'method', description: 'Schedule standard terminal literal / sub-element rule' },
  { label: 'OneOff', insertText: 'OneOff(', type: 'method', description: 'Schedule a speculative choice selection (any matched pattern)' },
  { label: 'OneOffToken', insertText: 'OneOffToken(', type: 'method', description: 'Schedule speculative choice branch match while automatically handling skipped trivias' },
  { label: 'Element', insertText: 'Element(', type: 'method', description: 'Helper to return a new named SyntaxElement' },
  { label: 'LiteralMatch', insertText: 'LiteralMatch(', type: 'method', description: 'Match strict terminal word/keyword/literal' },
  { label: 'Token', insertText: 'Token(', type: 'method', description: 'Inject clean terminal lexical Token marker (wraps literals/regexes)' },
  { label: 'Optional', insertText: 'Optional(', type: 'method', description: 'Mark element rule as fully optional' },
  { label: 'ZeroOrMore', insertText: 'ZeroOrMore(', type: 'method', description: 'Repetition: loop consecutive matches. Overloaded to support choices if passed array/multiple parameters' },
  { label: 'ZeroOrMoreToken', insertText: 'ZeroOrMoreToken(', type: 'method', description: 'Repetition loops through matches, automatically skipping default leading/trailing trivia around each loop item' },
  { label: 'OneOrMore', insertText: 'OneOrMore(', type: 'method', description: 'Repetition: loop consecutive matches requires at least 1 match. Overloaded to support choices if passed array/multiple parameters' },
  { label: 'OneOrMoreToken', insertText: 'OneOrMoreToken(', type: 'method', description: 'Repetition loops through matches (at least 1 required), automatically skipping default leading/trailing trivia around each loop item' },
  { label: 'LeadingTrivia', insertText: 'LeadingTrivia(', type: 'method', description: 'Define expected default preceding layout whitespaces or comments' },
  { label: 'TrailingTrivia', insertText: 'TrailingTrivia(', type: 'method', description: 'Define expected default trailing layout whitespaces or comments' },
  { label: 'Whitespace', insertText: 'Whitespace()', type: 'method', description: 'Consume contiguous space layouts' },
  { label: 'EnumTarget', insertText: 'EnumTarget()', type: 'method', description: 'Flag elements for C# enum compilation structures' },
  { label: 'BeginScope', insertText: 'BeginScope(', type: 'method', description: 'Signal local lexical namespace creation (e.g., matching brace "{" )' },
  { label: 'EndScope', insertText: 'EndScope(', type: 'method', description: 'Signal local lexical namespace termination (e.g., matching brace "}" )' },
  { label: 'ExpectsEOF', insertText: 'ExpectsEOF()', type: 'method', description: 'Enforce complete final end-of-file condition' },
  { label: 'As', insertText: 'As(', type: 'method', description: 'Assign field property name/label to the matched result' },
  { label: 'WithError', insertText: 'WithError(', type: 'method', description: 'Attach a custom user-defined manual error message to the last defined rule' },
  { label: 'Inline', insertText: 'Inline()', type: 'method', description: 'Inline this element, copying its rules directly into any receiving element at runtime' },
  { label: 'InlinedElement', insertText: 'InlinedElement()', type: 'method', description: 'Helper to return a new anonymous, inlined SyntaxElement' },
  { label: 'RecoverWith', insertText: 'RecoverWith(', type: 'method', description: 'Register explicit manual recovery delimiters for automated parser healing' },
  { label: 'MapToEnum', insertText: 'MapToEnum(', type: 'method', description: 'Map matched string tokens to target C# compilation enumerations' },
  { label: 'SeparatedBy', insertText: 'SeparatedBy(', type: 'method', description: 'Sequence matcher for elements separated by distinct separator literal/token' },
  { label: 'SeparatedByToken', insertText: 'SeparatedByToken(', type: 'method', description: 'Sequence matcher for elements separated by separator while skipping trivia' },
  { label: 'Assert', insertText: 'Assert(', type: 'method', description: 'Lookahead assertion checker: verify ahead without consuming incoming layout streams' },
  { label: 'SyntaxElement', insertText: 'SyntaxElement', type: 'class', description: 'Compiler blueprint construct initializer' },
  { label: 'Sort', insertText: 'Sort(', type: 'keyword', description: 'Sort array inputs descending by pattern length' },
  { label: 'DefaultLeadingTrivia', insertText: 'DefaultLeadingTrivia', type: 'variable', description: 'Pre-registered standard spacer elements container' },
  { label: 'DefaultTrailingTrivia', insertText: 'DefaultTrailingTrivia', type: 'variable', description: 'Pre-registered standard spacer elements container' },
  { label: 'Required', insertText: 'Required(', type: 'method', description: 'Mark element rule as required in an unordered or optional list rule' },
  { label: 'Unordered', insertText: 'Unordered(', type: 'method', description: 'Match zero, one, or multiple rules in any order' },
  { label: 'Regex', insertText: 'Regex(', type: 'method', description: 'Create a named or standard regular expression pattern' },
];

export function Required(pattern: any): any {
  if (pattern && typeof pattern === 'object' && '__isRequiredRule' in pattern) {
    return pattern;
  }
  return { __isRequiredRule: true, pattern };
}

// ==========================================
// SECTION 1: GLOBAL TYPE & INTERFACE DEFINITIONS
// ==========================================

export type RuleType = 
  | 'literal' 
  | 'caseInsensitiveLiteral'
  | 'regex' 
  | 'element' 
  | 'not' 
  | 'assert'
  | 'separatedBy'
  | 'choice' 
  | 'optional' 
  | 'leadingTrivia' 
  | 'trailingTrivia' 
  | 'zeroOrMore' 
  | 'oneOrMore' 
  | 'eof' 
  | 'literalMatch'
  | 'caseInsensitiveLiteralMatch';

export interface Rule {
  id: number;
  type: RuleType;
  value?: any;
  label?: string;
  ignored?: boolean;
  isToken?: boolean;
  hasTokenWarning?: boolean; // Set when Token wraps choice elements inside OneOff
  hasLiteralMatchWarning?: boolean; // Set when LiteralMatch wraps choice elements inside OneOff
  primitiveType?: string;
  requiredIndices?: Set<number>;
  customErrorMessage?: string;
  recoveryPatterns?: (string | RegExp | SyntaxElement)[];
  explicitRecoveryPatterns?: (string | RegExp | SyntaxElement)[];
  parentRuleId?: number;
}

export class RuleHelper {
  public static isList(rule: Rule): boolean {
    return rule.type == "choice" || rule.type === 'zeroOrMore' || rule.type === 'oneOrMore' || rule.type === 'separatedBy';
  }

  public static isTrivia(rule: Rule): boolean {
    return rule.type === 'leadingTrivia' || rule.type === 'trailingTrivia';
  }

  public static isOptional(rule: Rule): boolean {
    return rule.type === 'optional' || rule.type === 'zeroOrMore' || rule.type === 'leadingTrivia' || rule.type === 'trailingTrivia';
  }

  public static isLiteral(rule:Rule):boolean
  {
    return rule.type == "literal" || rule.type == "caseInsensitiveLiteral" || rule.type == "literalMatch" || rule.type == "caseInsensitiveLiteralMatch";
  }

  public static isStructural(rule: Rule): boolean {
    if (rule.type === 'leadingTrivia' || rule.type === 'trailingTrivia') return false;
    if (rule.type === 'optional' || rule.type === 'zeroOrMore') return false;
    if (rule.type === 'not' || rule.type === 'assert') return false;
    return true;
  }

  public static isLoop(rule: Rule): boolean {
    return rule.type === 'zeroOrMore' || rule.type === 'oneOrMore' || rule.type == "separatedBy";
  }

  public static hasArrayValue(rule: Rule): boolean {
    return (rule.type === 'choice' || rule.type === 'zeroOrMore' || rule.type === 'oneOrMore') && Array.isArray(rule.value);
  }

  public static hasSubPatterns(rule: Rule): boolean {
    return rule.type === 'choice' || rule.type === 'zeroOrMore' || rule.type === 'oneOrMore';
  }

  public static isTerminalTextValue(rule: Rule): boolean {
    return rule.type === 'literal' && typeof rule.value === 'string';
  }

  public static hasOptionalOrTriviaOrLoop(rule: Rule): boolean {
    return rule.type === 'optional' || rule.type === 'leadingTrivia' || rule.type === 'trailingTrivia' || rule.type === 'zeroOrMore';
  }

  public static isOptionOrTriviaOrLoopOrNot(rule: Rule): boolean {
    return rule.type === 'optional' || rule.type === 'leadingTrivia' || rule.type === 'trailingTrivia' || rule.type === 'zeroOrMore' || rule.type === 'oneOrMore' || rule.type === 'not';
  }

  public static isRepetitionOrOptional(rule: Rule): boolean {
    return rule.type === 'optional' || rule.type === 'zeroOrMore' || rule.type === 'oneOrMore';
  }
}

export interface ParseError {
  message: string;
  offset: number;
  recoveredOffset?: number;
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
  public readonly _fields: Record<string, any> = {};
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

        // Dynamic attribute mapping based on rule labels
        const parentRuleId = (g as any).parentRuleId !== undefined ? (g as any).parentRuleId : g.ruleId;
        const rule = SyntaxElement.ruleRegistry?.get(parentRuleId);
        if (rule && rule.label) {
          const label = rule.label;
          const isList = RuleHelper.isList(rule);
          
          // Store in our safe _fields mapping first to avoid colliding with built-in properties
          if (isList) {
            if (!this._fields[label]) {
              this._fields[label] = [];
            }
            if (Array.isArray(this._fields[label])) {
              this._fields[label].push(redChild);
            }
          } else {
            this._fields[label] = redChild;
          }

          // Directly assign on instance ONLY if the field name doesn't conflict with built-in properties
          const reserved = new Set(['type', 'width', '_value', '_isResolved', 'green', 'parent', 'offset', 'value', '_fields']);
          if (!reserved.has(label)) {
            if (isList) {
              if (!(this as any)[label]) {
                (this as any)[label] = [];
              }
              if (Array.isArray((this as any)[label])) {
                (this as any)[label].push(redChild);
              }
            } else {
              (this as any)[label] = redChild;
            }
          }
        }

        return redChild;
      });
    } else {
      this._value = val;
    }
    this._isResolved = true;
    return this._value;
  }

  public get text(): string {
    const val = this.green.value;
    if (typeof val === "string") return val;
    if (Array.isArray(val)) {
      return this.value.map((c: RedNode) => c ? c.text : "").join("");
    }
    return "";
  }

  private ensureTerminal(): void {
    if (typeof this.green.value !== "string") {
      throw new Error("This operation is only valid on a terminal token.");
    }
  }

  public asText(): string {
    this.ensureTerminal();
    return this.text;
  }

  public asLiteral(): string {
    this.ensureTerminal();
    return this.text;
  }

  public asInteger(): number {
    this.ensureTerminal();
    return parseInt(this.text, 10);
  }

  public asFloat(): number {
    this.ensureTerminal();
    return parseFloat(this.text);
  }

  public asByte(): number {
    this.ensureTerminal();
    return parseInt(this.text, 10);
  }

  public asSByte(): number {
    this.ensureTerminal();
    return parseInt(this.text, 10);
  }

  public asInt16(): number {
    this.ensureTerminal();
    return parseInt(this.text, 10);
  }

  public asUInt16(): number {
    this.ensureTerminal();
    return parseInt(this.text, 10);
  }

  public asInt32(): number {
    this.ensureTerminal();
    return parseInt(this.text, 10);
  }

  public asUInt32(): number {
    this.ensureTerminal();
    return parseInt(this.text, 10);
  }

  public asInt64(): number {
    this.ensureTerminal();
    return parseInt(this.text, 10);
  }

  public asUInt64(): number {
    this.ensureTerminal();
    return parseInt(this.text, 10);
  }

  public asSingle(): number {
    this.ensureTerminal();
    return parseFloat(this.text);
  }

  public asDouble(): number {
    this.ensureTerminal();
    return parseFloat(this.text);
  }

  public asBoolean(): boolean {
    this.ensureTerminal();
    return this.text === "true";
  }

  public static asLiteral(text: string): RedNode {
    const green = GreenNode.create("Literal", text, 0, text.length);
    return new RedNode(green, null, 0);
  }

  public static asText(text: string): RedNode {
    const green = GreenNode.create("Token", text, 0, text.length);
    return new RedNode(green, null, 0);
  }

  public static asInteger(value: number): RedNode {
    const green = GreenNode.create("Token", String(value), 0, String(value).length);
    return new RedNode(green, null, 0);
  }

  public static asFloat(value: number): RedNode {
    const green = GreenNode.create("Token", String(value), 0, String(value).length);
    return new RedNode(green, null, 0);
  }

  public static asByte(value: number): RedNode {
    const green = GreenNode.create("Token", String(value), 0, String(value).length);
    return new RedNode(green, null, 0);
  }

  public static asSByte(value: number): RedNode {
    const green = GreenNode.create("Token", String(value), 0, String(value).length);
    return new RedNode(green, null, 0);
  }

  public static asInt16(value: number): RedNode {
    const green = GreenNode.create("Token", String(value), 0, String(value).length);
    return new RedNode(green, null, 0);
  }

  public static asUInt16(value: number): RedNode {
    const green = GreenNode.create("Token", String(value), 0, String(value).length);
    return new RedNode(green, null, 0);
  }

  public static asInt32(value: number): RedNode {
    const green = GreenNode.create("Token", String(value), 0, String(value).length);
    return new RedNode(green, null, 0);
  }

  public static asUInt32(value: number): RedNode {
    const green = GreenNode.create("Token", String(value), 0, String(value).length);
    return new RedNode(green, null, 0);
  }

  public static asInt64(value: number): RedNode {
    const green = GreenNode.create("Token", String(value), 0, String(value).length);
    return new RedNode(green, null, 0);
  }

  public static asUInt64(value: number): RedNode {
    const green = GreenNode.create("Token", String(value), 0, String(value).length);
    return new RedNode(green, null, 0);
  }

  public static asSingle(value: number): RedNode {
    const green = GreenNode.create("Token", String(value), 0, String(value).length);
    return new RedNode(green, null, 0);
  }

  public static asDouble(value: number): RedNode {
    const green = GreenNode.create("Token", String(value), 0, String(value).length);
    return new RedNode(green, null, 0);
  }

  public static asBoolean(value: boolean): RedNode {
    const str = value ? "true" : "false";
    const green = GreenNode.create("Token", str, 0, str.length);
    return new RedNode(green, null, 0);
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

  public static Reset()
  {
    SyntaxElement.registry.clear();
    SyntaxElement.ruleRegistry.clear();
    SyntaxElement.defaultLeadingTrivia = undefined;
    SyntaxElement.defaultTrailingTrivia = undefined;
    SyntaxElement.lastId = 0;
  }

  public static defaultLeadingTrivia?: string | RegExp | SyntaxElement;
  public static defaultTrailingTrivia?: string | RegExp | SyntaxElement;

  public static registry = new Map<string, SyntaxElement>();
  public static ruleRegistry = new Map<number, Rule>();

  public static lastId = 0;
  
  public readonly id: number;
  public readonly name: string;
  public readonly rules: Rule[] = [];
  
  public isInlined: boolean = false;
  public warnings: string[] = [];

  public get isHiddenElement(): boolean {
    return this.isInlined;
  }
  public set isHiddenElement(val: boolean) {
    this.isInlined = val;
  }

  public enumName: string | null = null;

  public addWarning(message: string): void {
    if (!this.warnings.includes(message)) {
      this.warnings.push(message);
    }
  }

  private checkInliningRecursion(source: any): void {
    const checkSingle = (item: any) => {
      const unwrapped = SyntaxElement.unwrapPattern(item);
      if (unwrapped instanceof SyntaxElement) {
        if (unwrapped.isInlined || this.isInlined) {
          if (this.detectEndlessInliningRecursion(unwrapped)) {
            throw new Error(`Endless recursion prohibited: inlining loop detected on element '${unwrapped.name || "Inlined"}'`);
          }
        }
      }
    };

    if (Array.isArray(source)) {
      source.forEach(checkSingle);
    } else {
      checkSingle(source);
    }
  }

  private detectEndlessInliningRecursion(source: SyntaxElement, visited = new Set<SyntaxElement>()): boolean {
    if (source === this) return true;
    if (visited.has(source)) return false;
    visited.add(source);

    for (const rule of source.rules) {
      if (rule.type === 'element' && rule.value instanceof SyntaxElement) {
        if (this.detectEndlessInliningRecursion(rule.value, visited)) return true;
      } else if (rule.type === 'choice' || rule.type === 'zeroOrMore' || rule.type === 'oneOrMore' || rule.type === 'optional') {
        const vals = Array.isArray(rule.value) ? rule.value : [rule.value];
        for (const val of vals) {
          const unwrapped = SyntaxElement.unwrapPattern(val);
          if (unwrapped instanceof SyntaxElement) {
            if (this.detectEndlessInliningRecursion(unwrapped, visited)) return true;
          }
        }
      } else if (rule.type === 'separatedBy' && rule.value) {
        const itemUnwrapped = SyntaxElement.unwrapPattern(rule.value.item);
        const checkElement = (p: any): boolean => {
          if (p instanceof SyntaxElement) {
            return this.detectEndlessInliningRecursion(p, visited);
          } else if (Array.isArray(p)) {
            return p.some(checkElement);
          }
          return false;
        };
        if (checkElement(itemUnwrapped)) return true;
        const sepUnwrapped = SyntaxElement.unwrapPattern(rule.value.separator);
        if (sepUnwrapped instanceof SyntaxElement && this.detectEndlessInliningRecursion(sepUnwrapped, visited)) return true;
      }
    }
    return false;
  }

  private inlineElementRules(source: SyntaxElement): void {
    this.checkInliningRecursion(source);

    // copy warnings too so they bubble up if any
    for (const warn of source.warnings) {
      this.addWarning(warn);
    }

    for (const rule of source.rules) {
      const newId = nextRuleId();
      if (rule.type === 'element' && rule.value instanceof SyntaxElement && rule.value.isInlined) {
        this.inlineElementRules(rule.value);
      } else {
        this.rules.push({
          ...rule,
          id: newId,
          value: this.cloneRuleValue(rule.value)
        });
      }
    }
  }

  private cloneRuleValue(val: any): any {
    if (val === null || val === undefined) return val;
    if (val instanceof SyntaxElement) {
      return val;
    }
    if (Array.isArray(val)) {
      return val.map(item => this.cloneRuleValue(item));
    }
    if (typeof val === 'object') {
      const cloned: any = {};
      for (const k of Object.keys(val)) {
        cloned[k] = this.cloneRuleValue(val[k]);
      }
      return cloned;
    }
    return val;
  }

  public get isEnumTarget(): boolean {
    return this.enumName !== null;
  }

  constructor(name: string) {
    this.id = ++SyntaxElement.lastId;
    this.name = name;
    SyntaxElement.registry.set(name, this);
  }

  public get structuralRules(): Rule[] {
    return this.rules.filter(rule => {
      return (
        rule.type !== 'optional' &&
        rule.type !== 'leadingTrivia' &&
        rule.type !== 'trailingTrivia'
      );
    });
  }

  public static getPatternDescription(pat: any): string {
    if (!pat) return "unknown";
    if (pat instanceof SyntaxElement) return pat.name || "anonymous element";
    if (typeof pat === 'object') {
      if ('__isTokenMarker' in pat) return pat.name || SyntaxElement.getPatternDescription(pat.pattern);
      if ('__isLiteralExp' in pat) return `"${pat.literal}"`;
    }
    if (pat instanceof RegExp) {
      if ('overrideName' in pat && typeof (pat as any).overrideName === 'string') {
        return (pat as any).overrideName;
      }
      return pat.source;
    }
    return `"${String(pat)}"`;
  }

  public static unwrapPattern(p: any): any {
    if (p && typeof p === 'object') {
      if ('__isTokenMarker' in p) {
        return SyntaxElement.unwrapPattern(p.pattern);
      }
      if ('__isLiteralExp' in p || ('literal' in p && 'pattern' in p)) {
        return p.literal;
      }
      if ('pattern' in p) {
        return p.pattern;
      }
    }
    return p;
  }

  public static arePatternsEquivalent(a: any, b: any): boolean {
    if (a === b) return true;
    if (!a || !b) return false;

    const ua = SyntaxElement.unwrapPattern(a);
    const ub = SyntaxElement.unwrapPattern(b);

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
        if (!SyntaxElement.arePatternsEquivalent(ua[i], ub[i])) return false;
      }
      return true;
    }

    return false;
  }

  public static isPatternNullable(pattern: any, nullable: Map<SyntaxElement, boolean>): boolean {
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

  public static isRuleNullable(rule: Rule, nullable: Map<SyntaxElement, boolean>): boolean {
    switch (rule.type) {
      case 'literal':
      case 'regex':
      case 'element':
        return SyntaxElement.isPatternNullable(SyntaxElement.unwrapPattern(rule.value), nullable);
      case 'not':
      case 'assert':
      case 'eof':
      case 'leadingTrivia':
      case 'trailingTrivia':
        return true; // zero-width
      case 'optional':
      case 'zeroOrMore':
        return true;
      case 'separatedBy': {
        const itemUnwrapped = SyntaxElement.unwrapPattern(rule.value.item);
        if (Array.isArray(itemUnwrapped)) {
          return itemUnwrapped.some((alt: any) => SyntaxElement.isPatternNullable(SyntaxElement.unwrapPattern(alt), nullable));
        }
        return SyntaxElement.isPatternNullable(itemUnwrapped, nullable);
      }
      case 'oneOrMore':
        if (Array.isArray(rule.value)) {
          return rule.value.some((alt: any) => SyntaxElement.isPatternNullable(SyntaxElement.unwrapPattern(alt), nullable));
        }
        return SyntaxElement.isPatternNullable(SyntaxElement.unwrapPattern(rule.value), nullable);
      case 'choice':
        if (Array.isArray(rule.value)) {
          return rule.value.some((alt: any) => SyntaxElement.isPatternNullable(SyntaxElement.unwrapPattern(alt), nullable));
        }
        return false;
      default:
        return false;
    }
  }

  public getFirstReachableElements(nullable: Map<SyntaxElement, boolean>): Set<SyntaxElement> {
    const referenced = new Set<SyntaxElement>();
    if (!this.rules) return referenced;
    
    for (const rule of this.rules) {
      if (rule.type === 'element' && rule.value instanceof SyntaxElement) {
        referenced.add(rule.value);
      } else if (
        rule.type === 'choice' || 
        rule.type === 'zeroOrMore' || 
        rule.type === 'oneOrMore'
      ) {
        if (Array.isArray(rule.value)) {
          for (const alt of rule.value) {
            const unwrapped = SyntaxElement.unwrapPattern(alt);
            if (unwrapped instanceof SyntaxElement) {
              referenced.add(unwrapped);
            }
          }
        } else {
          const unwrapped = SyntaxElement.unwrapPattern(rule.value);
          if (unwrapped instanceof SyntaxElement) {
            referenced.add(unwrapped);
          }
        }
      } else if (
        rule.type === 'optional' ||
        rule.type === 'leadingTrivia' ||
        rule.type === 'trailingTrivia' ||
        rule.type === 'not' ||
        rule.type === 'assert'
      ) {
        const unwrapped = SyntaxElement.unwrapPattern(rule.value);
        if (unwrapped instanceof SyntaxElement) {
          referenced.add(unwrapped);
        }
      } else if (rule.type === 'separatedBy' && rule.value) {
        const unwrappedItem = SyntaxElement.unwrapPattern(rule.value.item);
        const addReachable = (p: any) => {
          if (p instanceof SyntaxElement) {
            referenced.add(p);
          } else if (Array.isArray(p)) {
            p.forEach(addReachable);
          }
        };
        addReachable(unwrappedItem);
        
        let isItemNullable = false;
        if (Array.isArray(unwrappedItem)) {
          isItemNullable = unwrappedItem.some((alt: any) => SyntaxElement.isPatternNullable(SyntaxElement.unwrapPattern(alt), nullable));
        } else {
          isItemNullable = SyntaxElement.isPatternNullable(unwrappedItem, nullable);
        }

        if (isItemNullable) {
          const unwrappedSep = SyntaxElement.unwrapPattern(rule.value.separator);
          addReachable(unwrappedSep);
        }
      }
      
      if (!SyntaxElement.isRuleNullable(rule, nullable)) {
        break;
      }
    }
    
    return referenced;
  }

  // Builder Methods

  MapToEnum(enumName: string): this {
    if (this.isInlined) {
      this.addWarning(`Calling MapToEnum("${enumName}") on an inlined syntax element has no effect, as the element will be flattened and its node will never be created in the AST.`);
      console.warn(`Calling MapToEnum("${enumName}") on an inlined syntax element has no effect.`);
    }
    this.enumName = enumName;
    return this;
  }

  As(fieldName: string): this {
    if (this.rules.length > 0) {
      let targetRule = this.rules[this.rules.length - 1];
      for (let i = this.rules.length - 1; i >= 0; i--) {
        const r = this.rules[i];
        if (!RuleHelper.isTrivia(r)) {
          targetRule = r;
          break;
        }
      }
      targetRule.label = fieldName;
    }
    return this;
  }

  WithError(errorMessage: string): this {
    if (this.rules.length > 0) {
      let targetRule = this.rules[this.rules.length - 1];
      for (let i = this.rules.length - 1; i >= 0; i--) {
        const r = this.rules[i];
        if (!RuleHelper.isTrivia(r)) {
          targetRule = r;
          break;
        }
      }
      targetRule.customErrorMessage = errorMessage;
    }
    return this;
  }

  AsInteger(fieldName: string): this {
    this.As(fieldName);
    this.setLastRulePrimitiveType('Integer');
    return this;
  }

  AsFloat(fieldName: string): this {
    this.As(fieldName);
    this.setLastRulePrimitiveType('Float');
    return this;
  }

  AsLiteral(fieldName: string): this {
    this.As(fieldName);
    this.setLastRulePrimitiveType('Literal');
    return this;
  }

  AsText(fieldName: string): this {
    this.As(fieldName);
    this.setLastRulePrimitiveType('Text');
    return this;
  }

  AsByte(fieldName: string): this {
    this.As(fieldName);
    this.setLastRulePrimitiveType('Byte');
    return this;
  }

  AsSByte(fieldName: string): this {
    this.As(fieldName);
    this.setLastRulePrimitiveType('SByte');
    return this;
  }

  AsInt16(fieldName: string): this {
    this.As(fieldName);
    this.setLastRulePrimitiveType('Int16');
    return this;
  }

  AsUInt16(fieldName: string): this {
    this.As(fieldName);
    this.setLastRulePrimitiveType('UInt16');
    return this;
  }

  AsInt32(fieldName: string): this {
    this.As(fieldName);
    this.setLastRulePrimitiveType('Int32');
    return this;
  }

  AsUInt32(fieldName: string): this {
    this.As(fieldName);
    this.setLastRulePrimitiveType('UInt32');
    return this;
  }

  AsInt64(fieldName: string): this {
    this.As(fieldName);
    this.setLastRulePrimitiveType('Int64');
    return this;
  }

  AsUInt64(fieldName: string): this {
    this.As(fieldName);
    this.setLastRulePrimitiveType('UInt64');
    return this;
  }

  AsSingle(fieldName: string): this {
    this.As(fieldName);
    this.setLastRulePrimitiveType('Single');
    return this;
  }

  AsDouble(fieldName: string): this {
    this.As(fieldName);
    this.setLastRulePrimitiveType('Double');
    return this;
  }

  AsBoolean(fieldName: string): this {
    this.As(fieldName);
    this.setLastRulePrimitiveType('Boolean');
    return this;
  }

  private setLastRulePrimitiveType(type: string): void {
    if (this.rules.length > 0) {
      let targetRule = this.rules[this.rules.length - 1];
      for (let i = this.rules.length - 1; i >= 0; i--) {
        const r = this.rules[i];
        if (!RuleHelper.isTrivia(r)) {
          targetRule = r;
          break;
        }
      }
      targetRule.primitiveType = type;
    }
  }

  Inline(): this {
    this.isInlined = true;
    if (this.name && this.name !== "Inlined" && this.name !== "") {
      this.addWarning(`Defining a custom name "${this.name}" for an inlined syntax element has no effect, as the element will be flattened and its node will never be created in the AST.`);
      console.warn(`Defining a custom name "${this.name}" for an inlined syntax element has no effect.`);
    }
    return this;
  }

  RecoverWith(...boundaries: (string | RegExp | SyntaxElement)[]): this {
    if (this.rules.length > 0) {
      let targetRule = this.rules[this.rules.length - 1];
      for (let i = this.rules.length - 1; i >= 0; i--) {
        const r = this.rules[i];
        if (!RuleHelper.isTrivia(r)) {
          targetRule = r;
          break;
        }
      }
      targetRule.explicitRecoveryPatterns ??= [];
      targetRule.explicitRecoveryPatterns.push(...boundaries);
    }
    return this;
  }

  BeginScope(pattern: string | RegExp | SyntaxElement | TokenMarker): this {
    return this.Expects(pattern);
  }

  EndScope(pattern: string | RegExp | SyntaxElement | TokenMarker): this {
    return this.Expects(pattern);
  }

  Expects(pattern: any): this {
    if (pattern === undefined || pattern === null) {
      pattern = "";
    }
    if (Array.isArray(pattern)) {
      for (const item of pattern) {
        this.Expects(item);
      }
      return this;
    }
    if (pattern && typeof pattern === 'object' && ('__isTokenMarker' in pattern || '__isLiteralExp' in pattern)) {
      return this.Token(pattern);
    }
    if (pattern instanceof SyntaxElement) {
      return this.Rule(pattern);
    }
    if (pattern instanceof RegExp) {
      return this.Match(pattern);
    }
    return this.Literal(String(pattern));
  }

  Rule(element: any): this {
    if (element && typeof element === 'object' && ('__isTokenMarker' in element || '__isLiteralExp' in element)) {
      return this.Token(element);
    }
    if (!(element instanceof SyntaxElement)) {
      throw new Error("Rule parameter must be a SyntaxElement instance.");
    }
    this.checkInliningRecursion(element);

    if (element.isInlined) {
      this.inlineElementRules(element);
    } else {
      const id = nextRuleId();
      this.rules.push({ id, type: 'element', value: element });
    }
    return this;
  }

  Match(regex: any): this {
    if (regex && typeof regex === 'object' && ('__isTokenMarker' in regex || '__isLiteralExp' in regex)) {
      return this.Token(regex);
    }
    if (!(regex instanceof RegExp)) {
      throw new Error("Match parameter must be a RegExp instance.");
    }
    const id = nextRuleId();
    if (isSimpleCaseInsensitiveRegex(regex)) {
      this.rules.push({ id, type: 'caseInsensitiveLiteral', value: regex });
    } else {
      this.rules.push({ id, type: 'regex', value: regex });
    }
    return this;
  }

  Literal(value: any): this {
    if (value && typeof value === 'object' && ('__isTokenMarker' in value || '__isLiteralExp' in value)) {
      return this.Token(value);
    }
    const id = nextRuleId();
    this.rules.push({ id, type: 'literal', value: String(value) });
    return this;
  }

  LiteralMatch(literal: any, pattern?: RegExp | string): this {
    if (literal && typeof literal === 'object' && '__isTokenMarker' in literal) {
      return this.Token(literal);
    }
    let lit: string | RegExp;
    let pat: string | RegExp;
    if (literal instanceof LiteralExp) {
      lit = literal.literal;
      pat = literal.pattern;
    } else {
      if (pattern === undefined || pattern === null) {
        throw new Error("Regex pattern for LiteralMatch must be specified.");
      }
      lit = literal;
      pat = pattern;
    }

    const id = nextRuleId();
    let litVal = "";
    let ruleType: RuleType = 'literalMatch';

    if (lit instanceof RegExp) {
      if (!isSimpleCaseInsensitiveRegex(lit)) {
        throw new Error("Regex pattern for LiteralMatch must be a simple case-insensitive regex pattern (have 'i' flag and no regex special chars).");
      }
      litVal = lit.source;
      ruleType = 'caseInsensitiveLiteralMatch';
    } else {
      litVal = String(lit);
    }

    const regex = typeof pat === 'string' ? new RegExp(pat) : pat;
    this.rules.push({ id, type: ruleType, value: { literal: litVal, pattern: regex } });
    return this;
  }

  Not(pattern: any, ...additional: any[]): this {
    if (pattern === undefined || pattern === null) {
      pattern = "";
    }
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

    const hasAdditional = additional.length > 0;
    const isArrayInput = Array.isArray(pattern);
    const allPatterns = isArrayInput ? flatten(pattern) : (hasAdditional ? flatten([pattern, ...additional]) : [pattern]);

    const unwrapped: (string | RegExp | SyntaxElement)[] = [];
    for (const p of allPatterns) {
      if (p && typeof p === 'object' && '__isTokenMarker' in p) {
        unwrapped.push(unwrapToken(p));
      } else {
        unwrapped.push(p as any);
      }
    }

    const valueToWrite = unwrapped.length === 1 && !isArrayInput && !hasAdditional ? unwrapped[0] : unwrapped;

    const id = nextRuleId();
    this.rules.push({ id, type: 'not', value: valueToWrite });
    return this;
  }

  OneOff(...patterns: any[]): this {
    this.checkInliningRecursion(patterns);
    if (patterns.length === 0) {
      patterns = [""];
    }
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
    let hasLiteralMatch = false;
    const unwrapped: any[] = [];
    for (const p of flatPatterns) {
      if (p && typeof p === 'object' && '__isTokenMarker' in p) {
        hasToken = true;
        unwrapped.push(unwrapToken(p));
      } else if (p && typeof p === 'object' && '__isLiteralExp' in p) {
        hasLiteralMatch = true;
        unwrapped.push(p as any);
      } else {
        unwrapped.push(p as any);
      }
    }
    
    if (hasToken || hasLiteralMatch) {
      const lead = SyntaxElement.defaultLeadingTrivia;
      const trail = SyntaxElement.defaultTrailingTrivia;
      if (lead) this.LeadingTrivia(lead);
      
      const id = nextRuleId();
      this.rules.push({ id, type: 'choice', value: unwrapped, hasTokenWarning: hasToken, hasLiteralMatchWarning: hasLiteralMatch });
      
      if (trail) this.TrailingTrivia(trail);
    } else {
      const id = nextRuleId();
      this.rules.push({ id, type: 'choice', value: unwrapped as any });
    }
    return this;
  }

  OneOffToken(...patterns: any[]): this {
    return this.OneOff(...patterns.map(p => Token(p)));
  }

  Optional(pattern: any, ...additional: any[]): this {
    this.checkInliningRecursion(pattern);
    this.checkInliningRecursion(additional);
    if (pattern === undefined || pattern === null) {
      pattern = "";
    }
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

    const hasAdditional = additional.length > 0;
    const isArrayInput = Array.isArray(pattern);
    const allPatterns = isArrayInput ? flatten(pattern) : (hasAdditional ? flatten([pattern, ...additional]) : [pattern]);

    const requiredIndices = new Set<number>();
    let hasLiteralMatch = false;
    const unwrapped: any[] = [];
    for (let i = 0; i < allPatterns.length; i++) {
      let p = allPatterns[i];
      if (p && typeof p === 'object' && '__isRequiredRule' in p) {
        requiredIndices.add(i);
        p = p.pattern;
      }
      if (p && typeof p === 'object' && '__isLiteralExp' in p) {
        hasLiteralMatch = true;
        unwrapped.push(p);
      } else {
        unwrapped.push(p as any);
      }
    }

    const valueToWrite = unwrapped.length === 1 && !isArrayInput && !hasAdditional ? unwrapped[0] : unwrapped;

    const id = nextRuleId();
    const ruleObj: Rule = { id, type: 'optional', value: valueToWrite };
    if (requiredIndices.size > 0) {
      ruleObj.requiredIndices = requiredIndices;
    }

    if (hasLiteralMatch) {
      const lead = SyntaxElement.defaultLeadingTrivia;
      const trail = SyntaxElement.defaultTrailingTrivia;
      if (lead) this.LeadingTrivia(lead);
      this.rules.push(ruleObj);
      if (trail) this.TrailingTrivia(trail);
    } else {
      this.rules.push(ruleObj);
    }
    return this;
  }

  Unordered(pattern: any, ...additional: any[]): this {
    return this.Optional(pattern, ...additional);
  }

  Required(): any {
    return Required(this);
  }

  ZeroOrMore(pattern: any, ...additional: any[]): this {
    this.checkInliningRecursion(pattern);
    this.checkInliningRecursion(additional);
    if (pattern === undefined || pattern === null) {
      pattern = "";
    }
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

    const hasAdditional = additional.length > 0;
    const isArrayInput = Array.isArray(pattern);
    const allPatterns = isArrayInput ? flatten(pattern) : (hasAdditional ? flatten([pattern, ...additional]) : [pattern]);

    let hasLiteralMatch = false;
    const unwrapped: any[] = [];
    for (const p of allPatterns) {
      if (p && typeof p === 'object' && '__isLiteralExp' in p) {
        hasLiteralMatch = true;
        unwrapped.push(p);
      } else {
        unwrapped.push(p as any);
      }
    }

    const valueToWrite = unwrapped.length === 1 && !isArrayInput && !hasAdditional ? unwrapped[0] : unwrapped;

    if (hasLiteralMatch) {
      const lead = SyntaxElement.defaultLeadingTrivia;
      const trail = SyntaxElement.defaultTrailingTrivia;
      if (lead) this.LeadingTrivia(lead);
      
      const id = nextRuleId();
      this.rules.push({ id, type: 'zeroOrMore', value: valueToWrite, hasLiteralMatchWarning: hasLiteralMatch });
      
      if (trail) this.TrailingTrivia(trail);
    } else {
      const id = nextRuleId();
      this.rules.push({ id, type: 'zeroOrMore', value: valueToWrite });
    }
    return this;
  }

  ZeroOrMoreToken(pattern: any, ...additional: any[]): this {
    return this.ZeroOrMore(Token(pattern), ...additional.map(p => Token(p)));
  }

  OneOrMore(pattern: any, ...additional: any[]): this {
    this.checkInliningRecursion(pattern);
    this.checkInliningRecursion(additional);
    if (pattern === undefined || pattern === null) {
      pattern = "";
    }
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

    const hasAdditional = additional.length > 0;
    const isArrayInput = Array.isArray(pattern);
    const allPatterns = isArrayInput ? flatten(pattern) : (hasAdditional ? flatten([pattern, ...additional]) : [pattern]);

    let hasLiteralMatch = false;
    const unwrapped: any[] = [];
    for (const p of allPatterns) {
      if (p && typeof p === 'object' && '__isLiteralExp' in p) {
        hasLiteralMatch = true;
        unwrapped.push(p);
      } else {
        unwrapped.push(p as any);
      }
    }

    const valueToWrite = unwrapped.length === 1 && !isArrayInput && !hasAdditional ? unwrapped[0] : unwrapped;

    if (hasLiteralMatch) {
      const lead = SyntaxElement.defaultLeadingTrivia;
      const trail = SyntaxElement.defaultTrailingTrivia;
      if (lead) this.LeadingTrivia(lead);
      
      const id = nextRuleId();
      this.rules.push({ id, type: 'oneOrMore', value: valueToWrite, hasLiteralMatchWarning: hasLiteralMatch });
      
      if (trail) this.TrailingTrivia(trail);
    } else {
      const id = nextRuleId();
      this.rules.push({ id, type: 'oneOrMore', value: valueToWrite });
    }
    return this;
  }

  OneOrMoreToken(pattern: any, ...additional: any[]): this {
    return this.OneOrMore(Token(pattern), ...additional.map(p => Token(p)));
  }

  ExpectEOF(): this {
    const id = nextRuleId();
    this.rules.push({ id, type: 'eof' });
    return this;
  }

  ExpectsEOF(): this {
    return this.ExpectEOF();
  }

  LeadingTrivia(pattern?: string | RegExp | SyntaxElement): this {
    const val = pattern !== undefined ? pattern : (SyntaxElement.defaultLeadingTrivia || "");
    const id = nextRuleId();
    this.rules.push({ id, type: 'leadingTrivia', value: val });
    return this;
  }

  TrailingTrivia(pattern?: string | RegExp | SyntaxElement): this {
    const val = pattern !== undefined ? pattern : (SyntaxElement.defaultTrailingTrivia || "");
    const id = nextRuleId();
    this.rules.push({ id, type: 'trailingTrivia', value: val });
    return this;
  }

  SeparatedBy(
    item: any,
    separator: any,
    optionsOrAllowTrailing?: boolean | { allowLeading?: boolean; allowTrailing?: boolean },
    allowLeading?: boolean
  ): this {
    if (item === undefined || item === null) {
      item = "";
    }
    if (separator === undefined || separator === null) {
      separator = "";
    }

    let allowTrailing = false;
    let computedAllowLeading = false;
    if (typeof optionsOrAllowTrailing === 'boolean') {
      allowTrailing = optionsOrAllowTrailing;
      computedAllowLeading = !!allowLeading;
    } else if (optionsOrAllowTrailing && typeof optionsOrAllowTrailing === 'object') {
      allowTrailing = !!optionsOrAllowTrailing.allowTrailing;
      computedAllowLeading = !!optionsOrAllowTrailing.allowLeading;
    }

    const flatten = (arr: any[]): any[] => {
      const res: any[] = [];
      for (const x of arr) {
        if (Array.isArray(x)) {
          res.push(...flatten(x));
        } else {
          res.push(x);
        }
      }
      return res;
    };

    const isArrayInput = Array.isArray(item);
    const allItems = isArrayInput ? flatten(item) : [item];
    const unwrappedItems: any[] = [];
    for (const p of allItems) {
      this.checkInliningRecursion(p);
      unwrappedItems.push(p);
    }
    const itemToWrite = unwrappedItems.length === 1 && !isArrayInput ? unwrappedItems[0] : unwrappedItems;

    this.checkInliningRecursion(separator);

    const id = nextRuleId();
    this.rules.push({
      id,
      type: 'separatedBy',
      value: { item: itemToWrite, separator, allowTrailing, allowLeading: computedAllowLeading }
    });
    return this;
  }

  SeparatedByToken(
    item: any,
    separator: any,
    optionsOrAllowTrailing?: boolean | { allowLeading?: boolean; allowTrailing?: boolean },
    allowLeading?: boolean
  ): this {
    const isArrayInput = Array.isArray(item);
    const processedItem = isArrayInput ? item.map(p => Token(p)) : Token(item);
    return this.SeparatedBy(processedItem, Token(separator), optionsOrAllowTrailing, allowLeading);
  }

  Assert(pattern: any, ...additional: any[]): this {
    if (pattern === undefined || pattern === null) {
      pattern = "";
    }
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

    const hasAdditional = additional.length > 0;
    const isArrayInput = Array.isArray(pattern);
    const allPatterns = isArrayInput ? flatten(pattern) : (hasAdditional ? flatten([pattern, ...additional]) : [pattern]);

    const unwrapped: (string | RegExp | SyntaxElement)[] = [];
    for (const p of allPatterns) {
      if (p && typeof p === 'object' && '__isTokenMarker' in p) {
        unwrapped.push(unwrapToken(p));
      } else {
        unwrapped.push(p as any);
      }
    }

    const valueToWrite = unwrapped.length === 1 && !isArrayInput && !hasAdditional ? unwrapped[0] : unwrapped;

    const id = nextRuleId();
    this.rules.push({ id, type: 'assert', value: valueToWrite });
    return this;
  }

  Token(pattern: string | RegExp | SyntaxElement | LiteralExp | TokenMarker, leading?: string | RegExp | SyntaxElement, trailing?: string | RegExp | SyntaxElement): this {
    const lead = leading !== undefined ? leading : SyntaxElement.defaultLeadingTrivia;
    const trail = trailing !== undefined ? trailing : SyntaxElement.defaultTrailingTrivia;
    if (lead) this.LeadingTrivia(lead);
    
    const realPattern = (pattern && typeof pattern === 'object' && '__isTokenMarker' in pattern) ? pattern.pattern : pattern;
    
    let rule: Rule;
    const id = nextRuleId();
    if (realPattern instanceof SyntaxElement) {
      rule = { id, type: 'element', value: realPattern };
    } else if (realPattern instanceof RegExp) {
      if (isSimpleCaseInsensitiveRegex(realPattern)) {
        rule = { id, type: 'caseInsensitiveLiteral', value: realPattern };
      } else {
        rule = { id, type: 'regex', value: realPattern };
      }
    } else if (realPattern instanceof LiteralExp) {
      let litVal = "";
      let ruleType: RuleType = 'literalMatch';
      if (realPattern.literal instanceof RegExp) {
        if (!isSimpleCaseInsensitiveRegex(realPattern.literal)) {
          throw new Error("Regex pattern for LiteralMatch must be a simple case-insensitive regex pattern (have 'i' flag and no regex special chars).");
        }
        litVal = realPattern.literal.source;
        ruleType = 'caseInsensitiveLiteralMatch';
      } else {
        litVal = String(realPattern.literal);
      }
      const regexVal = typeof realPattern.pattern === 'string' ? new RegExp(realPattern.pattern) : realPattern.pattern;
      rule = { id, type: ruleType, value: { literal: litVal, pattern: regexVal } };
    } else {
      rule = { id, type: 'literal', value: realPattern };
    }
    this.rules.push(rule);
    
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
      isInlineElement: this.isHiddenElement,
      rules: this.rules.map(r => {
        let val = r.value;
        if ((r.type === 'choice' || r.type === 'zeroOrMore' || r.type === 'oneOrMore') && Array.isArray(r.value)) {
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
    const isRootCall = visited.size === 0;
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
      } else if (RuleHelper.hasArrayValue(rule)) {
        for (const choice of rule.value) {
          if (choice instanceof SyntaxElement) {
            choice.autoInjectLoopBoundaries(visited);
          }
        }
      } else if (RuleHelper.isLoop(rule)) {
        if (rule.value instanceof SyntaxElement) {
          rule.value.autoInjectLoopBoundaries(visited);
        } else if (Array.isArray(rule.value)) {
          for (const choice of rule.value) {
            if (choice instanceof SyntaxElement) {
              choice.autoInjectLoopBoundaries(visited);
            }
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
      if (RuleHelper.isLoop(rule)) {
        if (rule.value instanceof SyntaxElement) {
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
        } else if (Array.isArray(rule.value)) {
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
    
    if (isRootCall) {
      this.precomputeRecoveryBoundaries();
    }
  }

  public precomputeRecoveryBoundaries(visited: Set<number> = new Set()): void {
    const isRootCall = visited.size === 0;
    if (isRootCall) {
      this.linkParentRules();
    }
    if (visited.has(this.id)) return;
    visited.add(this.id);

    // 1. Recurse sub-elements first
    for (const rule of this.rules) {
      if (rule.value instanceof SyntaxElement) {
        rule.value.precomputeRecoveryBoundaries(visited);
      } else if (RuleHelper.hasArrayValue(rule)) {
        for (const choice of rule.value) {
          if (choice instanceof SyntaxElement) {
            choice.precomputeRecoveryBoundaries(visited);
          }
        }
      } else if (RuleHelper.isLoop(rule)) {
        if (rule.value instanceof SyntaxElement) {
          rule.value.precomputeRecoveryBoundaries(visited);
        } else if (Array.isArray(rule.value)) {
          for (const choice of rule.value) {
            if (choice instanceof SyntaxElement) {
              choice.precomputeRecoveryBoundaries(visited);
            }
          }
        }
      } else if (rule.type === 'optional' && rule.value instanceof SyntaxElement) {
        rule.value.precomputeRecoveryBoundaries(visited);
      }
    }

    // 2. Precompute future expected patterns for each of this element's rules
    for (let i = 0; i < this.rules.length; i++) {
      const rule = this.rules[i];
      const futureRecoveryPatterns = this.gatherFollowPatterns(this.rules, i + 1, new Set());
      
      // If the current rule is a repetition loop (zeroOrMore/oneOrMore), 
      // we can also expect the loop's starting patterns if it repeats.
      if (rule.type === 'zeroOrMore' || rule.type === 'oneOrMore') {
        const loopStartPatterns = this.collectStartPatterns(rule, new Set());
        futureRecoveryPatterns.push(...loopStartPatterns);
      }

      const unwrappedFuture = futureRecoveryPatterns
        .map(p => unwrapToken(p))
        .filter(p => p !== null && p !== undefined && p !== "");

      const explicit = rule.explicitRecoveryPatterns || [];
      const combined = [...explicit];

      for (const p of unwrappedFuture) {
        // if (!combined.some(cp => {
        //   if (cp === p) return true;
        //   if (cp instanceof RegExp && p instanceof RegExp) {
        //     return cp.source === p.source && cp.flags === p.flags;
        //   }
        //   return false;
        // })) {
        //   combined.push(p);
        // }
        combined.push(p);
      }
      rule.recoveryPatterns = combined;
    }

    // 3. Precompute recovery patterns for this element itself
      const patterns: (string | RegExp | SyntaxElement)[] = [];
      for (let i = this.rules.length - 1; i >= 0; i--) {
        const r = this.rules[i];
        if (r.type === 'literal' && typeof r.value === 'string') {
          const val = r.value;
          if (!patterns.includes(val)) patterns.push(val);
          break;
        } else if (RuleHelper.hasOptionalOrTriviaOrLoop(r)) {
          continue;
        } else {
          break;
        }
      }
  }

  public linkParentRules(visited: Set<number> = new Set()): void {
    if (visited.has(this.id)) return;
    visited.add(this.id);

    for (const rule of this.rules) {
      const childElements = this.findReferencedElementsInRule(rule);
      for (const child of childElements) {
        if (child.rules) {
          for (const childRule of child.rules) {
            if (childRule.parentRuleId === undefined) {
              childRule.parentRuleId = rule.id;
            }
            else
            {
            console.log(`TWICEEE: ${this.name}, ${child.name}, ${rule.id}, ${childRule.parentRuleId}`);
            }
          }
        }
        child.linkParentRules(visited);
      }
    }
  }

  private findReferencedElementsInRule(rule: Rule): SyntaxElement[] {
    const found: SyntaxElement[] = [];
    const collect = (val: any, visitedObjects = new Set<any>()) => {
      if (!val || visitedObjects.has(val)) return;
      visitedObjects.add(val);

      if (val instanceof SyntaxElement) {
        found.push(val);
        return;
      }
      if (Array.isArray(val)) {
        for (const item of val) {
          collect(item, visitedObjects);
        }
      } else if (typeof val === 'object') {
        for (const k of Object.keys(val)) {
          collect(val[k], visitedObjects);
        }
      }
    };
    collect(rule.value);
    return found;
  }

  public gatherFollowPatterns(rules: Rule[], startIndex: number, visitedElements: Set<number>): any[] {
    const patterns: any[] = [];
    for (let j = startIndex; j < rules.length; j++) {
      const rule = rules[j];
      const subPatterns = this.collectStartPatterns(rule, visitedElements);
      patterns.push(...subPatterns);
    }
    return patterns;
  }

  private collectStartPatterns(rule: Rule, visitedElements: Set<number>): any[] {
    if (!rule) return [];
    if (rule.type === 'literal') {
      return [rule.value];
    }
    if (rule.type === 'regex' || rule.type === 'caseInsensitiveLiteral') {
      return [rule.value];
    }
    if (rule.type === 'literalMatch' || rule.type === 'caseInsensitiveLiteralMatch') {
      return [rule.value.pattern];
    }
    if (RuleHelper.isList(rule) && Array.isArray(rule.value)) {
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
    if (RuleHelper.isRepetitionOrOptional(rule) && rule.value) {
      if (Array.isArray(rule.value)) {
        const pats: any[] = [];
        for (const choice of rule.value) {
          if (choice instanceof SyntaxElement) {
            pats.push(...this.collectElementStartPatterns(choice, visitedElements));
          } else {
            pats.push(choice);
          }
        }
        return pats;
      } else if (rule.value instanceof SyntaxElement) {
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
    return RuleHelper.isOptional(rule);
  }

  // ==========================================
  // SECTION 4: CORE PARSING MECHANICS (REFACTORED OOD DECOUPLED)
  // ==========================================

  private parsePattern(
    pattern: any, 
    text: string, 
    currentOffset: number, 
    memo: Map<string, ParseResult>, 
    ruleId: number, 
    context?: any
  ) {
    if (pattern && typeof pattern === 'object' && '__isTokenMarker' in pattern) {
      const innerPattern = pattern.pattern;
      const tokenName = pattern.name;

      let scanOffset = currentOffset;
      let maxLimit = currentOffset;

      if (SyntaxElement.defaultLeadingTrivia) {
        const leadRes = this.parsePattern(SyntaxElement.defaultLeadingTrivia, text, scanOffset, memo, ruleId, context);
        if (leadRes.success) {
           scanOffset = leadRes.newOffset;
        }
      }

      const innerStartOffset = scanOffset;
      const innerRes = this.parsePattern(innerPattern, text, scanOffset, memo, ruleId, context);
      maxLimit = Math.max(maxLimit, innerRes.dependencyLimit);

      if (!innerRes.success) {
         return { success: false, newOffset: currentOffset, dependencyLimit: maxLimit };
      }

      scanOffset = innerRes.newOffset;
      let ast = innerRes.value;

      if (SyntaxElement.defaultTrailingTrivia) {
         const trailRes = this.parsePattern(SyntaxElement.defaultTrailingTrivia, text, scanOffset, memo, ruleId, context);
         if (trailRes.success) {
            scanOffset = trailRes.newOffset;
         }
      }

      if (tokenName && ast) {
          const wrapped = {
             type: 'struct',
             start: innerStartOffset,
             end: innerRes.newOffset,
             _fields: { [tokenName]: ast },
             value: ast
          };
          ast = wrapped;
      }

      return { success: true, newOffset: scanOffset, value: ast, dependencyLimit: maxLimit };
    }

    if (pattern instanceof SyntaxElement) {
      const subResult = pattern.parse(text, currentOffset, memo, context);
      if (subResult && !subResult.error) {
        if (subResult.ast) {
          (subResult.ast as any).parentRuleId = ruleId;
        }
        return { success: true, value: subResult.ast, newOffset: subResult.newOffset, skipped: false, dependencyLimit: subResult.dependencyLimit !== undefined ? subResult.dependencyLimit : subResult.newOffset };
      } else {
        return { success: false, error: subResult?.error || `Failed sub-element: ${pattern.name}`, newOffset: subResult ? subResult.newOffset : currentOffset, dependencyLimit: subResult ? (subResult.dependencyLimit !== undefined ? subResult.dependencyLimit : subResult.newOffset) : currentOffset };
      }
    } else if (pattern && typeof pattern === 'object' && '__isLiteralExp' in pattern) {
      const marker = pattern as any;
      const lit = marker.literal;
      const pat = marker.pattern;
      
      let litVal = "";
      let isCaseInsensitive = false;
      if (lit instanceof RegExp) {
        litVal = lit.source;
        isCaseInsensitive = true;
      } else {
        litVal = String(lit);
      }
      
      const regex = pat instanceof RegExp ? pat : new RegExp(pat);
      const match = matchRegex(regex, text, currentOffset);
      
      const matchSuccess = isCaseInsensitive 
        ? (match && match[0].toLowerCase() === litVal.toLowerCase())
        : (match && match[0] === litVal);

      if (matchSuccess) {
        const matchedValue = match![0];
        return { success: true, value: GreenNode.create('literal', matchedValue, ruleId, matchedValue.length), newOffset: currentOffset + matchedValue.length, dependencyLimit: currentOffset + matchedValue.length };
      } else {
        return { success: false, error: `Expected strict literal: "${litVal}"`, newOffset: currentOffset, dependencyLimit: currentOffset + 1 };
      }
    } else if (pattern instanceof RegExp) {
      if (isSimpleCaseInsensitiveRegex(pattern)) {
        const source = pattern.source;
        const slice = text.slice(currentOffset, currentOffset + source.length);
        if (slice.toLowerCase() === source.toLowerCase()) {
          return { success: true, value: GreenNode.create('literal', slice, ruleId, source.length), newOffset: currentOffset + source.length, dependencyLimit: currentOffset + source.length };
        } else {
          const hasOverride = 'overrideName' in pattern && typeof (pattern as any).overrideName === 'string';
          const errMsg = hasOverride ? `Expected ${(pattern as any).overrideName}` : `Expected case-insensitive literal: ${source}`;
          return { success: false, error: errMsg, newOffset: currentOffset, dependencyLimit: currentOffset + source.length };
        }
      }
      const match = matchRegex(pattern, text, currentOffset);
      if (match) {
        return { success: true, value: GreenNode.create('token', match[0], ruleId, match[0].length), newOffset: currentOffset + match[0].length, dependencyLimit: currentOffset + match[0].length };
      } else {
        const hasOverride = 'overrideName' in pattern && typeof (pattern as any).overrideName === 'string';
        const errMsg = hasOverride ? `Expected ${(pattern as any).overrideName}` : `Expected match for pattern: ${pattern.source}`;
        return { success: false, error: errMsg, newOffset: currentOffset, dependencyLimit: currentOffset + 1 };
      }
    } else {
      if (text.startsWith(pattern as string, currentOffset)) {
        return { success: true, value: GreenNode.create('literal', pattern, ruleId, (pattern as string).length), newOffset: currentOffset + (pattern as string).length, dependencyLimit: currentOffset + (pattern as string).length };
      } else {
        return { success: false, error: `Expected literal: ${pattern}`, newOffset: currentOffset, dependencyLimit: currentOffset + (pattern as string).length };
      }
    }
  }

  parse(
    text: string, 
    offset: number = 0, 
    memo: Map<string, ParseResult> = new Map(), 
    context?: any
  ): ParseResult | null {
    for (const el of SyntaxElement.registry.values()) {
      for (const rule of el.rules) {
        SyntaxElement.ruleRegistry.set(rule.id, rule);
      }
    }
    for (const rule of this.rules) {
      SyntaxElement.ruleRegistry.set(rule.id, rule);
    }

    const isSpatial = 'tryGet' in memo && typeof (memo as any).tryGet === 'function';
    let cached: ParseResult | undefined = undefined;
    if (isSpatial) {
      cached = (memo as any).tryGet(this.id, offset);
    } else {
      cached = memo.get(`${this.id}-${offset}`);
    }

    const ctx: any = context || { maxOffset: -1, maxError: null, expectedPaths: [], recoveredErrors: [] };
    if (ctx.maxOffset === undefined) ctx.maxOffset = -1;
    if (ctx.maxError === undefined) ctx.maxError = null;
    if (ctx.expectedPaths === undefined) ctx.expectedPaths = [];
    if (ctx.recoveredErrors === undefined) ctx.recoveredErrors = [];

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

    if (cached !== undefined) {
      if (typeof ctx.cacheHits === 'number') {
        ctx.cacheHits++;
      }
      
      if (cached.astDelta && cached.astDelta !== 0) {
        const d = cached.astDelta;
        if (cached.recoveredErrors) {
          cached.recoveredErrors = cached.recoveredErrors.map(err => ({
            ...err,
            offset: err.offset + d,
            recoveredOffset: typeof err.recoveredOffset === 'number' ? err.recoveredOffset + d : undefined
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

    if (isSpatial) {
      (memo as any).trySet(this.id, offset, res);
    } else {
      memo.set(`${this.id}-${offset}`, res);
    }

    if (ctx.profile && profilerNode) {
      profilerNode.duration = performance.now() - profilerStartTime;
      const childrenDuration = profilerNode.children.reduce((acc: number, c: any) => acc + c.duration, 0);
      profilerNode.selfTime = Math.max(0, profilerNode.duration - childrenDuration);
      ctx.profileStack.pop();
    }

    return res;
  }

  private isRuleStructural(rule: Rule): boolean {
    return RuleHelper.isStructural(rule);
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
    let highTension = false;

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
        case 'caseInsensitiveLiteral':
        case 'regex':
          res = this.evaluatePatternRule(rule, text, currentOffset, memo, ctx, results);
          break;

        case 'literalMatch':
          res = this.evaluateLiteralMatchRule(rule, text, currentOffset, memo, ctx, results);
          break;

        case 'caseInsensitiveLiteralMatch':
          res = this.evaluateCaseInsensitiveLiteralMatchRule(rule, text, currentOffset, memo, ctx, results);
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

        case 'oneOrMore':
          res = this.evaluateOneOrMoreRule(rule, text, currentOffset, memo, ctx, results);
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
        currentOffset = res.newOffset;
        if (res.panicked) {
          panicked = true;
          
          if (res.newOffset > offset) hasCommitted = true;
          break;
        }

        const errorMsgToUse = rule.customErrorMessage || res.error || "Match failed";
        
        let shouldRecover = !highTension;
        let recovered = false;
        if (!shouldRecover && ctx.rootElement === this) {
          shouldRecover = true;
        }

        if (shouldRecover) {

          let r = this.attemptRecovery(text, currentOffset, rule.recoveryPatterns || [], memo, ctx);
          if (!r && hasCommitted) {
            // Walk up static parentRuleId chains
            let parentId = rule.parentRuleId;
            const visitedRules = new Set<number>();
            while (parentId !== undefined && !visitedRules.has(parentId)) {
              visitedRules.add(parentId);
              const parentRule = SyntaxElement.ruleRegistry.get(parentId);
              console.log(parentRule.label);
              if (parentRule) {
                if (parentRule.recoveryPatterns && parentRule.recoveryPatterns.length > 0) {
                  const parentR = this.attemptRecovery(text, currentOffset, parentRule.recoveryPatterns, memo, ctx);
                  if (parentR) {
                    r = parentR;
                    break;
                  }
                }
                parentId = parentRule.parentRuleId;
              } else {
                break;
              }
            }
          }

          if (r) {
            localMaxOffset = Math.max(localMaxOffset, r.dependencyLimit);
            const matchedOffset = r.newOffset;

            const msg = `Syntax Error in ${this.name}: ${errorMsgToUse} at offset ${currentOffset}. Recovered at offset ${matchedOffset}`;
            ctx.recoveredErrors.push({ message: msg, offset: currentOffset, recoveredOffset: matchedOffset });
            const errNode = GreenNode.create('error_node', msg, 0, matchedOffset - currentOffset);
            results.push(errNode);

            currentOffset = matchedOffset;
            panicked = false;
            recovered = true; // Mark as successfully recovered
          }
        }

        if (recovered) {
          if(!hasCommitted) highTension=true;
          continue; // ✅ Skip returning the fatal error and continue parsing the next sequence rules!
        }

        const err = this.fail(errorMsgToUse, currentOffset, rule.id, ctx);
        localMaxOffset = Math.max(localMaxOffset, err.dependencyLimit);
        return err;
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

  private evaluateLiteralMatchRule(
    rule: Rule,
    text: string,
    currentOffset: number,
    memo: Map<string, ParseResult>,
    ctx: any,
    results: any[]
  ) {
    const literal = rule.value?.literal !== undefined && rule.value?.literal !== null ? String(rule.value.literal) : "";
    const pattern = rule.value?.pattern || new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const match = matchRegex(pattern, text, currentOffset);
    if (match && match[0] === literal) {
      const node = GreenNode.create('literal', literal, rule.id, literal.length);
      results.push(node);
      return { success: true, newOffset: currentOffset + literal.length, dependencyLimit: currentOffset + literal.length };
    } else {
      const errorMsg = `Expected strict literal: "${literal}"`;
      return { success: false, newOffset: currentOffset, dependencyLimit: currentOffset + 1, error: errorMsg };
    }
  }

  private evaluateCaseInsensitiveLiteralMatchRule(
    rule: Rule,
    text: string,
    currentOffset: number,
    memo: Map<string, ParseResult>,
    ctx: any,
    results: any[]
  ) {
    const literal = rule.value?.literal !== undefined && rule.value?.literal !== null ? String(rule.value.literal) : "";
    const pattern = rule.value?.pattern || new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const match = matchRegex(pattern, text, currentOffset);
    if (match && match[0].toLowerCase() === literal.toLowerCase()) {
      const matchedValue = match[0];
      const node = GreenNode.create('literal', matchedValue, rule.id, matchedValue.length);
      results.push(node);
      return { success: true, newOffset: currentOffset + matchedValue.length, dependencyLimit: currentOffset + matchedValue.length };
    } else {
      const errorMsg = `Expected case-insensitive strict literal : "${literal}"`;
      return { success: false, newOffset: currentOffset, dependencyLimit: currentOffset + 1, error: errorMsg };
    }
  }

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
      return { success: true, newOffset: res.newOffset, dependencyLimit: res.dependencyLimit };
    } else {
      let offsetToUse = currentOffset;
      if (res.newOffset && res.newOffset > currentOffset) {
        offsetToUse = res.newOffset;
      }
      return { success: false, newOffset: offsetToUse, dependencyLimit: res.dependencyLimit, error: res.error };
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
    let choiceErrorMsg = `Expected one of: ${patterns.map(p => SyntaxElement.getPatternDescription(p)).join(", ")}`;
    let localMaxOffset = currentOffset;

    const baseErrorsLength = ctx.recoveredErrors.length;

    let backupMatch: { 
      resVal: any; 
      pattern: any;
      newOffset: number; 
      errors: ParseError[]; 
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
              errors: ctx.recoveredErrors.slice(beforeBranchErrors)
            };
          }
          ctx.recoveredErrors.length = beforeBranchErrors;
        }
      } else {
        if (res.newOffset && res.newOffset > maxFailedOffset) {
          maxFailedOffset = res.newOffset;
          choiceErrorMsg = res.error || choiceErrorMsg;
        }
        ctx.recoveredErrors.length = baseErrorsLength;
      }
    }

    if (!matched && backupMatch) {
      if (backupMatch.resVal && (backupMatch.resVal.width > 0 || backupMatch.resVal.type === 'eof')) {
        results.push(backupMatch.resVal);
      }
      currentOffset = backupMatch.newOffset;
      ctx.recoveredErrors.push(...backupMatch.errors);
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
    const isArray = Array.isArray(rule.value);
    const initialResultsCount = results.length;
    
    if (!isArray) {
      const beforeOptErrorsLength = ctx.recoveredErrors.length;
      const res = this.parsePattern(rule.value, text, currentOffset, memo, rule.id, ctx);
      if (res.success) {
        if (res.value && (res.value.width > 0 || res.value.type === 'eof')) {
          results.push(res.value);
        }
        return { success: true, newOffset: res.newOffset, dependencyLimit: res.dependencyLimit };
      } else {
        ctx.recoveredErrors.length = beforeOptErrorsLength;
        // If single item was somehow required
        if (rule.requiredIndices && rule.requiredIndices.has(0)) {
          const reqPattern = rule.value;
          const name = reqPattern instanceof SyntaxElement ? reqPattern.name : String(reqPattern);
          return {
            success: false,
            newOffset: currentOffset,
            dependencyLimit: res.dependencyLimit,
            error: `Missing required element: ${name}`
          };
        }
        return { success: true, newOffset: currentOffset, dependencyLimit: res.dependencyLimit };
      }
    } else {
      let scanOffset = currentOffset;
      let globalMaxDependencyLimit = currentOffset;
      const patterns = rule.value as any[];
      const matchedIndices = new Set<number>();
      
      let matchedSomething = true;
      while (matchedSomething && scanOffset < text.length && matchedIndices.size < patterns.length) {
        matchedSomething = false;
        
        for (let i = 0; i < patterns.length; i++) {
          if (matchedIndices.has(i)) continue;
          
          const beforeErrorsLength = ctx.recoveredErrors.length;
          const res = this.parsePattern(patterns[i], text, scanOffset, memo, rule.id, ctx);
          globalMaxDependencyLimit = Math.max(globalMaxDependencyLimit, res.dependencyLimit);
          
          if (res.success && res.newOffset > scanOffset) {
            matchedSomething = true;
            matchedIndices.add(i);
            if (res.value && (res.value.width > 0 || res.value.type === 'eof')) {
              results.push(res.value);
            }
            scanOffset = res.newOffset;
            break; // restart check for remaining items to maintain any order
          } else {
            ctx.recoveredErrors.length = beforeErrorsLength;
          }
        }
      }
      
      if (rule.requiredIndices) {
        for (const reqIdx of rule.requiredIndices) {
          if (!matchedIndices.has(reqIdx)) {
            // Unwind any added results
            results.splice(initialResultsCount, results.length - initialResultsCount);
            const reqPattern = patterns[reqIdx];
            const name = reqPattern instanceof SyntaxElement ? reqPattern.name : String(reqPattern);
            return {
              success: false,
              newOffset: currentOffset,
              dependencyLimit: globalMaxDependencyLimit,
              error: `Missing required element: ${name}`
            };
          }
        }
      }

      return { success: true, newOffset: scanOffset, dependencyLimit: globalMaxDependencyLimit };
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
    const isArray = Array.isArray(rule.value);

    while (currentOffset < text.length) {
      let matchedBranch = false;
      let matchedRes: any = null;
      let branchNewOffset = currentOffset;
      const beforeLoopErrorsLength = ctx.recoveredErrors.length;

      if (isArray) {
        for (const pattern of rule.value) {
          const res = this.parsePattern(pattern, text, currentOffset, memo, rule.id, ctx);
          localMaxOffset = Math.max(localMaxOffset, res.dependencyLimit);
          if (res.success && res.newOffset > currentOffset) {
            matchedBranch = true;
            matchedRes = res.value;
            branchNewOffset = res.newOffset;
            break;
          } else {
            ctx.recoveredErrors.length = beforeLoopErrorsLength;
          }
        }
      } else {
        const res = this.parsePattern(rule.value, text, currentOffset, memo, rule.id, ctx);
        localMaxOffset = Math.max(localMaxOffset, res.dependencyLimit);
        if (res.success && res.newOffset > currentOffset) {
          matchedBranch = true;
          matchedRes = res.value;
          branchNewOffset = res.newOffset;
        } else {
          ctx.recoveredErrors.length = beforeLoopErrorsLength;
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
        results.push(GreenNode.create('zeroOrMore', matches, rule.id, loopWidth));
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
    const isArray = Array.isArray(rule.value);

    while (currentOffset < text.length) {
      let matchedBranch = false;
      let matchedRes: any = null;
      let branchNewOffset = currentOffset;
      const beforeLoopErrorsLength = ctx.recoveredErrors.length;
      const baseActiveScopeEndsLength = ctx.activeScopeEnds ? ctx.activeScopeEnds.length : 0;

      if (isArray) {
        for (const pattern of rule.value) {
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
      } else {
        const res = this.parsePattern(rule.value, text, currentOffset, memo, rule.id, ctx);
        localMaxOffset = Math.max(localMaxOffset, res.dependencyLimit);
        if (res.success && res.newOffset > currentOffset) {
          matchedBranch = true;
          matchedRes = res.value;
          branchNewOffset = res.newOffset;
        } else {
          ctx.recoveredErrors.length = beforeLoopErrorsLength;
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
        results.push(GreenNode.create('oneOrMore', matches, rule.id, loopWidth));
      }
      return { success: true, newOffset: currentOffset, dependencyLimit: localMaxOffset, hasCommittedUpdate: true };
    } else {
      const expected = Array.isArray(rule.value) 
        ? rule.value.map(p => SyntaxElement.getPatternDescription(p)).join(" or ") 
        : SyntaxElement.getPatternDescription(rule.value);
      return { success: false, newOffset: currentOffset, dependencyLimit: localMaxOffset, error: `Expected at least one occurrence of ${expected}` };
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
    }
    const isArray = Array.isArray(rule.value);
    if (isArray) {
      let tempOffset = scanOffset;
      let allSuccess = true;
      let dependencyLimit = tempOffset;
      for (const pattern of rule.value) {
        const res = this.parsePattern(pattern, text, tempOffset, memo, rule.id, ctx);
        dependencyLimit = Math.max(dependencyLimit, res.dependencyLimit);
        if (res.success) {
          tempOffset = res.newOffset;
        } else {
          allSuccess = false;
          break;
        }
      }
      if (allSuccess) {
        return { success: false, newOffset: currentOffset, dependencyLimit, error: "Encountered forbidden pattern sequence" };
      }
      return { success: true, newOffset: currentOffset, dependencyLimit };
    } else {
      const res = this.parsePattern(rule.value, text, scanOffset, memo, rule.id, ctx);
      if (res.success) {
        return { success: false, newOffset: currentOffset, dependencyLimit: res.dependencyLimit, error: "Encountered forbidden pattern" };
      }
      return { success: true, newOffset: currentOffset, dependencyLimit: res.dependencyLimit };
    }
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
    }
    const isArray = Array.isArray(rule.value);
    if (isArray) {
      let tempOffset = scanOffset;
      let allSuccess = true;
      let dependencyLimit = tempOffset;
      for (const pattern of rule.value) {
        const res = this.parsePattern(pattern, text, tempOffset, memo, rule.id, ctx);
        dependencyLimit = Math.max(dependencyLimit, res.dependencyLimit);
        if (res.success) {
          tempOffset = res.newOffset;
        } else {
          allSuccess = false;
          break;
        }
      }
      if (allSuccess) {
        return { success: true, newOffset: currentOffset, dependencyLimit };
      }
      return { success: false, newOffset: currentOffset, dependencyLimit, error: "Assertion sequence failed" };
    } else {
      const res = this.parsePattern(rule.value, text, scanOffset, memo, rule.id, ctx);
      if (res.success) {
        return { success: true, newOffset: currentOffset, dependencyLimit: res.dependencyLimit };
      }
      return { success: false, newOffset: currentOffset, dependencyLimit: res.dependencyLimit, error: "Assertion failed" };
    }
  }

  private evaluateSeparatedByRule(
    rule: Rule,
    text: string,
    currentOffset: number,
    memo: Map<string, ParseResult>,
    ctx: any,
    results: any[]
  ) {
    const { item, separator, allowTrailing, allowLeading } = rule.value;
    const matches = [];
    const loopStartOffset = currentOffset;
    let localMaxOffset = currentOffset;

    const parsePatternOrArray = (pat: any, offset: number) => {
      const isPatArray = Array.isArray(pat);
      const beforeErrLength = ctx.recoveredErrors.length;

      if (isPatArray) {
        for (const subPat of pat) {
          const res = this.parsePattern(subPat, text, offset, memo, rule.id, ctx);
          localMaxOffset = Math.max(localMaxOffset, res.dependencyLimit);
          if (res.success) {
            return { success: true, res };
          }
          ctx.recoveredErrors.length = beforeErrLength;
        }
        return { success: false, res: null };
      } else {
        const res = this.parsePattern(pat, text, offset, memo, rule.id, ctx);
        localMaxOffset = Math.max(localMaxOffset, res.dependencyLimit);
        return { success: res.success, res };
      }
    };

    let firstItemMatched = false;

    // Optional leading separator
    if (allowLeading) {
      const beforeLeadSepOffset = currentOffset;
      const beforeLeadSepErrorsLength = ctx.recoveredErrors.length;

      const resSep = parsePatternOrArray(separator, currentOffset);
      if (resSep.success && resSep.res) {
        // Separator matched, now we must match the item
        const resItem = parsePatternOrArray(item, resSep.res.newOffset);
        if (resItem.success && resItem.res) {
          // Both matches succeeded, commit!
          if (resSep.res.value && (resSep.res.value.width > 0 || resSep.res.value.type === 'eof')) {
            matches.push(resSep.res.value);
          }
          if (resItem.res.value && (resItem.res.value.width > 0 || resItem.res.value.type === 'eof')) {
            matches.push(resItem.res.value);
          }
          currentOffset = resItem.res.newOffset;
          firstItemMatched = true;
        } else {
          // If the item failed after the leading separator, backtrack completely and try parsing item directly
          ctx.recoveredErrors.length = beforeLeadSepErrorsLength;
        }
      }
    }

    if (!firstItemMatched) {
      // Parse first item directly
      const resItem = parsePatternOrArray(item, currentOffset);
      if (!resItem.success || !resItem.res) {
        const expectedItem = Array.isArray(item) 
          ? item.map(p => SyntaxElement.getPatternDescription(p)).join(" or ") 
          : SyntaxElement.getPatternDescription(item);
        return { success: false, newOffset: currentOffset, dependencyLimit: localMaxOffset, error: `Expected first item (${expectedItem}) in separated list` };
      }
      if (resItem.res.value && (resItem.res.value.width > 0 || resItem.res.value.type === 'eof')) {
        matches.push(resItem.res.value);
      }
      currentOffset = resItem.res.newOffset;
    }

    // Loop for (separator item)*
    while (currentOffset < text.length) {
      const beforeSepOffset = currentOffset;
      const beforeSepErrorsLength = ctx.recoveredErrors.length;

      // Parse separator
      const resSep = parsePatternOrArray(separator, currentOffset);
      if (!resSep.success || !resSep.res) {
        ctx.recoveredErrors.length = beforeSepErrorsLength;
        break;
      }

      // Parse subsequent item
      const resItem = parsePatternOrArray(item, resSep.res.newOffset);
      if (resItem.success && resItem.res) {
        // Succeeded matching both separator and item!
        if (resSep.res.value && (resSep.res.value.width > 0 || resSep.res.value.type === 'eof')) {
          matches.push(resSep.res.value);
        }
        if (resItem.res.value && (resItem.res.value.width > 0 || resItem.res.value.type === 'eof')) {
          matches.push(resItem.res.value);
        }
        currentOffset = resItem.res.newOffset;
      } else {
        // Separator matched but subsequent item failed
        if (allowTrailing) {
          // Consume the trailing separator, update offset, and stop
          if (resSep.res.value && (resSep.res.value.width > 0 || resSep.res.value.type === 'eof')) {
            matches.push(resSep.res.value);
          }
          currentOffset = resSep.res.newOffset;
        } else {
          // Backtrack separator parsing and stop
          ctx.recoveredErrors.length = beforeSepErrorsLength;
        }
        break;
      }
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
    const rule = SyntaxElement.ruleRegistry.get(ruleId);
    const finalMessage = (rule && rule.customErrorMessage) ? rule.customErrorMessage : message;

    const error = {
      ast: null,
      newOffset: offset,
      error: finalMessage,
      ruleId,
      dependencyLimit: offset + 1
    };

    if (context) {
      if (offset > context.maxOffset) {
        context.maxOffset = offset;
        context.maxError = error;
        context.expectedPaths = [finalMessage];
      } else if (offset === context.maxOffset) {
        if (!context.expectedPaths.includes(finalMessage)) {
          context.expectedPaths.push(finalMessage);
        }
      }
    }

    return error;
  }

  getTerminalLiterals(visited: Set<number> = new Set()): string[] {
    if (visited.has(this.id)) return [];
    visited.add(this.id);
    const literals: string[] = [];
    for (const rule of this.rules) {
      if (RuleHelper.isTerminalTextValue(rule)) {
        if (!literals.includes(rule.value)) {
          literals.push(rule.value);
        }
      } else if (rule.type === 'element' && rule.value instanceof SyntaxElement) {
        for (const lit of rule.value.getTerminalLiterals(visited)) {
          if (!literals.includes(lit)) {
            literals.push(lit);
          }
        }
      } else if (RuleHelper.hasArrayValue(rule)) {
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
      } else if (RuleHelper.isOptionOrTriviaOrLoopOrNot(rule) && rule.value) {
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

export interface TokenMarker {
  __isTokenMarker: true;
  pattern: string | RegExp | SyntaxElement | LiteralExp;
}

export function Token(pattern: string | RegExp | SyntaxElement | LiteralExp): TokenMarker {
  return {
    __isTokenMarker: true,
    pattern
  };
}

export function unwrapToken(pattern: any): any {
  if (pattern && typeof pattern === 'object' && '__isTokenMarker' in pattern) {
    return unwrapToken(pattern.pattern);
  }
  return pattern;
}

export class LiteralExp {
  public readonly __isLiteralExp = true;
  constructor(public literal: string | RegExp, public pattern: string | RegExp) {}
}

export function LiteralMatch(literal: string | RegExp, pattern: string | RegExp): LiteralExp {
  return new LiteralExp(literal, pattern);
}

export function Element(name: string): SyntaxElement {
  return new SyntaxElement(name);
}

export function InlinedElement(): SyntaxElement {
  const el = new SyntaxElement("Inlined");
  el.Inline();
  return el;
}

export class NamedRegExp extends RegExp {
  public overrideName: string;
  constructor(pattern: RegExp | string, name: string) {
    if (pattern instanceof RegExp) {
      super(pattern.source, pattern.flags);
    } else {
      super(pattern);
    }
    this.overrideName = name;
  }
}

export function Regex(pattern: RegExp | string, name?: string): RegExp {
  if (name !== undefined) {
    return new NamedRegExp(pattern, name);
  }
  return pattern instanceof RegExp ? pattern : new RegExp(pattern);
}

export { findDiff } from './utils';