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
* **Example:** Matching `/Properties/i` immediately preceding an identifier block `/^[a-zA-Z_]/` (e.g. `PropertiesFoo` could be misconstrued). We use `.LiteralMatch(/Properties/i, id_exp)` to assert the identifier boundary.
* **Anti-Pattern (Avoid):** If the next rule matches non-overlapping characters (like `{`, `(`, or layout whitespaces), a boundary checker is completely redundant. Replace it with a simple, highly optimized `.Token` call referencing the raw pattern:
  * ❌ *Incorrect (Redundant boundary check):* `.LiteralMatch(/ZWrite/i, id_exp).Expects(onOffValue)` (and trivia is ignored too)
  * ❌ *Inefficient:* `.Token(LiteralMatch(/Properties/i, id_exp)).BeginScope(Token("{"))`
  *  *Correct:* `.Token(/Properties/i).BeginScope(Token("{"))` (no character overlap possible with `{`).

### 3. `Literal` (Builder `.Literal(value)` or Global `LiteralMatch` with plain values)
* **Core Job:** Strictly matches characters value-for-value.
* **When to use:** Used when exact character pairing is required, and we do not care about boundary character sets on the right side of the parsed window.

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
| **`SeparatedBy(item, separator)`** | Sequence matcher for items separated by a specific separator. | `.SeparatedBy(args, Token(","))` |
| **`Not(pattern, ...additional?)`** | Negative lookahead assertion check (prohibits the pattern from existing at pointer). | `.Not(Token("/"))` |

### 2. Scope and Recovery Setup

| Builder Method | Description | Usage Example |
| :--- | :--- | :--- |
| **`BeginScope(pattern)`** | Declares a nesting bracket/structure entrance (registers matching scopes for folds/brace highlighting). | `.BeginScope(Token("{"))` |
| **`EndScope(pattern)`** | Declares a nesting bracket/structure exit. | `.EndScope(Token("}"))` |
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

## 🔄 Optional List Rule (Permutation Parsing)

When `.Optional()` is invoked with multiple arguments, it is parsed as an **Optional List Rule**.

### Key Rules of Optional Lists:
* **Order-Independence:** The items in the list can appear in **any order/permutation**.
* **Uniqueness (At-Most-Once):** Each specified pattern can be matched **at most once**.
* **Use Cases:** This is perfect for order-independent modifier sets (e.g., `public`, `static`, `readonly`, `override`), lists of optional attributes/decorators, or flexible metadata configurations.

### Clear Example:
```typescript
// Compiles to match "public static readonly", "static public", or just "readonly", etc. (in any order, at most once)
const memberModifiers = new SyntaxElement("modifiers")
  .Optional(
    Token("public"),
    Token("static"),
    Token("readonly"),
    Token("override")
  );
```
