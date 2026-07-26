<script lang="ts">
    import { sendEmail, type SendAttachment } from "$lib/api";
    import { emailStore } from "$lib/stores/emailStore.svelte";
    import { errorStore } from "$lib/stores/errorStore.svelte";
    import { settingsStore } from "$lib/stores/settingsStore.svelte";
    import { basenameOf, bytesToBase64, inferMimeType } from "$lib/attachments";
    import UndoSendToast from "../../components/UndoSendToast.svelte";

    let { accountId } = $props<{ accountId: string }>();

    let to = $state(emailStore.composeTo);
    let cc = $state(emailStore.composeCc);
    let bcc = $state(emailStore.composeBcc);
    let subject = $state(emailStore.composeSubject);
    let body = $state(emailStore.composeBody);
    let isSending = $state(false);
    let showCc = $state(Boolean(emailStore.composeCc));
    let showBcc = $state(Boolean(emailStore.composeBcc));
    let scheduleSend = $state(false);
    let scheduledDateTime = $state('');
    let scheduleError = $state('');

    // Undo-send toast state
    let showToast = $state(false);
    let sentComposeData = $state({ to: '', cc: '', bcc: '', subject: '', body: '' });
    let sendTimeMs = $state<number | null>(null);
    let sentMessageId = $state<string | null>(null);
    // 猶予期間（ミリ秒）。設定画面で 5〜30 秒から選択できる
    const undoWindowMs = $derived(settingsStore.undoSendSec * 1000);

    $effect(() => {
        if (!scheduleSend) {
            scheduledDateTime = '';
            scheduleError = '';
        }
    });

    $effect(() => {
        if (scheduleSend && scheduledDateTime && scheduleError) {
            const dt = new Date(scheduledDateTime);
            if (!isNaN(dt.getTime()) && dt.getTime() >= Date.now()) {
                scheduleError = '';
            }
        }
    });

    // Cleanup: hide the undo toast on destroy so stale setTimeout closures in
    // UndoSendToast cannot fire after ComposeEmail is gone.
    $effect(() => {
        return () => {
            showToast = false;
        };
    });

    async function handleSend() {
        if (!to.trim()) {
            errorStore.set({ type: "Validation", message: "Recipient is required." });
            return;
        }

        // Validate scheduled send time when checkbox is enabled
        if (scheduleSend && !scheduledDateTime) {
            scheduleError = 'Scheduled date and time are required.';
            return;
        }

        let scheduledSendTimeMs: number | undefined;
        if (scheduleSend && scheduledDateTime) {
            const dt = new Date(scheduledDateTime);
            if (isNaN(dt.getTime())) {
                scheduleError = 'Invalid scheduled date and time.';
                return;
            }
            if (dt.getTime() < Date.now()) {
                scheduleError = 'Scheduled time must be in the future.';
                return;
            }
            scheduledSendTimeMs = dt.getTime();
        }

        isSending = true;
        try {
            const attachments = emailStore.composeAttachments.length > 0 ? emailStore.composeAttachments : undefined;
            const response = await sendEmail(accountId, to.trim(), subject.trim(), body, cc.trim() || undefined, bcc.trim() || undefined, attachments, scheduledSendTimeMs);

            // Save compose data so "取り消し" can restore the draft
            sentComposeData = { to: to.trim(), cc: cc.trim(), bcc: bcc.trim(), subject: subject.trim(), body };
            sendTimeMs = Date.now();
            sentMessageId = response.messageId;
            // 猶予期間の間トーストを表示する。何もしなければ送信は確定し
            // （handleToastTimeout）、「取り消し」を押したときだけ撤回する。
            showToast = true;
        } catch (e) {
            // safeInvoke already sets errorStore, but ensure it's set
            if (e instanceof Error) {
                errorStore.set({ type: "SendError", message: e.message });
            } else if (typeof e === "object" && e !== null && "message" in e) {
                errorStore.set({ type: "SendError", message: String(e.message) });
            } else {
                errorStore.set({ type: "SendError", message: `Failed to send email: ${e}` });
            }
        } finally {
            isSending = false;
        }
    }

    function handleCancel() {
        emailStore.cancelComposing();
    }

    /**
     * 「取り消し」を押したとき: 送信済みメールをゴミ箱へ移し、
     * 作成画面に内容を復元して編集を続けられるようにする。
     */
    async function handleUndoSend() {
        showToast = false;
        await cancelSentEmail();

        // Restore compose data so user can edit before re-sending
        to = sentComposeData.to;
        cc = sentComposeData.cc;
        bcc = sentComposeData.bcc;
        showCc = showCc || Boolean(sentComposeData.cc);
        showBcc = showBcc || Boolean(sentComposeData.bcc);
        subject = sentComposeData.subject;
        body = sentComposeData.body;
        sentMessageId = null;

        // 添付は復元できない（送信時にバックエンドへ渡したきりのため）
        emailStore.composeAttachments = [];
    }

    /** 送信済みメールを撤回する（Gmail上ではゴミ箱へ移動）。 */
    async function cancelSentEmail() {
        if (sentMessageId === null) return;
        try {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke('cancel_email', {
                accountId,
                messageId: sentMessageId
            });
        } catch (e) {
            errorStore.set({ type: "UndoSendError", message: `送信の取り消しに失敗しました: ${e}` });
        }
    }

    /**
     * 猶予期間が満了したとき: 送信を確定し、作成画面を閉じる。
     * ここでメールに手を加えてはいけない。
     */
    function handleToastTimeout() {
        showToast = false;
        sentMessageId = null;
        emailStore.cancelComposing();
    }

    function toggleCc() {
        showCc = !showCc;
    }

    function toggleBcc() {
        showBcc = !showBcc;
    }

    /**
     * ファイルパスの配列を読み込んで添付に追加する。
     * ファイル選択ダイアログとドラッグ&ドロップの共通処理。
     */
    async function attachFilesFromPaths(filepaths: string[]) {
        if (filepaths.length === 0) return;
        const { readFile } = await import("@tauri-apps/plugin-fs");

        const newAttachments: SendAttachment[] = [];
        for (const filepath of filepaths) {
            try {
                const filename = basenameOf(filepath);
                const bytes = await readFile(filepath);
                newAttachments.push({
                    filename,
                    mimeType: inferMimeType(filename),
                    data: bytesToBase64(bytes),
                });
            } catch (e) {
                errorStore.set({
                    type: "AttachmentError",
                    message: `添付ファイルを読み込めませんでした: ${basenameOf(filepath)}`,
                });
                console.error(`[ComposeEmail] Failed to read file ${filepath}:`, e);
            }
        }

        if (newAttachments.length > 0) {
            emailStore.composeAttachments = [...emailStore.composeAttachments, ...newAttachments];
        }
    }

    async function handleAddAttachment() {
        const { open } = await import("@tauri-apps/plugin-dialog");
        try {
            const selected = await open({ multiple: true, directory: false });
            if (!selected) return;
            await attachFilesFromPaths(Array.isArray(selected) ? selected : [selected]);
        } catch (e) {
            console.error('[ComposeEmail] File picker error:', e);
        }
    }

    // ── ドラッグ&ドロップで添付 ────────────────────────────────
    // Tauri は既定でwebviewのHTML5ドロップを横取りするため、DOMの
    // dragover/drop ではなく webview のドラッグ&ドロップイベントを購読する。
    let isDragOver = $state(false);

    $effect(() => {
        let unlisten: (() => void) | undefined;
        let cancelled = false;

        import("@tauri-apps/api/webview")
            .then(({ getCurrentWebview }) =>
                getCurrentWebview().onDragDropEvent((event) => {
                    if (event.payload.type === 'over') {
                        isDragOver = true;
                    } else if (event.payload.type === 'drop') {
                        isDragOver = false;
                        void attachFilesFromPaths(event.payload.paths ?? []);
                    } else {
                        isDragOver = false;
                    }
                }),
            )
            .then((fn) => {
                if (cancelled) fn();
                else unlisten = fn;
            })
            .catch((e) => console.error('[ComposeEmail] drag & drop unavailable', e));

        return () => {
            cancelled = true;
            unlisten?.();
        };
    });

    function removeAttachment(index: number) {
        const updated = [...emailStore.composeAttachments];
        updated.splice(index, 1);
        emailStore.composeAttachments = updated;
    }

    function formatFileSize(bytes: number): string {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function getFileIcon(filename: string): string {
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        if (['pdf'].includes(ext)) return '📄';
        if (['doc', 'docx'].includes(ext)) return '📝';
        if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
        if (['ppt', 'pptx'].includes(ext)) return '📽️';
        if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg'].includes(ext)) return '🖼️';
        if (['zip', 'gz', 'tar'].includes(ext)) return '📦';
        return '📎';
    }

    function getModeTitle(): string {
        switch (emailStore.composeMode) {
            case 'reply': return 'Reply';
            case 'reply-all': return 'Reply All';
            case 'forward': return 'Forward';
            default: return 'New Message';
        }
    }
</script>

    <div class="compose-container">
    <div class="compose-header">
        <h3>{getModeTitle()}</h3>
        <button class="close-btn" onclick={handleCancel}>&times;</button>
    </div>

    {#if isDragOver}
        <div class="drop-overlay">
            <span>📎 ドロップしてファイルを添付</span>
        </div>
    {/if}

    <div class="compose-body">
        <div class="form-group">
            <label for="compose-to">To</label>
            <input
                id="compose-to"
                type="email"
                bind:value={to}
                placeholder="recipient@example.com"
                autocomplete="off"
            />
        </div>

        <div class="cc-row">
            <button class="cc-toggle" onclick={toggleCc} title="Toggle CC">
                {showCc ? '▾' : '▸'} CC
            </button>
            {#if showCc}
                <div class="form-group cc-input">
                    <input
                        id="compose-cc"
                        type="email"
                        bind:value={cc}
                        placeholder="cc@example.com (optional)"
                        autocomplete="off"
                    />
                </div>
            {/if}
        </div>

        <div class="cc-row">
            <button class="cc-toggle" onclick={toggleBcc} title="Toggle BCC">
                {showBcc ? '▾' : '▸'} BCC
            </button>
            {#if showBcc}
                <div class="form-group cc-input">
                    <input
                        id="compose-bcc"
                        type="email"
                        bind:value={bcc}
                        placeholder="bcc@example.com (optional)"
                        autocomplete="off"
                    />
                </div>
            {/if}
        </div>

        <div class="form-group">
            <label for="compose-subject">Subject</label>
            <input
                id="compose-subject"
                type="text"
                bind:value={subject}
                placeholder="Subject"
            />
        </div>

        <div class="form-group">
            <label for="compose-body">Body</label>
            <textarea
                id="compose-body"
                bind:value={body}
                placeholder="Write your message..."
            ></textarea>
        </div>

        <!-- Attachment section -->
        {#if emailStore.composeAttachments.length > 0}
            <div class="attachment-section">
                <div class="attachment-list">
                    {#each emailStore.composeAttachments as att, i (att.filename)}
                        <div class="attachment-item">
                            <span class="attachment-icon">{getFileIcon(att.filename)}</span>
                            <div class="attachment-info">
                                <span class="attachment-name" title={att.filename}>{att.filename}</span>
                                <span class="attachment-size"></span>
                            </div>
                            <button
                                class="remove-attachment"
                                onclick={() => removeAttachment(i)}
                                title="Remove attachment"
                            >
                                &times;
                            </button>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}
    </div>

    <div class="compose-footer">
        <button
            class="attach-btn"
            onclick={handleAddAttachment}
            disabled={isSending}
            title="Attach files"
        >
            📎
        </button>
        <div class="schedule-row">
            <label class="schedule-checkbox">
                <input type="checkbox" bind:checked={scheduleSend} disabled={isSending} />
                <span>Schedule Send</span>
            </label>
            {#if scheduleSend}
                <input
                    type="datetime-local"
                    class="schedule-datetime"
                    bind:value={scheduledDateTime}
                    disabled={isSending}
                />
            {/if}
        </div>
        {#if scheduleError}
            <span class="schedule-error">{scheduleError}</span>
        {/if}
        <button
            class="send-btn"
            onclick={handleSend}
            disabled={isSending}
        >
            {isSending ? "Sending..." : (scheduleSend ? "Schedule" : "Send")}
        </button>
        <button
            class="cancel-btn"
            onclick={handleCancel}
            disabled={isSending}
        >
            Cancel
        </button>
    </div>
</div>

{#if showToast}
    <UndoSendToast
        message={scheduleSend ? "送信を予約しました" : "メールを送信しました"}
        onUndo={handleUndoSend}
        onTimeout={handleToastTimeout}
        duration={undoWindowMs}
    />
{/if}

<style>
    .compose-container {
        position: relative;
        display: flex;
        flex-direction: column;
        height: 100%;
        background: #1f2937;
        overflow: hidden;
    }

    /* ドラッグ中のオーバーレイ（ポインタイベントは透過させる） */
    .drop-overlay {
        position: absolute;
        inset: 0;
        z-index: 20;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        background: rgba(66, 133, 244, 0.18);
        border: 2px dashed #4285f4;
        border-radius: 8px;
        color: #dbeafe;
        font-size: 1rem;
        font-weight: 600;
    }

    .compose-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1rem 1.5rem;
        border-bottom: 1px solid #374151;
        flex-shrink: 0;
    }

    .compose-header h3 {
        color: #e5e7eb;
        font-size: 1.125rem;
        margin: 0;
    }

    .close-btn {
        background: none;
        border: none;
        color: #9ca3af;
        font-size: 1.5rem;
        cursor: pointer;
        padding: 0;
        line-height: 1;
    }

    .close-btn:hover {
        color: #e5e7eb;
    }

    .compose-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        padding: 1.5rem;
        gap: 1rem;
        overflow-y: auto;
        min-height: 0;
    }

    .form-group {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .cc-row {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .cc-toggle {
        background: none;
        border: none;
        color: #6b7280;
        cursor: pointer;
        font-size: 0.8125rem;
        font-family: inherit;
        padding: 0;
        display: flex;
        align-items: center;
        gap: 0.375rem;
    }

    .cc-toggle:hover {
        color: #9ca3af;
    }

    .cc-input input {
        padding: 0.5rem 0.75rem;
        background-color: #111827;
        border: 1px solid #374151;
        border-radius: 6px;
        color: #e5e7eb;
        font-family: inherit;
        font-size: 0.8125rem;
    }

    .cc-input input:focus {
        outline: none;
        border-color: #4285f4;
        box-shadow: 0 0 0 2px rgba(66, 133, 244, 0.2);
    }

    .form-group label {
        color: #9ca3af;
        font-size: 0.8125rem;
        font-weight: 500;
    }

    .form-group input {
        padding: 0.625rem 0.75rem;
        background-color: #111827;
        border: 1px solid #374151;
        border-radius: 6px;
        color: #e5e7eb;
        font-family: inherit;
        font-size: 0.875rem;
    }

    .form-group input:focus {
        outline: none;
        border-color: #4285f4;
        box-shadow: 0 0 0 2px rgba(66, 133, 244, 0.2);
    }

    .form-group textarea {
        flex: 1;
        min-height: 200px;
        padding: 0.625rem 0.75rem;
        background-color: #111827;
        border: 1px solid #374151;
        border-radius: 6px;
        color: #e5e7eb;
        font-family: inherit;
        font-size: 0.875rem;
        resize: vertical;
        line-height: 1.6;
    }

    .form-group textarea:focus {
        outline: none;
        border-color: #4285f4;
        box-shadow: 0 0 0 2px rgba(66, 133, 244, 0.2);
    }

    .compose-footer {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.75rem;
        padding: 1rem 1.5rem;
        border-top: 1px solid #374151;
        flex-shrink: 0;
    }

    .schedule-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex: 1;
        min-width: 200px;
    }

    .schedule-checkbox {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        color: #9ca3af;
        font-size: 0.8125rem;
        cursor: pointer;
        white-space: nowrap;
    }

    .schedule-checkbox input[type="checkbox"] {
        cursor: pointer;
        accent-color: #4285f4;
    }

    .schedule-checkbox input[type="checkbox"]:disabled {
        cursor: not-allowed;
    }

    .schedule-datetime {
        padding: 0.375rem 0.5rem;
        background-color: #111827;
        border: 1px solid #374151;
        border-radius: 6px;
        color: #e5e7eb;
        font-family: inherit;
        font-size: 0.8125rem;
    }

    .schedule-datetime:focus {
        outline: none;
        border-color: #4285f4;
        box-shadow: 0 0 0 2px rgba(66, 133, 244, 0.2);
    }

    .schedule-datetime::-webkit-calendar-picker-indicator {
        filter: invert(0.7);
        cursor: pointer;
    }

    .schedule-error {
        width: 100%;
        color: #ef4444;
        font-size: 0.8125rem;
    }

    .send-btn {
        padding: 0.625rem 1.5rem;
        background-color: #4285f4;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 500;
        font-family: inherit;
        font-size: 0.875rem;
    }

    .send-btn:hover:not(:disabled) {
        background-color: #357ae8;
    }

    .send-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .cancel-btn {
        padding: 0.625rem 1.5rem;
        background-color: transparent;
        color: #9ca3af;
        border: 1px solid #374151;
        border-radius: 6px;
        cursor: pointer;
        font-family: inherit;
        font-size: 0.875rem;
    }

    .cancel-btn:hover:not(:disabled) {
        background-color: rgba(255, 255, 255, 0.05);
        color: #e5e7eb;
    }

    .cancel-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    /* Attachment styles */
    .attach-btn {
        background: none;
        border: none;
        font-size: 1.25rem;
        cursor: pointer;
        padding: 0.375rem 0.625rem;
        border-radius: 6px;
        line-height: 1;
    }

    .attach-btn:hover:not(:disabled) {
        background-color: rgba(255, 255, 255, 0.08);
    }

    .attach-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .attachment-section {
        margin-top: 0.5rem;
    }

    .attachment-list {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .attachment-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.375rem 0.625rem;
        background-color: #111827;
        border: 1px solid #374151;
        border-radius: 6px;
    }

    .attachment-icon {
        font-size: 1.125rem;
        flex-shrink: 0;
    }

    .attachment-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
    }

    .attachment-name {
        color: #e5e7eb;
        font-size: 0.8125rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .attachment-size {
        color: #6b7280;
        font-size: 0.6875rem;
    }

    .remove-attachment {
        background: none;
        border: none;
        color: #6b7280;
        cursor: pointer;
        font-size: 1.25rem;
        padding: 0;
        line-height: 1;
        flex-shrink: 0;
    }

    .remove-attachment:hover {
        color: #ef4444;
    }
</style>
