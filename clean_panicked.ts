import fs from 'fs';

let content = fs.readFileSync('src/lib/codegen.ts', 'utf8');

// The lines look like:
//                     if (TryRecover(text, (true && lastStructuralOffset < currentOffset ? lastStructuralOffset : currentOffset), 69, "Expected literal \\")\\"", ref localMaxOffset, results, lastStructuralResultsCount, ref currentOffset, ref panicked, hasCommitted, null, ctx, out var failRes))
//                         if (panicked) panicked = true; // Handled recovery boundary hit
//                     else
//                         return failRes;

const lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('if (panicked) panicked = true;')) {
        // we found the target line
        // The previous line contains `if (TryRecover`
        if (i > 0 && lines[i-1].includes('if (TryRecover')) {
            lines[i-1] = lines[i-1].replace('if (TryRecover', 'if (!TryRecover');
            
            // Extract the comment if any
            let comment = '';
            if (line.includes('//')) {
                comment = ' ' + line.substring(line.indexOf('//'));
            }

            // Replace current line and next two lines
            // lines[i] is '                        if (panicked) panicked = true;'
            // lines[i+1] is '                    else'
            // lines[i+2] is '                        return failRes;'
            
            // We want it to be just: `                        return failRes;${comment}`
            lines[i] = '                        return failRes;' + comment;
            lines[i+1] = ''; // blank line or remove it entirely
            lines[i+2] = '';
        }
    }
}

// remove empty lines created by our process
const finalLines = lines.filter((l, idx) => {
    // we set i+1 and i+2 to empty strings. Let's just remove them if they are exactly empty string and were right after our modified block
    // but a safer way is to just join
    return l !== '';
});

fs.writeFileSync('src/lib/codegen.ts', finalLines.join('\n'), 'utf8');
