import { GreenNode, RedNode } from './types';

export interface QueryCapture {
  name: string;
  node: any;
}

export interface QueryMatch {
  patternIndex: number;
  captures: QueryCapture[];
  node?: any;
}

interface RelativeQueryMatch {
  patternIndex: number;
  nodePath: number[];
  captures: Array<{
    name: string;
    nodePath: number[];
  }>;
}

const greenQueryCache = new WeakMap<GreenNode, Map<CSTQuery, RelativeQueryMatch[]>>();

function getPathFromRoot(node: RedNode, root: RedNode): number[] {
  const path: number[] = [];
  let curr = node;
  while (curr !== root && curr.parent !== null) {
    const parentVal = curr.parent.value;
    if (Array.isArray(parentVal)) {
      const idx = parentVal.indexOf(curr);
      if (idx !== -1) {
        path.push(idx);
      } else {
        break;
      }
    } else {
      break;
    }
    curr = curr.parent;
  }
  return path.reverse();
}

function resolveNodePath(root: RedNode, path: number[]): RedNode {
  let current: RedNode = root;
  for (const idx of path) {
    const val = current.value;
    if (Array.isArray(val) && idx < val.length) {
      current = val[idx];
    } else {
      break;
    }
  }
  return current;
}

export interface Predicate {
  operator: string;
  capture: string;
  value: string;
}

