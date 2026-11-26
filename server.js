```javascript
require('dotenv').config();

const express = require('express');
const path = require('path');
const cron = require('node-cron');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const PACKAGES = require('./packages');

const {
    initiateSTKPush,
    formatPhone
} = require('./services/mpesa');

const {
    activateHotspotUser,
    disconnectAndRemoveUser
} = require('./services/mikrotik');

const adminRoutes = require('./routes/admin');

// ======================================
// APPLICATION CONFIGURATION
// ======================================

const app = express();

app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(express.static(path.join(__dirname, 'public')));

// ======================================
// SECURITY CONFIGURATION
// ======================================

if (
    !process.env.ADMIN_JWT_SECRET ||
    process.env.ADMIN_JWT_SECRET.length < 32
) {
    throw new Error(
        'ADMIN_JWT_SECRET must contain at least 32 characters.'
    );
}

// ======================================
// DATABASE CONFIGURATION
// ======================================

let db;

async function initializeDatabase() {

    const databasePath =
        process.env.DATABASE_PATH ||
        path.join(__dirname, 'galex-billing.sqlite');

    db = await open({
        filename: databasePath,
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS transactions (
            checkout_id TEXT PRIMARY KEY,
            phone TEXT NOT NULL,
            package_id TEXT NOT NULL,
            package_label TEXT,
            amount INTEGER NOT NULL,
            mac TEXT,
            status TEXT NOT NULL,
            voucher TEXT UNIQUE,
            mpesa_receipt TEXT,
            paid_at INTEGER,
            expires_at INTEGER,
            devices INTEGER DEFAULT 1,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            phone TEXT NOT NULL,
            package_id TEXT NOT NULL,
            package_label TEXT,
            amount INTEGER NOT NULL,
            devices INTEGER DEFAULT 1,
            paid_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            status TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_subscription_expiry
        ON subscriptions(status, expires_at);
    `);

    console.log('Billing database initialized.');

}

// ======================================
// ADMIN ROUTES
// ======================================

app.use('/api/admin', adminRoutes);

// ======================================
// HELPER FUNCTIONS
// ======================================

function generateVoucher() {

    return crypto
        .randomBytes(5)
        .toString('hex')
        .toUpperCase();

}

function getPackage(packageId) {

    return PACKAGES.find(
        item => item.id === packageId
    );

}

function getPackageDuration(pkg) {

    const hours = Number(pkg.hours);

    if (!Number.isFinite(hours) || hours <= 0) {
        throw new Error('Invalid package duration.');
    }

    return hours * 60 * 60 * 1000;

}

// ======================================
// CUSTOMER PACKAGES
// ======================================

app.get('/api/packages', (req, res) => {

    res.json(PACKAGES);

});

// ======================================
// INITIATE M-PESA PAYMENT
// ======================================

