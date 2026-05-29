import fs from 'fs';
import path from 'path';

const buildDir = path.resolve(import.meta.dirname, '..', 'build');
const kitAssetsDir = path.resolve(import.meta.dirname, '..', '.svelte-kit', 'output', 'client', '_app', 'immutable', 'assets');

const cssFiles = fs.readdirSync(kitAssetsDir).filter(f => /^\d+\./.test(f) || /^Toast\./.test(f));

if (cssFiles.length > 0) {
    let cssContent = cssFiles.map(f => {
        const filePath = path.join(kitAssetsDir, f);
        return `/* ${f} */\n${fs.readFileSync(filePath, 'utf8')}`;
    }).join('\n');

    const styleTag = `<style>\n${cssContent}\n</style>`;
    const indexPath = path.join(buildDir, 'index.html');
    let html = fs.readFileSync(indexPath, 'utf8');
    html = html.replace('</head>', `${styleTag}\n  </head>`);
    fs.writeFileSync(indexPath, html);
    console.log('[inject-css] Injected', cssFiles.length, 'CSS files');
} else {
    console.log('[inject-css] No CSS files found');
}