export interface QueryPattern {
  type: 'node' | 'literal' | 'wildcard' | 'alternation';
  nodeType?: string;
  literalValue?: string;
  children?: QueryPattern[];
  alternatives?: QueryPattern[];
  capture?: string;
  field?: string;
  quantifier?: '*' | '+' | '?';
  isDescendant?: boolean;
  predicates?: Predicate[];
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

enum TokenType {
  LPAREN,
  RPAREN,
  LBRACKET,
  RBRACKET,
  STRING,
  IDENTIFIER,
  CAPTURE,
  FIELD,
  QUANTIFIER,
  WILDCARD,
  PREDICATE
}

interface Token {
  type: TokenType;
  value: string;
}

function tokenizeQuery(queryStr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < queryStr.length) {
    if (/\s/.test(queryStr[i])) {
      i++;
      continue;
    }
    
    if (queryStr[i] === '(') { tokens.push({ type: TokenType.LPAREN, value: '(' }); i++; continue; }
    if (queryStr[i] === ')') { tokens.push({ type: TokenType.RPAREN, value: ')' }); i++; continue; }
    if (queryStr[i] === '[') { tokens.push({ type: TokenType.LBRACKET, value: '[' }); i++; continue; }
    if (queryStr[i] === ']') { tokens.push({ type: TokenType.RBRACKET, value: ']' }); i++; continue; }
    
    if (queryStr.substring(i, i + 2) === '..') {
      tokens.push({ type: TokenType.IDENTIFIER, value: '..' });
      i += 2;
      continue;
    }
    
    if (['+', '?'].includes(queryStr[i])) {
      tokens.push({ type: TokenType.QUANTIFIER, value: queryStr[i] });
      i++;
      continue;
    }
    
    if (queryStr[i] === '*') {
      tokens.push({ type: TokenType.WILDCARD, value: '*' });
      i++;
      continue;
    }
    
    if (queryStr[i] === '"' || queryStr[i] === "'") {
      const quote = queryStr[i];
      i++;
      let val = "";
      while (i < queryStr.length && queryStr[i] !== quote) {
        if (queryStr[i] === '\\') {
           val += queryStr[i+1] || '';
           i += 2;
        } else {
           val += queryStr[i];
           i++;
        }
      }
      if (i < queryStr.length) i++;
      tokens.push({ type: TokenType.STRING, value: val });
      continue;
    }
    
    if (queryStr[i] === '@') {
      i++;
      let val = "";
      while (i < queryStr.length && /[a-zA-Z0-9_\-]/.test(queryStr[i])) {
        val += queryStr[i];
        i++;
      }
      tokens.push({ type: TokenType.CAPTURE, value: val });
      continue;
    }
    
    if (queryStr[i] === ';') {
      while (i < queryStr.length && queryStr[i] !== '\n') i++;
      continue;
    }
    
    let start = i;
    while (i < queryStr.length && /[a-zA-Z0-9_\-\.\#]/.test(queryStr[i])) {
      i++;
    }
    
    if (i < queryStr.length && queryStr[i] === '?') {
      i++;
    }
       
    if (i < queryStr.length && queryStr[i] === ':') {
      tokens.push({ type: TokenType.FIELD, value: queryStr.substring(start, i) });
      i++;
      continue;
    }
    
    const val = queryStr.substring(start, i);
    if (!val) { 
      i++;
      continue;
    }
    
    if (val === '_') {
      tokens.push({ type: TokenType.WILDCARD, value: '_' });
    } else if (val.startsWith('#')) {
      tokens.push({ type: TokenType.PREDICATE, value: val });
    } else {
      tokens.push({ type: TokenType.IDENTIFIER, value: val });
    }
  }
  return tokens;
}

function parsePattern(tokens: Token[], pos: { current: number }): QueryPattern | null {
  if (pos.current >= tokens.length) return null;
  
  let pattern: QueryPattern | null = null;
  let field: string | undefined;
  
  if (tokens[pos.current].type === TokenType.FIELD) {
    field = tokens[pos.current].value;
    pos.current++;
  }
  
  if (pos.current >= tokens.length) return null;
  const token = tokens[pos.current];
  
  if (token.type === TokenType.WILDCARD) {
    pattern = { type: 'wildcard' };
    pos.current++;
  } else if (token.type === TokenType.STRING) {
    pattern = { type: 'literal', literalValue: token.value };
    pos.current++;
  } else if (token.type === TokenType.IDENTIFIER) {
    pattern = { type: 'node', nodeType: token.value };
    pos.current++;
  } else if (token.type === TokenType.LBRACKET) {
    pos.current++;
    const alts: QueryPattern[] = [];
    while (pos.current < tokens.length && tokens[pos.current].type !== TokenType.RBRACKET) {
      const alt = parsePattern(tokens, pos);
      if (alt) alts.push(alt);
      else pos.current++;
    }
    if (pos.current < tokens.length) pos.current++;
    pattern = { type: 'alternation', alternatives: alts };
  } else if (token.type === TokenType.LPAREN) {
    pos.current++;
    if (pos.current >= tokens.length) return null;
    
    const nextToken = tokens[pos.current];
    if (nextToken.type === TokenType.IDENTIFIER || nextToken.type === TokenType.WILDCARD) {
      const nodeType = (nextToken.value === '_' || nextToken.value === '*') ? undefined : nextToken.value;
      const type = (nextToken.value === '_' || nextToken.value === '*') ? 'wildcard' : 'node';
      pos.current++;
      
      const children: QueryPattern[] = [];
      const predicates: Predicate[] = [];
      let innerCapture: string | undefined;
      let nextIsDescendant = false;
      
      while (pos.current < tokens.length && tokens[pos.current].type !== TokenType.RPAREN) {
        if (tokens[pos.current].type === TokenType.LPAREN && 
            pos.current + 1 < tokens.length && 
            tokens[pos.current + 1].type === TokenType.PREDICATE) {
          pos.current += 2;
          const operator = tokens[pos.current - 1].value;
          let cap = "";
          let val = "";
          
          while (pos.current < tokens.length && tokens[pos.current].type !== TokenType.RPAREN) {
              if (tokens[pos.current].type === TokenType.CAPTURE) {
                  cap = tokens[pos.current].value;
                  pos.current++;
              } else if (tokens[pos.current].type === TokenType.STRING) {
                  val = tokens[pos.current].value;
                  pos.current++;
              } else {
                  pos.current++;
              }
          }
          if (pos.current < tokens.length) pos.current++;
          predicates.push({ operator, capture: cap, value: val });
        } else if (tokens[pos.current].type === TokenType.CAPTURE) {
           innerCapture = tokens[pos.current].value;
           pos.current++;
        } else if (tokens[pos.current].type === TokenType.IDENTIFIER && tokens[pos.current].value === '..') {
           nextIsDescendant = true;
           pos.current++;
        } else {
           const child = parsePattern(tokens, pos);
           if (child) {
             if (nextIsDescendant) {
               child.isDescendant = true;
               nextIsDescendant = false;
             }
             children.push(child);
           } else {
             pos.current++;
           }
        }
      }
      if (pos.current < tokens.length) pos.current++;
      
      pattern = { type: type as any, nodeType, children, predicates };
      if (innerCapture) pattern.capture = innerCapture;
    } else {
      pattern = parsePattern(tokens, pos);
      if (pattern) {
        while (pos.current < tokens.length && tokens[pos.current].type !== TokenType.RPAREN) {
          if (tokens[pos.current].type === TokenType.LPAREN && 
              pos.current + 1 < tokens.length && 
              tokens[pos.current + 1].type === TokenType.PREDICATE) {
            pos.current += 2;
            const operator = tokens[pos.current - 1].value;
            let cap = "";
            let val = "";
            
            while (pos.current < tokens.length && tokens[pos.current].type !== TokenType.RPAREN) {
                if (tokens[pos.current].type === TokenType.CAPTURE) {
                    cap = tokens[pos.current].value;
                    pos.current++;
                } else if (tokens[pos.current].type === TokenType.STRING) {
                    val = tokens[pos.current].value;
                    pos.current++;
                } else {
                    pos.current++;
                }
            }
            if (pos.current < tokens.length) pos.current++;
            if (!pattern.predicates) pattern.predicates = [];
            pattern.predicates.push({ operator, capture: cap, value: val });
          } else {
            pos.current++;
          }
        }
        if (pos.current < tokens.length) pos.current++;
      }
    }
  } else {
    pos.current++;
  }
  
  if (!pattern) return null;
  if (field) pattern.field = field;
  
  while (pos.current < tokens.length) {
    const postToken = tokens[pos.current];
    if (postToken.type === TokenType.QUANTIFIER || (postToken.type === TokenType.WILDCARD && postToken.value === '*')) {
      pattern.quantifier = postToken.value as any;
      pos.current++;
    } else if (postToken.type === TokenType.CAPTURE) {
      pattern.capture = postToken.value;
      pos.current++;
    } else {
      break;
    }
  }
  
  return pattern;
}

export function parseQuery(queryStr: string): QueryPattern[] {
  const tokens = tokenizeQuery(queryStr);
  const patterns: QueryPattern[] = [];
  let pos = { current: 0 };
  while (pos.current < tokens.length) {
    const pat = parsePattern(tokens, pos);
    if (pat) patterns.push(pat);
    else pos.current++;
  }
  return patterns;
}

function evaluatePredicates(pat: QueryPattern, captures: QueryCapture[]): boolean {
  if (!pat.predicates || pat.predicates.length === 0) return true;

  for (const pred of pat.predicates) {
    const targetCapture = captures.filter(c => c.name === pred.capture);
    if (targetCapture.length === 0) continue;
    
    for (const cap of targetCapture) {
       const getNodeText = (n: any): string => {
           if (typeof n === 'string') return n;
           if (n.value !== undefined && typeof n.value === 'string') return n.value;
           if (n.type === 'token') return n.value || "";
           return String(n.value || n.type);
       }
       
       const val = getNodeText(cap.node);
       
       if (pred.operator === '#eq?') {
         if (val !== pred.value) return false;
       } else if (pred.operator === '#not-eq?') {
         if (val === pred.value) return false;
       } else if (pred.operator === '#match?') {
         try {
           const regex = new RegExp(pred.value);
           if (!regex.test(val)) return false;
         } catch { return false; }
       }
    }
  }
  return true;
}

export interface Candidate {
  node: any;
  isDirect: boolean;
}

export function getPreOrderCandidates(nodes: any[]): Candidate[] {
  const result: Candidate[] = [];
  
  const traverse = (n: any, isDirect: boolean) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const item of n) {
        traverse(item, isDirect);
      }
      return;
    }
    
    result.push({ node: n, isDirect });
    
    const childrenNodes = getStructuralNodes(n.children !== undefined ? n.children : n.value);
    for (const child of childrenNodes) {
      traverse(child, false);
    }
  };
  
  for (const node of nodes) {
    traverse(node, true);
  }
  
  return result;
}

