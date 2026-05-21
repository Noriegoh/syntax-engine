# SyntaxEngine Workbench

An interactive developer environment and debugger for designing **scannerless, error-resilient parsers** with a code-first, fluent JavaScript/TypeScript API. 

The **SyntaxEngine Workbench** empowers language and tool creators to rapidly prototype, visualize, and debug complex context-free grammars without compiling traditional compiler front-ends up front. 

Live Link : https://syntaxengine-workbench-301154961695.europe-west2.run.app/

---

## 🚀 Key Architectural Advantages

### 1. Scannerless, Single-Phase Parsing
Conventional compilers separate lexing (tokenizing) and grammatical parsing into two independent passes. SyntaxEngine uses a **scannerless parser design** where rules operate directly on the raw text character stream using character-level literals, regular expressions, and fluent chains. This simplifies rule authoring and preserves precise byte locations of syntactical constructs during phase changes.

### 2. Industry-Grade Built-In Error Recovery
Typical compiler pipelines crash on the first syntactic error (such as a missing closing curly brace or semicolon). SyntaxEngine implements custom **resilience constructs**:
*   **`.RecoverWith(...anchors)`**: Provides explicit synchronic landmarks (e.g. semicolons `;` or linebreaks `\n`). When a rule fails, the parser can skip forward to these anchors to recover context without terminating.
*   **`.SelfHeals(...boundaries)`**: Establishes structural block boundaries (e.g. `}`, `)`). If a parse failure occurs deep inside a block-oriented statement, the parser marks the section as a self-healed `error_node`, captures the exact failure span, and hops cleanly past the block boundary to continue compiling subsequent elements.

### 3. Ambiguity Resolution & Precedence handling
*   **`.Prec(level)`**: Assigns numeric precedence to individual grammar branches, resolving structural ambiguities (e.g., standard math operator precedence, nested statements).
*   **Greedy Decisions**: Features longest-match and prior-matching resolution when matching list structures (`Choice`, `ZeroOrMore`, `OneOrMore`).

---

## 🛠️ Feature Overview & Workspace Modules

The workbench is divided into two highly tailored workflows, optimized for development, visualization, and validation:

### 1. Grammar Designer View
The primary environment for writing and mapping syntax element logic:
*   **Live Fluent Rule Editor**: An embedded code editor featuring Prism syntax highlighting, matching helper brackets, and reactive compiling. As you change your fluent chains, the engine rebuilds.
*   **Visual Grammar Flow**: Stagger-animated rule detail panels, visual dependencies lists, and custom cross-rule references (`referencedBy` and `references`).
*   **Dynamic Breadcrumb Trace**: Includes a full **Exploration Stack Navigation System** with back history, allowing you to click `Explore →` on deep rule branches and backtrack sequentially through your parser's hierarchy tree.

### 2. Interactive Parser Playground
A live feedback loop for pasting and checking actual source scripts:
*   **Code Input Console**: Drag-and-drop or select sample source files.
*   **Diagnostics Panel**: View real-time parse statistics (e.g., byte length parsed, AST nodes generated, specific compilation performance timing, and deep error trace records).
*   **Syntactic Self-Healing Switch**: Toggle whether parsing automatically isolates syntax errors into recoverable inline nodes or stops immediately at block boundaries.
*   **Concrete Syntax Tree (CST) Canvas**: An interactive high-performance node explorer driven by `react-zoom-pan-pinch`.
    *   **Zoom & Pan Controls**: Glide, drag, and scale through expansive structures easily.
    *   **Node Highlighting**: Select any parsed tree element to see the exact corresponding source span highlighted.
    *   **Compact Mode**: Quickly collapse leaf nodes to visualize complex hierarchical boundaries.
*   **Abstract Syntax Tree (AST) Explorer**: Visualizes the finalized AST hierarchy. Uses `.Hide()` instructions to discard metadata of token layout (such as whitespaces and comments) for a cleaner representation.

---

## 🧩 Fluent API Reference & Pattern Engine

SyntaxEngine structures parsing chains with a human-scannable fluent builder interface:

| Builder Method | Description |
| :--- | :--- |
| `Expects(pattern)` | Match a static `string` literal, regular expression `/regex/`, or nested `SyntaxElement` sub-rule. |
| `ExpectsOneOf(...patterns)` | Evaluates a non-blocking choice tree branch. Resolves to the branch with the highest precedence or longest consumed string match. |
| `Optional(pattern)` | Match `pattern` zero or one times without causing a thread fail. |
| `ZeroOrMore(pattern)` | Match a repeating sequence of matching structures (0 to N). |
| `OneOrMore(pattern)` | Match one or more repeat repetitions of the designated structure (1 to N). |
| `ExpectsEOF()` | Asserts that parsing successfully consumed the remaining source tape. |
| `Unexpects(pattern)` | Formulates a negative lookahead constraint (fails matching if this pattern matches at the current pointer). |
| `ExpectsWhitespace()` | Matches whitespace characters automatically. |
| `Hide()` | Retains the match for validation but removes it from the clean AST to avoid noise (ideal for comment or separator nodes). |
| `Prec(level)` | Configures structural precedence (larger integer values take priority). |

---

## 💻 Technical Core & Setup

The workbench is modern, fast, and light, powered by the following stack:
*   **Frontend Core**: [React JS](https://react.dev) with [Vite](https://vite.dev) and fully strict TypeScript static type checks.
*   **Animation**: Physics transitions and staggered entrance menus styled with [Motion](https://motion.dev).
*   **Icons**: Scalable vector icons powered by `lucide-react`.
*   **Tree Engine**: Collapsible nodes and custom scrollbars for deep inspect scopes.
*   **Bundling**: Configured using Tailwind CSS and Vite asset bundlers.

### Project Scripts

Run the development environment locally:

```bash
# Install dependencies
npm install

# Run the live development server on port 3000
npm run dev

# Compile the application for production build
npm run build

# Run the TypeScript type check and linter
npm run lint
```
