import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { listen } from "@tauri-apps/api/event";
import { ask, message } from "@tauri-apps/plugin-dialog";

interface Account {
  id: string;
  name: string;
  color: string;
  unreadCount?: number;
}

let accounts: Account[] = [];
let activeAccountId: string | null = null;

function getBadgeRgba(count: number): number[] | null {
  if (count <= 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, 32, 32);
  ctx.beginPath();
  ctx.arc(16, 16, 16, 0, Math.PI * 2);
  ctx.fillStyle = "#D93025";
  ctx.fill();

  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  
  const text = count > 99 ? "99+" : count.toString();
  ctx.font = "bold " + (text.length > 2 ? "12px" : "16px") + " sans-serif";
  ctx.fillText(text, 16, 17);

  const imgData = ctx.getImageData(0, 0, 32, 32);
  return Array.from(imgData.data);
}

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

  const accountList = document.createElement("div");
  accountList.id = "account-list";
  accountList.style.display = "flex";
  accountList.style.flexDirection = "column";
  accountList.style.alignItems = "center";
  accountList.style.gap = "16px";
  accountList.style.flex = "1";
  accountList.style.overflowY = "auto";
  accountList.style.width = "100%";
  
  // Custom scrollbar hiding css
  accountList.className = "hide-scrollbar";
  sidebar.appendChild(accountList);

  const sidebarBottom = document.createElement("div");
  sidebarBottom.id = "sidebar-bottom";
  sidebarBottom.style.padding = "16px 0";
  sidebarBottom.style.display = "flex";
  sidebarBottom.style.flexDirection = "column";
  sidebarBottom.style.alignItems = "center";
  sidebar.appendChild(sidebarBottom);

  const settingsBtn = document.createElement("button");
  settingsBtn.className = "account-btn add-btn";
  settingsBtn.textContent = "⚙";
  settingsBtn.title = "Settings";
  settingsBtn.onclick = openSettings;
  sidebarBottom.appendChild(settingsBtn);

  renderSidebar();

  // Listen for unread count updates
  listen("unread_update", (event) => {
    const payload = event.payload as { account_id: string, count: number };
    const acc = accounts.find(a => a.id === payload.account_id);
    if (acc && acc.unreadCount !== payload.count) {
      acc.unreadCount = payload.count;
      renderSidebar();
      
      const total = accounts.reduce((sum, a) => sum + (a.unreadCount || 0), 0);
      invoke("set_app_badge", { count: total, rgba: getBadgeRgba(total) }).catch(console.error);
    }
  });

  // Spawn background webviews for all accounts except the first one
  if (accounts.length > 1) {
    const backgroundIds = accounts.slice(1).map(a => a.id);
    invoke("spawn_background_webviews", { accountIds: backgroundIds }).catch(console.error);
  }

  // If we have accounts, switch to the first one (this spawns the first one and shows it)
  if (accounts.length > 0) {
    await switchAccount(accounts[0].id);
  }
}

