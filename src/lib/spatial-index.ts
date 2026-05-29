import { ParseResult, ParseError, RedNode } from './syntax-element';
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

    for (const [startOffset, ruleMap] of this.nodesByOffset.entries()) {
      for (const [ruleId, node] of ruleMap.entries()) {
        const dependencyLimit = node.dependencyLimit;

        // Scenario 1: Parse started before the edit point
        if (node.start < editOffset) {
          if (dependencyLimit >= editOffset) {
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
              offset: err.offset + delta
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
  }
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
    const ctx = context || {
      maxOffset: -1,
      maxError: null,
      expectedPaths: [],
      recoveredErrors: [],
      cacheHits: 0,
      cacheMisses: 0
    };

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

    // Parse with the updated memo cache
    ctx.cacheHits = 0;
    ctx.cacheMisses = 0;

    const res = root.parse(newText, 0, this.memo, ctx);
    
    this.lastText = newText;
    this.lastResult = res || { ast: null, newOffset: 0, error: "Parsing failed", dependencyLimit: 0 };
    this.lastContext = ctx;
    return this.lastResult.ast ? ({ ...this.lastResult, ast: new RedNode(this.lastResult.ast, null, 0) } as any) : this.lastResult;
  }
}
