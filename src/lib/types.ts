/**
 * Core types and utilities for SyntaxEngine.
 */

export type RuleType = 'literal' | 'regex' | 'element' | 'not' | 'whitespace' | 'choice' | 'optional' | 'leadingTrivia' | 'trailingTrivia' | 'zeroOrMore' | 'oneOrMore' | 'eof' | 'beginScope' | 'endScope';

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

const greenNodeCache = new Map<string, WeakRef<GreenNode>>();
const finalizationRegistry = new FinalizationRegistry<string>((key) => {
  const ref = greenNodeCache.get(key);
  if (ref && !ref.deref()) {
    greenNodeCache.delete(key);
  }
});

let nextGreenNodeId = 0;

export class GreenNode {
  public id: number;

  constructor(
    public type: string,
    public value: any,
    public ruleId: number,
    public width: number
  ) {
    this.id = ++nextGreenNodeId;
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

    const key = `${type}:${ruleId}:${width}:${valueKey}`;
    const ref = greenNodeCache.get(key);
    if (ref) {
      const node = ref.deref();
      if (node) {
        return node;
      }
    }

    const newNode = new GreenNode(type, value, ruleId, width);
    greenNodeCache.set(key, new WeakRef(newNode));
    finalizationRegistry.register(newNode, key);
    return newNode;
  }
}

export class RedNode {
  private _valueCache: any = undefined;

  constructor(
    public green: GreenNode,
    public parent: RedNode | null,
    public offset: number 
  ) {}

  get type() { return this.green.type; }
  get ruleId() { return this.green.ruleId; }
  get start() { return this.offset; }
  get end() { return this.offset + this.green.width; }
  get deepestOffset() { return this.start; } // optional API compatibility
  
  get value(): any {
    if (this._valueCache !== undefined) return this._valueCache;
    
    if (typeof this.green.value === 'string' || !Array.isArray(this.green.value)) {
      this._valueCache = this.green.value;
      return this._valueCache;
    }
    
    let currentOffset = this.offset;
    const redChildren: RedNode[] = [];
    for (const childGreen of this.green.value as GreenNode[]) {
      redChildren.push(new RedNode(childGreen, this, currentOffset));
      currentOffset += childGreen.width;
    }
    this._valueCache = redChildren;
    return this._valueCache;
  }

  toJSON() {
    return {
      type: this.type,
      ruleId: this.ruleId,
      start: this.start,
      end: this.end,
      deepestOffset: this.deepestOffset,
      value: this.value
    };
  }
}

export function wrapASTTransformerWithIncrementalCache(userAstCode: string): string {
  if (!userAstCode || !userAstCode.trim()) {
    return userAstCode;
  }
  
  // Try to find the name of the function invoked at the end, default to 'transform'
  const match = userAstCode.match(/return\s+(\w+)\(cst\);?\s*$/);
  const transformFuncName = match ? match[1] : 'transform';

  // Replace 'function transform(' with 'function _user_transform('
  const userFuncPattern = new RegExp(`\\bfunction\\s+${transformFuncName}\\s*\\(`, 'g');
  const replacedCode = userAstCode.replace(userFuncPattern, `function _user_${transformFuncName}(`);

  return `
    if (!self.__green_ast_cache) {
      self.__green_ast_cache = new WeakMap();
    }
    const __ast_cache = self.__green_ast_cache;

    function shiftAST(ast, delta) {
      if (!ast || typeof ast !== 'object') return ast;
      if (Array.isArray(ast)) {
        return ast.map(x => shiftAST(x, delta)).filter(Boolean);
      }
      const shifted = { ...ast };
      if (typeof shifted.start === 'number') shifted.start += delta;
      if (typeof shifted.end === 'number') shifted.end += delta;
      if (typeof shifted.deepestOffset === 'number') shifted.deepestOffset += delta;
      if (shifted.children) shifted.children = shifted.children.map(x => shiftAST(x, delta)).filter(Boolean);
      if (shifted.data) shifted.data = shiftAST(shifted.data, delta);
      if (shifted.value) {
        if (Array.isArray(shifted.value)) {
          shifted.value = shifted.value.map(x => shiftAST(x, delta)).filter(Boolean);
        } else {
          shifted.value = shiftAST(shifted.value, delta);
        }
      }
      return shifted;
    }

    ${replacedCode}

    function ${transformFuncName}(node) {
      if (!node || typeof node !== 'object') return node;
      if (Array.isArray(node)) {
        return node.map(${transformFuncName}).filter(Boolean);
      }
      if (node.green) {
        const cached = __ast_cache.get(node.green);
        if (cached) {
          const delta = node.start - cached.offset;
          return delta === 0 ? cached.ast : shiftAST(cached.ast, delta);
        }
      }
      if (typeof _user_${transformFuncName} !== 'function') {
        return node;
      }
      const result = _user_${transformFuncName}(node);
      if (node.green && result && typeof result === 'object') {
        __ast_cache.set(node.green, {
          offset: node.start,
          ast: result
        });
      }
      return result;
    }

    return ${transformFuncName}(cst);
  `;
}


