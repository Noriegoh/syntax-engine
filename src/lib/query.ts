export interface QueryPattern {
  type: string;
  children?: QueryPattern[];
  capture?: string;
  literalValue?: string;
}

export interface QueryCapture {
  name: string;
  node: any;
}

export interface QueryMatch {
  patternIndex: number;
  captures: QueryCapture[];
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

export function parseQuery(queryStr: string): QueryPattern[] {
  let offset = 0;
  
  function skipWhitespace() {
    while (offset < queryStr.length && /\s/.test(queryStr[offset])) {
      offset++;
    }
  }
  
  function parsePattern(): QueryPattern | null {
    skipWhitespace();
    if (offset >= queryStr.length) return null;
    
    if (queryStr[offset] === '"' || queryStr[offset] === "'") {
      const quote = queryStr[offset];
      offset++;
      let val = "";
      while (offset < queryStr.length && queryStr[offset] !== quote) {
        val += queryStr[offset];
        offset++;
      }
      if (offset < queryStr.length) offset++;
      skipWhitespace();
      let capture: string | undefined;
      if (queryStr[offset] === '@') {
        const start = offset;
        offset++;
        while (offset < queryStr.length && /[a-zA-Z0-9_]/.test(queryStr[offset])) {
          offset++;
        }
        capture = queryStr.substring(start + 1, offset);
      }
      return { type: 'literal', literalValue: val, capture };
    }
    
    if (queryStr[offset] !== '(') {
      let start = offset;
      while (offset < queryStr.length && /[a-zA-Z0-9_*-]/.test(queryStr[offset])) {
        offset++;
      }
      const type = queryStr.substring(start, offset);
      if (!type) return null;
      
      skipWhitespace();
      let capture: string | undefined;
      if (queryStr[offset] === '@') {
        const capStart = offset;
        offset++;
        while (offset < queryStr.length && /[a-zA-Z0-9_]/.test(queryStr[offset])) {
          offset++;
        }
        capture = queryStr.substring(capStart + 1, offset);
      }
      return { type, capture };
    }
    
    offset++; // skip '('
    skipWhitespace();
    
    let start = offset;
    while (offset < queryStr.length && /[a-zA-Z0-9_*-]/.test(queryStr[offset])) {
      offset++;
    }
    const type = queryStr.substring(start, offset) || '_';
    
    const children: QueryPattern[] = [];
    skipWhitespace();
    while (offset < queryStr.length && queryStr[offset] !== ')') {
      const child = parsePattern();
      if (!child) break;
      children.push(child);
      skipWhitespace();
    }
    
    if (queryStr[offset] === ')') {
      offset++;
    }
    
    skipWhitespace();
    let capture: string | undefined;
    if (queryStr[offset] === '@') {
      const capStart = offset;
      offset++;
      while (offset < queryStr.length && /[a-zA-Z0-9_]/.test(queryStr[offset])) {
        offset++;
      }
      capture = queryStr.substring(capStart + 1, offset);
    }
    
    return { type, children, capture };
  }
  
  const patterns: QueryPattern[] = [];
  while (offset < queryStr.length) {
    skipWhitespace();
    if (offset >= queryStr.length) break;
    const pat = parsePattern();
    if (pat) {
      patterns.push(pat);
    } else {
      break;
    }
  }
  return patterns;
}

function matchChildren(flattenedChildren: any[], childPatterns: QueryPattern[], patternIndex: number, currentCaptures: QueryCapture[]): QueryCapture[] | null {
  if (patternIndex >= childPatterns.length) {
    return currentCaptures;
  }
  
  const pat = childPatterns[patternIndex];
  for (let i = 0; i < flattenedChildren.length; i++) {
    const child = flattenedChildren[i];
    const localCaptures: QueryCapture[] = [];
    const matched = executePatternMatch(child, pat, localCaptures);
    if (matched) {
      const restCaptures = matchChildren(flattenedChildren.slice(i + 1), childPatterns, patternIndex + 1, [...currentCaptures, ...localCaptures]);
      if (restCaptures !== null) {
        return restCaptures;
      }
    }
  }
  return null;
}

export function executePatternMatch(node: any, pat: QueryPattern, captures: QueryCapture[]): boolean {
  if (!node || typeof node !== 'object') return false;
  
  if (pat.type === 'literal') {
    const textVal = typeof node === 'string' ? node : (node.value && typeof node.value === 'string' ? node.value : null);
    if (textVal && textVal === pat.literalValue) {
      if (pat.capture) {
        captures.push({ name: pat.capture, node });
      }
      return true;
    }
    return false;
  }
  
  if (pat.type !== '_' && node.type !== pat.type) {
    return false;
  }
  
  if (pat.children && pat.children.length > 0) {
    const childrenNodes = getStructuralNodes(node.children !== undefined ? node.children : node.value);
    const childMatchCaptures = matchChildren(childrenNodes, pat.children, 0, []);
    if (childMatchCaptures === null) {
      return false;
    }
    captures.push(...childMatchCaptures);
  }
  
  if (pat.capture) {
    captures.push({ name: pat.capture, node });
  }
  
  return true;
}

export class CSTQuery {
  private patterns: QueryPattern[];

  constructor(queryString: string) {
    this.patterns = parseQuery(queryString);
  }

  run(ast: any): QueryMatch[] {
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
            captures
          });
        }
      }
      
      const childrenToTraverse = node.children !== undefined ? node.children : node.value;
      if (childrenToTraverse !== undefined) {
        traverse(childrenToTraverse);
      }
    };
    
    traverse(ast);
    return matches;
  }
}
