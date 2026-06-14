import { getAccounts, switchActiveAccount, addAccount as apiAddAccount, removeAccount as apiRemoveAccount } from "../api";

/** Callback invoked when the backend signals a token refresh for an account. */
export type TokenRefreshCallback = (accountId: string) => void;

// Using a simple class with runes for Svelte 5
class AuthStore {
    activeAccountId = $state<string | null>(null);
    accounts = $state<Array<{id: string, name: string}>>([]);

    /** Registry of callbacks notified when the backend refreshes an account's token. */
    #tokenRefreshCallbacks: TokenRefreshCallback[] = [];

    /**
     * Call this on application startup to sync the store with the backend.
     */
    async initialize() {
        await this.syncAccounts();
        // Set the first account as active if none is set yet (frontend only)
        // The backend active account is managed by switchActiveAccount
        if (!this.activeAccountId && this.accounts.length > 0) {
            this.activeAccountId = this.accounts[0].id;
        }
    }

    async syncAccounts() {
        try {
            const raw = await getAccounts();
            // Deduplicate by id
            const seen = new Set<string>();
            this.accounts = raw.filter(a => {
                if (seen.has(a.id)) return false;
                seen.add(a.id);
                return true;
            });
        } catch (e) {
            console.error("Failed to sync accounts", e);
        }
    }

    async getAccounts() {
        return await getAccounts();
    }

    /**
     * Get a reference to the emailStore singleton (lazy, cached).
     * Used to avoid repeated dynamic imports in hot paths.
     */
    #emailStoreRef: typeof import("$lib/stores/emailStore.svelte").emailStore | null = null;

    async getEmailStore() {
        if (!this.#emailStoreRef) {
            const mod = await import("$lib/stores/emailStore.svelte");
            this.#emailStoreRef = mod.emailStore;
        }
        return this.#emailStoreRef;
    }

    async setActiveAccount(id: string) {
        await switchActiveAccount(id);
        this.activeAccountId = id;
        // Fully reset + refresh email data after switching accounts
        const email = await this.getEmailStore();
        email.refresh();
    }

    async addAccountFromFlow(id: string, access_token: string, refresh_token?: string) {
        await apiAddAccount(id, access_token, refresh_token);
        this.accounts = await getAccounts();
        if (this.accounts.length > 0) {
            this.activeAccountId = this.accounts[0].id;
            await switchActiveAccount(this.accounts[0].id);
        }
    }

    async removeAccount(id: string) {
        await apiRemoveAccount(id);
        this.accounts = await getAccounts();
        if (this.activeAccountId === id) {
            this.activeAccountId = this.accounts.length > 0 ? this.accounts[0].id : null;
            // Reset emailStore when active account is removed
            const email = await this.getEmailStore();
            email.refresh();
        }
    }

    /**
     * Register a callback to be invoked when the backend emits a token-refresh event.
     * Returns an unsubscribe function.
     */
    onTokenRefresh(callback: TokenRefreshCallback): () => void {
        this.#tokenRefreshCallbacks.push(callback);
        return () => {
            const idx = this.#tokenRefreshCallbacks.indexOf(callback);
            if (idx >= 0) this.#tokenRefreshCallbacks.splice(idx, 1);
        };
    }

    /**
     * Public method called by the layout when the backend emits a token-refreshed event.
     * Notifies all registered callbacks.
     */
    notifyTokenRefreshed(accountId: string): void {
        for (const cb of this.#tokenRefreshCallbacks) {
            try {
                cb(accountId);
            } catch (e) {
                console.error("[authStore] token refresh callback error", e);
            }
        }
    }
}

export const authStore = new AuthStore();
