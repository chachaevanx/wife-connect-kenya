const jwt = require('jsonwebtoken');

function adminAuth(req, res, next) {
    try {
        const token = req.cookies?.wc_admin;

        if (!token) {
            return res.status(401).json({
                error: 'Administrator login required.'
            });
        }

        const decoded = jwt.verify(
            token,
            process.env.ADMIN_JWT_SECRET
        );

        req.admin = decoded;

        next();

    } catch (error) {
        return res.status(401).json({
            error: 'Invalid or expired administrator session.'
        });
    }
}

module.exports = adminAuth;
