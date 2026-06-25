/**
 * 検索サジェスト・自動補完のロジック。
 *
 * Gmail 互換の演算子サポートを含む検索入力に対するサジェストを生成する純粋関数群。
 * サジェストの種類:
 *   1. 検索履歴からのフィルタリング (fuzzy matching, case-insensitive)
 *   2. Gmail 演算子の自動補完 (from:, to:, subject:, has:, is:, after:, before:)
 *   3. 差出人サジェスト (キャッシュされたメールから送信者名を抽出、重複排除)
 */

/** サジェスト1件の型。kind で種別を区別する。 */
export interface SuggestionItem {
    /** 表示テキスト */
    text: string;
    /** サジェストの種別 */
    kind: 'history' | 'operator' | 'sender';
    /** operator 種別の 경우、補完後に挿入する値 */
    operator?: string;
    /** 説明 (演算子サジェスト用) */
    description?: string;
}

/** Gmail でサポートする検索演算子の定義。 */
const GMAIL_OPERATORS: ReadonlyArray<{ prefix: string; label: string; description: string }> = Object.freeze([
    { prefix: 'from:', label: 'from:', description: '送信者で絞り込み' },
    { prefix: 'to:', label: 'to:', description: '受信者で絞り込み' },
    { prefix: 'subject:', label: 'subject:', description: '件名で絞り込み' },
    { prefix: 'has:attachment', label: 'has:attachment', description: '添付ファイルあり' },
    { prefix: 'is:starred', label: 'is:starred', description: 'スター付きメール' },
    { prefix: 'after:', label: 'after:', description: 'この日以降のメール (YYYY/MM/DD)' },
    { prefix: 'before:', label: 'before:', description: 'この日以前のメール (YYYY/MM/DD)' },
]);

/**
 * 検索履歴から入力テキストでフィルタリングしたサジェストを返す。
 * fuzzy matching: 大文字小文字を区別せず、入力テキストの各文字が順序よく含まれていれば一致。
 */
export function filterHistoryEntries(
    history: string[],
    input: string,
    maxResults = 5,
): SuggestionItem[] {
    if (!input.trim()) return [];

    const lowerInput = input.toLowerCase();
    const results: SuggestionItem[] = [];

    for (const entry of history) {
        // Fuzzy match: 入力の各文字が順序よく含まれているか
        let inputIdx = 0;
        for (let i = 0; i < entry.length && inputIdx < lowerInput.length; i++) {
            if (entry[i].toLowerCase() === lowerInput[inputIdx]) {
                inputIdx++;
            }
        }

        if (inputIdx === lowerInput.length) {
            results.push({ text: entry, kind: 'history' });
        }

        if (results.length >= maxResults) break;
    }

    return results;
}

/**
 * 入力テキストに一致する Gmail 演算子のサジェストを返す。
 * 入力が `fro` → `from:` がマッチ、`is:` → `is:starred` がマッチ、など。
 */
export function operatorSuggestions(
    input: string,
    maxResults = 5,
): SuggestionItem[] {
    if (!input.trim()) return [];

    const lowerInput = input.toLowerCase();
    const results: SuggestionItem[] = [];

    for (const op of GMAIL_OPERATORS) {
        if (op.prefix.startsWith(lowerInput) || op.label.startsWith(lowerInput)) {
            results.push({
                text: `${op.label} — ${op.description}`,
                kind: 'operator',
                operator: op.prefix,
                description: op.description,
            });
        }

        if (results.length >= maxResults) break;
    }

    return results;
}

/**
 * 送信者文字列からメールアドレスを抽出する。
 * "Name <email>" → "email", "email" → "email"
 */
function extractEmail(from: string): string {
    const match = from.match(/<([^>]+)>/);
    if (match) return match[1].toLowerCase();
    return from.toLowerCase();
}

/**
 * 入力テキストでフィルタリングした差出人サジェストを返す。
 * キャッシュされたメールの送信者名 (`from` フィールド) から抽出。
 * メールアドレスが重複する場合は一度きりの出現とする (deduplication)。
 * Gmail と同様に、substring 一致（大文字小文字を区別しない）を使用する。
 */
