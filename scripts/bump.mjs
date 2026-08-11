import fs from 'fs';
import path from 'path';

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: node scripts/bump.mjs <version>");
  console.error("Example: node scripts/bump.mjs 0.3.2");
  process.exit(1);
}

const packageJsonPath = path.resolve('package.json');
const tauriConfPath = path.resolve('src-tauri/tauri.conf.json');
const cargoTomlPath = path.resolve('src-tauri/Cargo.toml');

// Update package.json
let pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
pkg.version = version;
fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`Updated package.json to ${version}`);

// Update tauri.conf.json
let tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
tauriConf.version = version;
fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
console.log(`Updated tauri.conf.json to ${version}`);

// Update Cargo.toml
let cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
cargoToml = cargoToml.replace(/^version = ".*"/m, `version = "${version}"`);
fs.writeFileSync(cargoTomlPath, cargoToml);
console.log(`Updated Cargo.toml to ${version}`);

console.log("\nDone! Next steps:");
console.log(`1. git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml`);
console.log(`2. git commit -m "chore: bump version to ${version}"`);
console.log(`3. git tag v${version}`);
console.log(`4. git push origin master && git push origin v${version}`);
