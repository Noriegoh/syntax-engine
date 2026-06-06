import regexpTree from 'regexp-tree';
import { SyntaxElement } from './syntax-element';

/**
 * Normalizes a string to be a safe C# or TS identifier.
 */
export function sanitize(name: string): string {
  if (!name) return "";
  const parts = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // split camelCase
    .replace(/[^a-zA-Z0-9]/g, ' ')          // replace non-alphanumeric with spaces
    .split(/\s+/)
    .filter(Boolean);
  
  if (parts.length === 0) return "_";
  
  const result = parts
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
  
  if (/^[0-9]/.test(result)) {
    return '_' + result;
  }
  return result;
}

/**
 * Escapes strings for code literal initialization.
 */
export function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Collects all unique SyntaxElements reachable from root.
 */
export function collectElements(root: SyntaxElement): SyntaxElement[] {
  const visited = new Set<number>();
  const elements: SyntaxElement[] = [];
  function visit(el: SyntaxElement) {
    if (!el || visited.has(el.id)) return;
    visited.add(el.id);
    elements.push(el);
    for (const rule of el.rules) {
      if (rule.type === 'element' && rule.value instanceof SyntaxElement) {
        visit(rule.value);
      } else if (rule.type === 'choice' || rule.type === 'zeroOrMore' || rule.type === 'oneOrMore') {
        if (Array.isArray(rule.value)) {
          for (const child of rule.value) {
            if (child instanceof SyntaxElement) {
              visit(child);
            }
          }
        } else if (rule.value instanceof SyntaxElement) {
          visit(rule.value);
        }
      } else if (
        rule.type === 'optional' ||
        rule.type === 'leadingTrivia' ||
        rule.type === 'trailingTrivia' ||
        rule.type === 'not' ||
        rule.type === 'beginScope' ||
        rule.type === 'endScope' ||
        rule.type === 'assert'
      ) {
        if (rule.value instanceof SyntaxElement) {
          visit(rule.value);
        }
      } else if (rule.type === 'separatedBy' && rule.value) {
        if (rule.value.item instanceof SyntaxElement) {
          visit(rule.value.item);
        }
        if (rule.value.separator instanceof SyntaxElement) {
          visit(rule.value.separator);
        }
      }
    }
  }
  visit(root);

  // Also collect default leading and trailing trivias to make sure they are compiled if they are SyntaxElements!
  if (SyntaxElement.defaultLeadingTrivia instanceof SyntaxElement) {
    visit(SyntaxElement.defaultLeadingTrivia);
  }
  if (SyntaxElement.defaultTrailingTrivia instanceof SyntaxElement) {
    visit(SyntaxElement.defaultTrailingTrivia);
  }

  return elements;
}

