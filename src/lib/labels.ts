import type { GmailLabel } from "$lib/api";

/** Icon and Japanese display name for Gmail's system labels. */
export const LABEL_ICONS: Record<string, { icon: string; name: string }> = {
    INBOX: { icon: '📥', name: '受信トレイ' },
    SENT: { icon: '📤', name: '送信トレイ' },
    DRAFT: { icon: '📝', name: '下書き' },
    STARRED: { icon: '⭐', name: 'スター付き' },
    IMPORTANT: { icon: '🏆', name: '重要' },
    SPAM: { icon: '⚠️', name: 'スパム' },
    TRASH: { icon: '🗑️', name: 'ゴミ箱' },
    CATEGORY_PERSONAL: { icon: '🏠', name: 'プライベート' },
    CATEGORY_SOCIAL: { icon: '👥', name: 'ソーシャル' },
    CATEGORY_PROMOTIONS: { icon: '🎉', name: 'プロモーション' },
    CATEGORY_UPDATES: { icon: '📢', name: 'アップデート' },
    CATEGORY_FORUMS: { icon: '💬', name: 'フォーラム' },
};

/** Labels Gmail itself never shows in the sidebar. */
export const NEVER_SHOWN_LABELS = new Set(['CHAT', 'YELLOW_STAR', 'UNREAD']);

export function getLabelInfo(labelName: string): { icon: string; name: string } {
    return LABEL_ICONS[labelName] ?? { icon: '📂', name: labelName };
}

/**
 * Labels that are candidates for the sidebar, before per-account
 * hide/reorder preferences are applied.
 */
export function selectableLabels(labels: GmailLabel[]): GmailLabel[] {
    return labels.filter(l => l.labelType === 'system' && !NEVER_SHOWN_LABELS.has(l.name));
}
