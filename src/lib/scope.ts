import { CSTQuery, getStructuralNodes } from './query';

export interface SymbolDefinition {
  id: string;
  name: string;
  kind: 'variable' | 'parameter' | 'function' | 'struct' | 'member' | 'other' | string;
  datatype: string;
  start: number;
  end: number;
  node: any;
  scopeId: string;
  references: SymbolReference[];
  fileName?: string;
}

export interface SymbolReference {
  id: string;
  name: string;
  start: number;
  end: number;
  node: any;
  scopeId: string;
  resolvedSymbolId?: string;
  fileName?: string;
}

export interface LexicalScope {
  id: string;
  name: string;
  type: 'global' | 'function' | 'struct' | 'block' | string;
  start: number;
  end: number;
  node: any;
  parentId: string | null;
  children: LexicalScope[];
  symbols: SymbolDefinition[];
  references: SymbolReference[];
  fileName?: string;
}

export class ScopeBuilder {
  private scopeRules: { type: string; query: CSTQuery; nameFn: (match: Record<string, any>, rawCaptures: any[], rawMatch: any) => string }[] = [];
  private symbolRules: { 
    query: CSTQuery; 
    nameFn?: (match: Record<string, any>, rawCaptures: any[], rawMatch: any) => string; 
    kindFn?: (match: Record<string, any>, rawCaptures: any[], rawMatch: any) => string; 
    datatypeFn?: (match: Record<string, any>, rawCaptures: any[], rawMatch: any) => string;
    isPlural?: boolean;
    symbolsFn?: (match: Record<string, any>, rawCaptures: any[], rawMatch: any) => Array<{
      node: any;
      name: string;
      kind?: 'variable' | 'parameter' | 'function' | 'struct' | 'member' | 'other' | string;
      datatype?: string;
    }>;
  }[] = [];
  private referenceRules: { query: CSTQuery; nameFn: (match: Record<string, any>, rawCaptures: any[], rawMatch: any) => string }[] = [];

  defineScope(type: string, query: string | CSTQuery, nameFn: (match: Record<string, any>, rawCaptures: any[], rawMatch: any) => string) {
    this.scopeRules.push({ type, query: query instanceof CSTQuery ? query : new CSTQuery(query), nameFn });
    return this;
  }

  defineSymbol(
    query: string | CSTQuery, 
    nameFn: (match: Record<string, any>, rawCaptures: any[], rawMatch: any) => string, 
    kindFn: (match: Record<string, any>, rawCaptures: any[], rawMatch: any) => string, 
    datatypeFn: (match: Record<string, any>, rawCaptures: any[], rawMatch: any) => string
  ) {
    this.symbolRules.push({ query: query instanceof CSTQuery ? query : new CSTQuery(query), nameFn, kindFn, datatypeFn });
    return this;
  }

  defineSymbols(
    query: string | CSTQuery,
    symbolsFn: (
      match: Record<string, any>,
      rawCaptures: any[],
      rawMatch: any
    ) => Array<{
      node: any;
      name: string;
      kind?: 'variable' | 'parameter' | 'function' | 'struct' | 'member' | 'other' | string;
      datatype?: string;
    }>
  ) {
    this.symbolRules.push({
      query: query instanceof CSTQuery ? query : new CSTQuery(query),
      isPlural: true,
      symbolsFn
    });
    return this;
  }

  defineReference(query: string | CSTQuery, nameFn: (match: Record<string, any>, rawCaptures: any[], rawMatch: any) => string) {
    this.referenceRules.push({ query: query instanceof CSTQuery ? query : new CSTQuery(query), nameFn });
    return this;
  }

