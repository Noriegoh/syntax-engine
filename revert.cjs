const fs = require('fs');
let text = fs.readFileSync('src/lib/codegen.ts', 'utf8');

text = text.replace(/NewOffset = failStartOffset,/g, 'NewOffset = currentOffset,');

text = text.replace(
`            failResult = new ParseResult
            {
                Success = false,
                Error = errorMsg,
                NewOffset = currentOffset,`,
`            failResult = new ParseResult
            {
                Success = false,
                Error = errorMsg,
                NewOffset = failStartOffset,`
);

fs.writeFileSync('src/lib/codegen.ts', text, 'utf8');
