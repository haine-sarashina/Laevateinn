const { spawn, execSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

function syncWindowState() {
    try {
        execSync('node scripts/sync-window-state.js', {
            cwd: REPO_ROOT,
            stdio: 'inherit'
        });
    } catch (e) {
        console.log('[sync-window-state] failed:', e.message);
    }
}

let tauriProc = null;

function cleanup(code) {
    if (tauriProc) tauriProc.kill('SIGTERM');
    process.exit(code);
}

function main() {
    syncWindowState();

    tauriProc = spawn('pnpm', ['tauri', 'dev'], {
        cwd: REPO_ROOT,
        stdio: 'inherit',
        shell: true,
    });

    process.on('SIGINT', () => cleanup(0));
    process.on('SIGTERM', () => cleanup(0));

    tauriProc.on('exit', (code) => {
        cleanup(code !== null ? code : 0);
    });
}

main();
