import { ParseResult, ParseError, RedNode, GreenNode } from './syntax-element';
import { findDiff } from './utils';
import { SyntaxElement } from './syntax-element';

export interface CSTNode {
  ruleId: number;
  start: number;
  end: number;
  dependencyLimit: number;
  result: ParseResult;
}

export class SpatialCSTIndex extends Map<string, ParseResult> {
  private nodesByOffset = new Map<number, Map<number, CSTNode>>();
  private totalNodes = 0;

  public lastInvalidatedStart = Infinity;
  public lastInvalidatedEnd = -1;
  public lastDiscardedNodes: CSTNode[] = [];

  tryGet(ruleId: number, offset: number): ParseResult | undefined {
    return this.nodesByOffset.get(offset)?.get(ruleId)?.result;
  }

  trySet(ruleId: number, offset: number, value: ParseResult): void {
    const dependencyLimit = value.dependencyLimit !== undefined ? value.dependencyLimit : value.newOffset;
    const cstNode: CSTNode = {
      ruleId,
      start: offset,
      end: value.newOffset,
      dependencyLimit,
      result: value
    };

    let ruleMap = this.nodesByOffset.get(offset);
    if (!ruleMap) {
      ruleMap = new Map<number, CSTNode>();
      this.nodesByOffset.set(offset, ruleMap);
    }
    if (!ruleMap.has(ruleId)) {
      this.totalNodes++;
    }
    ruleMap.set(ruleId, cstNode);
  }

  override has(key: string): boolean {
    const dashIndex = key.lastIndexOf('-');
    if (dashIndex === -1) return false;
    const ruleId = parseInt(key.substring(0, dashIndex), 10);
    const offset = parseInt(key.substring(dashIndex + 1), 10);
    return this.nodesByOffset.get(offset)?.has(ruleId) ?? false;
  }

  override get(key: string): ParseResult | undefined {
    const dashIndex = key.lastIndexOf('-');
    if (dashIndex === -1) return undefined;
    const ruleId = parseInt(key.substring(0, dashIndex), 10);
    const offset = parseInt(key.substring(dashIndex + 1), 10);
    return this.nodesByOffset.get(offset)?.get(ruleId)?.result;
  }

  override set(key: string, value: ParseResult): this {
    const dashIndex = key.lastIndexOf('-');
    if (dashIndex === -1) return this;
    const ruleId = parseInt(key.substring(0, dashIndex), 10);
    const offset = parseInt(key.substring(dashIndex + 1), 10);

    const dependencyLimit = value.dependencyLimit !== undefined ? value.dependencyLimit : value.newOffset;
    const cstNode: CSTNode = {
      ruleId,
      start: offset,
      end: value.newOffset,
      dependencyLimit,
      result: value
    };

    let ruleMap = this.nodesByOffset.get(offset);
    if (!ruleMap) {
      ruleMap = new Map<number, CSTNode>();
      this.nodesByOffset.set(offset, ruleMap);
    }
    if (!ruleMap.has(ruleId)) {
      this.totalNodes++;
    }
    ruleMap.set(ruleId, cstNode);
    return this;
  }

  override clear(): void {
    this.nodesByOffset.clear();
    this.totalNodes = 0;
    this.lastInvalidatedStart = Infinity;
    this.lastInvalidatedEnd = -1;
    this.lastDiscardedNodes = [];
  }

  override get size(): number {
    return this.totalNodes;
  }

  override *entries(): IterableIterator<[string, ParseResult]> {
    for (const [startOffset, ruleMap] of this.nodesByOffset.entries()) {
      for (const [ruleId, node] of ruleMap.entries()) {
        yield [`${ruleId}-${startOffset}`, node.result];
      }
    }
  }

  override *keys(): IterableIterator<string> {
    for (const [startOffset, ruleMap] of this.nodesByOffset.entries()) {
      for (const ruleId of ruleMap.keys()) {
        yield `${ruleId}-${startOffset}`;
      }
    }
  }

  override *values(): IterableIterator<ParseResult> {
    for (const ruleMap of this.nodesByOffset.values()) {
      for (const node of ruleMap.values()) {
        yield node.result;
      }
    }
  }

  override [Symbol.iterator](): IterableIterator<[string, ParseResult]> {
    return this.entries();
  }

