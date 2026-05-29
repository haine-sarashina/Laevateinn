<script lang="ts">
    import { errorStore } from "$lib/stores/errorStore.svelte";
    import { onMount } from "svelte";

    let visible = $state(false);

    $effect(() => {
        if (errorStore.current) {
            visible = true;
            const msg = String(errorStore.current.message ?? "");
            const isAuth = msg.includes("AuthError") || msg.includes("認証");
            if (!isAuth) {
                const timer = setTimeout(() => {
                    errorStore.clear();
                    visible = false;
                }, 5000);
                return () => clearTimeout(timer);
            }
        }
    });
</script>

{#if visible && errorStore.current}
    <div class="toast" role="alert">
        <span><strong>{errorStore.current.type}:</strong> {errorStore.current.message}</span>
        <button class="toast-close" onclick={() => { errorStore.clear(); visible = false; }}>&times;</button>
    </div>
{/if}

<style>
    .toast {
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 1rem;
        background-color: #ff4444;
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 1000;
        min-width: 250px;
        max-width: 400px;
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
    }

    .toast span {
        flex: 1;
        word-wrap: break-word;
    }

    .toast-close {
        background: none;
        border: none;
        color: white;
        font-size: 1.25rem;
        cursor: pointer;
        padding: 0;
        line-height: 1;
        opacity: 0.8;
    }

    .toast-close:hover {
        opacity: 1;
    }
</style>
