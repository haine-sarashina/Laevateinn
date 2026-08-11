import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ask, message } from "@tauri-apps/plugin-dialog";

interface Account {
  id: string;
  name: string;
  color: string;
}

let accounts: Account[] = [];
let activeAccountId: string | null = null;

// Initialize app
async function init() {
  // Check for updates in the background
  checkForUpdates();

  const saved = localStorage.getItem("accounts");
  if (saved) {
    accounts = JSON.parse(saved);
  }

  const appDiv = document.getElementById("app")!;
  
  // Create sidebar
  const sidebar = document.createElement("div");
  sidebar.id = "sidebar";
  appDiv.appendChild(sidebar);

  renderSidebar();

  // If we have accounts, switch to the first one
  if (accounts.length > 0) {
    await switchAccount(accounts[0].id);
  }
}

// Render the sidebar UI
function renderSidebar() {
  const sidebar = document.getElementById("sidebar")!;
  sidebar.innerHTML = "";

  accounts.forEach((account) => {
    const btn = document.createElement("button");
    btn.className = `account-btn ${activeAccountId === account.id ? "active" : ""}`;
    btn.style.backgroundColor = account.color;
    btn.textContent = account.name.charAt(0).toUpperCase();
    btn.title = account.name;
    btn.onclick = () => switchAccount(account.id);
    sidebar.appendChild(btn);
  });

  const addBtn = document.createElement("button");
  addBtn.className = "account-btn add-btn";
  addBtn.textContent = "+";
  addBtn.title = "Add Account";
  addBtn.onclick = addAccount;
  sidebar.appendChild(addBtn);
}

async function switchAccount(id: string) {
  activeAccountId = id;
  renderSidebar();
  
  try {
    // Call Rust to manage the child Webview
    await invoke("switch_account_webview", { accountId: id });
  } catch (e) {
    console.error("Failed to switch webview:", e);
    alert("Error: " + e);
  }
}

function addAccount() {
  const name = prompt("Enter account name (e.g. Work, Personal):");
  if (!name) return;

  const id = `acc_${Date.now()}`;
  const colors = ["#DB4437", "#4285F4", "#0F9D58", "#F4B400", "#673AB7", "#3F51B5"];
  const color = colors[accounts.length % colors.length];

  accounts.push({ id, name, color });
  saveAccounts();
  switchAccount(id);
}

function saveAccounts() {
  localStorage.setItem("accounts", JSON.stringify(accounts));
}

// Run init
init();

async function checkForUpdates() {
  try {
    const update = await check();
    if (update) {
      const yes = await ask(
        `新しいバージョン (${update.version}) が利用可能です。\n今すぐアップデートしますか？\n\nリリースノート:\n${update.body || "なし"}`,
        {
          title: "アップデートの確認",
          kind: "info",
        }
      );
      if (yes) {
        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case 'Started':
              console.log(`Started downloading ${event.data.contentLength} bytes`);
              break;
            case 'Progress':
              console.log(`Downloaded ${event.data.chunkLength} bytes`);
              break;
            case 'Finished':
              console.log('Download finished');
              break;
          }
        });
        await message("アップデートが完了しました。アプリを再起動します。", { title: "アップデート完了" });
        await relaunch();
      }
    }
  } catch (error) {
    console.error("Failed to check for updates:", error);
  }
}