function matchChildren(
   parent: any,
   candidates: Candidate[],
   childPatterns: QueryPattern[],
   childIdx: number,
   nodeIdx: number,
   captures: QueryCapture[]
): QueryCapture[] | null {
  if (childIdx >= childPatterns.length) {
     return captures;
  }
  
  const pat = childPatterns[childIdx];
  const q = pat.quantifier;
  const isDescendantPat = pat.isDescendant || false;
  
  if (pat.field) {
    if (parent && parent[pat.field] !== undefined) {
      const target = parent[pat.field];
      const targetNodes = Array.isArray(target) ? target : [target];
      
      for (const tn of targetNodes) {
        const localCaptures: QueryCapture[] = [];
        if (executePatternMatch(tn, pat, localCaptures)) {
           const res = matchChildren(parent, candidates, childPatterns, childIdx + 1, nodeIdx, [...captures, ...localCaptures]);
           if (res !== null) return res;
        }
      }
    }
    // If it has a '*' or '?' quantifier, it implies the field is optional
    if (q === '*' || q === '?') {
      const res = matchChildren(parent, candidates, childPatterns, childIdx + 1, nodeIdx, captures);
      if (res !== null) return res;
    }
    return null;
  }
  
  for (let i = nodeIdx; i < candidates.length; i++) {
     const cand = candidates[i];
     
     if (!isDescendantPat && !cand.isDirect) {
        continue;
     }
     
     const localCaptures: QueryCapture[] = [];
     if (executePatternMatch(cand.node, pat, localCaptures)) {
        if (q === '?' || !q) {
           const res = matchChildren(parent, candidates, childPatterns, childIdx + 1, i + 1, [...captures, ...localCaptures]);
           if (res !== null) return res;
        } else if (q === '*' || q === '+') {
           const modifiedPat = { ...pat, quantifier: '*' as const };
           const newPatterns = [...childPatterns];
           newPatterns[childIdx] = modifiedPat;
           const res = matchChildren(parent, candidates, newPatterns, childIdx, i + 1, [...captures, ...localCaptures]);
           if (res !== null) return res;
        }
     }
  }

  if (q === '*' || q === '?') {
    const res = matchChildren(parent, candidates, childPatterns, childIdx + 1, nodeIdx, captures);
    if (res !== null) return res;
  }

  return null;
}

