# SyntaxEngine Grammar Rule Authoring Skill

This skill guide provides precise instructions, API patterns, and code-first idioms for authoring error-resilient, scannerless parsers using **SyntaxEngine**'s fluent TypeScript/JavaScript API.

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

## 🧩 API Reference & Builder Patterns

### 1. Core Chaining Methods

| Builder Method | Description | Usage Example |
| :--- | :--- | :--- |
| **`Expects(pattern)`** | Direct sequence matcher for literals, regex, or subelements. | `.Expects(typeName).As("type")` |
| **`ExpectsOneOf(...choices)`**| Ordered choice matching. Tries choices from left to right (PEG equivalent to `/`). | `.ExpectsOneOf(floatType, intType)` |
| **`Optional(pattern)`** | Matches zero or one occurrences without causing a thread failure. | `.Optional(semiToken)` |
| **`ZeroOrMore(pattern)`** | Loops matching a rule zero or more times (greedy). | `.ZeroOrMore(structMember)` |
| **`OneOrMore(pattern)`** | Loops matching a rule one or more times (greedy). | `.OneOrMore(subshaderBlock)` |
| **`SeparatedBy(item, sep)`** | Matches lists of `item` interleaved with `sep` (comma, etc.). | `.SeparatedBy(args, Token(","))` |
| **`Not(pattern)` / `Unexpects`** | Negative lookahead constraint (checks that the pattern is *not* at the current pointer). | `.Not(Token("/"))` |
| **`BeginScope(pattern)`** | Opens a structural nested bracket segment (bracket-matching, folds). | `.Token(BeginScope("{"))` |
| **`EndScope(pattern)`** | Closes a structural nested segment. | `.Token(EndScope("}"))` |
| **`AsNode(name)`** | Forces visual compiler to bundle matched results into an AST Group node. | `new SyntaxElement("vector").AsNode("Vector")` |
| **`As(fieldName)`** | Maps subtree or literal match to an accessor property in the red tree node. | `.Expects(id).As("variableName")` |
| **`AsToken(tokenName)`** | Labels the preceding matched rule with a token identifier without injecting spacer trivias. | `.Expects(/[0-9]+/).AsToken("integer")` |
| **`Ignore()`** | Excludes the preceding token value from the finalized visual node outputs. | `.Token(":").Ignore()` |
| **`IgnoreSelf()`** | Omits the element container itself while keeping children parsing checks. | `new SyntaxElement("wrap").IgnoreSelf()` |
| **`Inline()`** | Flattens the parsed elements directly within the parent's syntax scope. | `.Expects(modifierBlock).Inline()` |
| **`RecoverWith(...anchors)`** | Establishes sync anchors (e.g. `;`, `\n`) to hop to when parsing failures occur. | `.RecoverWith(";")` |
| **`SelfHeals(...bounds)`** | Standard structural boundary healer. Bypasses inner errors and skips to the boundary. | `.SelfHeals("}")` |

---

## 💎 Authoring Idioms & Best Practices

### 1. Token Wrapper vs. Pure RegEx
* Use **`Token(pattern, tokenName?)`** for structural terminals, operators, keywords, and identifiers that are expected to have surrounding layout whitespace.
* Use **`Pure RegExp`** or `.AsToken()` when parsing compound structures (like string inner data, numeric parts) where whitespaces inside are highly regulated or banned.

### 2. Symmetrical Boundary Scopes
To enable perfect structural folding, brace highlighting, and visual AST generation:
```typescript
// Define block with scope bounds
const myBlock = new SyntaxElement("nested_block")
  .AsNode("NestedBlock")
  .Token(BeginScope("{"))
  .ZeroOrMore(statement).As("statements")
  .Token(EndScope("}"))
  .SelfHeals("}");
```

### 3. Choice Rule Ordering (Greedy Rule Resolution)
Because `.ExpectsOneOf(...)` resolves on the *first matching branch*, compile specific prefixes and long literals *before* general, shorter ones:
```typescript
// Correct Order: Longer matching tokens first!
const op = new SyntaxElement("op")
  .ExpectsOneOf(
    Token(/<=/),
    Token(/>=/),
    Token(/</),
    Token(/>/)
  );
```

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
  .Token(BeginScope("{"))
  .ZeroOrMore(declaration).As("members")
  .Token(EndScope("}"))
  .SelfHeals("}"); // Recovers cleanly if members contain syntax errors
```
