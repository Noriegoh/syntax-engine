import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

let lastRuleId = 0;
export function nextRuleId(): number {
  return ++lastRuleId;
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