  build(ast: any, fullText: string): LexicalScope {
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

    let scopeCounter = 0;
    let symbolCounter = 0;
    let refCounter = 0;

    const getCapturesDict = (match: any): Record<string, any> => {
      const dict: Record<string, any> = {};
      for (const c of match.captures) {
        if (dict[c.name] !== undefined) {
          if (Array.isArray(dict[c.name])) {
            dict[c.name].push(c.node);
          } else {
            dict[c.name] = [dict[c.name], c.node];
          }
        } else {
          dict[c.name] = c.node;
        }
      }
      return dict;
    };

    // 1. Find all scopes
    const scopes: LexicalScope[] = [];
    for (const rule of this.scopeRules) {
      const matches = rule.query.run(ast);
      for (const match of matches) {
        const captures = getCapturesDict(match);
        const targetNode = captures['node'] || match.captures[0]?.node;
        if (!targetNode) continue;
        
        scopes.push({
          id: `scope-${rule.type}-${++scopeCounter}`,
          name: rule.nameFn(captures, match.captures, match),
          type: rule.type,
          start: targetNode.start ?? 0,
          end: targetNode.end ?? 0,
          node: targetNode,
          parentId: null,
          children: [],
          symbols: [],
          references: []
        });
      }
    }

    // Sort scopes by start position ascending, and then by end position descending (larger first)
    scopes.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return b.end - a.end;
    });

    const allScopes = [globalScope, ...scopes];
    const scopeMap = new Map<string, LexicalScope>(allScopes.map(s => [s.id, s]));

    // Build scope tree in O(S) time using a stack
    const activeStack: LexicalScope[] = [globalScope];
    for (const scope of scopes) {
      while (activeStack.length > 1) {
        const top = activeStack[activeStack.length - 1];
        if (top.start <= scope.start && top.end >= scope.end) {
          break;
        }
        activeStack.pop();
      }
      const parent = activeStack[activeStack.length - 1];
      scope.parentId = parent.id;
      parent.children.push(scope);
      activeStack.push(scope);
    }

    // High performance recursive scope descent helper
    function findDeepestScope(parent: LexicalScope, start: number, end: number): LexicalScope {
      for (const child of parent.children) {
        if (child.start <= start && child.end >= end) {
          return findDeepestScope(child, start, end);
        }
      }
      return parent;
    }

    // 2. Find all symbols
    const mainDeclOffsets = new Set<number>();
    
    for (const rule of this.symbolRules) {
      const matches = rule.query.run(ast);
      for (const match of matches) {
        const captures = getCapturesDict(match);
        
        let symbolsToRegister: Array<{ node: any; name: string; kind: string; datatype: string }> = [];
        
        if (rule.isPlural && rule.symbolsFn) {
          const list = rule.symbolsFn(captures, match.captures, match);
          if (Array.isArray(list)) {
            for (const s of list) {
              if (s && s.node && s.name) {
                symbolsToRegister.push({
                  node: s.node,
                  name: s.name,
                  kind: s.kind || 'variable',
                  datatype: s.datatype || 'auto'
                });
              }
            }
          }
        } else if (rule.nameFn && rule.kindFn && rule.datatypeFn) {
          const targetNode = captures['node'] || match.captures[0]?.node;
          if (targetNode) {
            symbolsToRegister.push({
              node: targetNode,
              name: rule.nameFn(captures, match.captures, match),
              kind: rule.kindFn(captures, match.captures, match),
              datatype: rule.datatypeFn(captures, match.captures, match)
            });
          }
        }
        
        for (const sym of symbolsToRegister) {
          const start = sym.node.start ?? 0;
          const end = sym.node.end ?? 0;

          const parentScope = findDeepestScope(globalScope, start, end);

          const symId = `sym-${++symbolCounter}`;
          parentScope.symbols.push({
            id: symId,
            name: sym.name,
            kind: sym.kind,
            datatype: sym.datatype,
            start,
            end,
            node: sym.node,
            scopeId: parentScope.id,
            references: []
          });
          
          mainDeclOffsets.add(start);
        }
      }
    }

    // 3. Find all references
    for (const rule of this.referenceRules) {
      const matches = rule.query.run(ast);
      for (const match of matches) {
        const captures = getCapturesDict(match);
        const targetNode = captures['node'] || match.captures[0]?.node;
        if (!targetNode) continue;
        
        const start = targetNode.start ?? 0;
        const end = targetNode.end ?? 0;
        
        // Don't add a reference if there's a declaration at the exact same offset
        if (mainDeclOffsets.has(start)) continue;

        const parentScope = findDeepestScope(globalScope, start, end);

        parentScope.references.push({
          id: `ref-${++refCounter}`,
          name: rule.nameFn(captures, match.captures, match),
          start,
          end,
          node: targetNode,
          scopeId: parentScope.id
        });
      }
    }

    // 4. Resolve references
    function resolveRef(ref: SymbolReference, scopeId: string): SymbolDefinition | null {
      let currentId: string | null = scopeId;
      while (currentId !== null) {
        const scope = scopeMap.get(currentId);
        if (!scope) break;
        
        const matchedSym = scope.symbols.find(s => s.name === ref.name);
        if (matchedSym) return matchedSym;
        
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
}

