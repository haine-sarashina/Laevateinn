import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { homedir } from "os";

const CONF_PATH = resolve("src-tauri/tauri.conf.json");
const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 800;

// Read app identifier from tauri.conf.json
let conf;
try {
    conf = JSON.parse(readFileSync(CONF_PATH, "utf-8"));
} catch {
    console.log("[sync-window-state] no tauri.conf.json, skipping");
    process.exit(0);
}

const identifier = conf.identifier || "com.example.app";

// Determine app config dir based on platform
let appConfigDir;
const platform = process.platform;
if (platform === "win32") {
    appConfigDir = resolve(homedir(), "AppData", "Roaming", identifier);
} else if (platform === "darwin") {
    appConfigDir = resolve(homedir(), "Library", "Application Support", identifier);
} else {
    appConfigDir = resolve(homedir(), ".config", identifier);
}

const statePath = resolve(appConfigDir, ".window-state.json");
console.log("[sync-window-state] state file:", statePath);

let state;
try {
    state = JSON.parse(readFileSync(statePath, "utf-8"));
} catch {
    console.log("[sync-window-state] no state file found, using defaults");
    process.exit(0);
}

// Find the main window config
let windowConf = null;
if (conf.app?.windows?.length > 0) {
    windowConf = conf.app.windows[0];
}
if (!windowConf) {
    console.log("[sync-window-state] no window config found, using defaults");
    process.exit(0);
}

const winLabel = windowConf.label || "main";
const winState = state[winLabel];
if (!winState) {
    console.log("[sync-window-state] no state for window", winLabel);
    process.exit(0);
}

let newWidth = winState.width ?? DEFAULT_WIDTH;
let newHeight = winState.height ?? DEFAULT_HEIGHT;

// Cap size to fit within typical screen bounds (to avoid WebView2 window scrollbar)
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;
if (newWidth > MAX_WIDTH) newWidth = MAX_WIDTH;
if (newHeight > MAX_HEIGHT) newHeight = MAX_HEIGHT;

if (windowConf.width !== newWidth || windowConf.height !== newHeight) {
    console.log("[sync-window-state] updating tauri.conf.json: ",
        windowConf.width, "x", windowConf.height, " -> ", newWidth, "x", newHeight);
    windowConf.width = newWidth;
    windowConf.height = newHeight;
    // Don't write maximized/x/y - the window-state plugin handles those separately
    writeFileSync(CONF_PATH, JSON.stringify(conf, null, 2) + "\n");
    console.log("[sync-window-state] saved");
} else {
    console.log("[sync-window-state] already up to date");
}
