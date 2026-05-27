const fs = require('fs');
let text = fs.readFileSync('src/lib/codegen.ts', 'utf8');

text = text.replace(
`                if (loopResults.Count > 0)
                {
                    results.Add(GreenNode.Create(NodeType.ZeroOrMore, loopResults, \${ruleId}, currentOffset - startLoopOffset));
                }`,
`                if (loopResults.Count > 0)
                {
                    results.Add(GreenNode.Create(NodeType.ZeroOrMore, loopResults, \${ruleId}, currentOffset - startLoopOffset));
                    \${structUpdate}
                }`);

fs.writeFileSync('src/lib/codegen.ts', text, 'utf8');