app.post('/api/pay', async (req, res) => {

    try {

        const { phone, packageId, mac } = req.body;

        if (!phone || !packageId) {

            return res.status(400).json({
                error: 'Phone number and package are required.'
            });

        }

        const pkg = getPackage(packageId);

        if (!pkg) {

            return res.status(400).json({
                error: 'Invalid package selected.'
            });

        }

        const formattedPhone = formatPhone(phone);

        const stkRes = await initiateSTKPush({

            phone: formattedPhone,

            amount: pkg.price,

            accountRef: pkg.id.toUpperCase(),

            description: pkg.label

        });

        if (!stkRes.CheckoutRequestID) {

            throw new Error(
                'Missing M-Pesa CheckoutRequestID.'
            );

        }

        const now = Date.now();

        await db.run(
            `INSERT INTO transactions (
                checkout_id,
                phone,
                package_id,
                package_label,
                amount,
                mac,
                status,
                devices,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                stkRes.CheckoutRequestID,
                formattedPhone,
                pkg.id,
                pkg.label,
                pkg.price,
                mac || '',
                'PENDING',
                pkg.devices || 1,
                now,
                now
            ]
        );

        res.json({

            message: 'STK Push sent. Enter your M-Pesa PIN.',

            checkoutRequestId:
                stkRes.CheckoutRequestID

        });

    } catch (err) {

        console.error(
            'STK Push Error:',
            err.response?.data || err.message
        );

        res.status(500).json({

            error: 'Failed to initiate M-Pesa payment.'

        });

    }

});

// ======================================
// M-PESA CALLBACK
// ======================================

app.post('/api/mpesa/callback', async (req, res) => {

    try {

        const callbackData =
            req.body?.Body?.stkCallback;

        if (!callbackData) {

            return res.status(400).json({
                error: 'Invalid callback.'
            });

        }

        const checkoutId =
            callbackData.CheckoutRequestID;

        const tx = await db.get(
            'SELECT * FROM transactions WHERE checkout_id = ?',
            [checkoutId]
        );

        if (!tx) {

            console.log(
                'Unknown M-Pesa transaction:',
                checkoutId
            );

            return res.json({
                ResultCode: 0,
                ResultDesc: 'Accepted'
            });

        }

        if (
            tx.status === 'SUCCESS' ||
            tx.status === 'PROCESSING' ||
            tx.status === 'EXPIRED'
        ) {

            return res.json({
                ResultCode: 0,
                ResultDesc: 'Already processed.'
            });

        }

        if (callbackData.ResultCode !== 0) {

            await db.run(
                `UPDATE transactions
                 SET status = ?, updated_at = ?
                 WHERE checkout_id = ?`,
                ['FAILED', Date.now(), checkoutId]
            );

            return res.json({
                ResultCode: 0,
                ResultDesc: 'Payment failed.'
            });

        }

        const metadata =
            callbackData.CallbackMetadata?.Item || [];

        const receiptItem = metadata.find(
            item => item.Name === 'MpesaReceiptNumber'
        );

        const amountItem = metadata.find(
            item => item.Name === 'Amount'
        );

        const phoneItem = metadata.find(
            item => item.Name === 'PhoneNumber'
        );

        const receipt = receiptItem?.Value;

        const paidAmount = Number(amountItem?.Value);

        const paidPhone = phoneItem?.Value
            ? String(phoneItem.Value)
            : '';

        if (
            !receipt ||
            !Number.isFinite(paidAmount) ||
            paidAmount !== Number(tx.amount)
        ) {

            await db.run(
                `UPDATE transactions
                 SET status = ?, updated_at = ?
                 WHERE checkout_id = ?`,
                ['PAYMENT_REVIEW', Date.now(), checkoutId]
            );

            console.error(
                'Payment validation failed:',
                checkoutId
            );

            return res.json({
                ResultCode: 0,
                ResultDesc: 'Payment requires verification.'
            });

        }

        // ======================================
        // START COUNTDOWN AT PAYMENT CONFIRMATION
        // ======================================

        const paidAt = Date.now();

        const pkg = getPackage(tx.package_id);

        if (!pkg) {
            throw new Error('Package no longer exists.');
        }

        const expiresAt =
            paidAt + getPackageDuration(pkg);

        const voucherCode = generateVoucher();

        // ======================================
        // PREVENT DUPLICATE PROCESSING
        // ======================================

        const result = await db.run(
            `UPDATE transactions
             SET status = ?,
                 voucher = ?,
                 mpesa_receipt = ?,
                 paid_at = ?,
                 expires_at = ?,
                 updated_at = ?
             WHERE checkout_id = ?
             AND status = 'PENDING'`,
            [
                'PROCESSING',
                voucherCode,
                receipt,
                paidAt,
                expiresAt,
                paidAt,
                checkoutId
            ]
        );

        if (result.changes !== 1) {

            return res.json({
                ResultCode: 0,
                ResultDesc: 'Already processing.'
            });

        }

        // ======================================
        // ACTIVATE MIKROTIK USER
        // ======================================

        if (expiresAt <= Date.now()) {

            throw new Error('Package expired before activation.');

        }

        await activateHotspotUser({

            username: voucherCode,

            password: voucherCode,

            pkg,

            macAddress: tx.mac,

            expiresAt

        });

        await db.run(
            `INSERT INTO subscriptions (
                username,
                phone,
                package_id,
                package_label,
                amount,
                devices,
                paid_at,
                expires_at,
                status,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                voucherCode,
                tx.phone,
                tx.package_id,
                tx.package_label,
                tx.amount,
                tx.devices,
                paidAt,
                expiresAt,
                'ACTIVE',
                paidAt
            ]
        );

        await db.run(
            `UPDATE transactions
             SET status = ?, updated_at = ?
             WHERE checkout_id = ?`,
            ['SUCCESS', Date.now(), checkoutId]
        );

        console.log(
            `Activated ${voucherCode}. Expires: ${new Date(expiresAt).toISOString()}`
        );

        res.json({

            ResultCode: 0,

            ResultDesc: 'Payment processed.'

        });

    } catch (err) {

        console.error(
            'M-Pesa callback processing error:',
            err.message
        );

        res.json({

            ResultCode: 0,

            ResultDesc: 'Accepted'

        });

    }

});

