const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');

module.exports = function (pool) {

    const router = express.Router();

    const JWT_SECRET = process.env.ADMIN_JWT_SECRET;

    // =====================================
    // IMAGE UPLOAD CONFIGURATION
    // =====================================

    const storage = multer.memoryStorage();

    const upload = multer({
        storage,
        limits: {
            fileSize: 2 * 1024 * 1024
        },
        fileFilter: (req, file, cb) => {

            const allowed = [
                'image/jpeg',
                'image/png',
                'image/webp'
            ];

            if (!allowed.includes(file.mimetype)) {
                return cb(
                    new Error('Only JPG, PNG and WEBP images are allowed')
                );
            }

            cb(null, true);
        }
    });

    // =====================================
    // INITIALIZE TWO ADMINISTRATORS
    // =====================================

    let initializationPromise;

    async function initializeAdmins() {

        const admins = [
            {
                slot: 1,
                name: process.env.ADMIN1_NAME,
                email: process.env.ADMIN1_EMAIL,
                password: process.env.ADMIN1_PASSWORD
            },
            {
                slot: 2,
                name: process.env.ADMIN2_NAME,
                email: process.env.ADMIN2_EMAIL,
                password: process.env.ADMIN2_PASSWORD
            }
        ];

        for (const admin of admins) {

            if (
                !admin.name ||
                !admin.email ||
                !admin.password ||
                admin.password.length < 12
            ) {
                throw new Error(
                    `Admin slot ${admin.slot} has missing details or a password shorter than 12 characters`
                );
            }

        }

        const result = await pool.query(
            'SELECT COUNT(*) FROM admin_users'
        );

        const count = Number(result.rows[0].count);

        if (count === 0) {

            for (const admin of admins) {

                const hash = await bcrypt.hash(
                    admin.password,
                    12
                );

                await pool.query(
                    `INSERT INTO admin_users
                    (slot, full_name, email, password_hash)
                    VALUES ($1, $2, $3, $4)`,
                    [
                        admin.slot,
                        admin.name,
                        admin.email.toLowerCase(),
                        hash
                    ]
                );

            }

            console.log('Two administrator accounts created.');

        } else if (count !== 2) {

            throw new Error(
                'Admin database must contain exactly two administrator accounts. Resolve the database records before starting.'
            );

        }

    }

    function ensureInitialized() {

        if (!initializationPromise) {
            initializationPromise = initializeAdmins();
        }

        return initializationPromise;

    }

    // =====================================
    // AUTHENTICATION MIDDLEWARE
    // =====================================

    async function authenticate(req, res, next) {

        try {

            await ensureInitialized();

            const token = req.cookies?.wc_admin;

            if (!token) {
                return res.status(401).json({
                    error: 'Please log in.'
                });
            }

            const decoded = jwt.verify(
                token,
                JWT_SECRET
            );

            const result = await pool.query(
                `SELECT id, full_name, email, phone
                 FROM admin_users
                 WHERE id = $1`,
                [decoded.id]
            );

            if (result.rows.length === 0) {
                return res.status(401).json({
                    error: 'Administrator account not found.'
                });
            }

            req.admin = result.rows[0];

            next();

        } catch (error) {

            return res.status(401).json({
                error: 'Session expired. Please log in again.'
            });

        }

    }

    // =====================================
    // ADMIN LOGIN
    // =====================================

    router.post('/login', async (req, res) => {

        try {

            await ensureInitialized();

            const { email, password } = req.body;

            if (!email || !password) {
                return res.status(400).json({
                    error: 'Email and password are required.'
                });
            }

            const result = await pool.query(
                `SELECT *
                 FROM admin_users
                 WHERE LOWER(email) = LOWER($1)`,
                [email.trim()]
            );

            if (result.rows.length !== 1) {
                return res.status(401).json({
                    error: 'Invalid email or password.'
                });
            }

            const admin = result.rows[0];

            const validPassword = await bcrypt.compare(
                password,
                admin.password_hash
            );

            if (!validPassword) {
                return res.status(401).json({
                    error: 'Invalid email or password.'
                });
            }

            const token = jwt.sign(
                {
                    id: admin.id,
                    slot: admin.slot
                },
                JWT_SECRET,
                {
                    expiresIn: '8h'
                }
            );

            res.cookie('wc_admin', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 8 * 60 * 60 * 1000,
                path: '/'
            });

            res.json({
                success: true,
                message: 'Login successful.',
                admin: {
                    name: admin.full_name,
                    email: admin.email
                }
            });

        } catch (error) {

            console.error('Admin login:', error.message);

            res.status(500).json({
                error: 'Login service unavailable.'
            });

        }

    });

    // =====================================
    // ADMIN LOGOUT
    // =====================================

    router.post('/logout', (req, res) => {

        res.clearCookie('wc_admin', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            path: '/'
        });

        res.json({
            success: true,
            message: 'Logged out successfully.'
        });

    });

    // =====================================
    // CURRENT ADMIN PROFILE
    // =====================================

    router.get('/me', authenticate, async (req, res) => {

        try {

            const result = await pool.query(
                `SELECT id, full_name, email, phone,
                CASE WHEN profile_image IS NULL
                THEN false ELSE true END AS has_image
                FROM admin_users
                WHERE id = $1`,
                [req.admin.id]
            );

            res.json(result.rows[0]);

        } catch (error) {

            res.status(500).json({
                error: 'Unable to load profile.'
            });

        }

    });

    // =====================================
    // UPDATE ADMIN PROFILE
    // =====================================

    router.put('/profile', authenticate, async (req, res) => {

        try {

            const {
                full_name,
                email,
                phone
            } = req.body;

            if (!full_name || !email) {
                return res.status(400).json({
                    error: 'Name and email are required.'
                });
            }

            const result = await pool.query(
                `UPDATE admin_users
                 SET full_name = $1,
                     email = $2,
                     phone = $3,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $4
                 RETURNING id, full_name, email, phone`,
                [
                    full_name.trim(),
                    email.trim().toLowerCase(),
                    phone || null,
                    req.admin.id
                ]
            );

            res.json({
                success: true,
                admin: result.rows[0]
            });

        } catch (error) {

            if (error.code === '23505') {
                return res.status(409).json({
                    error: 'That email is already in use.'
                });
            }

            console.error(error.message);

            res.status(500).json({
                error: 'Profile update failed.'
            });

        }

    });

    // =====================================
    // PROFILE PICTURE
    // =====================================

    router.post(
        '/profile-picture',
        authenticate,
        upload.single('picture'),
        async (req, res) => {

            try {

                if (!req.file) {
                    return res.status(400).json({
                        error: 'Select a valid image.'
                    });
                }

                await pool.query(
                    `UPDATE admin_users
                     SET profile_image = $1,
                         profile_image_type = $2,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = $3`,
                    [
                        req.file.buffer,
                        req.file.mimetype,
                        req.admin.id
                    ]
                );

                res.json({
                    success: true,
                    message: 'Profile picture updated.'
                });

            } catch (error) {

                res.status(500).json({
                    error: 'Image upload failed.'
                });

            }

        }
    );

    router.get(
        '/profile-picture',
        authenticate,
        async (req, res) => {

            try {

                const result = await pool.query(
                    `SELECT profile_image, profile_image_type
                     FROM admin_users
                     WHERE id = $1`,
                    [req.admin.id]
                );

                const admin = result.rows[0];

                if (!admin || !admin.profile_image) {
                    return res.sendStatus(404);
                }

                res.setHeader(
                    'Content-Type',
                    admin.profile_image_type
                );

                res.setHeader(
                    'Cache-Control',
                    'no-store'
                );

                res.send(admin.profile_image);

            } catch (error) {

                res.status(500).json({
                    error: 'Unable to load image.'
                });

            }

        }
    );

    // =====================================
    // CHANGE PASSWORD
    // =====================================

    router.post(
        '/change-password',
        authenticate,
        async (req, res) => {

            try {

                const {
                    currentPassword,
                    newPassword
                } = req.body;

                if (
                    !currentPassword ||
                    !newPassword ||
                    newPassword.length < 12
                ) {
                    return res.status(400).json({
                        error: 'Enter your current password and a new password of at least 12 characters.'
                    });
                }

                const result = await pool.query(
                    `SELECT password_hash
                     FROM admin_users
                     WHERE id = $1`,
                    [req.admin.id]
                );

                const valid = await bcrypt.compare(
                    currentPassword,
                    result.rows[0].password_hash
                );

                if (!valid) {
                    return res.status(400).json({
                        error: 'Current password is incorrect.'
                    });
                }

                const hash = await bcrypt.hash(
                    newPassword,
                    12
                );

                await pool.query(
                    `UPDATE admin_users
                     SET password_hash = $1,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = $2`,
                    [hash, req.admin.id]
                );

                res.clearCookie('wc_admin', {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    path: '/'
                });

                res.json({
                    success: true,
                    message: 'Password changed. Please log in again.'
                });

            } catch (error) {

                console.error(error.message);

                res.status(500).json({
                    error: 'Password change failed.'
                });

            }

        }
    );

    // =====================================
    // DASHBOARD OVERVIEW
    // =====================================

    router.get('/overview', authenticate, async (req, res) => {

        try {

            const result = await pool.query(
                `SELECT id, full_name, email, phone
                 FROM admin_users
                 ORDER BY slot`
            );

            res.json({

                administrators: result.rows,

                administratorCount: result.rows.length,

                transactions: {
                    revenue: 0,
                    successful: 0,
                    pending: 0
                },

                subscriptions: {
                    active: 0,
                    expired: 0
                },

                notice: 'Payment and subscription statistics require persistent transaction storage. They are not yet connected to this dashboard.'

            });

        } catch (error) {

            res.status(500).json({
                error: 'Unable to load dashboard.'
            });

        }

    });

    return router;

};
