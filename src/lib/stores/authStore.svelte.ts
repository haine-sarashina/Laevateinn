import { getAccounts, switchActiveAccount, addAccount as apiAddAccount, removeAccount as apiRemoveAccount } from "../api";

// Using a simple class with runes for Svelte 5
class AuthStore {
    activeAccountId = $state<string | null>(null);
    accounts = $state<Array<{id: string, name: string}>>([]);

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

    async setActiveAccount(id: string) {
        await switchActiveAccount(id);
        this.activeAccountId = id;
        // Refresh email list after switching accounts
        const { emailStore } = await import("$lib/stores/emailStore.svelte");
        emailStore.refresh();
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
        }
    }
}

export const authStore = new AuthStore();
