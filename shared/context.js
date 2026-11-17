// Per-call state: getMeta() stores the TMDB metadata of the title Nuvio asked for, provider() uses it to label the
// streams with the real title/year and to drop streams that clearly belong to a different production (e.g. the US
// "Kingdom" instead of the Korean one). Nuvio loads every plugin into its own runtime, so this is per plugin.
export const ctx = { meta: null };
