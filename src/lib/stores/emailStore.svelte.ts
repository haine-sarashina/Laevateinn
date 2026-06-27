import { listMessages, getMessageDetails, listLabels, modifyLabels, sendDesktopNotification, type SendAttachment } from "$lib/api";
import type { GmailMessageDetail, GmailListResponse, GmailLabel, GmailLabelsResponse, ModifyLabelsResult } from "$lib/api";
import { errorStore } from "./errorStore.svelte";
import { authStore } from "./authStore.svelte";
import { groupMessagesByThread } from "$lib/threads";
import type { ThreadSummary } from "$lib/threads";
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

function toEmailMessage(m: { id: string; threadId: string; snippet: string; subject: string; from: string; date: string }): EmailMessage {
    return {
        id: m.id,
        threadId: m.threadId,
        snippet: m.snippet,
        subject: m.subject,
        from: m.from,
        date: m.date,
        body: '',
        read: false,
        starred: false,
    };
}

/** Compose state saved per account to survive account switches. */
interface SavedComposeState {
    mode: 'new' | 'reply' | 'reply-all' | 'forward';
    to: string;
    cc: string;
    subject: string;
    body: string;
    attachments: SendAttachment[];
}

class EmailStore {
    // LRU-backed message cache with configurable capacity
    private _cache = new LRUMessageCache(DEFAULT_CACHE_CAPACITY);

    /** Reactive array of messages — derived from the LRU cache. */
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
     */
    private _syncMessages(): void {
        this.messages = this._cache.toArray();
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
        } catch (e) {
            console.error('[emailStore] Failed to load labels', e);
        }
    }

    /**
     * Switches to a label. Null means "show all" (default inbox view).
     */
    async selectLabel(labelId: string | null) {
        this.currentLabelId = labelId;
        await this.refresh();
    }

    async loadMessages(refresh = false, explicitPageToken?: string, searchQueryOverride?: string, silent = false) {
        if (refresh) {
            this._cache.clear();
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
                    this._cache.addBatch(emailMsgs);
                    this._syncMessages();
                    this.nextPageToken = tokenFromResponse;
                    this.hasMore = tokenFromResponse !== null;

                    // Desktop notification for genuinely new messages (not on refresh/search/silent)
                    if (!silent && !this.isSearching && authStore.activeAccountId) {
                        const unreadNew = unique.filter(m => !this.#notifiedIds.has(m.id));
                        if (unreadNew.length > 0) {
                            const firstSender = unreadNew[0].from.split('<')[0].trim() || unreadNew[0].from;
                            const title = unreadNew.length === 1
                                ? '1 New Message'
                                : `${unreadNew.length} New Messages`;
                            sendDesktopNotification(title, firstSender);
                            unreadNew.forEach(m => this.#notifiedIds.add(m.id));
                        }
                    }
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

            // Update message in cache
            const cached = this._cache.get(messageId);
            if (cached) {
                cached.read = true;
                cached.snippet = detail.snippet;
                cached.subject = detail.subject;
                cached.from = detail.from;
                cached.date = detail.date;
                // Re-add to update in cache
                this._cache.add(cached);
                this._syncMessages();
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
            await this.loadMessages(false, this.nextPageToken, undefined, true);
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
        // For reply-all, To gets the sender, Cc gets other recipients (simplified: just use sender for now)
        this.composeTo = this.selectedMessage.from;
        this.composeCc = '';  // Would need full header parsing to extract CC recipients
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
        this.composeSubject = 'Fwd: ' + this.selectedMessage.subject;
        this.composeBody = `<p><br></p><blockquote>${this.selectedMessage.body || this.selectedMessage.snippet}</blockquote>`;
        this.isComposing = true;
    }

    cancelComposing() {
        this.isComposing = false;
        this.composeMode = 'new';
        this.composeTo = '';
        this.composeCc = '';
        this.composeSubject = '';
        this.composeBody = '';
        this.composeAttachments = [];
    }

    reset() {
        this.nextPageToken = null;
        this.hasMore = true;
        this._cache.clear();
        this._syncMessages();
        this.selectedMessage = null;
        this.error = null;
        this.isAuthErrorFlag = false;
        this.isLoading = false;
        this.isDetailsLoading = false;
        this.isMoreLoading = false;
        this.expandedThreads = new Set();
        this.currentLabelId = null;
        this.labels = [];
        this.listCursorIndex = -1;
        this.searchQuery = '';
        this.isSearching = false;
        this.isComposing = false;
        this.composeMode = 'new';
        this.composeTo = '';
        this.composeCc = '';
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
     * Uses Gmail API messages.modifyLabels to add/remove LABEL_STARRED.
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
                isStarred ? [] : ["LABEL_STARRED"],     // add if not starred
                isStarred ? ["LABEL_STARRED"] : [],       // remove if starred
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
     * Archives a message by removing LABEL_INBOX.
     */
    async archiveMessage(messageId: string) {
        try {
            const accountId = authStore.activeAccountId;
            if (!accountId) {
                this.error = 'No active account selected.';
                return;
            }

            await modifyLabels(accountId, messageId, [], ["LABEL_INBOX"]);

            // Remove from local cache
            this._cache.delete(messageId);
            this._syncMessages();
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
     * Moves a message to trash by adding LABEL_TRASH and removing LABEL_INBOX.
     */
    async trashMessage(messageId: string) {
        try {
            const accountId = authStore.activeAccountId;
            if (!accountId) {
                this.error = 'No active account selected.';
                return;
            }

            await modifyLabels(accountId, messageId, ["LABEL_TRASH"], ["LABEL_INBOX"]);

            // Remove from local cache
            this._cache.delete(messageId);
            this._syncMessages();
            this.selectedMessage = null;
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
     * Reports a message as spam by adding LABEL_SPAM and removing LABEL_INBOX.
     */
    async spamMessage(messageId: string) {
        try {
            const accountId = authStore.activeAccountId;
            if (!accountId) {
                this.error = 'No active account selected.';
                return;
            }

            await modifyLabels(accountId, messageId, ["LABEL_SPAM"], ["LABEL_INBOX"]);

            // Remove from local cache
            this._cache.delete(messageId);
            this._syncMessages();
            this.selectedMessage = null;
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
