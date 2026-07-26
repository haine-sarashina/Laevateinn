/** 拡張子から MIME タイプを推測するための表。 */
const MIME_BY_EXTENSION: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    txt: 'text/plain',
    csv: 'text/csv',
    htm: 'text/html',
    html: 'text/html',
    zip: 'application/zip',
    gz: 'application/gzip',
    json: 'application/json',
    xml: 'application/xml',
};

export const DEFAULT_MIME_TYPE = 'application/octet-stream';

/** ファイル名から MIME タイプを推測する。未知の拡張子は octet-stream。 */
export function inferMimeType(filename: string): string {
    const dot = filename.lastIndexOf('.');
    if (dot < 0 || dot === filename.length - 1) return DEFAULT_MIME_TYPE;
    const ext = filename.slice(dot + 1).toLowerCase();
    return MIME_BY_EXTENSION[ext] ?? DEFAULT_MIME_TYPE;
}

/** パス（Windows/POSIX どちらの区切りでも）からファイル名部分を取り出す。 */
export function basenameOf(path: string): string {
    const normalized = path.replace(/[\\/]+$/, '');
    const idx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
    return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

/** バイト列を base64 文字列へ変換する（大きなファイルでもスタックを溢れさせない）。 */
export function bytesToBase64(bytes: Uint8Array): string {
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}
