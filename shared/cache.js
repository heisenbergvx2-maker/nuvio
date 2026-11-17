// Tiny TTL cache. Values are promises, so two callers asking for the same page share one request and a failure is
// not remembered (the entry is dropped again). Nuvio calls a provider once per stream request, but within that call
// the same season page / TMDB document is often needed twice, and on TV a plugin's requests run one after another.
const MAX_ENTRIES = 200;
const entries = new Map();

export function cached(key, ttlMs, fn) {
    const now = Date.now();
    const hit = entries.get(key);
    if (hit && now - hit.at < ttlMs) return hit.value;
    if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value);
    const value = Promise.resolve().then(fn);
    entries.set(key, { at: now, value });
    value.catch(() => {
        const e = entries.get(key);
        if (e && e.value === value) entries.delete(key);
    });
    return value;
}

export function cacheClear() {
    entries.clear();
}