  applyEdit(editOffset: number, removedLength: number, delta: number) {
    const nextNodesByOffset = new Map<number, Map<number, CSTNode>>();
    let nextTotalNodes = 0;

    let minInvalidStart = Infinity;
    let maxInvalidEnd = -1;
    const discarded: CSTNode[] = [];

    for (const [startOffset, ruleMap] of this.nodesByOffset.entries()) {
      for (const [ruleId, node] of ruleMap.entries()) {
        const dependencyLimit = node.dependencyLimit;

        // Scenario 1: Parse started before the edit point
        if (node.start < editOffset) {
          if (dependencyLimit >= editOffset) {
            if (node.start < minInvalidStart) minInvalidStart = node.start;
            if (node.end > maxInvalidEnd) maxInvalidEnd = node.end;
            discarded.push(node);
            continue; // Overlaps with edit, discard
          }
          let nextRuleMap = nextNodesByOffset.get(node.start);
          if (!nextRuleMap) {
            nextRuleMap = new Map<number, CSTNode>();
            nextNodesByOffset.set(node.start, nextRuleMap);
          }
          nextRuleMap.set(ruleId, node);
          nextTotalNodes++;
        }
        // Scenario 2: Parse started inside the edited/deleted range
        else if (node.start >= editOffset && node.start < editOffset + removedLength) {
          if (node.start < minInvalidStart) minInvalidStart = node.start;
          if (node.end > maxInvalidEnd) maxInvalidEnd = node.end;
          discarded.push(node);
          continue; // Discard completely
        }
        // Scenario 3: Parse started after the edited/deleted range
        else {
          const newStart = node.start + delta;
          const newEnd = node.end + delta;
          const newDependencyLimit = node.dependencyLimit + delta;

          // Eagerly shift the offsets in result, AST and errors
          const shiftedResult: ParseResult = {
            ...node.result,
            newOffset: node.result.newOffset + delta,
            dependencyLimit: newDependencyLimit,
            astDelta: 0,
            ast: node.result.ast // Red-Green trees do not require shifting immutable AST nodes
          };

          if (node.result.recoveredErrors) {
            shiftedResult.recoveredErrors = node.result.recoveredErrors.map(err => ({
              ...err,
              offset: err.offset + delta,
              recoveredOffset: typeof err.recoveredOffset === 'number' ? err.recoveredOffset + delta : undefined
            }));
          }

          const shiftedNode: CSTNode = {
            ruleId,
            start: newStart,
            end: newEnd,
            dependencyLimit: newDependencyLimit,
            result: shiftedResult
          };

          let nextRuleMap = nextNodesByOffset.get(newStart);
          if (!nextRuleMap) {
            nextRuleMap = new Map<number, CSTNode>();
            nextNodesByOffset.set(newStart, nextRuleMap);
          }
          nextRuleMap.set(ruleId, shiftedNode);
          nextTotalNodes++;
        }
      }
    }

    this.nodesByOffset = nextNodesByOffset;
    this.totalNodes = nextTotalNodes;
    this.lastInvalidatedStart = minInvalidStart;
    this.lastInvalidatedEnd = maxInvalidEnd;
    this.lastDiscardedNodes = discarded;
  }
}

function getElementById(id: number): SyntaxElement | undefined {
  for (const el of SyntaxElement.registry.values()) {
    if (el.id === id) {
      return el;
    }
  }
  return undefined;
}

function replaceInGreenTree(
  node: GreenNode,
  currentOffset: number,
  targetStart: number,
  targetRuleId: number,
  targetWidth: number,
  replacement: GreenNode | null,
  candidateElement: SyntaxElement
): { node: GreenNode | null; matched: boolean; widthDelta: number } {
  const isMatch = currentOffset === targetStart &&
                  node.width === targetWidth &&
                  (node.ruleId === targetRuleId || node.type === candidateElement.name);

  if (isMatch) {
    const replacementWidth = replacement ? replacement.width : 0;
    return { node: replacement, matched: true, widthDelta: replacementWidth - node.width };
  }

  // If the target is completely outside this node's span, skip
  if (targetStart >= currentOffset + node.width || targetStart < currentOffset) {
    return { node, matched: false, widthDelta: 0 };
  }

  const value = node.value;
  if (Array.isArray(value)) {
    let childOffset = currentOffset;
    const newChildren: any[] = [];
    let matchedAny = false;
    let accumulatedDelta = 0;

    for (const child of value) {
      if (child instanceof GreenNode) {
        const res = replaceInGreenTree(child, childOffset, targetStart, targetRuleId, targetWidth, replacement, candidateElement);
        if (res.node !== null) {
          newChildren.push(res.node);
        }
        if (res.matched) {
          matchedAny = true;
          accumulatedDelta += res.widthDelta;
        }
        childOffset += child.width;
      } else {
        newChildren.push(child);
      }
    }

    if (matchedAny) {
      const newNode = GreenNode.create(node.type, newChildren, node.ruleId, node.width + accumulatedDelta);
      return { node: newNode, matched: true, widthDelta: accumulatedDelta };
    }
  } else if (value instanceof GreenNode) {
    const res = replaceInGreenTree(value, currentOffset, targetStart, targetRuleId, targetWidth, replacement, candidateElement);
    if (res.matched) {
      const newNode = res.node ? GreenNode.create(node.type, res.node, node.ruleId, node.width + res.widthDelta) : null;
      return { node: newNode, matched: true, widthDelta: res.widthDelta };
    }
  }

  return { node, matched: false, widthDelta: 0 };
}

export class IncrementalParser {
  private lastText: string = "";
  private memo: SpatialCSTIndex = new SpatialCSTIndex();
  private lastResult: ParseResult | null = null;
  private lastContext: any = null;

