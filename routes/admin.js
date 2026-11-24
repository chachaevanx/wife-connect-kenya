const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp'];

        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only JPG, PNG and WEBP images are allowed.'));
        }
    }
});

const JWT_SECRET = process.env.ADMIN_JWT_SECRET;

const admins = [
    {
        slot: 1,
        name: process.env.ADMIN1_NAME || 'Administrator 1',
        email: process.env.ADMIN1_EMAIL || '',
        password: process.env.ADMIN1_PASSWORD || '',
        phone: '',
        picture: null,
        pictureType: null
    },
    {
        slot: 2,
        name: process.env.ADMIN2_NAME || 'Administrator 2',
        email: process.env.ADMIN2_EMAIL || '',
        password: process.env.ADMIN2_PASSWORD || '',
        phone: '',
        picture: null,
        pictureType: null
    }
];

function authenticate(req, res, next) {
    try {
        const token = req.cookies?.wc_admin;

        if (!token) {
            return res.status(401).json({
                error: 'Please log in first.'
            });
        }

        req.admin = jwt.verify(token, JWT_SECRET);
        next();

    } catch {
        res.status(401).json({
            error: 'Session expired. Please log in again.'
        });
    }
}

// ADMIN LOGIN
router.post('/login', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const admin = admins.find(a =>
        a.email.toLowerCase() === email &&
        a.password === password
    );

    if (!admin || !admin.email || !admin.password) {
        return res.status(401).json({
            error: 'Incorrect email or password.'
        });
    }

    const token = jwt.sign(
        {
            slot: admin.slot,
            email: admin.email
        },
        JWT_SECRET,
        { expiresIn: '8h' }
    );

    res.cookie('wc_admin', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 8 * 60 * 60 * 1000
    });

    res.json({
        success: true,
        message: 'Login successful.'
    });
});

// ADMIN LOGOUT
router.post('/logout', (req, res) => {
    res.clearCookie('wc_admin');
    res.json({ success: true });
});

// CURRENT ADMIN
router.get('/me', authenticate, (req, res) => {
    const admin = admins.find(a => a.slot === req.admin.slot);

    if (!admin) {
        return res.status(404).json({ error: 'Admin not found.' });
    }

    res.json({
        slot: admin.slot,
        name: admin.name,
        email: admin.email,
        phone: admin.phone
    });
});

// UPDATE PROFILE
router.put('/profile', authenticate, (req, res) => {
    const admin = admins.find(a => a.slot === req.admin.slot);

    if (!admin) {
        return res.status(404).json({ error: 'Admin not found.' });
    }

    const { name, email, phone } = req.body;

    if (email && admins.some(a =>
        a.slot !== admin.slot &&
        a.email.toLowerCase() === String(email).toLowerCase()
    )) {
        return res.status(400).json({
            error: 'That email is already being used.'
        });
    }

    if (name) admin.name = String(name).trim();
    if (email) admin.email = String(email).trim();
    if (phone !== undefined) admin.phone = String(phone).trim();

    res.json({
        success: true,
        message: 'Profile updated.'
    });
});

// PROFILE PICTURE UPLOAD
router.post(
    '/profile-picture',
    authenticate,
    upload.single('picture'),
    (req, res) => {
        if (!req.file) {
            return res.status(400).json({
                error: 'Please select an image.'
            });
        }

        const admin = admins.find(a => a.slot === req.admin.slot);

        admin.picture = req.file.buffer;
        admin.pictureType = req.file.mimetype;

        res.json({
            success: true,
            message: 'Profile picture updated.'
        });
    }
);

// GET PROFILE PICTURE
router.get('/profile-picture', authenticate, (req, res) => {
    const admin = admins.find(a => a.slot === req.admin.slot);

    if (!admin || !admin.picture) {
        return res.status(404).send('No profile picture.');
    }

    res.set('Content-Type', admin.pictureType);
    res.send(admin.picture);
});

// CHANGE PASSWORD
router.post('/change-password', authenticate, (req, res) => {
    const admin = admins.find(a => a.slot === req.admin.slot);

    const { currentPassword, newPassword } = req.body;

    if (currentPassword !== admin.password) {
        return res.status(400).json({
            error: 'Current password is incorrect.'
        });
    }

    if (!newPassword || String(newPassword).length < 6) {
        return res.status(400).json({
            error: 'New password must contain at least 6 characters.'
        });
    }

    admin.password = String(newPassword);

    res.json({
        success: true,
        message: 'Password changed until the next server restart.'
    });
});

// DASHBOARD OVERVIEW
router.get('/overview', authenticate, (req, res) => {
    res.json({
        administrators: admins.map(a => ({
            slot: a.slot,
            name: a.name,
            email: a.email
        })),
        administratorCount: 2,
        revenue: 0,
        pendingPayments: 0,
        activeSubscriptions: 0,
        notice: 'Live transaction statistics are not connected yet.'
    });
});

module.exports = router;