// ======================================
// CHECK PAYMENT STATUS
// ======================================

app.get('/api/status/:checkoutId', async (req, res) => {

    try {

        const tx = await db.get(
            `SELECT status, voucher, devices, expires_at
             FROM transactions
             WHERE checkout_id = ?`,
            [req.params.checkoutId]
        );

        if (!tx) {

            return res.status(404).json({
                status: 'NOT_FOUND'
            });

        }

        res.json({

            status: tx.status,

            voucher: tx.voucher,

            devices: tx.devices,

            expiresAt: tx.expires_at

        });

    } catch (err) {

        console.error(err.message);

        res.status(500).json({
            error: 'Could not check payment status.'
        });

    }

});

// ======================================
// AUTOMATIC EXPIRY
// ======================================

let expiryCheckRunning = false;

async function checkExpiredSubscriptions() {

    if (expiryCheckRunning) return;

    expiryCheckRunning = true;

    try {

        const now = Date.now();

        const expired = await db.all(
            `SELECT username
             FROM subscriptions
             WHERE status = 'ACTIVE'
             AND expires_at <= ?`,
            [now]
        );

        for (const subscription of expired) {

            try {

                await disconnectAndRemoveUser(
                    subscription.username
                );

                await db.run(
                    `UPDATE subscriptions
                     SET status = 'EXPIRED'
                     WHERE username = ?`,
                    [subscription.username]
                );

                await db.run(
                    `UPDATE transactions
                     SET status = 'EXPIRED',
                         updated_at = ?
                     WHERE voucher = ?
                     AND status = 'SUCCESS'`,
                    [now, subscription.username]
                );

                console.log(
                    `Expired voucher blocked: ${subscription.username}`
                );

            } catch (err) {

                console.error(
                    `Expiry error for ${subscription.username}:`,
                    err.message
                );

            }

        }

    } catch (err) {

        console.error(
            'Expiry checker error:',
            err.message
        );

    } finally {

        expiryCheckRunning = false;

    }

}

cron.schedule('* * * * * *', () => {

    checkExpiredSubscriptions();

});

// ======================================
// ADMIN LOGIN PAGE
// ======================================

app.get('/admin', (req, res) => {

    res.redirect('/admin/login.html');

});

// ======================================
// HEALTH CHECK
// ======================================

app.get('/health', (req, res) => {

    res.json({

        status: 'online',

        service: 'Galex Cyber WiFi Billing',

        timestamp: new Date().toISOString()

    });

});

// ======================================
// SERVER START
// ======================================

const PORT = process.env.PORT || 3000;

async function startServer() {

    await initializeDatabase();

    await checkExpiredSubscriptions();

    app.listen(PORT, () => {

        console.log(
            `Galex Cyber WiFi running on port ${PORT}`
        );

        console.log(
            'Admin dashboard: /admin/login.html'
        );

    });

}

startServer().catch(err => {

    console.error(
        'Server startup failed:',
        err
    );

    process.exit(1);

});
```