// Render the sidebar UI
function renderSidebar() {
  const accountList = document.getElementById("account-list")!;
  accountList.innerHTML = "";

  accounts.forEach((account) => {
    const btnContainer = document.createElement("div");
    btnContainer.style.position = "relative";
    btnContainer.style.display = "inline-block";

    const btn = document.createElement("button");
    btn.className = `account-btn ${activeAccountId === account.id ? "active" : ""}`;
    btn.style.backgroundColor = account.color;
    btn.textContent = account.name.charAt(0).toUpperCase();
    btn.title = account.name;
    btn.onclick = () => switchAccount(account.id);
    
    btnContainer.appendChild(btn);

    if (account.unreadCount && account.unreadCount > 0) {
      const badge = document.createElement("div");
      badge.textContent = account.unreadCount > 99 ? "99+" : account.unreadCount.toString();
      badge.style.position = "absolute";
      badge.style.top = "0";
      badge.style.right = "0";
      badge.style.backgroundColor = "#D93025";
      badge.style.color = "white";
      badge.style.fontSize = "10px";
      badge.style.fontWeight = "bold";
      badge.style.borderRadius = "10px";
      badge.style.padding = "2px 5px";
      badge.style.pointerEvents = "none";
      badge.style.boxShadow = "0 1px 3px rgba(0,0,0,0.3)";
      btnContainer.appendChild(badge);
    }

    accountList.appendChild(btnContainer);
  });

  const addBtn = document.createElement("button");
  addBtn.className = "account-btn add-btn";
  addBtn.textContent = "+";
  addBtn.title = "Add Account";
  addBtn.onclick = addAccount;
  accountList.appendChild(addBtn);
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
  try {
    await invoke("hide_all_webviews");
  } catch (e) {
    console.error("Failed to hide webviews:", e);
  }

  const name = await customPrompt("Enter account name (e.g. Work, Personal):");
  if (!name) {
    if (activeAccountId) {
      switchAccount(activeAccountId);
    }
    return;
  }

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

function openSettings() {
  invoke("hide_all_webviews").catch(console.error);

  const dialog = document.createElement("dialog");
  dialog.style.padding = "20px";
  dialog.style.borderRadius = "8px";
  dialog.style.border = "none";
  dialog.style.boxShadow = "0 4px 12px rgba(0,0,0,0.5)";
  dialog.style.backgroundColor = "var(--bg-color)";
  dialog.style.color = "var(--text-color)";
  dialog.style.width = "400px";

  const title = document.createElement("h2");
  title.textContent = "Settings";
  title.style.marginBottom = "20px";
  dialog.appendChild(title);

  const list = document.createElement("div");
  list.style.display = "flex";
  list.style.flexDirection = "column";
  list.style.gap = "10px";

  accounts.forEach((acc) => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "10px";
    
    const label = document.createElement("div");
    label.style.width = "20px";
    label.style.height = "20px";
    label.style.borderRadius = "50%";
    label.style.backgroundColor = acc.color;

    const input = document.createElement("input");
    input.type = "text";
    input.value = acc.name;
    input.style.flex = "1";
    input.style.padding = "8px";
    input.style.border = "1px solid #555";
    input.style.borderRadius = "4px";
    input.style.backgroundColor = "#202124";
    input.style.color = "#fff";
    
    input.addEventListener("change", () => {
      acc.name = input.value;
      saveAccounts();
      renderSidebar();
    });

    row.appendChild(label);
    row.appendChild(input);
    list.appendChild(row);
  });

  if (accounts.length === 0) {
    const emptyMsg = document.createElement("p");
    emptyMsg.textContent = "No accounts added yet.";
    list.appendChild(emptyMsg);
  }

  dialog.appendChild(list);

  // Divider
  const divider = document.createElement("hr");
  divider.style.borderColor = "#555";
  divider.style.margin = "20px 0";
  dialog.appendChild(divider);

  // System section
  const systemTitle = document.createElement("h3");
  systemTitle.textContent = "System";
  systemTitle.style.marginBottom = "10px";
  dialog.appendChild(systemTitle);

  const updateBtn = document.createElement("button");
  updateBtn.textContent = "Check for Updates";
  updateBtn.style.padding = "8px 16px";
  updateBtn.style.cursor = "pointer";
  updateBtn.style.backgroundColor = "transparent";
  updateBtn.style.color = "var(--text-color)";
  updateBtn.style.border = "1px solid #555";
  updateBtn.style.borderRadius = "4px";
  updateBtn.onclick = manualCheckForUpdates;
  dialog.appendChild(updateBtn);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.style.marginTop = "20px";
  closeBtn.style.padding = "8px 16px";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.backgroundColor = "#4285F4";
  closeBtn.style.color = "#fff";
  closeBtn.style.border = "none";
  closeBtn.style.borderRadius = "4px";
  closeBtn.style.float = "right";
  closeBtn.onclick = () => {
    dialog.close();
    dialog.remove();
    if (activeAccountId) {
      switchAccount(activeAccountId);
    }
  };

  dialog.appendChild(closeBtn);
  
  // Clear floats
  const clearFix = document.createElement("div");
  clearFix.style.clear = "both";
  dialog.appendChild(clearFix);

  document.body.appendChild(dialog);
  dialog.showModal();
}

// Run init
init();

async function manualCheckForUpdates() {
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
        await update.downloadAndInstall();
        await message("アップデートが完了しました。アプリを再起動します。", { title: "アップデート完了" });
        await relaunch();
      }
    } else {
      await message("現在最新バージョンをご利用中です。", { title: "最新版", kind: "info" });
    }
  } catch (error) {
    console.error("Failed to check for updates:", error);
    await message("アップデートの確認に失敗しました。\n" + error, { title: "エラー", kind: "error" });
  }
}

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
