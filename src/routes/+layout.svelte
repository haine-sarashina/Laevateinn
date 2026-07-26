<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { authStore } from "$lib/stores/authStore.svelte";
    import Toast from "$lib/components/ui/Toast.svelte";
    import Sidebar from "$lib/components/Sidebar.svelte";
    import SettingsModal from "$lib/components/SettingsModal.svelte";
    import { settingsStore } from "$lib/stores/settingsStore.svelte";
    import { openUrl } from "@tauri-apps/plugin-opener";
    import { getCurrentWindow, PhysicalSize, PhysicalPosition } from "@tauri-apps/api/window";
    import { listen } from "@tauri-apps/api/event";
    import { safeInvoke } from "$lib/api";
    import { errorStore } from "$lib/stores/errorStore.svelte";
    import { useShortcuts } from "$lib/keyboardShortcuts";

    let { children } = $props();
    let hasRefreshed = $state(false);
    let appReady = $state(false);
    let windowReady = $state(false);
    let shown = $state(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let unlistenOAuthAdded: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let unlistenOAuthError: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let unlistenTokenRefreshed: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let unlistenShortcuts: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let unlistenAccountChange: any = null;
    // Kept so the new-mail poller can be stopped on destroy.
    let emailStoreRef: typeof import("$lib/stores/emailStore.svelte").emailStore | null = null;

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
        unlistenOAuthAdded = await listen<string>("oauth-account-added", async (event) => {
            console.log('[oauth] oauth-account-added event received!', event.payload);
            if (hasRefreshed) {
                console.log('[oauth] skipping, already refreshed');
                return;
            }
            hasRefreshed = true;
            settingsStore.close();
            try {
                // Use authStore.syncAccounts() to reload account list from backend
                await authStore.syncAccounts();
                console.log('[oauth] accounts synced:', authStore.accounts);
                if (authStore.accounts.length > 0) {
                    // setActiveAccount handles backend switch + email refresh in one call
                    await authStore.setActiveAccount(authStore.accounts[0].id);
                    console.log('[oauth] switched to account:', authStore.accounts[0].id);
                }
            } catch (e) {
                console.error("Failed to handle oauth-account-added", e);
            }
            windowReady = true;
            await showWindow();
        });

        // Listen for OAuth error events from callback server
        unlistenOAuthError = await listen<string>("oauth-error", async (event) => {
            console.log('[oauth] oauth-error event received!', event.payload);
            errorStore.set({ type: "OAuth Error", message: event.payload });
        });

        // Listen for token-refreshed events from backend (emitted after 401 retry succeeds)
        unlistenTokenRefreshed = await listen<string>("token-refreshed", (event) => {
            console.log('[auth] token-refreshed event for account:', event.payload);
            authStore.notifyTokenRefreshed(event.payload);
        });

        settingsStore.init();
        await authStore.initialize();
        const { emailStore } = await import("$lib/stores/emailStore.svelte");
        emailStoreRef = emailStore;
        emailStore.reloginCallback = handleGoogleLogin;

        // Register emailStore.refresh as a token-refresh callback on authStore.
        // When the backend refreshes an account's token (detected via 401 retry),
        // this ensures the UI re-fetches data with the new token.
        authStore.onTokenRefresh((accountId) => {
            if (authStore.activeAccountId === accountId) {
                emailStore.refresh();
            }
        });

        // Register compose state save/restore for account switching.
        // Before switch: save current compose draft for the old account.
        // After switch: restore compose draft for the new account.
        unlistenAccountChange = authStore.onAccountChange({
            before: () => emailStore.saveComposeBeforeSwitch(),
            after: () => emailStore.restoreComposeAfterSwitch(),
        });

        // Register keyboard shortcuts (Gmail-compatible keymap)
        unlistenShortcuts = useShortcuts(emailStore, authStore);

        // Periodic new-mail check (interval configured in the settings screen)
        emailStore.startPolling(settingsStore.pollIntervalSec * 1000);

        appReady = true;

        // Restore window position, size, and maximized state
        const state = await loadWindowState();
        await applyWindowState(state);

        // Show window after layout and size is ready
        clearTimeout(showTimeout);
        windowReady = true;
        await showWindow();

        });

    // Clean up on destroy - moved outside the onMount block to avoid lifecycle error
    onDestroy(() => {
        emailStoreRef?.stopPolling();
        if (unlistenAccountChange) unlistenAccountChange();
        if (unlistenOAuthAdded) unlistenOAuthAdded();
        if (unlistenOAuthError) unlistenOAuthError();
        if (unlistenTokenRefreshed) unlistenTokenRefreshed();
        if (unlistenShortcuts) unlistenShortcuts();
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

    /* Single dark palette — the theme switcher was removed by request. */
    :global(:root) {
        --bg-primary: #1f2937;
        --bg-secondary: #111827;
        --text-primary: #e5e7eb;
        --text-secondary: #d1d5db;
        --border-color: #374151;
    }

    :global(body) {
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: var(--bg-primary);
        margin: 0;
        padding: 0;
        color: var(--text-primary);
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
        background-color: var(--bg-secondary);
        display: flex;
        align-items: center;
        justify-content: space-between;
        user-select: none;
        flex-shrink: 0;
        border-bottom: 1px solid var(--border-color);
        padding: 0 8px 0 12px;
        gap: 8px;
    }

    .titlebar-title {
        color: var(--text-primary);
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
        width: 46px;
        height: 32px;
        border: none;
        background: none;
        cursor: pointer;
        font-size: 12px;
        color: var(--text-secondary);
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .titlebar-btn:hover {
        background-color: rgba(128, 128, 128, 0.15);
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
        <span class="titlebar-title" data-tauri-drag-region={true}>Laevateinn v0.1.3</span>
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
            <Sidebar />
            <div class="main-content">
                {@render children()}
            </div>
        </div>
    </div>
</div>

{#if settingsStore.isOpen}
    <SettingsModal onAddAccount={handleGoogleLogin} />
{/if}

<Toast />
