const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ error: 'No token provided' });

    const token = header.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// Roles in admin_users.role. An admin manages content (themes, questions,
// events); a host runs a game night from the host console.
const HOST_CONSOLE_ROLES = ['admin', 'host'];

// requireRole('admin') or requireRole('admin', 'host'). Use after auth.
// A token with no role, or a role not listed, is refused.
const requireRole = (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
};

module.exports = auth;
module.exports.requireRole = requireRole;
module.exports.HOST_CONSOLE_ROLES = HOST_CONSOLE_ROLES;
