<script lang="ts">
    import { sendEmail, type SendAttachment } from "$lib/api";
    import { emailStore } from "$lib/stores/emailStore.svelte";
    import { errorStore } from "$lib/stores/errorStore.svelte";

    let { accountId } = $props<{ accountId: string }>();

    let to = $state(emailStore.composeTo);
    let cc = $state(emailStore.composeCc);
    let subject = $state(emailStore.composeSubject);
    let body = $state(emailStore.composeBody);
    let isSending = $state(false);
    let showCc = $state(Boolean(emailStore.composeCc));

    async function handleSend() {
        if (!to.trim()) {
            errorStore.set({ type: "Validation", message: "Recipient is required." });
            return;
        }

        isSending = true;
        try {
            const attachments = emailStore.composeAttachments.length > 0 ? emailStore.composeAttachments : undefined;
            await sendEmail(accountId, to.trim(), subject.trim(), body, cc.trim() || undefined, undefined, attachments);
            // On success, close the compose view
            emailStore.cancelComposing();
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

    function toggleCc() {
        showCc = !showCc;
    }

    async function handleAddAttachment() {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const { readFile } = await import("@tauri-apps/plugin-fs");
        const { basename } = await import("@tauri-apps/api/path");

        try {
            const selected = await open({
                multiple: true,
                directory: false,
            });

            if (!selected) return;

            const filepaths = Array.isArray(selected) ? selected : [selected];
            const newAttachments: SendAttachment[] = [];

            for (const filepath of filepaths) {
                try {
                    const filenameResult = await basename(filepath);
                    const bytes = await readFile(filepath);

                    // Convert Uint8Array to base64
                    let binary = '';
                    for (let i = 0; i < bytes.length; i++) {
                        binary += String.fromCharCode(bytes[i]);
                    }
                    const data = btoa(binary);

                    // Infer MIME type from extension
                    const ext = filenameResult.split('.').pop()?.toLowerCase() || '';
                    let mimeType = 'application/octet-stream';
                    const mimeMap: Record<string, string> = {
                        'pdf': 'application/pdf',
                        'doc': 'application/msword',
                        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        'xls': 'application/vnd.ms-excel',
                        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        'ppt': 'application/vnd.ms-powerpoint',
                        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                        'png': 'image/png',
                        'jpg': 'image/jpeg',
                        'jpeg': 'image/jpeg',
                        'gif': 'image/gif',
                        'bmp': 'image/bmp',
                        'svg': 'image/svg+xml',
                        'txt': 'text/plain',
                        'csv': 'text/csv',
                        'htm': 'text/html',
                        'html': 'text/html',
                        'zip': 'application/zip',
                        'gz': 'application/gzip',
                        'json': 'application/json',
                        'xml': 'application/xml',
                    };
                    mimeType = mimeMap[ext] || mimeType;

                    newAttachments.push({
                        filename: filenameResult,
                        mimeType,
                        data,
                    });
                } catch (e) {
                    console.error(`[ComposeEmail] Failed to read file ${filepath}:`, e);
                }
            }

            if (newAttachments.length > 0) {
                emailStore.composeAttachments = [...emailStore.composeAttachments, ...newAttachments];
            }
        } catch (e) {
            console.error('[ComposeEmail] File picker error:', e);
        }
    }

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
        <button
            class="send-btn"
            onclick={handleSend}
            disabled={isSending}
        >
            {isSending ? "Sending..." : "Send"}
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

<style>
    .compose-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: #1f2937;
        overflow: hidden;
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
        gap: 0.75rem;
        padding: 1rem 1.5rem;
        border-top: 1px solid #374151;
        flex-shrink: 0;
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
