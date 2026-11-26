require('dotenv').config();

const express = require('express');
const path = require('path');
const cron = require('node-cron');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const PACKAGES = require('./packages');

const { pool, initDatabase } = require('./database');

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
// SECURITY
// ======================================

if (
    !process.env.ADMIN_JWT_SECRET ||
    process.env.ADMIN_JWT_SECRET.length < 32
) {
    throw new Error(
        'ADMIN_JWT_SECRET must contain at least 32 characters.'
    );
}

app.use('/api/admin', adminRoutes);

// ======================================
// HELPER FUNCTIONS
// ======================================

function generateVoucher() {
    return crypto.randomBytes(5).toString('hex').toUpperCase();
}

function getPackage(packageId) {
    return PACKAGES.find(pkg => pkg.id === packageId);
}

function getPackageDuration(pkg) {
    const hours = Number(pkg.hours);

    if (!Number.isFinite(hours) || hours <= 0) {
        throw new Error('Invalid package duration.');
    }

    return hours;
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
            throw new Error('Missing M-Pesa CheckoutRequestID.');
        }

        await pool.query(
            `INSERT INTO transactions (
                checkout_id,
                phone,
                package_id,
                package_label,
                amount,
                mac,
                status,
                devices
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                stkRes.CheckoutRequestID,
                formattedPhone,
                pkg.id,
                pkg.label,
                pkg.price,
                mac || '',
                'PENDING',
                pkg.devices || 1
            ]
        );

        res.json({
            message: 'STK Push sent. Enter your M-Pesa PIN.',
            checkoutRequestId: stkRes.CheckoutRequestID
        });

    } catch (error) {
        console.error(
            'STK Push error:',
            error.response?.data || error.message
        );

        res.status(500).json({
            error: 'Failed to initiate M-Pesa payment.'
        });
    }
});

// ======================================
// PROVISION PAID VOUCHER
// ======================================

async function provisionTransaction(tx) {
    const pkg = getPackage(tx.package_id);

    if (!pkg) {
        throw new Error('Package no longer exists.');
    }

    const paidAt = new Date(tx.paid_at);
    const expiresAt = new Date(tx.expires_at);

    if (expiresAt <= new Date()) {
        await pool.query(
            `UPDATE transactions
             SET status = 'EXPIRED',
                 updated_at = NOW()
             WHERE checkout_id = $1
             AND status = 'PROCESSING'`,
            [tx.checkout_id]
        );

        return;
    }

    await activateHotspotUser({
        username: tx.voucher,
        password: tx.voucher,
        pkg,
        macAddress: tx.mac,
        expiresAt: expiresAt.getTime()
    });

    await pool.query(
        `INSERT INTO subscriptions (
            username,
            phone,
            package_id,
            package_label,
            amount,
            devices,
            paid_at,
            expires_at,
            status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE')
        ON CONFLICT (username)
        DO UPDATE SET
            expires_at = EXCLUDED.expires_at,
            status = 'ACTIVE'`,
        [
            tx.voucher,
            tx.phone,
            tx.package_id,
            pkg.label,
            tx.amount,
            tx.devices,
            paidAt,
            expiresAt
        ]
    );

    await pool.query(
        `UPDATE transactions
         SET status = 'SUCCESS',
             updated_at = NOW()
         WHERE checkout_id = $1
         AND status = 'PROCESSING'`,
        [tx.checkout_id]
    );

    console.log(
        `Voucher activated: ${tx.voucher}`
    );
}

// ======================================
// M-PESA CALLBACK
// ======================================

app.post('/api/mpesa/callback', async (req, res) => {
    try {
        const callbackData = req.body?.Body?.stkCallback;

        if (!callbackData) {
            return res.status(400).json({
                error: 'Invalid callback.'
            });
        }

        const checkoutId = callbackData.CheckoutRequestID;

        const result = await pool.query(
            `SELECT *
             FROM transactions
             WHERE checkout_id = $1`,
            [checkoutId]
        );

        const tx = result.rows[0];

        if (!tx) {
            console.error('Unknown M-Pesa transaction:', checkoutId);

            return res.json({
                ResultCode: 0,
                ResultDesc: 'Accepted'
            });
        }

        if (
            ['SUCCESS', 'PROCESSING', 'EXPIRED'].includes(tx.status)
        ) {
            return res.json({
                ResultCode: 0,
                ResultDesc: 'Already processed.'
            });
        }

        if (Number(callbackData.ResultCode) !== 0) {
            await pool.query(
                `UPDATE transactions
                 SET status = 'FAILED',
                     callback_data = $1,
                     updated_at = NOW()
                 WHERE checkout_id = $2
                 AND status = 'PENDING'`,
                [JSON.stringify(callbackData), checkoutId]
            );

            return res.json({
                ResultCode: 0,
                ResultDesc: 'Payment failed.'
            });
        }

        const metadata =
            callbackData.CallbackMetadata?.Item || [];

        const receipt = metadata.find(
            item => item.Name === 'MpesaReceiptNumber'
        )?.Value;

        const amount = Number(
            metadata.find(item => item.Name === 'Amount')?.Value
        );

        const callbackPhone = metadata.find(
            item => item.Name === 'PhoneNumber'
        )?.Value;

        let formattedCallbackPhone;

        try {
            formattedCallbackPhone = formatPhone(callbackPhone);
        } catch {
            formattedCallbackPhone = '';
        }

        if (
            !receipt ||
            !Number.isFinite(amount) ||
            amount !== Number(tx.amount) ||
            formattedCallbackPhone !== tx.phone
        ) {
            await pool.query(
                `UPDATE transactions
                 SET status = 'PAYMENT_REVIEW',
                     callback_data = $1,
                     updated_at = NOW()
                 WHERE checkout_id = $2
                 AND status = 'PENDING'`,
                [JSON.stringify(callbackData), checkoutId]
            );

            console.error(
                'Payment requires manual verification:',
                checkoutId
            );

            return res.json({
                ResultCode: 0,
                ResultDesc: 'Payment requires verification.'
            });
        }

        const pkg = getPackage(tx.package_id);

        if (!pkg) {
            throw new Error('Package not found.');
        }

        const voucher = generateVoucher();

        // Atomic payment confirmation.
        // Countdown starts at confirmation time.

        const confirmed = await pool.query(
            `UPDATE transactions
             SET status = 'PROCESSING',
                 voucher = $1,
                 mpesa_receipt = $2,
                 paid_at = NOW(),
                 expires_at = NOW() + ($3 * INTERVAL '1 hour'),
                 callback_data = $4,
                 updated_at = NOW()
             WHERE checkout_id = $5
             AND status = 'PENDING'
             RETURNING *`,
            [
                voucher,
                receipt,
                getPackageDuration(pkg),
                JSON.stringify(callbackData),
                checkoutId
            ]
        );

        if (confirmed.rowCount !== 1) {
            return res.json({
                ResultCode: 0,
                ResultDesc: 'Already processing.'
            });
        }

        // Automatically create the voucher.

        await provisionTransaction(confirmed.rows[0]);

        res.json({
            ResultCode: 0,
            ResultDesc: 'Payment processed.'
        });

    } catch (error) {
        console.error(
            'M-Pesa callback error:',
            error.message
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
        const result = await pool.query(
            `SELECT status, voucher, devices, expires_at
             FROM transactions
             WHERE checkout_id = $1`,
            [req.params.checkoutId]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                status: 'NOT_FOUND'
            });
        }

        const tx = result.rows[0];

        res.json({
            status: tx.status,
            voucher: tx.status === 'SUCCESS' ? tx.voucher : null,
            devices: tx.devices,
            expiresAt: tx.expires_at
        });

    } catch (error) {
        console.error(error.message);

        res.status(500).json({
            error: 'Could not check payment status.'
        });
    }
});

// ======================================
// RECOVER UNFINISHED VOUCHER CREATION
// ======================================

let recoveryRunning = false;

async function recoverPendingTransactions() {
    if (recoveryRunning) return;

    recoveryRunning = true;

    try {
        const result = await pool.query(
            `SELECT *
             FROM transactions
             WHERE status = 'PROCESSING'
             ORDER BY paid_at ASC
             LIMIT 20`
        );

        for (const tx of result.rows) {
            try {
                await provisionTransaction(tx);
            } catch (error) {
                console.error(
                    `Voucher recovery failed for ${tx.checkout_id}:`,
                    error.message
                );
            }
        }

    } catch (error) {
        console.error('Recovery error:', error.message);

    } finally {
        recoveryRunning = false;
    }
}

// ======================================
// AUTOMATIC EXPIRY
// ======================================

let expiryRunning = false;

async function checkExpiredSubscriptions() {
    if (expiryRunning) return;

    expiryRunning = true;

    try {
        const result = await pool.query(
            `SELECT username
             FROM subscriptions
             WHERE status = 'ACTIVE'
             AND expires_at <= NOW()
             LIMIT 50`
        );

        for (const subscription of result.rows) {
            try {
                await disconnectAndRemoveUser(
                    subscription.username
                );

                await pool.query(
                    `UPDATE subscriptions
                     SET status = 'EXPIRED'
                     WHERE username = $1
                     AND status = 'ACTIVE'`,
                    [subscription.username]
                );

                await pool.query(
                    `UPDATE transactions
                     SET status = 'EXPIRED',
                         updated_at = NOW()
                     WHERE voucher = $1
                     AND status = 'SUCCESS'`,
                    [subscription.username]
                );

                console.log(
                    'Expired voucher blocked:',
                    subscription.username
                );

            } catch (error) {
                console.error(
                    `Expiry error for ${subscription.username}:`,
                    error.message
                );
            }
        }

    } catch (error) {
        console.error('Expiry checker error:', error.message);

    } finally {
        expiryRunning = false;
    }
}

// Check every minute.
cron.schedule('* * * * *', async () => {
    await recoverPendingTransactions();
    await checkExpiredSubscriptions();
});

// ======================================
// ADMIN PAGE
// ======================================

app.get('/admin', (req, res) => {
    res.redirect('/admin/login.html');
});

// ======================================
// HEALTH CHECK
// ======================================

app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');

        res.json({
            status: 'online',
            database: 'connected',
            service: 'Galex Cyber WiFi Billing',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        res.status(503).json({
            status: 'error',
            database: 'disconnected'
        });
    }
});

// ======================================
// START SERVER
// ======================================

const PORT = process.env.PORT || 3000;

async function startServer() {
    await initDatabase();

    await recoverPendingTransactions();
    await checkExpiredSubscriptions();

    app.listen(PORT, () => {
        console.log(
            `Galex Cyber WiFi running on port ${PORT}`
        );

        console.log('Neon PostgreSQL connected.');
        console.log('Admin dashboard: /admin/login.html');
    });
}

startServer().catch(error => {
    console.error('Server startup failed:', error);
    process.exit(1);
});
