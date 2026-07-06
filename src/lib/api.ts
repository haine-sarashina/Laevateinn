import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { errorStore } from "./stores/errorStore.svelte";

const COMMAND_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;

async function invokeWithTimeout<T>(command: string, args?: Record<string, any>): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            clearTimeout(timer);
            reject(new Error(`Command "${command}" timed out after ${COMMAND_TIMEOUT_MS}ms`));
        }, COMMAND_TIMEOUT_MS);

        invoke<T>(command, args)
            .then(resolve)
            .catch(reject)
            .finally(() => clearTimeout(timer));
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
        unread: boolean;
        starred: boolean;
    }> | null;
    nextPageToken: string | null;
}

export interface GmailAttachment {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    data?: string; // base64 encoded data
}

export interface GmailMessageDetail {
    id: string;
    snippet: string;
    subject: string;
    from: string;
    date: string;
    body: string;
    attachments?: GmailAttachment[];
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
    query?: string,
): Promise<GmailListResponse> {
    return await safeInvoke<GmailListResponse>('list_messages', {
        accountId,
        labelId: labelId || null,
        pageToken: pageToken || null,
        maxResults: maxResults,
        query: query || null,
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

/**
 * Attachment data for sending an email.
 */
export interface SendAttachment {
    filename: string;
    mimeType: string;
    data: string; // base64 encoded
}

/**
 * Sends an email via Gmail API.
 */
export async function sendEmail(
    accountId: string,
    to: string,
    subject: string,
    body: string,
    cc?: string,
    bcc?: string,
    attachments?: SendAttachment[],
    scheduledSendTimeMs?: number,
): Promise<{ messageId: string }> {
    return await safeInvoke<{ messageId: string }>('send_email', {
        accountId,
        to,
        subject,
        body,
        cc: cc || null,
        bcc: bcc || null,
        attachments: attachments || [],
        scheduledSendTimeMs: scheduledSendTimeMs ?? null,
    });
}

/**
 * Starts the OAuth authentication flow.
 * This function handles opening the auth URL in a browser and waiting for the callback.
 */
export async function startOAuthFlow(): Promise<{ auth_url: string, state: string }> {
    // We'll handle the actual authentication flow through the Tauri backend
    // which will open the browser window and manage the callback
    return await safeInvoke<{ auth_url: string, state: string }>('start_auth_flow');
}

/**
 * Modifies labels on a message (add/remove).
 * Used for star toggle, archive, trash, spam report, etc.
 */
export interface ModifyLabelsResult {
    success: boolean;
    messageId: string;
}

export async function modifyLabels(
    accountId: string,
    messageId: string,
    addLabelIds?: string[],
    removeLabelIds?: string[],
): Promise<ModifyLabelsResult> {
    return await safeInvoke<ModifyLabelsResult>('modify_labels', {
        accountId,
        messageId,
        addLabelIds: addLabelIds || [],
        removeLabelIds: removeLabelIds || [],
    });
}

/**
 * Sends a desktop notification via the Tauri Notification API.
 * Requests permission if not already granted.
 * Errors are caught and stored in errorStore (non-fatal).
 */
export async function sendDesktopNotification(title: string, body: string): Promise<void> {
    try {
        let granted = await isPermissionGranted();
        if (!granted) {
            const perm = await requestPermission();
            granted = perm === 'granted';
        }
        if (!granted) return;

        // TauriのNotification APIを使用
        await invoke('send_notification', { title, body });
    } catch (e) {
        errorStore.set(e);
    }
}