export function senderSuggestions(
    messages: ReadonlyArray<{ from: string }>,
    input: string,
    maxResults = 5,
): SuggestionItem[] {
    const trimmed = input.trim();
    const lowerInput = trimmed.toLowerCase();
    const seenEmails = new Set<string>();
    const results: SuggestionItem[] = [];

    for (const msg of messages) {
        if (!msg.from) continue;

        // 重複排除: メールアドレスベースで比較
        const emailKey = extractEmail(msg.from);
        if (seenEmails.has(emailKey)) continue;

        // Substring 一致（Gmail 互換）。空入力の場合はすべての送信者をマッチ。
        const matched = !lowerInput || msg.from.toLowerCase().includes(lowerInput);

        if (matched) {
            seenEmails.add(emailKey);
            results.push({ text: msg.from, kind: 'sender' });
        }

        if (results.length >= maxResults) break;
    }

    return results;
}

/**
 * 入力テキストの先頭部分から Gmail 演算子のプレフィックスを検出する。
 * ex) `from:foo` → `'from:'`, `is:*` → `'is:'`, `hello world` → `null`
 */
export function parseOperatorPrefix(input: string): string | null {
    // シンプルなマッチ: from:, to:, subject:, after:, before:, is:, has: のいずれかで始まるか
    const match = input.match(/^(from|to|subject|after|before|is|has):?/i);
    if (match) {
        return `${match[1].toLowerCase()}:`;
    }
    return null;
}

/**
 * 検索入力に対する全サジェストを生成する統合関数。
 * 優先度: sender > operator > history （現在のコンテキストに基づいて種別を切り替える）
 */
export function generateSuggestions(
    input: string,
    history: string[],
    messages: ReadonlyArray<{ from: string }>,
    options?: { maxHistory?: number; maxOperators?: number; maxSenders?: number },
): SuggestionItem[] {
    const trimmed = input.trim();
    if (!trimmed) return [];

    const {
        maxHistory = 5,
        maxOperators = 5,
        maxSenders = 5,
    } = options ?? {};

    // 演算子プレフィックスを検出。`from:` で始まる場合は差出人サジェストを優先
    const opPrefix = parseOperatorPrefix(trimmed);

    if (opPrefix === 'from:') {
        // from: の後に入力がある場合は、差出人サジェストを表示
        const afterPrefix = trimmed.slice('from:'.length).trim();
        if (afterPrefix) {
            const senders = senderSuggestions(messages, afterPrefix, maxSenders);
            if (senders.length > 0) return senders;
        }
        // プレフィックス直後は常に差出人サジェスト（入力なしでも上位送信者を表示）
        return senderSuggestions(messages, '', maxSenders);
    }

    // 他の演算子プレフィックス (`to:` など) も同様に扱う
    if (opPrefix && opPrefix !== 'from:') {
        const afterColon = trimmed.slice(trimmed.indexOf(':') + 1).trim();
        // 値が入力中の場合は fuzzy match
        if (afterColon) {
            const senders = senderSuggestions(messages, afterColon, maxSenders);
            if (senders.length > 0) return senders;
        }
    }

    // 通常モード: 演算子サジェスト + 履歴サジェストを組み合わせる
    const operators = operatorSuggestions(trimmed, maxOperators);
    const historyItems = filterHistoryEntries(history, trimmed, maxHistory);

    // 演算子サジェストがあればそれを優先（補完中）
    if (operators.length > 0) return operators;

    // それ以外は履歴 + 差出人を組み合わせる
    if (historyItems.length > 0) {
        const senders = senderSuggestions(messages, trimmed, maxSenders);
        // 差出人サジェストを追加（重複は排除）
        const historyTexts = new Set(historyItems.map(h => h.text.toLowerCase()));
        for (const sender of senders) {
            if (!historyTexts.has(sender.text.toLowerCase())) {
                historyItems.push(sender);
            }
            if (historyItems.length >= maxHistory + maxSenders) break;
        }
        return historyItems;
    }

    // 最終フォールバック: 差出人サジェストのみ
    return senderSuggestions(messages, trimmed, maxSenders);
}
