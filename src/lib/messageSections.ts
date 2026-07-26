import type { EmailMessage } from "$lib/stores/emailStore.svelte";

/**
 * A row rendered in the email list. The list is a flat sequence of rows so it can
 * be virtualized: section headers and messages share one index space.
 */
export type ListRow =
    | { kind: 'header'; id: string; label: string; count: number }
    | { kind: 'message'; id: string; message: EmailMessage; messageIndex: number };

/** Height in pixels of a section header row (must match the CSS in EmailList.svelte). */
export const HEADER_ROW_HEIGHT = 30;
/** Height in pixels of a message row (must match the CSS in EmailList.svelte). */
export const MESSAGE_ROW_HEIGHT = 76;

/**
 * Parses an email date header into a timestamp.
 * Unparseable dates sort to the bottom (treated as epoch 0).
 */
export function messageTimestamp(dateStr: string): number {
    const t = new Date(dateStr).getTime();
    return Number.isNaN(t) ? 0 : t;
}

/**
 * Sorts messages for display: unread section first, then read section,
 * each ordered newest-first.
 *
 * `unreadSectionIds` is a snapshot of the messages that were unread when they
 * arrived, not their live read state — so opening a message does not make it
 * jump between sections while the user is reading the list (Gmail behaviour).
 * Pass an empty set to get a pure newest-first ordering.
 */
export function sortMessagesForDisplay(
    messages: EmailMessage[],
    unreadSectionIds: ReadonlySet<string>,
): EmailMessage[] {
    return [...messages].sort((a, b) => {
        const sectionA = unreadSectionIds.has(a.id) ? 0 : 1;
        const sectionB = unreadSectionIds.has(b.id) ? 0 : 1;
        if (sectionA !== sectionB) return sectionA - sectionB;
        return messageTimestamp(b.date) - messageTimestamp(a.date);
    });
}

/**
 * Builds the flat row list from already-sorted messages, inserting 未読 / 既読
 * section headers. Headers are only emitted when both sections have entries —
 * a single header over the whole list carries no information.
 */
export function buildListRows(
    messages: EmailMessage[],
    unreadSectionIds: ReadonlySet<string>,
): ListRow[] {
    const unreadCount = messages.reduce(
        (n, m) => (unreadSectionIds.has(m.id) ? n + 1 : n),
        0,
    );
    const readCount = messages.length - unreadCount;
    const withHeaders = unreadCount > 0 && readCount > 0;

    const rows: ListRow[] = [];
    let emittedUnreadHeader = false;
    let emittedReadHeader = false;

    messages.forEach((message, messageIndex) => {
        const isUnreadSection = unreadSectionIds.has(message.id);
        if (withHeaders) {
            if (isUnreadSection && !emittedUnreadHeader) {
                rows.push({ kind: 'header', id: 'section-unread', label: '未読', count: unreadCount });
                emittedUnreadHeader = true;
            } else if (!isUnreadSection && !emittedReadHeader) {
                rows.push({ kind: 'header', id: 'section-read', label: '既読', count: readCount });
                emittedReadHeader = true;
            }
        }
        rows.push({ kind: 'message', id: message.id, message, messageIndex });
    });

    return rows;
}

/** Pixel height of each row, used to drive the variable-height virtual scroller. */
export function rowHeights(rows: ListRow[]): number[] {
    return rows.map(r => (r.kind === 'header' ? HEADER_ROW_HEIGHT : MESSAGE_ROW_HEIGHT));
}

/** Index of the row rendering the message at `messageIndex`, or -1. */
export function rowIndexForMessage(rows: ListRow[], messageIndex: number): number {
    return rows.findIndex(r => r.kind === 'message' && r.messageIndex === messageIndex);
}
