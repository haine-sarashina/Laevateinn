import { invoke } from "@tauri-apps/api/core";
import { errorStore } from "./stores/errorStore.svelte";

const COMMAND_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 1;

async function invokeWithTimeout<T>(command: string, args?: Record<string, any>): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Command "${command}" timed out after ${COMMAND_TIMEOUT_MS}ms`));
        }, COMMAND_TIMEOUT_MS);

        invoke<T>(command, args)
            .then(resolve)
            .catch(reject)
            .finally(clearTimeout(timer));
    });
}

export async function safeInvoke<T>(command: string, args?: Record<string, any>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await invokeWithTimeout<T>(command, args);
        } catch (e) {
            lastError = e;
            if (attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, 200));
            }
        }
    }
    errorStore.set(lastError);
    throw lastError;
}

export async function log(level: 'info' | 'warn' | 'error', message: string): Promise<void> {
    await invoke('log_message', { level, message });
}

/**
 * Fetches the list of accounts from the backend.
 */
export async function getAccounts(): Promise<Array<{id: string, name: string}>> {
    const accounts = await safeInvoke<Array<{id: string, name: string}>>('get_accounts');
    console.log('[getAccounts]', accounts);
    return accounts;
}

/**
 * Switches the active account on the backend.
 */
export async function switchActiveAccount(id: string): Promise<void> {
    await safeInvoke('switch_active_for_account', { id });
}

/**
 * Adds a new account via the backend.
 */
export async function addAccount(id: string, access_token: string, refresh_token?: string): Promise<void> {
    await safeInvoke('add_account', { id, access_token, refresh_token });
}

/**
 * Removes an account from the backend.
 */
export async function removeAccount(id: string): Promise<void> {
    await safeInvoke('remove_account', { id });
}

// === Gmail API Wrappers ===

export interface GmailListResponse {
    messages: Array<{
        id: string;
        threadId: string;
        subject: string;
        from: string;
        date: string;
        snippet: string;
    }> | null;
    nextPageToken: string | null;
}

export interface GmailMessageDetail {
    id: string;
    snippet: string;
    subject: string;
    from: string;
    date: string;
    body: string;
}

export interface GmailLabel {
    id: string;
    name: string;
    displayName: string;
    labelType: string;
    messagesUnread: number;
}

export interface GmailLabelsResponse {
    labels: GmailLabel[];
}

/**
 * Fetches paginated message list from the backend.
 */
export async function listMessages(
    accountId: string,
    labelId?: string,
    pageToken?: string,
    maxResults = 20,
): Promise<GmailListResponse> {
    return await safeInvoke<GmailListResponse>('list_messages', {
        accountId,
        labelId: labelId || null,
        pageToken: pageToken || null,
        maxResults: maxResults,
    });
}

/**
 * Fetches detailed message content.
 */
export async function getMessageDetails(accountId: string, messageId: string): Promise<GmailMessageDetail> {
    return await safeInvoke<GmailMessageDetail>('get_message_details', { accountId, messageId });
}

/**
 * Fetches the list of labels from the backend.
 */
export async function listLabels(accountId: string): Promise<GmailLabelsResponse> {
    return await safeInvoke<GmailLabelsResponse>('list_labels', { accountId });
}
