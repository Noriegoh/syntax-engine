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
