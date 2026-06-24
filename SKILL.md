# SyntaxEngine Grammar Rule Authoring Skill

This skill guide provides precise architectural designs, API patterns, and code-first idioms for authoring error-resilient, scannerless parsers using **SyntaxEngine**'s fluent TypeScript/JavaScript API.

---

## 🎯 Core Concepts of SyntaxEngine

### 1. Scannerless, Single-Phase Parser
Unlike traditional parsers that separate lexical tokenization and syntactic parsing, **SyntaxEngine operates directly on the raw string data**.
* **Direct Matching:** Matches are evaluated character-by-character using string literals, regular expressions (`RegExp`), or sub-`SyntaxElement` entries.
* **Zero-Loss Representation:** Syntactic trivia (spaces, horizontal tabs, linebreaks, and block/line comments) are retained perfectly with exact byte boundary locations.

### 2. Symmetrical Trivia Integration
Trivia is automatically woven between elements without clotting the programmatic logic.
* **Chained Method (`.Token(pattern)`):** Matches default leading trivia (spaces, comments), the actual identifier, and trailing trivia automatically.
* **Global Wrapping Function (`Token(pattern, tokenName?)`):** Automatically creates a `TokenMarker` which, when placed within `.Expects()` or `.Token()`, wraps the pattern with spacing/comments and tags it with a token lookup class.
* **Trivia-Free Naming (`.AsToken(name)`):** Sets a named terminal token type on the prior matched rule *without* asserting surrounding whitespace or comment checks.

---

## 🛑 The Symmetrical Triad: `Token()`, `LiteralMatch()`, and `Literal()`

Getting the boundary checks and trivia skipping right is the single most important factor for success with scannerless parsers.

### 1. `Token` (Builder `.Token(pattern)` or Wrapper `Token(pattern)`)
* **Core Job:** Injects leading and trailing trivia handlers to automatically parse and skip workspaces and comments surrounding this rule.
* **When to use:** **Almost always!** Every identifier, operator, symbol, keyword, or keyword match that is expected to stand as a distinct symbol with possible leading or trailing comments/whitespace must be wrapped inside or called via `Token`.
* **Important Note:** A bare `.LiteralMatch(...)` or `.Literal(...)` does *not* skip trivia. Always invoke them in a trivia-aware context like `.Token(LiteralMatch(/Properties/i, id_exp))` or simply `.Token(/Properties/i)`.

