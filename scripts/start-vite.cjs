const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '..', 'src-tauri', 'tauri.conf.json');

function findPort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer()
            .once('error', reject)
            .once('listening', () => {
                const port = server.address().port;
                server.close(() => resolve(port));
            });
        server.listen(0);
    });
}

async function main() {
    const port = await findPort();
    const devUrl = 'http://localhost:' + port;

    // Write port to config BEFORE starting Tauri
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    config.build.devUrl = devUrl;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

    console.log('\u{1f680} Starting Vite on port ' + port + '...');

    const viteProcess = spawn('npx', ['vite', 'dev'], {
        stdio: 'inherit',
        shell: true,
        env: Object.assign({}, process.env, { PORT: String(port) }),
    });

    process.on('SIGINT', function() { viteProcess.kill(); process.exit(0); });
    process.on('SIGTERM', function() { viteProcess.kill(); process.exit(0); });

    viteProcess.on('exit', function(code) {
        process.exit(code);
    });
}

main();