export function executePatternMatch(node: any, pat: QueryPattern, captures: QueryCapture[]): boolean {
  if (!node && pat.type !== 'wildcard') return false;
  if (!node || typeof node !== 'object') return false;
  
  const startCapturesLen = captures.length;

  if (pat.type === 'wildcard') {
    if (pat.capture) captures.push({ name: pat.capture, node });
    return evaluatePredicates(pat, captures.slice(startCapturesLen));
  }
  
  if (pat.type === 'literal') {
    const textVal = typeof node === 'string' ? node : (node.value && typeof node.value === 'string' ? node.value : null);
    if (textVal === pat.literalValue) {
      if (pat.capture) captures.push({ name: pat.capture, node });
      return evaluatePredicates(pat, captures.slice(startCapturesLen));
    }
    return false;
  }
  
  if (pat.type === 'alternation') {
    for (const alt of pat.alternatives || []) {
      const altCaptures: QueryCapture[] = [];
      if (executePatternMatch(node, alt, altCaptures)) {
        captures.push(...altCaptures);
        if (pat.capture) captures.push({ name: pat.capture, node });
        return evaluatePredicates(pat, captures.slice(startCapturesLen));
      }
    }
    return false;
  }
  
  if (pat.type === 'node') {
    if (pat.nodeType && pat.nodeType !== '_' && node.type !== pat.nodeType) {
      return false;
    }
    
    if (pat.children && pat.children.length > 0) {
      const childrenNodes = getStructuralNodes(node.children !== undefined ? node.children : node.value);
      const candidates = getPreOrderCandidates(childrenNodes);
      const childMatchCaptures = matchChildren(node, candidates, pat.children, 0, 0, []);
      if (childMatchCaptures === null) {
        return false;
      }
      captures.push(...childMatchCaptures);
    }
    
    if (pat.capture) captures.push({ name: pat.capture, node });
    return evaluatePredicates(pat, captures.slice(startCapturesLen));
  }
  
  return false;
}