class NState {
  id: number;
  transitions: { range: [number, number]; target: NState }[] = [];
  epsilonTransitions: NState[] = [];
  isAccepting = false;
  constructor(id: number) {
    this.id = id;
  }
}
function foldRange(start: number, end: number): [number, number][] {
  const result: [number, number][] = [[start, end]];
  
  const startLower = Math.max(97, Math.min(122, start));
  const endLower = Math.max(97, Math.min(122, end));
  if (startLower <= endLower && startLower >= 97) {
    result.push([startLower - 32, endLower - 32]);
  }
  
  const startUpper = Math.max(65, Math.min(90, start));
  const endUpper = Math.max(65, Math.min(90, end));
  if (startUpper <= endUpper && startUpper >= 65) {
    result.push([startUpper + 32, endUpper + 32]);
  }
  
  return result;
}
function invertRanges(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of sorted) {
    if (merged.length === 0) {
      merged.push([r[0], r[1]]);
    } else {
      const last = merged[merged.length - 1];
      if (r[0] <= last[1] + 1) {
        last[1] = Math.max(last[1], r[1]);
      } else {
        merged.push([r[0], r[1]]);
      }
    }
  }
  const inverted: [number, number][] = [];
  let current = 0;
  for (const r of merged) {
    if (r[0] > current) {
      inverted.push([current, r[0] - 1]);
    }
    current = r[1] + 1;
  }
  if (current <= 0xFFFF) {
    inverted.push([current, 0xFFFF]);
  }
  return inverted;
}
function buildNFA(patternStr: string, flags: string = ""): NState {
  const parsed = regexpTree.parse(`/${patternStr}/${flags}`);
  const isCaseInsensitive = flags.includes('i');
  
  let stateCount = 0;
  function createState() {
    return new NState(stateCount++);
  }
  function getMetaRanges(value: string): [number, number][] {
    if (value === '.') {
      return [[0, 9], [11, 12], [14, 0xFFFF]];
    }
    if (value === '\\d') {
      return [[48, 57]];
    }
    if (value === '\\D') {
      return invertRanges([[48, 57]]);
    }
    if (value === '\\w') {
      return [[48, 57], [65, 90], [95, 95], [97, 122]];
    }
    if (value === '\\W') {
      return invertRanges([[48, 57], [65, 90], [95, 95], [97, 122]]);
    }
    if (value === '\\s') {
      return [[9, 13], [32, 32]];
    }
    if (value === '\\S') {
      return invertRanges([[9, 13], [32, 32]]);
    }
    if (value.startsWith('\\')) {
      const c = value.slice(1);
      if (c === 'n') return [[10, 10]];
      if (c === 'r') return [[13, 13]];
      if (c === 't') return [[9, 9]];
      const code = c.charCodeAt(0);
      return [[code, code]];
    }
    const code = value.charCodeAt(0);
    return [[code, code]];
  }
  function toNFA(node: any): { entry: NState; exit: NState } {
    if (!node) {
      const entry = createState();
      const exit = createState();
      entry.epsilonTransitions.push(exit);
      return { entry, exit };
    }
    if (node.type === 'Char') {
      const entry = createState();
      const exit = createState();
      if (node.kind === 'simple') {
        const code = node.value.charCodeAt(0);
        const folded: [number, number][] = isCaseInsensitive ? foldRange(code, code) : [[code, code]];
        for (const r of folded) {
          entry.transitions.push({ range: r, target: exit });
        }
      } else if (node.kind === 'meta' || node.kind === 'escaped') {
        const ranges = getMetaRanges(node.value);
        for (const r of ranges) {
          entry.transitions.push({ range: r, target: exit });
        }
      }
      return { entry, exit };
    }
    if (node.type === 'CharacterClass') {
      const entry = createState();
      const exit = createState();
      let rawRanges: [number, number][] = [];
      const exprs = node.expressions || [];
      for (const expr of exprs) {
        if (expr.type === 'Char') {
          if (expr.kind === 'simple') {
            const code = expr.value.charCodeAt(0);
            rawRanges.push([code, code]);
          } else {
            rawRanges.push(...getMetaRanges(expr.value));
          }
        } else if (expr.type === 'ClassRange') {
          const fromCode = expr.from.value.charCodeAt(0);
          const toCode = expr.to.value.charCodeAt(0);
          rawRanges.push([fromCode, toCode]);
        }
      }
      if (isCaseInsensitive) {
        const folded: [number, number][] = [];
        for (const r of rawRanges) {
          folded.push(...foldRange(r[0], r[1]));
        }
        rawRanges = folded;
      }
      const finalRanges = node.negative ? invertRanges(rawRanges) : rawRanges;
      for (const r of finalRanges) {
        entry.transitions.push({ range: r, target: exit });
      }
      return { entry, exit };
    }
    if (node.type === 'Alternative') {
      const exprs = node.expressions || [];
      if (exprs.length === 0) {
        const entry = createState();
        const exit = createState();
        entry.epsilonTransitions.push(exit);
        return { entry, exit };
      }
      let prev = toNFA(exprs[0]);
      const entry = prev.entry;
      for (let i = 1; i < exprs.length; i++) {
        const cur = toNFA(exprs[i]);
        prev.exit.epsilonTransitions.push(cur.entry);
        prev = cur;
      }
      const exit = prev.exit;
      return { entry, exit };
    }
    if (node.type === 'Disjunction') {
      const left = toNFA(node.left);
      const right = toNFA(node.right);
      const entry = createState();
      const exit = createState();
      entry.epsilonTransitions.push(left.entry);
      entry.epsilonTransitions.push(right.entry);
      left.exit.epsilonTransitions.push(exit);
      right.exit.epsilonTransitions.push(exit);
      return { entry, exit };
    }
    if (node.type === 'Repetition') {
      const body = toNFA(node.expression);
      const quant = node.quantifier || {};
      const value = quant.value;
      
      const entry = createState();
      const exit = createState();
      
      if (value === '*') {
        entry.epsilonTransitions.push(body.entry);
        entry.epsilonTransitions.push(exit);
        body.exit.epsilonTransitions.push(body.entry);
        body.exit.epsilonTransitions.push(exit);
      } else if (value === '+') {
        entry.epsilonTransitions.push(body.entry);
        body.exit.epsilonTransitions.push(body.entry);
        body.exit.epsilonTransitions.push(exit);
      } else if (value === '?') {
        entry.epsilonTransitions.push(body.entry);
        entry.epsilonTransitions.push(exit);
        body.exit.epsilonTransitions.push(exit);
      } else {
        entry.epsilonTransitions.push(body.entry);
        entry.epsilonTransitions.push(exit);
        body.exit.epsilonTransitions.push(body.entry);
        body.exit.epsilonTransitions.push(exit);
      }
      return { entry, exit };
    }
    if (node.type === 'Group') {
      return toNFA(node.expression);
    }
    if (node.type === 'Assertion') {
      const entry = createState();
      const exit = createState();
      entry.epsilonTransitions.push(exit);
      return { entry, exit };
    }
    const entry = createState();
    const exit = createState();
    entry.epsilonTransitions.push(exit);
    return { entry, exit };
  }
  const rootNFA = toNFA(parsed.body);
  rootNFA.exit.isAccepting = true;
  return rootNFA.entry;
}
export function formatChar(cp: number): string {
  if (cp === 10) return "'\\n'";
  if (cp === 13) return "'\\r'";
  if (cp === 9) return "'\\t'";
  if (cp === 39) return "'\\''";
  if (cp === 92) return "'\\\\'";
  if (cp >= 32 && cp <= 126) return `'${String.fromCharCode(cp)}'`;
  return `(char)${cp}`;
}

