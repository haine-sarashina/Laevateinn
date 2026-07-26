import { listMessages, getMessageDetails, listLabels, modifyLabels, sendDesktopNotification, type SendAttachment } from "$lib/api";
import type { GmailMessageDetail, GmailListResponse, GmailLabel, GmailLabelsResponse, ModifyLabelsResult } from "$lib/api";
import { errorStore } from "./errorStore.svelte";
import { authStore } from "./authStore.svelte";
import { groupMessagesByThread } from "$lib/threads";
import type { ThreadSummary } from "$lib/threads";
import { buildReplyAllRecipients } from "$lib/recipients";
import { buildListRows, sortMessagesForDisplay } from "$lib/messageSections";
import type { ListRow } from "$lib/messageSections";
import { LRUMessageCache } from "./lruCache";
import type { SuggestionItem } from "$lib/searchSuggestions";
import { generateSuggestions } from "$lib/searchSuggestions";

export interface EmailMessage {
    id: string;
    threadId: string;
    snippet: string;
    subject: string;
    from: string;
    date: string;
    body: string;
    read: boolean;
    starred: boolean;
    /** IMPORTANT ラベルが付いているか */
    important: boolean;
}

export interface CacheInfo {
    /** Current number of messages in the cache. */
    size: number;
    /** Maximum allowed messages before eviction triggers. */
    capacity: number;
    /** Total number of messages ever added (including evicted). */
    totalAdded: number;
    /** Total number of messages evicted due to capacity limit. */
    totalEvicted: number;
    /** Number of times the cache was reset. */
    resetCount: number;
}

const DEFAULT_CACHE_CAPACITY = 500;

/** How often the background poller checks the server for new mail. */
export const DEFAULT_POLL_INTERVAL_MS = 60_000;

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

function toEmailMessage(m: { id: string; threadId: string; snippet: string; subject: string; from: string; date: string; unread: boolean; starred: boolean; important?: boolean }): EmailMessage {
    return {
        id: m.id,
        threadId: m.threadId,
        snippet: m.snippet,
        subject: m.subject,
        from: m.from,
        date: m.date,
        body: '',
        read: !m.unread,
        starred: m.starred,
        important: m.important ?? false,
    };
}

/** Compose state saved per account to survive account switches. */
interface SavedComposeState {
    mode: 'new' | 'reply' | 'reply-all' | 'forward';
    to: string;
    cc: string;
    bcc: string;
    subject: string;
    body: string;
    attachments: SendAttachment[];
}

class EmailStore {
    // LRU-backed message cache with configurable capacity
    private _cache = new LRUMessageCache(DEFAULT_CACHE_CAPACITY);

    /** Reactive array of messages — derived from the LRU cache, in display order. */
    messages = $state<EmailMessage[]>([]);

    /**
     * IDs of messages that were unread when they arrived from the server.
     * Drives the 未読/既読 split; deliberately a snapshot rather than live read
     * state, so opening a message does not make it jump between sections.
     */
    #sectionUnreadIds = $state<Set<string>>(new Set());

