import defaultGrammar from "../components/default-grammar.txt?raw";

export const DEFAULT_CODE = defaultGrammar;

export const DEFAULT_AST_CODE = `// --- Optional AST Transformer ---
// Map the raw Concrete Syntax Tree (CST) into a clean, custom Abstract Syntax Tree (AST).
// If left as-is or returning null (or if deleted completely), ScopeBuilder, Query, and CodeGen
// will automatically fall back to using the CST directly.

function transform(node) {
  if (!node || typeof node !== 'object') return node;

  // If node is an array, map its items
  if (Array.isArray(node)) {
    return node.map(transform).filter(Boolean);
  }

  // Handle zeroOrMore/oneOrMore/choice wrappers by returning their values
  if (node.type === 'zeroOrMore' || node.type === 'oneOrMore') {
    return transform(node.value);
  }

  // Build a custom clean AST Node
  const cleanNode = {
    type: node.type,
    start: node.start,
    end: node.end
  };

  // Copy fields if present to allow queries with labels to work on AST
  if (node._fields) {
    cleanNode._fields = {};
    for (const key in node._fields) {
      const val = node._fields[key];
      const transformedVal = transform(val);
      cleanNode._fields[key] = transformedVal;
      cleanNode[key] = transformedVal;
    }
  }

  // Process sub-values recursively
  if (node.value !== undefined) {
    const transformedValue = transform(node.value);
    
    // Flatten children list if it contains elements
    if (Array.isArray(transformedValue)) {
      if (transformedValue.length > 0) {
        cleanNode.children = transformedValue;
      }
    } else if (transformedValue && typeof transformedValue === 'object') {
      cleanNode.data = transformedValue;
    } else if (transformedValue !== null && transformedValue !== undefined) {
      cleanNode.value = transformedValue;
    }
  }

  // If the node ended up with no children, no data, no value, and no fields, prune it
  // unless it has a specific type we want to retain (like identifier/id/literals)
  const hasFields = cleanNode._fields && Object.keys(cleanNode._fields).length > 0;
  if (
    cleanNode.children === undefined && 
    cleanNode.data === undefined && 
    cleanNode.value === undefined &&
    !hasFields
  ) {
    return null;
  }

  return cleanNode;
}

// Transform the entire Concrete Syntax Tree (CST) 
// Return transformed AST
return transform(cst);
`;

export const DEFAULT_SCOPE_RESOLVER_CODE = `// --- Custom Lexical Scope Resolver ---
// Define semantic scopes and symbol bindings using the intuitive ScopeBuilder API.
// Use AST queries to easily map AST nodes to lexical constructs!

const builder = new ScopeBuilder();

// 1. Define Lexical Scopes (containers that hold symbols)
// You can use standard function callbacks, or descriptive string formats like "{name}" or "{node:type}"!
builder.defineScope("struct", "(struct (id @name)) @node", "struct {name}");
builder.defineScope("function", "(function (id @name)) @node", "func {name}");
builder.defineScope("block", "(code_block @node)", "Local Block");

// 2. Define Symbol Declarations (variables, parameters, members)
// Binds patterns matching (variable/param/member) to lexical symbols
builder.defineSymbol("(variable (id @name)) @node", "{name}", "variable", "{node:type}");
builder.defineSymbol("(param (id @name)) @node", "{name}", "parameter", "{node:type}");
builder.defineSymbol("(struct_member (id @name)) @node", "{name}", "member", "{node:type}");

// 3. Define Symbol References (connects identifiers back to their declarations)
builder.defineReference("(id @name)", "{name}");

return builder.build(ast, fullText);
`;
