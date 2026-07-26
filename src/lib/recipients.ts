/**
 * RFC 5322 アドレスリストの最小限のパーサ。
 * 「全員に返信」の宛先組み立てに必要な範囲だけを扱う。
 */

export interface Recipient {
    /** 表示名（無ければ空文字） */
    name: string;
    /** メールアドレス（小文字化はしない。比較時のみ小文字化する） */
    email: string;
    /** 元の表記そのまま。再出力に使う */
    raw: string;
}

/**
 * カンマ区切りのアドレスリストを分割する。
 * 引用符内・山括弧内のカンマは区切りとして扱わない
 * （例: `"Doe, John" <j@x.com>, b@y.com` は2件）。
 */
export function splitAddressList(header: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inQuotes = false;
    let inAngle = false;

    for (let i = 0; i < header.length; i++) {
        const ch = header[i];
        if (ch === '"' && header[i - 1] !== '\\') {
            inQuotes = !inQuotes;
            current += ch;
        } else if (ch === '<' && !inQuotes) {
            inAngle = true;
            current += ch;
        } else if (ch === '>' && !inQuotes) {
            inAngle = false;
            current += ch;
        } else if (ch === ',' && !inQuotes && !inAngle) {
            if (current.trim()) parts.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
}

/** 単一のアドレス表記を表示名とメールアドレスに分解する。 */
export function parseAddress(raw: string): Recipient {
    const trimmed = raw.trim();
    const angle = trimmed.match(/<([^>]*)>/);
    if (angle) {
        const name = trimmed.slice(0, angle.index).trim().replace(/^"|"$/g, '').trim();
        return { name, email: angle[1].trim(), raw: trimmed };
    }
    return { name: '', email: trimmed, raw: trimmed };
}

/** ヘッダー文字列を Recipient の配列に変換する。 */
export function parseAddressList(header: string | undefined | null): Recipient[] {
    if (!header) return [];
    return splitAddressList(header)
        .map(parseAddress)
        .filter(r => r.email.length > 0);
}

/** Recipient の配列をヘッダー文字列へ戻す。 */
export function formatAddressList(recipients: Recipient[]): string {
    return recipients.map(r => r.raw).join(', ');
}

/**
 * 重複と自分自身を取り除く。
 * 比較はメールアドレスの小文字比較で行い、`exclude` に含まれるものと
 * `seen` に既出のものを落とす。
 */
export function dedupeRecipients(
    recipients: Recipient[],
    exclude: ReadonlySet<string>,
    seen: Set<string> = new Set(),
): Recipient[] {
    const result: Recipient[] = [];
    for (const r of recipients) {
        const key = r.email.toLowerCase();
        if (!key || exclude.has(key) || seen.has(key)) continue;
        seen.add(key);
        result.push(r);
    }
    return result;
}

/**
 * 「全員に返信」の宛先を組み立てる。
 *
 * Gmail と同じ規則:
 * - To  = 元の From ＋ 元の To（自分自身と重複を除く）
 * - Cc  = 元の Cc（To に入ったもの・自分自身・重複を除く）
 *
 * 自分だけが宛先だったメール（自分から自分など）で To が空になる場合は、
 * 送信先が無くなってしまうため From をそのまま To に残す。
 */
export function buildReplyAllRecipients(
    message: { from?: string; to?: string; cc?: string },
    selfEmail: string | null,
): { to: string; cc: string } {
    const exclude = new Set<string>();
    if (selfEmail) exclude.add(selfEmail.toLowerCase());

    const seen = new Set<string>();
    const fromList = parseAddressList(message.from);
    const toList = parseAddressList(message.to);
    const ccList = parseAddressList(message.cc);

    const to = dedupeRecipients([...fromList, ...toList], exclude, seen);
    const cc = dedupeRecipients(ccList, exclude, seen);

    if (to.length === 0) {
        // 自分宛てのみのメール: From を残さないと返信先が無くなる
        const fallback = dedupeRecipients(fromList, new Set(), new Set());
        return { to: formatAddressList(fallback), cc: formatAddressList(cc) };
    }

    return { to: formatAddressList(to), cc: formatAddressList(cc) };
}