### 2. `LiteralMatch` (Builder `.LiteralMatch(literal, pattern)` or Global `LiteralMatch(literal, pattern)`)
* **Core Job:** Matches words or patterns while checking boundaries (e.g. making sure a keyword doesn't blend into a subsequent identifier character).
* **When to use:** **Strictly ONLY** if the next rule has an overlapping character set that could blend with/encompass the current match. 
* **Regex Compatibility:** The literal string specified must exactly satisfy/match the provided boundary check regex starting at offset 0. If it does not, a grammar diagnostic error ("Impossible Literal Match") will be raised to protect against matching deadlock.
* **Example:** Matching `/Properties/i` immediately preceding an identifier block `/^[a-zA-Z_]/` (e.g. `PropertiesFoo` could be misconstrued). We use `.LiteralMatch(/Properties/i, id_exp)` to assert the identifier boundary.
* **Anti-Pattern (Avoid):** If the next rule matches non-overlapping characters (like `{`, `(`, or layout whitespaces), a boundary checker is completely redundant. Replace it with a simple, highly optimized `.Token` call referencing the raw pattern:
  * ❌ *Incorrect (Redundant boundary check):* `.LiteralMatch(/ZWrite/i, id_exp).Expects(onOffValue)` (and trivia is ignored too)
  * ❌ *Inefficient:* `.Token(LiteralMatch(/Properties/i, id_exp)).BeginScope(Token("{"))`
  *  *Correct:* `.Token(/Properties/i).BeginScope(Token("{"))` (no character overlap possible with `{`).

### 3. `Literal` (Builder `.Literal(value)` or Global `LiteralMatch` with plain values)
* **Core Job:** Strictly matches characters value-for-value.
* **When to use:** Used when exact character pairing is required, and we do not care about boundary character sets on the right side of the parsed window.

### 4. `Regex` (Global `Regex(pattern, name?)`)
* **Core Job:** Compiles a regular expression, optionally naming it so that parser error messages read as a user-friendly term instead of the raw pattern syntax.
* **When to use:** Use when matching patterns like identifiers, numeric values, string literals, etc. and want error messages to be extremely readable.
* **Example:** `Regex(/[a-zA-Z_][a-zA-Z0-9_]*/, "Identifier")` will make error messages output `"Expected Identifier"` instead of `"Expected match for pattern: [a-zA-Z_][a-zA-Z0-9_]*"`.

---

## 🧩 Correct API Reference & Builder Patterns

Avoid legacy methods and hallucinations. Here is the exact public API contract of `SyntaxElement`:

### 1. Sequence and Flow Matchers

| Builder Method | Description | Usage Example |
| :--- | :--- | :--- |
| **`Expects(pattern)`** | Sequenced layout match for regex, string literals, or sub-SyntaxElements. | `.Expects(id).As("varName")` |
| **`OneOff(...patterns)`** | Speculatively matches the first matching pattern from the provided choices (ordered choice). | `.OneOff("public", "private")` |
| **`OneOffToken(...patterns)`** | Symmetrical-trivia-aware ordered choice. Automatically wraps each pattern inside a `Token()`. | `.OneOffToken("+", "-", "*", "/")` |
| **`Optional(pattern, ...additional?)`** | Matches zero or one occurrences without raising thread failure. **Takes multiple arguments directly as an Optional List** (see below). | `.Optional(Token(";"))` |
| **`ZeroOrMore(pattern, ...additional?)`** | Greedy-loops through matches. **Takes multiple arguments directly as an optimized, inlined choice** to avoid nesting. | `.ZeroOrMore(lineWs, comment)` |
| **`OneOrMore(pattern, ...additional?)`** | Greedy-loops through matches (at least 1 required). Also accepts multiple parameters as choices. | `.OneOrMore(subShaderBlock)` |
| **`SeparatedBy(item, separator, optionsOrTrailing?, allowLeading?)`** | Sequence matcher for items separated by a specific separator. Supports trailing/leading separators and array-choice items. | `.SeparatedBy(args, Token(","), { allowTrailing: true })` |
| **`SeparatedByToken(...)`** | Symmetrical-trivia-aware separated-by list matcher. Automatically wraps item lists and separator in `Token()`. | `.SeparatedByToken([id, num], ",", { allowTrailing: true })` |
| **`Not(pattern, ...additional?)`** | Negative lookahead assertion check (prohibits the pattern from existing at pointer). | `.Not(Token("/"))` |
| **`Regex(pattern, name?)`** | Create a named or standardized regular expression pattern to enhance parser recovery error messages. | `Regex(/[a-zA-Z_][a-zA-Z0-9_]*/, "Identifier")` |

### 2. Scope and Recovery Setup

| Builder Method | Description | Usage Example |
| :--- | :--- | :--- |
| **`BeginScope(pattern)`** | Declares a nesting bracket/structure entrance (registers matching scopes for folds/brace highlighting). | `.BeginScope(Token("{"))` |
| **`EndScope(pattern)`** | Declares a nesting bracket/structure exit. | `.EndScope(Token("}"))` |
| **`WithError(errorMessage)`** | Attaches a custom, user-defined manual error message to the last defined rule on the element. | `.Expects(CurlyOpen).WithError("Missing opening curly brace '{'")` |
| **`RecoverWith(...anchors)`** | Establishes synchronization anchors to hop to when parsing failures occur. | `.RecoverWith(";")` |
| **`SelfHeals(...bounds)`** | Standard structural boundary healer. Skips inner errors to recover at the boundary. | `.SelfHeals("}")` |
| **`AsNode(nodeName)`** | Wraps the element into a concrete nodeset of the CST output under `nodeName`. | `new SyntaxElement("block").AsNode("BlockNode")` |
| **`As(fieldName)`** | Maps the matched child node's result under a key name in the parent node's properties. | `.Expects(id).As("identifier")` |
| **`AsToken(tokenName)`** | Labels the matched sequence with a token type identifier without injecting spacer trivias. | `.Expects(/[0-9]+/).AsToken("Integer")` |
| **`Ignore()`** | Hides the preceding rule's visual tree output while keeping its semantic match verification. | `.Token(";").Ignore()` |
| **`Inline()`** | Flattens matched elements directly under the container parent. | `.Expects(mods).Inline()` |

---

## 💎 Authoring Idioms & Best Practices

### 1. Token Wrapper vs. Pure RegEx
* Use **`Token(pattern, tokenName?)`** (or `.Token(...)`) for structural terminals, operators, keywords, and identifiers that are expected to have surrounding layout whitespace.
* Use **`Pure RegExp`** or `.AsToken()` when parsing compound structures (like string inner data, numeric formats) where whitespaces inside are highly regulated or banned.

### 2. Highly Resilient Structural Scopes (`BeginScope` & `EndScope`)
Unlocking perfect bracket matching, collapsible code folds, and **automatic cursor error-recovery** requires wrapping scope boundary characters properly.
Always use `.BeginScope(...)` and `.EndScope(...)` with a Token wrapper instead of generic `.Token(...)` when matching groupings.

#### Crucial Example:
```typescript
// ❌ INCORRECT (Uses basic Token constraints, lacks structural scope bounds, lacks recovery contexts)
const vectorLiteral = new SyntaxElement("vector_literal")
  .AsNode("VectorLiteral")
  .Token("(")
  .Expects(number).As("x")
  .Token(",")
  .Expects(number).As("y")
  .Token(")");

//  CORRECT (Uses scope declarations and enables automatic bracket matching, code folding, and automated list recovery)
const vectorLiteral = new SyntaxElement("vector_literal")
  .AsNode("VectorLiteral")
  .BeginScope(Token("("))
  .Expects(number).As("x")
  .Token(",")
  .Expects(number).As("y")
  .EndScope(Token(")"));
```

### 3. Choice Rule Ordering (Greedy Rule Resolution)
Because `.OneOff(...)` and `.OneOffToken(...)` choices resolve on the *first matching branch*, always place specific prefixes and longer matching literals *before* general, shorter ones. Failing to do this can result in premature matches (e.g. matching `<` instead of `<=`):
```typescript
// Correct Order: Longer matching tokens first!
const op = new SyntaxElement("op")
  .OneOffToken(
    /<=/,
    />=/,
    /</,
    />/
  );
```
Having many nested alternatives can slow down parsing. Consider ordering them by probability of occurrence (most common first) to speed up matching, or grouping them with common prefixes.

### 4. Code Resilience Injection
Always append `.RecoverWith(...)` to statements inside lists (like member lines, function declarations) and `.SelfHeals(...)` to block structures (such as structs or classes):
```typescript
const declaration = new SyntaxElement("decl")
  .AsNode("Decl")
  .Expects(id).As("name")
  .Token(";")
  .RecoverWith(";"); // Continues with next line upon error

const classBlock = new SyntaxElement("class")
  .AsNode("ClassDeclaration")
  .Token("class")
  .Expects(id).As("className")
  .BeginScope(Token("{"))
  .ZeroOrMore(declaration).As("members")
  .EndScope(Token("}"))
  .SelfHeals("}"); // Recovers cleanly if members contain syntax errors
```

---

## ⚡ Real-Time Parsing Optimizations

### 1. Choice Loops via Multi-Argument Iterations
Avoid wrapping repeated options in supplementary nested structures or using separate `.OneOff` rule arrays inside repetitions. Direct multiple arguments handle choice logic faster and cleaner inside loops:

```typescript
// ❌ INCORRECT / INEFFICIENT (Dutifully wraps rules in secondary SyntaxElements)
const trailingTrivia = new SyntaxElement('trailing_trivia')
  .ZeroOrMore(new SyntaxElement('t_elem').OneOff(lineWs, comment))
  .Optional(/\r?\n/);

//  CORRECT / HIGHLY OPTIMIZED (Greedy-loops the items directly as an inline choice)
const trailingTrivia = new SyntaxElement('trailing_trivia')
  .ZeroOrMore(lineWs, comment)
  .Optional(/\r?\n/);
```

### 2. Automatic Synced Backups
Do not crowd rules and schemas with unnecessary custom recovery setups on every single element.
* Built-in parsers naturally compute healing paths and automatically synchronize grammar sequences back using active `.EndScope(...)` bounds whenever parsing defects are matched.
* Use explicit recovery helpers (like `.RecoverWith(...)`) primarily for complex deep segments that require structural sync anchors (e.g. scanning semicolon lines inside classes).

---

## 🔄 Unordered / Optional List Rule (Permutation Parsing)

When `.Unordered()` (or `.Optional()`) is invoked with multiple arguments, it is parsed as an **Unordered/Optional List Rule**.

### Key Rules of Unordered Lists:
* **Order-Independence:** The items in the list can appear in **any order/permutation**.
* **Uniqueness (At-Most-Once):** Each specified pattern can be matched **at most once**.
* **Selective Verification with `Required`:** In some contexts, some rules are optional while others are strictly **required** (must be parsed to succeed). You can wrap any pattern using `Required(pattern)` or call `.Required()` on a sub-element.
* **Use Cases:** Elegant modifier lists (e.g., `public`, `static`, `readonly`) where some might be essential, lists of optional attributes/decorators, or flexible metadata configurations.

### Examples:

#### 1. Basic Unordered List (Fully Optional)
```typescript
// Compiles to match "public static readonly", "static public", or just "readonly", etc. (in any order, at most once)
const memberModifiers = new SyntaxElement("modifiers")
  .Unordered(
    Token("public"),
    Token("static"),
    Token("readonly"),
    Token("override")
  );
```

#### 2. Unordered List with Required Items
You can mark specific rules in the unordered list as required using the `Required()` wrapper or the `.Required()` helper:
```typescript
import { Required } from "./syntax-element";

// Match a list of modifiers in any order, where "readonly" must be present
const requiredSet = new SyntaxElement("modifiers")
  .Unordered(
    Token("public"),
    Token("static"),
    Required(Token("readonly"))
  );

// Or using helper suffix:
const staticElement = new SyntaxElement("staticKeyword").Expects("static");
const requiredSetWithSuffix = new SyntaxElement("modifiers")
  .Unordered(
    Token("public"),
    staticElement.Required()
  );
```

---

## 🔗 Separated-By List Rule (`SeparatedBy` & `SeparatedByToken`)

The `SeparatedBy(item, separator, options?, allowLeading?)` method parses lists of elements separated by a delimiter. It has been enhanced with flexible alignment and format features:

### 1. Optional Leading and Trailing Separators
You can now specify whether a separator can optionally appear before the first item, or after the absolute last item in the list:
* **Option Configuration Object:** Pass an options object: `{ allowLeading?: boolean; allowTrailing?: boolean }`
* **Boolean Shorthand:** Pass a boolean as the third argument for `allowTrailing`, and a boolean as the fourth argument for `allowLeading`.

```typescript
// Match comma-separated arguments, allowing a trailing comma (e.g., "[1, 2, 3,]")
const listWithTrailing = new SyntaxElement("list")
  .SeparatedBy(item, Token(","), { allowTrailing: true });

// Match slash-separated options, allowing both a leading slash and trailing slash (e.g., "/a/b/c/")
const listLeadingAndTrailing = new SyntaxElement("paths")
  .SeparatedByToken(segment, "/", { allowLeading: true, allowTrailing: true });
```

### 2. Multi-Element Choice List (No nested `OneOff` required)
Just like `ZeroOrMore` and `OneOrMore`, the `item` parameter can be an **Array of patterns**. When an array of patterns is passed, the engine internally treats them as speculative ordered choices (speculatively matching any of the items in the list) without forcing you to wrap them in an explicit `.OneOff(...)` call:

```typescript
// Correct and highly optimized: matches a list separated by commas, where each element can be a string, number, or identifier
const listWithChoices = new SyntaxElement("config")
  .SeparatedByToken([stringLiteral, numericLiteral, identifier], ",");
```

---

## 🛡️ Automatic error-recovery & Self-Healing

The parser includes robust, industry-grade error recovery and panic-mode synchronization strategies to ensure that single errors do not cause catastrophic parse failures (i.e., avoiding the "Fatal Parsing Failure"):

### 1. Root-Level Automatic Fallback Recovery
If a syntax error occurs on the very first token/rule of the root (top-level) element, the parser automatically attempts self-healing recovery even if no explicit commit has occurred yet. This ensures that the editor retains a structured AST (with embedded error nodes) for the rest of the document instead of failing entirely.

### 2. Prioritized Terminal & Future Target-Ordered Scanning
When a rule fails inside an element, the recovery engine automatically performs forward-scanning analysis:
* It reads ahead to collect succeeding **expected/required terminal patterns** of the current element.
* It merges these expected future terminals with generic boundary anchors (e.g. `;`, `}`, `\n` or explicit `.RecoverWith()` anchors), keeping the strict future-required patterns **first**.
* This prioritizes synchronization on precise matching tokens (such as a string quote `"` or opening curly brace `{`) instead of blindly hopping over code structures to distant line endings or whitespaces.

### 3. ParseError Representation and Squiggly Ranges
All soft recovered syntax errors are pushed into `ctx.recoveredErrors` as a `ParseError` object conforming to the following structure:
```typescript
export interface ParseError {
  message: string;
  offset: number; // The exact offset where the parsing error began (fail offset)
  recoveredOffset?: number; // The exact offset where synchronization successfully completed (recovered offset)
}
```
This enables the UI and IDE tools to highlight/squiggle the exact unparsed range from `offset` directly to `recoveredOffset`, instead of falling back to single word bounds.
