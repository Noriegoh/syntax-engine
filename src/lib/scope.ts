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
  private scopeRules: { type: string; query: CSTQuery; nameFn: (match: Record<string, any>) => string }[] = [];
  private symbolRules: { query: CSTQuery; nameFn: (match: Record<string, any>) => string; kindFn: (match: Record<string, any>) => string; datatypeFn: (match: Record<string, any>) => string }[] = [];
  private referenceRules: { query: CSTQuery; nameFn: (match: Record<string, any>) => string }[] = [];

  defineScope(type: string, queryStr: string, nameFn: (match: Record<string, any>) => string) {
    this.scopeRules.push({ type, query: new CSTQuery(queryStr), nameFn });
    return this;
  }

  defineSymbol(queryStr: string, nameFn: (match: Record<string, any>) => string, kindFn: (match: Record<string, any>) => string, datatypeFn: (match: Record<string, any>) => string) {
    this.symbolRules.push({ query: new CSTQuery(queryStr), nameFn, kindFn, datatypeFn });
    return this;
  }

  defineReference(queryStr: string, nameFn: (match: Record<string, any>) => string) {
    this.referenceRules.push({ query: new CSTQuery(queryStr), nameFn });
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

    // 1. Find all scopes
    const scopes: LexicalScope[] = [];
    for (const rule of this.scopeRules) {
      const matches = rule.query.run(ast);
      for (const match of matches) {
        const captures = Object.fromEntries(match.captures.map(c => [c.name, c.node]));
        const targetNode = captures['node'] || match.captures[0]?.node;
        if (!targetNode) continue;
        
        scopes.push({
          id: `scope-${rule.type}-${++scopeCounter}`,
          name: rule.nameFn(captures),
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

    // Sort scopes by length (larger scopes first), then start position
    // This makes child scopes fall entirely within parent scopes
    scopes.sort((a, b) => {
      const lenA = a.end - a.start;
      const lenB = b.end - b.start;
      if (lenA !== lenB) return lenB - lenA;
      return a.start - b.start;
    });

    const allScopes = [globalScope, ...scopes];
    const scopeMap = new Map<string, LexicalScope>(allScopes.map(s => [s.id, s]));

    // Build scope tree
    for (const scope of scopes) {
      // Find the smallest scope that contains this scope
      let parent = globalScope;
      for (const possibleParent of allScopes) {
        if (possibleParent === scope) continue;
        if (possibleParent.start <= scope.start && possibleParent.end >= scope.end) {
          if (possibleParent.end - possibleParent.start < parent.end - parent.start) {
            parent = possibleParent;
          }
        }
      }
      scope.parentId = parent.id;
      parent.children.push(scope);
    }

    // 2. Find all symbols
    const mainDeclOffsets = new Set<number>();
    
    for (const rule of this.symbolRules) {
      const matches = rule.query.run(ast);
      for (const match of matches) {
        const captures = Object.fromEntries(match.captures.map(c => [c.name, c.node]));
        const targetNode = captures['node'] || match.captures[0]?.node;
        if (!targetNode) continue;
        
        const start = targetNode.start ?? 0;
        const end = targetNode.end ?? 0;

        let parentScope = globalScope;
        for (const scope of allScopes) {
          if (scope.start <= start && scope.end >= end) {
            if (scope.end - scope.start < parentScope.end - parentScope.start) {
              parentScope = scope;
            }
          }
        }

        const symId = `sym-${++symbolCounter}`;
        parentScope.symbols.push({
          id: symId,
          name: rule.nameFn(captures),
          kind: rule.kindFn(captures),
          datatype: rule.datatypeFn(captures),
          start,
          end,
          node: targetNode,
          scopeId: parentScope.id,
          references: []
        });
        
        mainDeclOffsets.add(start);
      }
    }

    // 3. Find all references
    for (const rule of this.referenceRules) {
      const matches = rule.query.run(ast);
      for (const match of matches) {
        const captures = Object.fromEntries(match.captures.map(c => [c.name, c.node]));
        const targetNode = captures['node'] || match.captures[0]?.node;
        if (!targetNode) continue;
        
        const start = targetNode.start ?? 0;
        const end = targetNode.end ?? 0;
        
        // Don't add a reference if there's a declaration at the exact same offset
        if (mainDeclOffsets.has(start)) continue;

        let parentScope = globalScope;
        for (const scope of allScopes) {
          if (scope.start <= start && scope.end >= end) {
            if (scope.end - scope.start < parentScope.end - parentScope.start) {
              parentScope = scope;
            }
          }
        }

        parentScope.references.push({
          id: `ref-${++refCounter}`,
          name: rule.nameFn(captures),
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

