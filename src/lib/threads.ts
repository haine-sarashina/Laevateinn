import type { EmailMessage } from "./stores/emailStore.svelte";

/**
 * A grouped thread: multiple messages sharing the same threadId.
 */
export interface ThreadSummary {
    /** The Gmail thread identifier. */
    threadId: string;
    /** Messages in this thread, sorted newest-first by date. */
    messages: EmailMessage[];
    /** Number of messages in this thread. */
    count: number;
    /** ISO timestamp of the newest message in this thread. */
    latestDate: string;
    /** Human-friendly date label for the newest message. */
    latestDateLabel: string;
    /** Combined unique sender display names, comma-separated (max 3). */
    combinedSenders: string;
    /** The subject from the newest message in the thread. */
    subject: string;
}

/**
 * Format a sender string to a short display name.
 * Extracts "Name" from "Name <email>" or returns the bare email.
 */
export function formatSender(from: string): string {
    const match = from.match(/^[^<]+/);
    return match ? match[0].trim() : from;
}

/**
 * Format a date string into a human-friendly label (today, yesterday, etc.).
 */
export function formatDateLabel(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (isNaN(diffMs)) {
        return "";
    }

    if (diffDays === 0) {
        return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    } else if (diffDays === 1) {
        return "Yesterday";
    } else if (diffDays < 7) {
        return date.toLocaleDateString("ja-JP", { weekday: "short" });
    } else {
        return date.toLocaleDateString("ja-JP", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        });
    }
}

/**
 * Group an array of EmailMessage by threadId and return ThreadSummary[].
 * Threads are sorted newest-first (by the latest message date inside each thread).
 */
export function groupMessagesByThread(messages: EmailMessage[]): ThreadSummary[] {
    if (!messages.length) return [];

    // Group messages by threadId using a Map to preserve insertion order
    const map = new Map<string, EmailMessage[]>();
    for (const msg of messages) {
        const existing = map.get(msg.threadId);
        if (existing) {
            existing.push(msg);
        } else {
            map.set(msg.threadId, [msg]);
        }
    }

    // Build ThreadSummary for each group
    const threads: ThreadSummary[] = [];
    for (const [threadId, msgs] of map) {
        // Sort messages newest-first by date within the thread
        msgs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        const latestMsg = msgs[0]; // newest first after sort

        // Collect unique sender display names (max 3)
        const uniqueSenders: string[] = [];
        for (const m of msgs) {
            const name = formatSender(m.from);
            if (!uniqueSenders.includes(name)) {
                uniqueSenders.push(name);
                if (uniqueSenders.length >= 3) break;
            }
        }

        threads.push({
            threadId,
            messages: msgs,
            count: msgs.length,
            latestDate: latestMsg.date,
            latestDateLabel: formatDateLabel(latestMsg.date),
            combinedSenders: uniqueSenders.join(", "),
            subject: latestMsg.subject || "",
        });
    }

    // Sort threads newest-first by latest message date
    threads.sort(
        (a, b) => new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime(),
    );

    return threads;
}