  constructor() {}

  getMemoTable(): SpatialCSTIndex {
    return this.memo;
  }

  clear() {
    this.lastText = "";
    this.memo.clear();
    this.lastResult = null;
    this.lastContext = null;
  }

  parse(
    root: SyntaxElement,
    newText: string,
    context?: {
      maxOffset: number;
      maxError: ParseResult | null;
      expectedPaths: string[];
      recoveredErrors: ParseError[];
      cacheHits?: number;
      cacheMisses?: number;
    },
    edits?: { editOffset: number; removedLength: number; insertedText: string }[]
  ): ParseResult {
    const ctx: any = context || {
      maxOffset: -1,
      maxError: null,
      expectedPaths: [],
      recoveredErrors: [],
      cacheHits: 0,
      cacheMisses: 0
    };
    if (!ctx.rootElement) {
      ctx.rootElement = root;
    }

    if (this.lastText === "") {
      // First parse: build full memo
      ctx.cacheHits = 0;
      ctx.cacheMisses = 0;
      
      const res = root.parse(newText, 0, this.memo, ctx);
      this.lastText = newText;
      this.lastResult = res || { ast: null, newOffset: 0, error: "Parsing failed", dependencyLimit: 0 };
      this.lastContext = ctx;
      return this.lastResult.ast ? ({ ...this.lastResult, ast: new RedNode(this.lastResult.ast, null, 0) } as any) : this.lastResult;
    }

    if (edits && edits.length > 0) {
      // Eagerly apply the precise event-driven edits
      for (const edit of edits) {
        const delta = edit.insertedText.length - edit.removedLength;
        this.memo.applyEdit(edit.editOffset, edit.removedLength, delta);
      }
    } else {
      // Fallback: calculate the diff
      const { editOffset, removedLength, insertedText } = findDiff(this.lastText, newText);
      const delta = insertedText.length - removedLength;

      // Shift/invalidate the spatial CST index
      if (removedLength > 0 || insertedText.length > 0) {
        this.memo.applyEdit(editOffset, removedLength, delta);
      }
    }

    // --- INCREMENTAL PARSE BY CONVERGENCE ---
    if (this.lastResult && this.lastResult.ast) {
      let editOffset = 0;
      let delta = 0;
      if (edits && edits.length > 0) {
        editOffset = edits[0].editOffset;
        delta = edits.reduce((acc, e) => acc + e.insertedText.length - e.removedLength, 0);
      } else {
        const diff = findDiff(this.lastText, newText);
        editOffset = diff.editOffset;
        delta = diff.insertedText.length - diff.removedLength;
      }

      // Filter discarded nodes covering the edit offset
      const candidates = this.memo.lastDiscardedNodes.filter(node => {
        const el = getElementById(node.ruleId);
        if (!el) return false;
        return node.start <= editOffset && node.dependencyLimit >= editOffset;
      });

      if (candidates.length > 0) {
        // Sort candidates: deepest first (smallest width)
        candidates.sort((a, b) => (a.end - a.start) - (b.end - b.start));

        for (const candidateNode of candidates) {
          const candidateElement = getElementById(candidateNode.ruleId)!;
          
          ctx.cacheHits = 0;
          ctx.cacheMisses = 0;

          // Re-parse candidate at its original start offset
          const result = candidateElement.parse(newText, candidateNode.start, this.memo, ctx);

          if (result && !result.error) {
            // Check if the result converged
            if (result.newOffset === candidateNode.end + delta) {
              const oldRoot = (this.lastResult.ast as any).green || this.lastResult.ast;
              const replaceRes = replaceInGreenTree(
                oldRoot,
                0,
                candidateNode.start,
                candidateNode.ruleId,
                candidateNode.end - candidateNode.start,
                result.ast,
                candidateElement
              );

              if (replaceRes.matched && replaceRes.node) {
                const finalResult: ParseResult = {
                  ...this.lastResult,
                  ast: replaceRes.node,
                  newOffset: this.lastResult.newOffset + delta,
                  dependencyLimit: this.lastResult.dependencyLimit + delta
                };

                this.lastText = newText;
                this.lastResult = finalResult;
                this.lastContext = ctx;

                return finalResult.ast ? ({ ...finalResult, ast: new RedNode(finalResult.ast, null, 0) } as any) : finalResult;
              }
            }
          }
        }
      }
    }

    // Fallback: Full top-down parse with the updated memo cache
    ctx.cacheHits = 0;
    ctx.cacheMisses = 0;

    const res = root.parse(newText, 0, this.memo, ctx);
    
    this.lastText = newText;
    this.lastResult = res || { ast: null, newOffset: 0, error: "Parsing failed", dependencyLimit: 0 };
    this.lastContext = ctx;
    return this.lastResult.ast ? ({ ...this.lastResult, ast: new RedNode(this.lastResult.ast, null, 0) } as any) : this.lastResult;
  }
}