export class CSTQuery {
  private patterns: QueryPattern[];

  constructor(queryString: string) {
    this.patterns = parseQuery(queryString);
  }

  private runRecursively(
    node: RedNode,
    path: number[],
    tempMatches: Array<{ patternIndex: number; nodePath: number[]; captures: Array<{ name: string; nodePath: number[] }> }>
  ): void {
    if (!node || typeof node !== 'object') return;

    const cacheMap = greenQueryCache.get(node.green);
    const cachedSub = cacheMap?.get(this);
    if (cachedSub) {
      for (const rel of cachedSub) {
        tempMatches.push({
          patternIndex: rel.patternIndex,
          nodePath: [...path, ...rel.nodePath],
          captures: rel.captures.map(c => ({
            name: c.name,
            nodePath: [...path, ...c.nodePath]
          }))
        });
      }
      return;
    }

    const startCapturesLen = 0;
    for (let i = 0; i < this.patterns.length; i++) {
      const pat = this.patterns[i];
      const captures: QueryCapture[] = [];
      if (executePatternMatch(node, pat, captures)) {
        tempMatches.push({
          patternIndex: i,
          nodePath: [...path],
          captures: captures.map(c => {
            const relativePath = getPathFromRoot(c.node, node);
            return {
              name: c.name,
              nodePath: [...path, ...relativePath]
            };
          })
        });
      }
    }

    const childVal = node.value;
    if (Array.isArray(childVal)) {
      for (let idx = 0; idx < childVal.length; idx++) {
        const child = childVal[idx];
        if (child instanceof RedNode) {
          this.runRecursively(child, [...path, idx], tempMatches);
        }
      }
    }
  }

  rawRun(ast: any): QueryMatch[] {
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
            captures,
            node
          });
        }
      }
      
      const childrenToTraverse = (node.children !== undefined) ? node.children : node.value;
      if (childrenToTraverse !== undefined) {
        traverse(childrenToTraverse);
      }
    };
    
    traverse(ast);
    return matches;
  }

  run(ast: any): QueryMatch[] {
    if (!(ast instanceof RedNode)) {
      return this.rawRun(ast);
    }

    let cacheMap = greenQueryCache.get(ast.green);
    if (!cacheMap) {
      cacheMap = new Map();
      greenQueryCache.set(ast.green, cacheMap);
    }

    let cached = cacheMap.get(this);
    if (!cached) {
      const tempMatches: Array<{ patternIndex: number; nodePath: number[]; captures: Array<{ name: string; nodePath: number[] }> }> = [];
      const tempRoot = new RedNode(ast.green, null, 0);
      
      this.runRecursively(tempRoot, [], tempMatches);
      cached = tempMatches;
      cacheMap.set(this, cached);
    }

    return cached.map(rel => ({
      patternIndex: rel.patternIndex,
      node: resolveNodePath(ast, rel.nodePath),
      captures: rel.captures.map(cap => ({
        name: cap.name,
        node: resolveNodePath(ast, cap.nodePath)
      }))
    }));
  }
}
