import { getAccounts, switchActiveAccount, addAccount as apiAddAccount, removeAccount as apiRemoveAccount } from "../api";

/** Callback invoked when the backend signals a token refresh for an account. */
export type TokenRefreshCallback = (accountId: string) => void;

/** Callback invoked before/after active account changes. */
export type AccountChangeCallback = {
    /** Called before the active account is changed. Returns a promise to allow async cleanup. */
    before?: (oldId: string | null, newId: string) => Promise<void> | void;
    /** Called after the active account is fully changed (backend switched, email refreshed). */
    after?: (oldId: string | null, newId: string) => void;
};

// Using a simple class with runes for Svelte 5
class AuthStore {
    activeAccountId = $state<string | null>(null);
    accounts = $state<Array<{id: string, name: string}>>([]);

    /** Registry of callbacks notified when the backend refreshes an account's token. */
    #tokenRefreshCallbacks: TokenRefreshCallback[] = [];

    /** Registry of callbacks for active account changes (save/restore compose state, etc.) */
    #accountChangeCallbacks: AccountChangeCallback[] = [];

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
        const oldId = this.activeAccountId;
        // Notify before change so subscribers can save state for the old account
        for (const cb of this.#accountChangeCallbacks) {
            if (cb.before) {
                await cb.before(oldId, id);
            }
        }
        await switchActiveAccount(id);
        this.activeAccountId = id;
        // Fully reset + refresh email data after switching accounts
        const email = await this.getEmailStore();
        email.refresh();
        // Notify after change so subscribers can restore state for the new account
        for (const cb of this.#accountChangeCallbacks) {
            if (cb.after) {
                try {
                    cb.after(oldId, id);
                } catch (e) {
                    console.error("[authStore] account change after callback error", e);
                }
            }
        }
    }

    async addAccountFromFlow(id: string, access_token: string, refresh_token?: string) {
        await apiAddAccount(id, access_token, refresh_token);
        await this.syncAccounts();
        // Use setActiveAccount to switch backend + refresh email store atomically
        if (this.accounts.length > 0) {
            await this.setActiveAccount(this.accounts[0].id);
        }
    }

    async removeAccount(id: string) {
        await apiRemoveAccount(id);
        this.accounts = await getAccounts();
        if (this.activeAccountId === id) {
            const oldId = this.activeAccountId;
            const newId = this.accounts.length > 0 ? this.accounts[0].id : null;
            // Save compose state for old account before switching
            for (const cb of this.#accountChangeCallbacks) {
                if (cb.before) {
                    await cb.before(oldId, newId ?? "");
                }
            }
            this.activeAccountId = newId;
            // Reset emailStore when active account is removed
            const email = await this.getEmailStore();
            email.refresh();
            // Restore compose state for new account
            if (newId) {
                for (const cb of this.#accountChangeCallbacks) {
                    if (cb.after) {
                        try {
                            cb.after(oldId, newId);
                        } catch (e) {
                            console.error("[authStore] account change after callback error", e);
                        }
                    }
                }
            }
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

    /**
     * Register callbacks to be invoked before/after the active account changes.
     * This is used by emailStore to save/restore compose state per account.
     * Returns an unsubscribe function.
     */
    onAccountChange(callback: AccountChangeCallback): () => void {
        this.#accountChangeCallbacks.push(callback);
        return () => {
            const idx = this.#accountChangeCallbacks.indexOf(callback);
            if (idx >= 0) this.#accountChangeCallbacks.splice(idx, 1);
        };
    }
}

export const authStore = new AuthStore();
