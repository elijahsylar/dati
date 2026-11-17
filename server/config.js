// Start-up checks on the environment. Used by server/index.js before it
// listens; kept apart so it can be tested without starting the server.

// The value .env.example ships. Anyone can read it, so it is refused.
const JWT_SECRET_PLACEHOLDER = 'change_this_to_something_random';
const JWT_SECRET_MIN_LENGTH = 32;

// Returns null when JWT_SECRET is usable, otherwise one line that names
// the variable and the rule. The value itself is never put in the line.
function jwtSecretProblem(env = process.env) {
    const secret = typeof env.JWT_SECRET === 'string' ? env.JWT_SECRET.trim() : '';
    const how = 'Set it in .env to a random value, for example the output of: openssl rand -hex 32';
    if (secret === '') {
        return `JWT_SECRET is not set. ${how}`;
    }
    if (secret === JWT_SECRET_PLACEHOLDER) {
        return `JWT_SECRET is still the placeholder from .env.example. ${how}`;
    }
    if (secret.length < JWT_SECRET_MIN_LENGTH) {
        return `JWT_SECRET is too short: it must be at least ${JWT_SECRET_MIN_LENGTH} characters. ${how}`;
    }
    return null;
}

module.exports = { jwtSecretProblem, JWT_SECRET_PLACEHOLDER, JWT_SECRET_MIN_LENGTH };
