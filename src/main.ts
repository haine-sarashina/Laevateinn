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
    await message("Error: " + e, { title: "Error", kind: "error" });
  }
}

function customPrompt(msg: string): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.style.padding = "20px";
    dialog.style.borderRadius = "8px";
    dialog.style.border = "none";
    dialog.style.boxShadow = "0 4px 12px rgba(0,0,0,0.5)";
    dialog.style.backgroundColor = "var(--bg-color)";
    dialog.style.color = "var(--text-color)";

    const label = document.createElement("p");
    label.textContent = msg;
    label.style.marginBottom = "10px";

    const input = document.createElement("input");
    input.type = "text";
    input.style.width = "100%";
    input.style.padding = "8px";
    input.style.marginBottom = "15px";
    input.style.border = "1px solid #555";
    input.style.borderRadius = "4px";
    input.style.backgroundColor = "#202124";
    input.style.color = "#fff";
    input.style.boxSizing = "border-box";

    const btnContainer = document.createElement("div");
    btnContainer.style.display = "flex";
    btnContainer.style.justifyContent = "flex-end";
    btnContainer.style.gap = "10px";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.padding = "8px 16px";
    cancelBtn.style.cursor = "pointer";
    cancelBtn.style.backgroundColor = "transparent";
    cancelBtn.style.color = "var(--text-color)";
    cancelBtn.style.border = "1px solid #555";
    cancelBtn.style.borderRadius = "4px";
    cancelBtn.onclick = () => {
      dialog.close();
      dialog.remove();
      resolve(null);
    };

    const okBtn = document.createElement("button");
    okBtn.textContent = "OK";
    okBtn.style.padding = "8px 16px";
    okBtn.style.cursor = "pointer";
    okBtn.style.backgroundColor = "#4285F4";
    okBtn.style.color = "#fff";
    okBtn.style.border = "none";
    okBtn.style.borderRadius = "4px";
    okBtn.onclick = () => {
      dialog.close();
      dialog.remove();
      resolve(input.value);
    };

    // Allow Enter to submit
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") okBtn.click();
      if (e.key === "Escape") cancelBtn.click();
    });

    btnContainer.appendChild(cancelBtn);
    btnContainer.appendChild(okBtn);

    dialog.appendChild(label);
    dialog.appendChild(input);
    dialog.appendChild(btnContainer);

    document.body.appendChild(dialog);
    dialog.showModal();
    input.focus();
  });
}

async function addAccount() {
  const name = await customPrompt("Enter account name (e.g. Work, Personal):");
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