export class DFAState {
  id: number;
  nfaStates: Set<NState>;
  transitions = new Map<number, DFAState>();
  isAccepting = false;
  constructor(id: number, nfaStates: Set<NState>) {
    this.id = id;
    this.nfaStates = nfaStates;
    for (const s of nfaStates) {
      if (s.isAccepting) {
        this.isAccepting = true;
        break;
      }
    }
  }
}

export interface MinimizedDFA {
  dfaStates: DFAState[];
  intervals: [number, number][];
}

export function compileDFA(regex: RegExp): MinimizedDFA {
  const patternStr = regex.source;
  const flags = regex.flags;
  const startState = buildNFA(patternStr, flags);
  const allRanges: [number, number][] = [];
  const visited = new Set<number>();
  
  function collectRanges(state: NState) {
    if (visited.has(state.id)) return;
    visited.add(state.id);
    for (const t of state.transitions) {
      allRanges.push(t.range);
    }
    for (const t of state.transitions) {
      collectRanges(t.target);
    }
    for (const next of state.epsilonTransitions) {
      collectRanges(next);
    }
  }
  collectRanges(startState);
  
  const splitPointsSet = new Set<number>();
  splitPointsSet.add(0);
  splitPointsSet.add(0x10000);
  for (const r of allRanges) {
    splitPointsSet.add(r[0]);
    splitPointsSet.add(r[1] + 1);
  }
  const splitPoints = Array.from(splitPointsSet).sort((a, b) => a - b);
  
  const intervals: [number, number][] = [];
  for (let i = 0; i < splitPoints.length - 1; i++) {
    intervals.push([splitPoints[i], splitPoints[i+1] - 1]);
  }
  
  function getEpsilonClosure(states: Iterable<NState>): Set<NState> {
    const closure = new Set<NState>(states);
    const queue = Array.from(states);
    while (queue.length > 0) {
      const s = queue.shift()!;
      for (const next of s.epsilonTransitions) {
        if (!closure.has(next)) {
          closure.add(next);
          queue.push(next);
        }
      }
    }
    return closure;
  }
  
  function getDFAStateKey(states: Set<NState>): string {
    return Array.from(states).map(s => s.id).sort((a, b) => a - b).join(',');
  }
  
  const dfaStates: DFAState[] = [];
  const stateMap = new Map<string, DFAState>();
  
  const startClosure = getEpsilonClosure([startState]);
  const startDFAState = new DFAState(0, startClosure);
  dfaStates.push(startDFAState);
  stateMap.set(getDFAStateKey(startClosure), startDFAState);
  
  const queue = [startDFAState];
  while (queue.length > 0) {
    const currentDFA = queue.shift()!;
    
    for (let intervalIdx = 0; intervalIdx < intervals.length; intervalIdx++) {
      const [startCp] = intervals[intervalIdx];
      const targets = new Set<NState>();
      
      for (const nState of currentDFA.nfaStates) {
        for (const t of nState.transitions) {
          if (startCp >= t.range[0] && startCp <= t.range[1]) {
            targets.add(t.target);
          }
        }
      }
      
      if (targets.size > 0) {
        const closure = getEpsilonClosure(targets);
        const key = getDFAStateKey(closure);
        
        let targetDFA = stateMap.get(key);
        if (!targetDFA) {
          targetDFA = new DFAState(dfaStates.length, closure);
          dfaStates.push(targetDFA);
          stateMap.set(key, targetDFA);
          queue.push(targetDFA);
        }
        currentDFA.transitions.set(intervalIdx, targetDFA);
      }
    }
  }

  // MINIMIZATION (MOORE'S ALGORITHM)
  let partition: DFAState[][] = [];
  const nonAccepting = dfaStates.filter(s => !s.isAccepting);
  const accepting = dfaStates.filter(s => s.isAccepting);
  if (nonAccepting.length > 0) partition.push(nonAccepting);
  if (accepting.length > 0) partition.push(accepting);

  const stateToGroupId = new Map<number, number>();
  function updateGroupIds() {
    stateToGroupId.clear();
    for (let gId = 0; gId < partition.length; gId++) {
      for (const state of partition[gId]) {
        stateToGroupId.set(state.id, gId);
      }
    }
  }
  updateGroupIds();

  let partitionChanged = true;
  while (partitionChanged) {
    partitionChanged = false;
    const newPartition: DFAState[][] = [];
    for (const group of partition) {
      if (group.length <= 1) {
        newPartition.push(group);
        continue;
      }

      const sigMap = new Map<string, DFAState[]>();
      for (const s of group) {
        const sig = Array.from({ length: intervals.length }, (_, idx) => {
          const target = s.transitions.get(idx);
          return target ? stateToGroupId.get(target.id)! : -1;
        }).join(',');

        if (!sigMap.has(sig)) {
          sigMap.set(sig, []);
        }
        sigMap.get(sig)!.push(s);
      }

      if (sigMap.size > 1) {
        partitionChanged = true;
      }
      for (const subset of sigMap.values()) {
        newPartition.push(subset);
      }
    }
    partition = newPartition;
    updateGroupIds();
  }

  const startGroupIdx = partition.findIndex(group => group.some(s => s.id === 0));
  if (startGroupIdx !== -1 && startGroupIdx !== 0) {
    const [startGroup] = partition.splice(startGroupIdx, 1);
    partition.unshift(startGroup);
  }

  const originalIdToMinId = new Map<number, number>();
  for (let minId = 0; minId < partition.length; minId++) {
    for (const s of partition[minId]) {
      originalIdToMinId.set(s.id, minId);
    }
  }

  const minDFAStates: DFAState[] = [];
  for (let minId = 0; minId < partition.length; minId++) {
    const rep = partition[minId][0];
    const combinedNFAStates = new Set<NState>();
    for (const s of partition[minId]) {
      for (const ns of s.nfaStates) {
        combinedNFAStates.add(ns);
      }
    }
    const minState = new DFAState(minId, combinedNFAStates);
    minState.isAccepting = rep.isAccepting;
    minDFAStates.push(minState);
  }

  for (let minId = 0; minId < partition.length; minId++) {
    const minState = minDFAStates[minId];
    const rep = partition[minId][0];
    for (const [intervalIdx, targetState] of rep.transitions.entries()) {
      const targetMinId = originalIdToMinId.get(targetState.id)!;
      minState.transitions.set(intervalIdx, minDFAStates[targetMinId]);
    }
  }

  return { dfaStates: minDFAStates, intervals };
}