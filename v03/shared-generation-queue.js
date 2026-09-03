const GLOBAL_QUEUE_KEY = '__sillytavern_shared_quiet_generation_queue_v1';

function getQueue() {
    const existing = globalThis[GLOBAL_QUEUE_KEY];
    if (existing && typeof existing === 'object' && existing.tail && typeof existing.tail.then === 'function') return existing;
    const queue = {
        tail: Promise.resolve(),
        activeLabel: '',
        queuedCount: 0,
    };
    globalThis[GLOBAL_QUEUE_KEY] = queue;
    return queue;
}

export function runSharedQuietGeneration(label, task) {
    if (typeof task !== 'function') throw new TypeError('Shared quiet generation requires a task function.');
    const queue = getQueue();
    queue.queuedCount += 1;
    const previous = queue.tail.catch(() => {});
    const run = previous.then(async () => {
        queue.activeLabel = String(label || 'extension');
        try {
            return await task();
        } finally {
            queue.activeLabel = '';
            queue.queuedCount = Math.max(0, queue.queuedCount - 1);
        }
    });
    queue.tail = run.then(() => undefined, () => undefined);
    return run;
}

export function sharedQuietGenerationStatus() {
    const queue = getQueue();
    return {
        activeLabel: String(queue.activeLabel || ''),
        queuedCount: Math.max(0, Number(queue.queuedCount) || 0),
    };
}
