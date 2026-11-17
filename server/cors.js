// Which browser origins may call the API and Socket.io from another site.
// CORS_ORIGIN is a comma-separated list of exact origins, for example
// "https://trivia.example.com,https://admin.example.com". Unset, it is
// only this server's own localhost address, which is enough for local
// development. There is no wildcard: "*" and "null" entries are dropped.
//
// Pages served by this server itself (public/) are same-origin and are not
// affected by this list, whatever address they were opened on.
function allowedOrigins(env = process.env) {
    const fallback = [`http://localhost:${env.PORT || 3000}`];
    const raw = (env.CORS_ORIGIN || '').trim();
    if (!raw) return fallback;

    const origins = [];
    for (const entry of raw.split(',')) {
        const origin = entry.trim().replace(/\/+$/, '');
        if (!origin) continue;
        if (origin.includes('*') || origin === 'null') {
            console.warn(`[cors] ignoring CORS_ORIGIN entry "${origin}": wildcards are not allowed`);
            continue;
        }
        origins.push(origin);
    }
    return origins.length > 0 ? origins : fallback;
}

// Options for the cors package and for Socket.io's `cors` setting. An
// origin outside the list gets no Access-Control-Allow-Origin header, so
// the browser refuses to hand the response to that page.
function corsOptions(env = process.env) {
    return { origin: allowedOrigins(env) };
}

module.exports = { allowedOrigins, corsOptions };
