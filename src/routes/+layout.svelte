<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { authStore } from "$lib/stores/authStore.svelte";
    import Toast from "$lib/components/ui/Toast.svelte";
    import Sidebar from "$lib/components/Sidebar.svelte";
    import { openUrl } from "@tauri-apps/plugin-opener";
    import { getCurrentWindow, PhysicalSize, PhysicalPosition } from "@tauri-apps/api/window";
    import { listen } from "@tauri-apps/api/event";
    import { safeInvoke } from "$lib/api";
    import { errorStore } from "$lib/stores/errorStore.svelte";

    let { children } = $props();
    let hasRefreshed = $state(false);
    let appReady = $state(false);
    let windowReady = $state(false);
    let shown = $state(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let unlisten: any = null;

    let showTimeout = setTimeout(async () => {
        windowReady = true;
        await showWindow();
    }, 10000);

    async function loadWindowState() {
        try {
            const result = await safeInvoke<Record<string, unknown>>("load_window_state");
            return result as {
                width?: number; height?: number;
                x?: number; y?: number;
                maximized?: boolean;
            } | null;
        } catch (e) {
            return null;
        }
    }

    async function showWindow() {
        if (shown) return;
        shown = true;
        try { await getCurrentWindow().show(); } catch {}
    }

    async function applyWindowState(state: {
        width?: number; height?: number;
        x?: number; y?: number;
        maximized?: boolean;
    } | null) {
        if (!state) {
            return;
        }
        const win = getCurrentWindow();
        if (state.maximized) {
            await win.maximize();
        } else if (state.width && state.height) {
            await win.setSize(new PhysicalSize(state.width, state.height));
            if (state.x != null && state.y != null) {
                try {
                    await win.setPosition(new PhysicalPosition(state.x, state.y));
                } catch {
                    // ignore position errors
                }
            }
        }
    }

    async function handleGoogleLogin() {
        try {
            hasRefreshed = false;
            const result = await safeInvoke<{ auth_url: string; state: string }>("start_auth_flow");
            console.log('[oauth] auth_flow started, state=' + result.state);
            await openUrl(result.auth_url);
        } catch (e) {
            hasRefreshed = true;
            errorStore.set({ type: "error", message: "Auth error: " + e });
        }
    }

    onMount(async () => {
        // Listen for OAuth account-added events from callback server
        unlisten = await listen<string>("oauth-account-added", async (event) => {
            console.log('[oauth] oauth-account-added event received!', event.payload);
            if (hasRefreshed) {
                console.log('[oauth] skipping, already refreshed');
                return;
            }
            hasRefreshed = true;
            try {
                const accounts = await authStore.getAccounts();
                console.log('[oauth] accounts loaded:', accounts);
                authStore.accounts = accounts;
                if (accounts.length > 0) {
                    authStore.activeAccountId = accounts[0].id;
                    await safeInvoke('switch_active_for_account', { id: accounts[0].id });
                }
                const { emailStore: email } = await import("$lib/stores/emailStore.svelte");
                await email.refresh();
                console.log('[oauth] email list refreshed');
            } catch (e) {
                console.error("Failed to handle oauth-account-added", e);
            }
            windowReady = true;
            await showWindow();
        });

        await authStore.initialize();
        const { emailStore } = await import("$lib/stores/emailStore.svelte");
        emailStore.reloginCallback = handleGoogleLogin;
        appReady = true;

        // Restore window position, size, and maximized state
        const state = await loadWindowState();
        await applyWindowState(state);

        // Show window after layout and size is ready
        clearTimeout(showTimeout);
        windowReady = true;
        await showWindow();
    });

    onDestroy(() => {
        if (unlisten) unlisten();
    });
</script>

<style>
    * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
    }

    :global(html) {
        width: 100%;
        height: 100%;
        overflow: hidden;
    }

    :global(body) {
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #1f2937;
        margin: 0;
        padding: 0;
        color: #e5e7eb;
    }

    .app {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
    }

    .titlebar {
        width: 100%;
        height: 32px;
        background-color: #111827;
        display: flex;
        align-items: center;
        justify-content: space-between;
        user-select: none;
        flex-shrink: 0;
        border-bottom: 1px solid #374151;
        padding: 0 8px 0 12px;
        gap: 8px;
    }

    .titlebar-title {
        color: #e5e7eb;
        font-size: 13px;
        font-weight: 600;
        flex: 0 0 auto;
        min-width: 80px;
        user-select: none;
        padding: 0 0 0 12px;
        opacity: 1 !important;
    }

    .titlebar-controls {
        display: flex;
        height: 100%;
        flex: 0 0 auto;
    }

    .titlebar-btn {
        -webkit-app-region: no-drag;
        app-region: no-drag;
        width: 46px;
        height: 32px;
        border: none;
        background: none;
        cursor: pointer;
        font-size: 12px;
        color: #d1d5db;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .titlebar-btn:hover {
        background-color: rgba(255, 255, 255, 0.1);
    }

    .titlebar-close:hover {
        background-color: #dc2626;
        color: white;
    }

    .window-frame {
        width: 100%;
        flex: 1;
        overflow: hidden;
    }

    .layout {
        display: flex;
        width: 100%;
        height: 100%;
        overflow: hidden;
    }

    .main-content {
        flex-grow: 1;
        overflow: hidden;
    }
</style>

<div class="app">
    <div class="titlebar" data-tauri-drag-region={true}>
        <span class="titlebar-title" data-tauri-drag-region={true} style="color: #e5e7eb !important;">Laevateinn</span>
        <div class="titlebar-controls">
            <button class="titlebar-btn" data-tauri-window-btn="minimize" title="最小化" onclick={() => getCurrentWindow().minimize()}>─</button>
            <button class="titlebar-btn" data-tauri-window-btn="maximize" title="最大化/元に戻す" onclick={async () => getCurrentWindow().toggleMaximize()}>□</button>
            <button class="titlebar-btn titlebar-close" data-tauri-window-btn="close" title="閉じる" onclick={async () => {
                const win = getCurrentWindow();
                try {
                    const size = await win.outerSize();
                    const inner = await win.innerSize();
                    const pos = await win.outerPosition();
                    const maximized = await win.isMaximized();
                    await safeInvoke('save_window_state_cmd', {
                        width: inner.width,
                        height: inner.height,
                        x: pos.x,
                        y: pos.y,
                        maximized
                    });
                } catch {
                    // ignore save errors
                }
                win.close();
            }}>✕</button>
        </div>
    </div>
    <div class="window-frame">
        <div class="layout">
            <Sidebar onLogin={handleGoogleLogin} />
            <div class="main-content">
                {@render children()}
            </div>
        </div>
    </div>
</div>

<Toast />
