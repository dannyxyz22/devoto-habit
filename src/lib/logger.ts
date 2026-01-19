import { supabase } from "@/lib/supabase";

export interface ErrorLogData {
    error_message: string;
    stack_trace?: string;
    metadata?: Record<string, any>;
    severity?: 'error' | 'warning' | 'info';
}

const ERROR_QUEUE_KEY = 'error_logs_queue';

export const logger = {
    /**
     * Log an error to Supabase or queue it if offline.
     * Guaranteed to return void (fire and forget from UI perspective).
     */
    async logError(error: unknown, context?: Record<string, any>) {
        try {
            const { data: { user } } = await supabase.auth.getUser();

            let message = 'Unknown error';
            let stack = undefined;

            if (error instanceof Error) {
                message = error.message;
                stack = error.stack;
            } else if (typeof error === 'string') {
                message = error;
            } else {
                message = JSON.stringify(error);
            }

            const payload = {
                user_id: user?.id || null, // Logs UUID only, no emails
                error_message: message,
                stack_trace: stack,
                metadata: {
                    ...context,
                    url: window.location.href,
                    userAgent: navigator.userAgent
                },
                severity: 'error',
                created_at: new Date().toISOString()
            };

            if (navigator.onLine) {
                const { error: sendErr } = await supabase.from('error_logs').insert(payload);
                if (sendErr) {
                    console.error('Logger: Failed to send log, queuing.', sendErr);
                    this.queueError(payload);
                }
            } else {
                console.log('Logger: Offline, queuing error.');
                this.queueError(payload);
            }
        } catch (err) {
            console.error('Logger: Critical failure in logging system', err);
        }
    },

    queueError(payload: any) {
        try {
            const queue = JSON.parse(localStorage.getItem(ERROR_QUEUE_KEY) || '[]');
            queue.push(payload);
            // Limit queue size to avoid storage overflow
            if (queue.length > 50) queue.shift();
            localStorage.setItem(ERROR_QUEUE_KEY, JSON.stringify(queue));
        } catch { } // Ignore storage errors
    },

    /**
     * Call this on app start or network reconnect to flush queued logs.
     */
    async flushQueue() {
        if (!navigator.onLine) return;

        try {
            const queueStr = localStorage.getItem(ERROR_QUEUE_KEY);
            if (!queueStr) return;

            const queue = JSON.parse(queueStr);
            if (queue.length === 0) return;

            console.log(`Logger: Flushing ${queue.length} queued errors...`);

            const { error } = await supabase.from('error_logs').insert(queue);

            if (!error) {
                localStorage.removeItem(ERROR_QUEUE_KEY);
                console.log('Logger: Queue flushed successfully.');
            } else {
                console.error('Logger: Failed to flush queue', error);
            }
        } catch (err) {
            console.error('Logger: Flush failed', err);
        }
    }
};
