const { rateLimit } = require('express-rate-limit');

// Failed logins allowed per window. Successful logins are not counted, so
// a host and an admin behind the venue's one address are not locked out
// by using the app normally.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_CLIENT = 20;    // per client address, across all usernames
const MAX_PER_USERNAME = 5;   // per username, across all clients

const base = {
    windowMs: WINDOW_MS,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Try again later.' },
};

// The counter key for a username. The login route only lets through
// usernames made of A-Z, a-z, 0-9, "_", "." and "-" (at most 50), so case
// is the only way two spellings can reach the same account; lowercasing
// gives them one counter.
function usernameKey(username) {
    return 'user:' + String(username).toLowerCase();
}

// Returns two fresh limiters (each with its own in-memory counters), to be
// used in this order on POST /api/auth/login, after express.json() and
// after the route has checked the username (requireCredentials). There
// is no skip: every request that gets this far is counted under a key.
function loginLimiters() {
    const perClient = rateLimit({ ...base, limit: MAX_PER_CLIENT });

    const perUsername = rateLimit({
        ...base,
        limit: MAX_PER_USERNAME,
        keyGenerator: (req) => usernameKey(req.body && req.body.username),
    });

    return [perClient, perUsername];
}

module.exports = { loginLimiters, usernameKey, WINDOW_MS, MAX_PER_CLIENT, MAX_PER_USERNAME };