    /** Flat row list (section headers + messages) rendered by EmailList. */
    listRows = $derived<ListRow[]>(buildListRows(this.messages, this.#sectionUnreadIds));

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

    // Thread grouping
    threads = $derived(groupMessagesByThread(this.messages));

    // Expanded thread tracking (set of threadIds)
    expandedThreads = $state<Set<string>>(new Set());

    // Compose state
    isComposing = $state(false);

    // Keyboard navigation cursor (index into messages array)
    listCursorIndex = $state<number>(-1);
    composeMode = $state<'new' | 'reply' | 'reply-all' | 'forward'>('new');
    composeTo = $state<string>('');
    composeCc = $state<string>('');
    composeBcc = $state<string>('');
    composeSubject = $state<string>('');
    composeBody = $state<string>('');
    composeAttachments = $state<SendAttachment[]>([]);

    // Label support
    labels = $state<GmailLabel[]>([]);
    currentLabelId = $state<string | null>(null);

    // Search support
    searchQuery = $state<string>('');
    isSearching = $state(false);

    // Search history (most recent first, max 10 entries)
    searchHistory = $state<string[]>([]);
    readonly #maxSearchHistory = 10;

    // Search suggestions state
    showSuggestions = $state(false);
    suggestions = $state<SuggestionItem[]>([]);
    suggestionCursorIndex = $state<number>(-1);

    /** Compose state saved per account ID to survive account switches. */
    #composeStatePerAccount = new Map<string, SavedComposeState>();

    /** Message IDs that have already triggered a notification (prevents duplicates). */
    #notifiedIds = new Set<string>();

    /** Register with authStore to save/restore compose state on account switch. */
    #saveComposeBeforeSwitch(): void {
        const accountId = authStore.activeAccountId;
        if (accountId && this.isComposing) {
            this.#composeStatePerAccount.set(accountId, {
                mode: this.composeMode,
                to: this.composeTo,
                cc: this.composeCc,
                bcc: this.composeBcc,
                subject: this.composeSubject,
                body: this.composeBody,
                attachments: [...this.composeAttachments],
            });
        }
    }

    /** Restore compose state for the current account after refresh completes. */
    #restoreComposeAfterSwitch(): void {
        const accountId = authStore.activeAccountId;
        if (accountId) {
            const saved = this.#composeStatePerAccount.get(accountId);
            if (saved) {
                this.composeMode = saved.mode;
                this.composeTo = saved.to;
                this.composeCc = saved.cc;
                this.composeBcc = saved.bcc ?? '';
                this.composeSubject = saved.subject;
                this.composeBody = saved.body;
                this.composeAttachments = [...saved.attachments];
                this.isComposing = true;
            }
        }
    }

    /** Public: Save current compose state for the active account. */
    saveComposeBeforeSwitch(): void {
        this.#saveComposeBeforeSwitch();
    }

    /** Public: Restore compose state for the current account. */
    restoreComposeAfterSwitch(): void {
        this.#restoreComposeAfterSwitch();
    }

    /**
     * Synchronize the reactive messages array from the internal LRU cache.
     * The cache preserves insertion order, which does not match arrival time
     * once pages are appended or entries updated, so ordering is applied here:
     * unread section first, newest first within each section.
     */
    private _syncMessages(): void {
        this.messages = sortMessagesForDisplay(this._cache.toArray(), this.#sectionUnreadIds);
    }

    /** Records which of the incoming messages belong to the 未読 section. */
    #markUnreadSection(incoming: Array<{ id: string; unread: boolean }>): void {
        const next = new Set(this.#sectionUnreadIds);
        let changed = false;
        for (const m of incoming) {
            if (m.unread && !next.has(m.id)) {
                next.add(m.id);
                changed = true;
            }
        }
        if (changed) this.#sectionUnreadIds = next;
    }

    /** Read-only view of the 未読 section membership (used by tests and the UI). */
    get unreadSectionIds(): ReadonlySet<string> {
        return this.#sectionUnreadIds;
    }

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

            // Default to the inbox so the sidebar always shows which label is
            // active — an unset label rendered as "nothing selected".
            if (this.currentLabelId === null && this.labels.some(l => l.id === 'INBOX')) {
                this.currentLabelId = 'INBOX';
            }
        } catch (e) {
            console.error('[emailStore] Failed to load labels', e);
        }
    }

    /**
     * Switches to a label. Null means "show all" (default inbox view).
     */
    async selectLabel(labelId: string | null) {
        this.reset();
        this.currentLabelId = labelId;
        await this.loadLabels();
        await this.loadMessages(true);
    }

    async loadMessages(refresh = false, explicitPageToken?: string, searchQueryOverride?: string) {
        if (refresh) {
            this._cache.clear();
            this.#sectionUnreadIds = new Set();
            this._syncMessages();
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

            const queryToUse = searchQueryOverride ?? (this.isSearching ? this.searchQuery : undefined);
            const response: GmailListResponse = await listMessages(accountId, this.currentLabelId ?? undefined, explicitPageToken, this.maxResults, queryToUse);
            const newMessages = response.messages || [];
            const tokenFromResponse = response.nextPageToken || null;

            if (refresh) {
                // Batch add all messages from fresh load
                const emailMsgs = newMessages.map(m => toEmailMessage(m));
                this.#markUnreadSection(newMessages);
                this._cache.addBatch(emailMsgs);
                this._syncMessages();
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

                // Deduplicate against existing cache
                const unique = dedupedIncoming.filter(m => !this._cache.has(m.id));

                if (unique.length === 0) {
                    if (tokenFromResponse) {
                        console.log("[store] all duplicates but API returned nextPageToken, keeping pagination open");
                    } else {
                        console.log("[store] no new messages, stopping pagination");
                        this.hasMore = false;
                        this.nextPageToken = null;
                    }
                } else {
                    const emailMsgs = unique.map(m => toEmailMessage(m));
                    this.#markUnreadSection(unique);
                    this._cache.addBatch(emailMsgs);
                    this._syncMessages();
                    this.nextPageToken = tokenFromResponse;
                    this.hasMore = tokenFromResponse !== null;

                    // No notification here: this path appends *older* pages
                    // (Load More). Genuinely new mail is detected by
                    // checkForNewMessages() below.
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

    /**
     * Polls the server for mail that arrived after the current first page.
     * Only the first page is fetched, so pagination state is left untouched;
     * anything not already cached is merged in and announced once.
     */
    async checkForNewMessages(): Promise<number> {
        const accountId = authStore.activeAccountId;
        if (!accountId) return 0;
        // Skip while another fetch is in flight or while showing search results,
        // where "new mail" is not what the user is looking at.
        if (this.isLoading || this.isMoreLoading || this.isSearching) return 0;

        try {
            const response: GmailListResponse = await listMessages(
                accountId,
                this.currentLabelId ?? undefined,
                undefined,
                this.maxResults,
                undefined,
            );
            const incoming = response.messages || [];
            const fresh = incoming.filter(m => !this._cache.has(m.id));
            if (fresh.length === 0) return 0;

            this.#markUnreadSection(fresh);
            this._cache.addBatch(fresh.map(m => toEmailMessage(m)));
            this._syncMessages();
            this.#notifyNewArrivals(fresh);
            return fresh.length;
        } catch (e) {
            // A failed poll must never disrupt the UI — surface it in the log only.
            console.error('[emailStore] new mail check failed', e);
            return 0;
        }
    }

    /** Sends one desktop notification for messages not yet announced. */
    #notifyNewArrivals(messages: Array<{ id: string; from: string }>): void {
        const unannounced = messages.filter(m => !this.#notifiedIds.has(m.id));
        if (unannounced.length === 0) return;
        const firstSender = unannounced[0].from.split('<')[0].trim() || unannounced[0].from;
        const title = unannounced.length === 1
            ? '新着メール 1件'
            : `新着メール ${unannounced.length}件`;
        sendDesktopNotification(title, firstSender);
        unannounced.forEach(m => this.#notifiedIds.add(m.id));
    }

    /** Handle of the running poll timer, or null when polling is stopped. */
    #pollTimer: ReturnType<typeof setInterval> | null = null;

    /** Interval used by startPolling() when no explicit value is given. */
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;

    /**
     * Starts periodic new-mail checks. Idempotent: an existing timer is
     * replaced, so switching accounts or settings cannot stack timers.
     */
    startPolling(intervalMs: number = this.pollIntervalMs): void {
        this.stopPolling();
        if (intervalMs <= 0) return;
        this.pollIntervalMs = intervalMs;
        this.#pollTimer = setInterval(() => {
            void this.checkForNewMessages();
        }, intervalMs);
    }

    /** Stops periodic new-mail checks. Safe to call when not polling. */
    stopPolling(): void {
        if (this.#pollTimer !== null) {
            clearInterval(this.#pollTimer);
            this.#pollTimer = null;
        }
    }

    /** True while the background poller is running (used by tests). */
    get isPolling(): boolean {
        return this.#pollTimer !== null;
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

            // Update message in cache
            const cached = this._cache.get(messageId);
            if (cached) {
                const wasUnread = !cached.read;
                cached.read = true;
                cached.snippet = detail.snippet;
                cached.subject = detail.subject;
                cached.from = detail.from;
                cached.date = detail.date;
                // Re-add to update in cache
                this._cache.add(cached);
                this._syncMessages();

                // Persist read state to Gmail (remove UNREAD label)
                if (wasUnread) {
                    modifyLabels(accountId, messageId, [], ["UNREAD"]).catch(() => {
                        // Revert optimistic update if the server call fails
                        cached.read = false;
                        this._cache.add(cached);
                        this._syncMessages();
                    });
                }
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

    startComposing() {
        if (!authStore.activeAccountId) {
            return;
        }
        this.composeMode = 'new';
        this.composeTo = '';
        this.composeCc = '';
        this.composeBcc = '';
        this.composeSubject = '';
        this.composeBody = '';
        this.composeAttachments = [];
        this.isComposing = true;
    }

    replyToMessage() {
        if (!this.selectedMessage) return;
        this.composeMode = 'reply';
        this.composeTo = this.selectedMessage.from;
        this.composeCc = '';
        this.composeBcc = '';
        this.composeSubject = this.selectedMessage.subject.startsWith('Re: ')
            ? this.selectedMessage.subject
            : 'Re: ' + this.selectedMessage.subject;
        // Quote original body
        this.composeBody = `<p><br></p><blockquote>${this.selectedMessage.body || this.selectedMessage.snippet}</blockquote>`;
        this.isComposing = true;
    }

    replyAllToMessage() {
        if (!this.selectedMessage) return;
        this.composeMode = 'reply-all';
        // To = 元の From + To、Cc = 元の Cc。いずれも自分自身と重複を除く
        const { to, cc } = buildReplyAllRecipients(this.selectedMessage, authStore.activeAccountId);
        this.composeTo = to;
        this.composeCc = cc;
        this.composeBcc = '';
        this.composeSubject = this.selectedMessage.subject.startsWith('Re: ')
            ? this.selectedMessage.subject
            : 'Re: ' + this.selectedMessage.subject;
        this.composeBody = `<p><br></p><blockquote>${this.selectedMessage.body || this.selectedMessage.snippet}</blockquote>`;
        this.isComposing = true;
    }

    forwardMessage() {
        if (!this.selectedMessage) return;
        this.composeMode = 'forward';
        this.composeTo = '';
        this.composeCc = '';
        this.composeBcc = '';
        this.composeSubject = 'Fwd: ' + this.selectedMessage.subject;
        this.composeBody = `<p><br></p><blockquote>${this.selectedMessage.body || this.selectedMessage.snippet}</blockquote>`;
        this.isComposing = true;
    }

    cancelComposing() {
        this.isComposing = false;
        this.composeMode = 'new';
        this.composeTo = '';
        this.composeCc = '';
        this.composeBcc = '';
        this.composeSubject = '';
        this.composeBody = '';
        this.composeAttachments = [];
    }

    reset() {
        this.nextPageToken = null;
        this.hasMore = true;
        this._cache.clear();
        this.#sectionUnreadIds = new Set();
        this._syncMessages();
        this.selectedMessage = null;
        this.error = null;
        this.isAuthErrorFlag = false;
        this.isLoading = false;
        this.isDetailsLoading = false;
        this.isMoreLoading = false;
        this.expandedThreads = new Set();
        this.selectedIds = new Set();
        this.isBulkRunning = false;
        this.currentLabelId = null;
        this.labels = [];
        this.listCursorIndex = -1;
        this.searchQuery = '';
        this.isSearching = false;
        this.isComposing = false;
        this.composeMode = 'new';
        this.composeTo = '';
        this.composeCc = '';
        this.composeBcc = '';
        this.composeSubject = '';
        this.composeBody = '';
        this.composeAttachments = [];
        this.#notifiedIds.clear();
    }

    async refresh() {
        this.reset();
        await this.loadLabels();
        await this.loadMessages(true);
    }

    /**
     * Toggles whether a thread is expanded in the UI.
     */
    toggleThread(threadId: string): void {
        const next = new Set(this.expandedThreads);
        if (next.has(threadId)) {
            next.delete(threadId);
        } else {
            next.add(threadId);
        }
        this.expandedThreads = next;
    }

    /**
     * Expands all threads in the list.
     */
    expandAllThreads(): void {
        this.expandedThreads = new Set(this.threads.map(t => t.threadId));
    }

    /**
     * Collapse a single thread.
     */
    collapseThread(threadId: string): void {
        const next = new Set(this.expandedThreads);
        next.delete(threadId);
        this.expandedThreads = next;
    }

    /**
     * Checks if a thread is currently expanded.
     */
    isThreadExpanded(threadId: string): boolean {
        return this.expandedThreads.has(threadId);
    }

    /**
     * Returns cache statistics for monitoring memory usage.
     */
    getCacheInfo(): CacheInfo {
        return this._cache.stats();
    }

    /**
     * Move the keyboard navigation cursor down one position in the message list.
     * Clamped to the bounds of the messages array.
     */
    moveCursorDown(): void {
        const max = this.messages.length - 1;
        if (max < 0) {
            this.listCursorIndex = -1;
            return;
        }
        this.listCursorIndex = Math.min(this.listCursorIndex + 1, max);
    }

    /**
     * Move the keyboard navigation cursor up one position in the message list.
     * Clamped to zero (top of list).
     */
    moveCursorUp(): void {
        if (this.messages.length === 0) {
            this.listCursorIndex = -1;
            return;
        }
        this.listCursorIndex = Math.max(this.listCursorIndex - 1, 0);
    }

    /**
     * Open the message at the cursor position via loadMessageDetail.
     * No-op if the cursor is invalid.
     */
    openCursorMessage(): void {
        if (this.listCursorIndex < 0 || this.listCursorIndex >= this.messages.length) return;
        const msg = this.messages[this.listCursorIndex];
        if (msg) this.loadMessageDetail(msg.id);
    }

    /**
     * Reset the cursor when the message list is cleared (e.g., refresh).
     */
    resetCursor(): void {
        this.listCursorIndex = -1;
    }

    /**
     * Directly look up a message by ID (O(1) via internal Map).
     */
    getMessage(id: string): EmailMessage | undefined {
        return this._cache.get(id);
    }

    /**
     * Toggles the star status of a message.
     * Uses Gmail API messages.modifyLabels to add/remove STARRED.
     */
    async toggleStar(messageId: string) {
        try {
            const accountId = authStore.activeAccountId;
            if (!accountId) {
                this.error = 'No active account selected.';
                return;
            }

            // Check current starred state to decide add or remove
            const cached = this._cache.get(messageId);
            const isStarred = cached?.starred ?? false;

            const result: ModifyLabelsResult = await modifyLabels(
                accountId,
                messageId,
                isStarred ? [] : ["STARRED"],     // add if not starred
                isStarred ? ["STARRED"] : [],       // remove if starred
            );

            if (result.success) {
                // Update local state
                const msg = this._cache.get(messageId);
                if (msg) {
                    msg.starred = !isStarred;
                    this._cache.add(msg); // re-add to update access order
                    this._syncMessages();
                }
            }
        } catch (e) {
            if (e instanceof Error) {
                this.error = e.message;
            } else if (typeof e === "object" && e !== null && "message" in e) {
                this.error = String(e.message);
            } else {
                this.error = `Failed to toggle star: ${e}`;
            }
            this.isAuthErrorFlag = isAuthError(e);
            if (!this.isAuthErrorFlag) {
                errorStore.set(this.error);
            }
        }
    }

    /**
     * Toggles the IMPORTANT marker (Gmail's manual importance override).
     */
    async toggleImportant(messageId: string) {
        try {
            const accountId = authStore.activeAccountId;
            if (!accountId) {
                this.error = 'No active account selected.';
                return;
            }

            const cached = this._cache.get(messageId);
            const isImportant = cached?.important ?? false;

            const result: ModifyLabelsResult = await modifyLabels(
                accountId,
                messageId,
                isImportant ? [] : ["IMPORTANT"],
                isImportant ? ["IMPORTANT"] : [],
            );

            if (result.success && cached) {
                cached.important = !isImportant;
                this._cache.add(cached);
                this._syncMessages();
            }
        } catch (e) {
            this.#reportError(e, 'Failed to toggle importance');
        }
    }

    /**
     * Returns the message that should take the selection when `messageId`
     * leaves the list: the one after it, or the one before it at the end.
     * Must be called *before* the message is removed from the cache.
     */
    #neighbourOf(messageId: string): EmailMessage | null {
        const idx = this.messages.findIndex(m => m.id === messageId);
        if (idx < 0) return null;
        return this.messages[idx + 1] ?? this.messages[idx - 1] ?? null;
    }

    /**
     * Drops a message from the list and moves the selection on to its
     * neighbour, so archiving/deleting walks through the inbox instead of
     * dumping the user back on an empty pane.
     */
    async #removeAndAdvance(messageId: string, neighbour: EmailMessage | null) {
        const wasSelected = this.selectedMessage?.id === messageId;
        this._cache.delete(messageId);
        if (this.#sectionUnreadIds.has(messageId)) {
            const next = new Set(this.#sectionUnreadIds);
            next.delete(messageId);
            this.#sectionUnreadIds = next;
        }
        this._syncMessages();

        if (!wasSelected) {
            // Keep the cursor pointing at the same message it was on
            this.listCursorIndex = this.selectedMessage
                ? this.messages.findIndex(m => m.id === this.selectedMessage!.id)
                : Math.min(this.listCursorIndex, this.messages.length - 1);
            return;
        }

        if (neighbour && this._cache.has(neighbour.id)) {
            this.listCursorIndex = this.messages.findIndex(m => m.id === neighbour.id);
            await this.loadMessageDetail(neighbour.id);
        } else {
            this.selectedMessage = null;
            this.listCursorIndex = -1;
        }
    }

    /** Shared error handling for the label-modifying actions. */
    #reportError(e: unknown, fallback: string) {
        if (e instanceof Error) {
            this.error = e.message;
        } else if (typeof e === "object" && e !== null && "message" in e) {
            this.error = String((e as { message: unknown }).message);
        } else {
            this.error = `${fallback}: ${e}`;
        }
        this.isAuthErrorFlag = isAuthError(e);
        if (!this.isAuthErrorFlag) {
            errorStore.set(this.error);
        }
    }

    /**
     * Archives a message by removing INBOX.
     */
    async archiveMessage(messageId: string) {
        try {
            const accountId = authStore.activeAccountId;
            if (!accountId) {
                this.error = 'No active account selected.';
                return;
            }

            const neighbour = this.#neighbourOf(messageId);
            await modifyLabels(accountId, messageId, [], ["INBOX"]);
            await this.#removeAndAdvance(messageId, neighbour);
        } catch (e) {
            if (e instanceof Error) {
                this.error = e.message;
            } else if (typeof e === "object" && e !== null && "message" in e) {
                this.error = String(e.message);
            } else {
                this.error = `Failed to archive message: ${e}`;
            }
            this.isAuthErrorFlag = isAuthError(e);
            if (!this.isAuthErrorFlag) {
                errorStore.set(this.error);
            }
        }
    }

    /**
     * Moves a message to trash by adding TRASH and removing INBOX.
     */
    async trashMessage(messageId: string) {
        try {
            const accountId = authStore.activeAccountId;
            if (!accountId) {
                this.error = 'No active account selected.';
                return;
            }

            const neighbour = this.#neighbourOf(messageId);
            await modifyLabels(accountId, messageId, ["TRASH"], ["INBOX"]);
            await this.#removeAndAdvance(messageId, neighbour);
        } catch (e) {
            if (e instanceof Error) {
                this.error = e.message;
            } else if (typeof e === "object" && e !== null && "message" in e) {
                this.error = String(e.message);
            } else {
                this.error = `Failed to trash message: ${e}`;
            }
            this.isAuthErrorFlag = isAuthError(e);
            if (!this.isAuthErrorFlag) {
                errorStore.set(this.error);
            }
        }
    }

    /**
     * Reports a message as spam by adding SPAM and removing INBOX.
     */
    async spamMessage(messageId: string) {
        try {
            const accountId = authStore.activeAccountId;
            if (!accountId) {
                this.error = 'No active account selected.';
                return;
            }

            const neighbour = this.#neighbourOf(messageId);
            await modifyLabels(accountId, messageId, ["SPAM"], ["INBOX"]);
            await this.#removeAndAdvance(messageId, neighbour);
        } catch (e) {
            if (e instanceof Error) {
                this.error = e.message;
            } else if (typeof e === "object" && e !== null && "message" in e) {
                this.error = String(e.message);
            } else {
                this.error = `Failed to report as spam: ${e}`;
            }
            this.isAuthErrorFlag = isAuthError(e);
            if (!this.isAuthErrorFlag) {
                errorStore.set(this.error);
            }
        }
    }

    // ── Bulk selection ─────────────────────────────────────────

    /** IDs ticked with the list checkboxes. */
    selectedIds = $state<Set<string>>(new Set());

    /** True while a bulk action is in flight (disables the action bar). */
    isBulkRunning = $state(false);

    get hasSelection(): boolean {
        return this.selectedIds.size > 0;
    }

    isSelected(id: string): boolean {
        return this.selectedIds.has(id);
    }

    toggleSelected(id: string): void {
        const next = new Set(this.selectedIds);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        this.selectedIds = next;
    }

    /** Ticks every message currently in the list, or clears if all are ticked. */
    toggleSelectAll(): void {
        if (this.selectedIds.size === this.messages.length && this.messages.length > 0) {
            this.selectedIds = new Set();
        } else {
            this.selectedIds = new Set(this.messages.map(m => m.id));
        }
    }

    clearSelection(): void {
        this.selectedIds = new Set();
    }

    /**
     * Applies a label change to every selected message.
     *
     * Requests run in parallel — the selection is at most one page — and any
     * message the server accepted is dropped from the list when `remove` is set.
     * Failures are reported once rather than per message.
     */
    async #bulkModify(add: string[], remove: string[], dropFromList: boolean): Promise<number> {
        const accountId = authStore.activeAccountId;
        if (!accountId || this.selectedIds.size === 0) return 0;

        const ids = [...this.selectedIds];
        this.isBulkRunning = true;
        try {
            const results = await Promise.allSettled(
                ids.map(id => modifyLabels(accountId, id, add, remove)),
            );

            let succeeded = 0;
            results.forEach((result, i) => {
                if (result.status !== 'fulfilled') return;
                succeeded++;
                const id = ids[i];
                if (dropFromList) {
                    this._cache.delete(id);
                } else {
                    const cached = this._cache.get(id);
                    if (cached) {
                        if (add.includes('STARRED')) cached.starred = true;
                        if (remove.includes('STARRED')) cached.starred = false;
                        if (remove.includes('UNREAD')) cached.read = true;
                        if (add.includes('UNREAD')) cached.read = false;
                        this._cache.add(cached);
                    }
                }
            });

            if (dropFromList) {
                const removed = new Set(ids);
                const nextSection = new Set(
                    [...this.#sectionUnreadIds].filter(id => !removed.has(id)),
                );
                this.#sectionUnreadIds = nextSection;
                if (this.selectedMessage && removed.has(this.selectedMessage.id)) {
                    this.selectedMessage = null;
                    this.listCursorIndex = -1;
                }
            }
            this._syncMessages();

            const failed = results.length - succeeded;
            if (failed > 0) {
                this.#reportError(
                    new Error(`${failed}件の操作に失敗しました`),
                    'Bulk action failed',
                );
            }
            this.clearSelection();
            return succeeded;
        } finally {
            this.isBulkRunning = false;
        }
    }

    /** Archives every selected message. */
    bulkArchive(): Promise<number> {
        return this.#bulkModify([], ["INBOX"], true);
    }

    /** Moves every selected message to the trash. */
    bulkTrash(): Promise<number> {
        return this.#bulkModify(["TRASH"], ["INBOX"], true);
    }

    /** Marks every selected message as read. */
    bulkMarkRead(): Promise<number> {
        return this.#bulkModify([], ["UNREAD"], false);
    }

    /** Marks every selected message as unread. */
    bulkMarkUnread(): Promise<number> {
        return this.#bulkModify(["UNREAD"], [], false);
    }

    /** Stars every selected message. */
    bulkStar(): Promise<number> {
        return this.#bulkModify(["STARRED"], [], false);
    }

    /** Removes the star from every selected message. */
    bulkUnstar(): Promise<number> {
        return this.#bulkModify([], ["STARRED"], false);
    }

    /**
     * Search messages using the Gmail API query language.
     * Resets pagination and cache before fetching results.
     */
    async searchMessages(query: string): Promise<void> {
        if (!query.trim()) {
            // Empty query — clear search instead
            await this.clearSearch();
            return;
        }
        const trimmed = query.trim();
        this.searchQuery = trimmed;
        this.isSearching = true;
        // Add to history (deduplicate, most recent first)
        this.#addToHistory(trimmed);
        // Reset pagination so search starts from the first page
        this.nextPageToken = null;
        this.hasMore = true;
        await this.loadMessages(true);
    }

    /**
     * Clear the active search and restore the normal inbox view.
     */
    async clearSearch(): Promise<void> {
        this.searchQuery = '';
        this.isSearching = false;
        this.nextPageToken = null;
        this.hasMore = true;
        this._cache.clear();
        this._syncMessages();
        await this.loadMessages(true);
    }

    /**
     * Focus the search bar input element by ID.
     * Called from the keyboard shortcut handler.
     */
    focusSearchBar(): void {
        const el = document.getElementById('email-search-input');
        if (el) {
            el.focus();
            (el as HTMLInputElement).select();
        }
    }

    /** Internal: add a query to search history, deduplicated, capped at #maxSearchHistory. */
    #addToHistory(query: string): void {
        const idx = this.searchHistory.indexOf(query);
        if (idx > -1) {
            // Remove duplicate so it can be re-added at the front
            this.searchHistory.splice(idx, 1);
        }
        this.searchHistory.unshift(query);
        if (this.searchHistory.length > this.#maxSearchHistory) {
            this.searchHistory = this.searchHistory.slice(0, this.#maxSearchHistory);
        }
    }

    /** Public: manually add a query to search history. */
    addToSearchHistory(query: string): void {
        this.#addToHistory(query.trim());
    }

    /** Public: clear all search history entries. */
    clearSearchHistory(): void {
        this.searchHistory = [];
    }

    /** Public: remove a single entry from search history by index. */
    removeSearchHistoryEntry(index: number): void {
        if (index >= 0 && index < this.searchHistory.length) {
            this.searchHistory.splice(index, 1);
        }
    }

    /**
     * Update search suggestions based on current input.
     * Uses generateSuggestions from searchSuggestions.ts to produce history/operator/sender suggestions.
     */
    updateSuggestions(input: string): void {
        const trimmed = input.trim();
        if (!trimmed) {
            this.showSuggestions = false;
            this.suggestions = [];
            this.suggestionCursorIndex = -1;
            return;
        }

        const msgList = this.messages.map(m => ({ from: m.from }));
        const results = generateSuggestions(trimmed, this.searchHistory, msgList);

        this.suggestions = results;
        this.showSuggestions = results.length > 0;
        this.suggestionCursorIndex = -1;
    }

    /**
     * Clear suggestions and hide the dropdown.
     */
    clearSuggestions(): void {
        this.showSuggestions = false;
        this.suggestions = [];
        this.suggestionCursorIndex = -1;
    }

    /**
     * Move the suggestion cursor up or down within the suggestion list.
     * @param direction - Positive for down, negative for up.
     */
    moveSuggestionCursor(direction: number): void {
        if (!this.showSuggestions || this.suggestions.length === 0) return;

        const max = this.suggestions.length - 1;
        if (this.suggestionCursorIndex < 0) {
            // First move: start at top (down) or bottom (up)
            this.suggestionCursorIndex = direction > 0 ? 0 : max;
        } else {
            this.suggestionCursorIndex = Math.max(0, Math.min(max, this.suggestionCursorIndex + direction));
        }
    }

    /**
     * Get the currently selected suggestion text (for cursor navigation).
     */
    getSelectedSuggestion(): string | null {
        if (this.suggestionCursorIndex < 0 || this.suggestionCursorIndex >= this.suggestions.length) {
            return null;
        }
        const item = this.suggestions[this.suggestionCursorIndex];
        // For operator suggestions, extract the operator prefix (without description)
        if (item.kind === 'operator' && item.operator) {
            return item.operator;
        }
        return item.text || null;
    }

    /**
     * Accept the currently selected suggestion or the first one.
     */
    acceptSuggestion(): string | null {
        if (this.suggestionCursorIndex >= 0 && this.suggestionCursorIndex < this.suggestions.length) {
            return this.getSelectedSuggestion();
        }
        if (this.suggestions.length > 0) {
            const item = this.suggestions[0];
            if (item.kind === 'operator' && item.operator) {
                return item.operator;
            }
            return item.text || null;
        }
        return null;
    }

    /**
     * Select a suggestion by index and apply it to the search query.
     */
    selectSuggestion(index: number): void {
        if (index < 0 || index >= this.suggestions.length) return;
        const item = this.suggestions[index];
        if (!item) return;

        // For operator suggestions, set the operator prefix as the query
        if (item.kind === 'operator' && item.operator) {
            this.searchQuery = item.operator;
        } else {
            this.searchQuery = item.text;
        }

        this.clearSuggestions();
    }
}

export const emailStore = new EmailStore();
