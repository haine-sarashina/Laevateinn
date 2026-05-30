import { listMessages, getMessageDetails, listLabels } from "$lib/api";
import type { GmailMessageDetail, GmailListResponse, GmailLabel, GmailLabelsResponse } from "$lib/api";
import { errorStore } from "./errorStore.svelte";
import { authStore } from "./authStore.svelte";

export interface EmailMessage {
    id: string;
    threadId: string;
    snippet: string;
    subject: string;
    from: string;
    date: string;
    body: string;
    read: boolean;
}

function isAuthError(e: unknown): boolean {
    if (e instanceof Error) {
        return e.message.includes("AuthError") || e.message.includes("認証");
    }
    if (typeof e === "object" && e !== null && "type" in e) {
        return (e as any).type === "AuthError";
    }
    if (typeof e === "string") {
        return e.includes("AuthError") || e.includes("認証");
    }
    return false;
}

class EmailStore {
    messages = $state<EmailMessage[]>([]);
    selectedMessage = $state<GmailMessageDetail | null>(null);
    isLoading = $state(false);
    isDetailsLoading = $state(false);
    isMoreLoading = $state(false);
    error = $state<string | null>(null);
    isAuthErrorFlag = $state(false);
    reloginCallback: (() => Promise<void>) | null = null;
    nextPageToken = $state<string | null>(null);
    hasMore = $state(true);
    maxResults = 20;

    // Label support
    labels = $state<GmailLabel[]>([]);
    currentLabelId = $state<string | null>(null);

    /**
     * Fetches labels for the active account.
     * Filters to show only relevant system and user labels.
     */
    async loadLabels() {
        try {
            const accountId = authStore.activeAccountId;
            if (!accountId) return;

            const response: GmailLabelsResponse = await listLabels(accountId);
            this.labels = response.labels || [];
        } catch (e) {
            console.error('[emailStore] Failed to load labels', e);
        }
    }

    /**
     * Switches to a label. Null means "show all" (default inbox view).
     */
    async selectLabel(labelId: string | null) {
        this.currentLabelId = labelId;
        this.refresh();
    }

    async loadMessages(refresh = false, explicitPageToken?: string) {
        if (refresh) {
            this.messages = [];
            this.hasMore = true;
        }

        this.isLoading = true;
        this.error = null;

        try {
            const accountId = authStore.activeAccountId;
            if (!accountId) {
                this.error = 'No active account selected.';
                this.isLoading = false;
                return;
            }

            const response: GmailListResponse = await listMessages(accountId, this.currentLabelId, explicitPageToken, this.maxResults);
            const newMessages = response.messages || [];
            const tokenFromResponse = response.nextPageToken || null;

            if (refresh) {
                this.messages = newMessages.map(m => ({
                    id: m.id,
                    threadId: m.threadId,
                    snippet: m.snippet,
                    subject: m.subject,
                    from: m.from,
                    date: m.date,
                    body: '',
                    read: false,
                }));
                this.nextPageToken = tokenFromResponse;
                this.hasMore = tokenFromResponse !== null;
            } else {
                // Deduplicate within the incoming batch
                const incomingIds = new Set<string>();
                const dedupedIncoming = newMessages.filter(m => {
                    if (incomingIds.has(m.id)) return false;
                    incomingIds.add(m.id);
                    return true;
                });

                // Deduplicate against existing store
                const existingIds = new Set(this.messages.map(m => m.id));
                const unique = dedupedIncoming.filter(m => !existingIds.has(m.id));

                if (unique.length === 0) {
                    if (tokenFromResponse) {
                        console.log("[store] all duplicates but API returned nextPageToken, keeping pagination open");
                    } else {
                        console.log("[store] no new messages, stopping pagination");
                        this.hasMore = false;
                        this.nextPageToken = null;
                    }
                } else {
                    this.messages = [
                        ...this.messages,
                        ...unique.map(m => ({
                            id: m.id,
                            threadId: m.threadId,
                            snippet: m.snippet,
                            subject: m.subject,
                            from: m.from,
                            date: m.date,
                            body: '',
                            read: false,
                        })),
                    ];
                    this.nextPageToken = tokenFromResponse;
                    this.hasMore = tokenFromResponse !== null;
                }
            }
        } catch (e) {
            if (e instanceof Error) {
                this.error = e.message;
            } else if (typeof e === "object" && e !== null && "message" in e) {
                this.error = String(e.message);
            } else {
                this.error = `Failed to fetch messages: ${e}`;
            }
            this.isAuthErrorFlag = isAuthError(e);
            if (!this.isAuthErrorFlag) {
                errorStore.set(this.error);
            }
        } finally {
            this.isLoading = false;
        }
    }

    async loadMessageDetail(messageId: string) {
        this.isDetailsLoading = true;
        this.error = null;

        try {
            const accountId = authStore.activeAccountId;
            if (!accountId) {
                this.error = 'No active account selected.';
                this.isDetailsLoading = false;
                return;
            }

            const detail = await getMessageDetails(accountId, messageId);
            this.selectedMessage = detail;

            const msg = this.messages.find(m => m.id === messageId);
            if (msg) {
                msg.read = true;
                msg.snippet = detail.snippet;
                msg.subject = detail.subject;
                msg.from = detail.from;
                msg.date = detail.date;
            }
        } catch (e) {
            if (e instanceof Error) {
                this.error = e.message;
            } else if (typeof e === "object" && e !== null && "message" in e) {
                this.error = String(e.message);
            } else {
                this.error = `Failed to fetch message details: ${e}`;
            }
            this.isAuthErrorFlag = isAuthError(e);
            if (!this.isAuthErrorFlag) {
                errorStore.set(this.error);
            }
        } finally {
            this.isDetailsLoading = false;
        }
    }

    clearSelectedMessage() {
        this.selectedMessage = null;
    }

    clearError() {
        this.error = null;
        this.isAuthErrorFlag = false;
    }

    async loadMoreMessages() {
        if (!this.nextPageToken || this.isLoading || this.isMoreLoading) {
            // Reset isMoreLoading even on early guard exit to prevent stuck state
            this.isMoreLoading = false;
            return;
        }
        this.isMoreLoading = true;
        try {
            await this.loadMessages(false, this.nextPageToken);
        } finally {
            this.isMoreLoading = false;
        }
    }

    refresh() {
        this.nextPageToken = null;
        this.hasMore = true;
        this.messages = [];
        this.error = null;
        this.isAuthErrorFlag = false;
        this.isMoreLoading = false;
        this.loadLabels();
        this.loadMessages(true);
    }
}

export const emailStore = new EmailStore();
