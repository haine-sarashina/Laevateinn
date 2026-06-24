/**
 * Gmail API 検索演算子のビルダーユーティリティ。
 *
 * Gmail API の q パラメータに対応する演算子を構造化されたオブジェクトから生成する。
 * サポートされる演算子: from:, to:, subject:, has:attachment, is:starred, after:YYYY/MM/DD, before:YYYY/MM/DD
 *
 * @see https://developers.google.com/gmail/api/guides/search
 */

/** 詳細検索で指定可能なフィールド。空文字列は未指定とみなす。 */
export interface AdvancedSearchParams {
    /** from: 演算子 — 送信者アドレスまたは名前 */
    from?: string;
    /** to: 演算子 — 受信者アドレスまたは名前 */
    to?: string;
    /** subject: 演算子 — 件名に含まれる文字列 */
    subject?: string;
    /** has:attachment — 添付ファイルがあるメールのみ */
    hasAttachment?: boolean;
    /** is:starred — スター付きメールのみ */
    starred?: boolean;
    /** after:YYYY/MM/DD — この日以降のメール */
    afterDate?: string;
    /** before:YYYY/MM/DD — この日以前のメール */
    beforeDate?: string;
    /** 自由テキスト検索（演算子以外） */
    query?: string;
}

/**
 * 日本語の日付文字列 (YYYY/MM/DD, YYYY-MM-DD) を Gmail API が期待する YYYY/MM/DD 形式に正規化する。
 * 形式が不正な場合は空文字列を返す。
 */
export function normalizeDate(dateStr: string): string {
    if (!dateStr) return '';
    // YYYY-MM-DD → YYYY/MM/DD に変換
    const normalized = dateStr.replace(/-/g, '/');
    // YYYY/MM/DD 形式か検証
    if (!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(normalized)) return '';
    const [year, month, day] = normalized.split('/').map(Number);
    if (month < 1 || month > 12 || day < 1 || day > 31) return '';
    return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
}

/**
 * 特殊文字をエスケープしたクォート付き文字列を返す。
 * Gmail API の from: / to: / subject: は値にスペースが含まれる場合、クォートで囲む必要がある。
 */
function quoteIfNeeded(value: string): string {
    if (value.includes(' ') || value.includes('"') || value.includes("'")) {
        const escaped = value.replace(/"/g, '\\"');
        return `"${escaped}"`;
    }
    return value;
}

/**
 * AdvancedSearchParams から Gmail API の q パラメータ文字列を生成する。
 */
export function buildSearchQuery(params: AdvancedSearchParams): string {
    const parts: string[] = [];

    if (params.from?.trim()) {
        parts.push(`from:${quoteIfNeeded(params.from.trim())}`);
    }
    if (params.to?.trim()) {
        parts.push(`to:${quoteIfNeeded(params.to.trim())}`);
    }
    if (params.subject?.trim()) {
        parts.push(`subject:${quoteIfNeeded(params.subject.trim())}`);
    }
    if (params.hasAttachment) {
        parts.push('has:attachment');
    }
    if (params.starred) {
        parts.push('is:starred');
    }
    const afterDate = normalizeDate(params.afterDate || '');
    if (afterDate) {
        parts.push(`after:${afterDate}`);
    }
    const beforeDate = normalizeDate(params.beforeDate || '');
    if (beforeDate) {
        parts.push(`before:${beforeDate}`);
    }

    // 自由テキストは最後に追加
    if (params.query?.trim()) {
        parts.push(params.query.trim());
    }

    return parts.join(' ');
}

/**
 * 現在の検索パラメータに特定の演算子を1つ追加（または削除）するためのヘルパー。
 * Gmail でよく使われる "/" キーショートカットの挙動をシミュレートする —
 * クリックしたメールの送信者を from: に追加する。
 */
export function addFromFilter(currentQuery: string, sender: string): string {
    // 既存の from:XXX を削除
    let query = currentQuery.replace(/from:[\s\S]+?(?=\s|$)/gi, '').trim();
    const part = `from:${quoteIfNeeded(sender)}`;
    if (query) {
        return `${query} ${part}`;
    }
    return part;
}

/**
 * 現在の検索パラメータに特定の演算子を1つ追加（または削除）するためのヘルパー。
 * クリックしたメールの宛先を to: に追加する。
 */
export function addToFilter(currentQuery: string, recipient: string): string {
    let query = currentQuery.replace(/to:[\s\S]+?(?=\s|$)/gi, '').trim();
    const part = `to:${quoteIfNeeded(recipient)}`;
    if (query) {
        return `${query} ${part}`;
    }
    return part;
}

/**
 * 検索クエリから from: 演算子を取り除く。
 */
export function removeFromFilter(query: string): string {
    return query.replace(/from:[\s\S]+?(?=\s|$)/gi, '').replace(/\s+/g, ' ').trim();
}

/**
 * 検索クエリから to: 演算子を取り除く。
 */
export function removeToFilter(query: string): string {
    return query.replace(/to:[\s\S]+?(?=\s|$)/gi, '').replace(/\s+/g, ' ').trim();
}

/**
 * 検索クエリから has:attachment を取り除く / 追加するトグル。
 */
export function toggleAttachmentFilter(query: string): string {
    const normalized = query.replace(/\s+/g, ' ');
    if (normalized.includes('has:attachment')) {
        return normalized.replace(/\s*has:attachment/g, '').trim();
    } else {
        return `${query} has:attachment`.replace(/\s+/g, ' ').trim();
    }
}

/**
 * 検索クエリから is:starred を取り除く / 追加するトグル。
 */
export function toggleStarredFilter(query: string): string {
    const normalized = query.replace(/\s+/g, ' ');
    if (normalized.includes('is:starred')) {
        return normalized.replace(/\s*is:starred/g, '').trim();
    } else {
        return `${query} is:starred`.replace(/\s+/g, ' ').trim();
    }
}
