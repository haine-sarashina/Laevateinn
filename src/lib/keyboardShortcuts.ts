import type { EmailStore } from "$lib/stores/emailStore.svelte";
import type { AuthStore } from "$lib/stores/authStore.svelte";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Shortcut {
    key: string;              // single character, case-insensitive match
    ctrl?: boolean;           // Ctrl / Meta required
    shift?: boolean;          // Shift required
    when: () => boolean;      // guard — is this shortcut applicable now?
    action: () => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true when the event target is an input/textarea/select. */
function isInputFocused(event: KeyboardEvent): boolean {
    const tag = (event.target as HTMLElement | null)?.tagName ?? '';
    const role = (event.target as HTMLElement | null)?.getAttribute('role') ?? '';
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || role === 'textbox';
}

/** Keys that are always allowed through even inside an input. */
const passthroughKeys = new Set(['Escape']);

/**
 * Core handler class: owns the shortcut list and dispatches events.
 */
class ShortcutHandler {
    private _shortcuts: Shortcut[] = [];
    private _boundHandler = this._onKeyDown.bind(this);

    add(s: Shortcut): void {
        this._shortcuts.push(s);
    }

    start(): () => void {
        window.addEventListener('keydown', this._boundHandler);
        return () => window.removeEventListener('keydown', this._boundHandler);
    }

    private _onKeyDown(event: KeyboardEvent): void {
        const targetIsInput = isInputFocused(event);

        // If focus is inside an input/textarea, only fire:
        // 1. Passthrough keys (Escape) — regardless of modifier
        // 2. Ctrl/Meta combos (e.g., future Ctrl+Enter send)
        if (targetIsInput) {
            const isPassthrough = passthroughKeys.has(event.key);
            const hasModifier = event.ctrlKey || event.metaKey;
            if (!isPassthrough && !hasModifier) return;
        }

        for (const s of this._shortcuts) {
            const keyMatch = s.key.toLowerCase() === event.key.toLowerCase();
            const ctrlMatch = s.ctrl ? (event.ctrlKey || event.metaKey) : !event.ctrlKey && !event.metaKey;
            // Shift matching: if the shortcut requires shift, it must be pressed.
            // If shift is not required AND the key is a single character (e.g. "j", "k"),
            // block when shift IS pressed — typing "K" should not fire "k" navigation.
            // For multi-key shortcuts ("Enter", "Escape") shift doesn't change the key, so allow.
            let shiftMatch: boolean;
            if (s.shift) {
                shiftMatch = event.shiftKey;
            } else if (s.key.length === 1) {
                shiftMatch = !event.shiftKey;
            } else {
                shiftMatch = true;
            }

            if (keyMatch && ctrlMatch && shiftMatch && s.when()) {
                event.preventDefault();
                void s.action();
                return; // fire only first match
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Public factory — register shortcuts given store references.
// ---------------------------------------------------------------------------

/**
 * Register all Gmail-compatible keyboard shortcuts and start listening.
 * @returns An unsubscribe function that removes the window listener.
 */
export function useShortcuts(
    emailStore: EmailStore,
    authStore: AuthStore,
): () => void {
    const handler = new ShortcutHandler();

    // Helper: is there an active account?
    const hasAccount = (): boolean => !!authStore.activeAccountId;

    // -- Always available (when logged in) --
    handler.add({
        key: 'c',
        when: () => hasAccount() && !emailStore.isComposing,
        action: () => emailStore.startComposing(),
    });

    // Refresh: press 'g' twice within 1s
    let gTimer: ReturnType<typeof setTimeout> | null = null;
    handler.add({
        key: 'g',
        when: () => hasAccount(),
        action: async () => {
            if (gTimer !== null) {
                clearTimeout(gTimer);
                gTimer = null;
                await emailStore.refresh();
            } else {
                gTimer = setTimeout(() => { gTimer = null; }, 1000);
            }
        },
    });

    // -- Compose context (when not composing) --
    handler.add({
        key: 'r',
        when: () => hasAccount() && !emailStore.isComposing && !!emailStore.selectedMessage,
        action: () => emailStore.replyToMessage(),
    });

    handler.add({
        key: 'r',
        shift: true,
        when: () => hasAccount() && !emailStore.isComposing && !!emailStore.selectedMessage,
        action: () => emailStore.replyAllToMessage(),
    });

    handler.add({
        key: 'f',
        when: () => hasAccount() && !emailStore.isComposing && !!emailStore.selectedMessage,
        action: () => emailStore.forwardMessage(),
    });

    // Delete / Trash selected message
    handler.add({
        key: 'd',
        when: () => hasAccount() && !!emailStore.selectedMessage && !emailStore.isComposing,
        action: async () => {
            if (emailStore.selectedMessage) {
                await emailStore.trashMessage(emailStore.selectedMessage.id);
            }
        },
    });

    // Delete key (same as d)
    handler.add({
        key: 'Delete',
        when: () => hasAccount() && !!emailStore.selectedMessage && !emailStore.isComposing,
        action: async () => {
            if (emailStore.selectedMessage) {
                await emailStore.trashMessage(emailStore.selectedMessage.id);
            }
        },
    });

    // Toggle star on selected message / cursor
    handler.add({
        key: 's',
        when: () => hasAccount() && !emailStore.isComposing,
        action: async () => {
            // Prefer the explicitly selected message; fall back to cursor
            let messageId: string | undefined = emailStore.selectedMessage?.id;
            if (!messageId) {
                const idx = emailStore.listCursorIndex;
                if (idx >= 0 && idx < emailStore.messages.length) {
                    messageId = emailStore.messages[idx]?.id;
                }
            }
            if (messageId) {
                await emailStore.toggleStar(messageId);
            }
        },
    });

    // -- List navigation --
    handler.add({
        key: 'j',
        when: () => hasAccount(),
        action: () => emailStore.moveCursorDown(),
    });

    handler.add({
        key: 'k',
        when: () => hasAccount(),
        action: () => emailStore.moveCursorUp(),
    });

    handler.add({
        key: 'ArrowDown',
        when: () => hasAccount(),
        action: () => emailStore.moveCursorDown(),
    });

    handler.add({
        key: 'ArrowUp',
        when: () => hasAccount(),
        action: () => emailStore.moveCursorUp(),
    });

    // Enter — open message at cursor (not when inside an input)
    handler.add({
        key: 'Enter',
        when: () => {
            const el = document.activeElement as HTMLElement | null;
            const tag = el?.tagName ?? '';
            return hasAccount() && tag !== 'INPUT' && tag !== 'TEXTAREA';
        },
        action: () => emailStore.openCursorMessage(),
    });

    // -- Compose context (when composing) --
    // Escape — cancel compose / clear selection
    handler.add({
        key: 'Escape',
        when: () => emailStore.isComposing,
        action: () => emailStore.cancelComposing(),
    });

    return handler.start();
}

// Export for testing
export { ShortcutHandler, type Shortcut };
