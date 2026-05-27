const fs = require('fs');
let text = fs.readFileSync('src/lib/codegen.ts', 'utf8');

text = text.replace(
`                    currentOffset = \${spec.newOffsetName};
                }
                else`,
`                    currentOffset = \${spec.newOffsetName};
                    \${structUpdate}
                }
                else`);

fs.writeFileSync('src/lib/codegen.ts', text, 'utf8');
