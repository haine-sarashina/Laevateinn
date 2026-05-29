import { writable } from 'svelte/store';
import { log } from '../api';

export class ErrorStore {
    #error = $state<{ type: string; message:string } | null>(null);

    get current() { return this.#error; }

    set(error: any) {
        // Standardize the error format from Rust
        const errorObj = typeof error === 'string'
            ? { type: 'Unknown', message: error }
            : error;
        this.#error = errorObj;

        // Log the error to the backend (fire and forget)
        log('error', `Frontend Error: [${errorObj.type}] ${errorObj.message}`)
            .catch(e => console.error("Failed to log error to backend:", e));
    }

    clear() {
        this.#error = null;
    }
}

export const errorStore = new ErrorStore();
