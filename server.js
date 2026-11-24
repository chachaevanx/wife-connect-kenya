require('dotenv').config();

const express = require('express');
const path = require('path');
const cron = require('node-cron');
const cookieParser = require('cookie-parser');

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
// ADMIN CONFIGURATION
// ======================================

if (!process.env.ADMIN_JWT_SECRET ||
    process.env.ADMIN_JWT_SECRET.length < 32) {
    throw new Error(
        'ADMIN_JWT_SECRET must contain at least 32 characters.'
    );
}

app.use('/api/admin', adminRoutes);

// ======================================
// TRANSACTION STORAGE
// ======================================

// These records are temporary.
// They will be lost when the server restarts.

const pendingTransactions = new Map();

const activeSubscriptions = [];

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

        const pkg = PACKAGES.find(
            p => p.id === packageId
        );

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
                'Safaricom did not return a CheckoutRequestID.'
            );
        }

        pendingTransactions.set(
            stkRes.CheckoutRequestID,
            {
                phone: formattedPhone,
                pkg,
                mac: mac || '',
                status: 'PENDING',
                voucher: null,
                amount: pkg.price,
                createdAt: Date.now()
            }
        );

        res.json({

            message: 'STK Push sent. Enter your M-Pesa PIN.',

            checkoutRequestId: stkRes.CheckoutRequestID

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

        const callbackData = req.body?.Body?.stkCallback;

        if (!callbackData) {
            return res.status(400).json({
                error: 'Invalid callback.'
            });
        }

        const checkoutId = callbackData.CheckoutRequestID;

        const tx = pendingTransactions.get(checkoutId);

        if (!tx) {

            console.log(
                'Callback received for unknown transaction:',
                checkoutId
            );

            return res.json({
                ResultCode: 0,
                ResultDesc: 'Accepted'
            });

        }

        if (
            tx.status === 'SUCCESS' ||
            tx.status === 'PROCESSING'
        ) {
            return res.json({
                ResultCode: 0,
                ResultDesc: 'Already processing or completed'
            });
        }

        if (callbackData.ResultCode === 0) {

            tx.status = 'PROCESSING';

            const voucherCode = Math.random()
                .toString(36)
                .substring(2, 8)
                .toUpperCase();

            try {

                await activateHotspotUser({

                    username: voucherCode,

                    password: voucherCode,

                    pkg: tx.pkg,

                    macAddress: tx.mac

                });

                const expiresAt =
                    Date.now() +
                    tx.pkg.hours * 60 * 60 * 1000;

                activeSubscriptions.push({

                    username: voucherCode,

                    phone: tx.phone,

                    package: tx.pkg.label,

                    amount: tx.pkg.price,

                    devices: tx.pkg.devices,

                    expiresAt

                });

                tx.status = 'SUCCESS';

                tx.voucher = voucherCode;

                console.log(
                    `Activated ${voucherCode} for ${tx.phone}`
                );

            } catch (mikrotikErr) {

                console.error(
                    'MikroTik Provisioning Error:',
                    mikrotikErr.message
                );

                tx.status = 'MIKROTIK_ERROR';

            }

        } else {

            tx.status = 'FAILED';

        }

        res.json({

            ResultCode: 0,

            ResultDesc: 'Accepted'

        });

    } catch (err) {

        console.error(
            'Callback processing error:',
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

app.get('/api/status/:checkoutId', (req, res) => {

    const tx = pendingTransactions.get(
        req.params.checkoutId
    );

    if (!tx) {

        return res.status(404).json({

            status: 'NOT_FOUND'

        });

    }

    res.json({

        status: tx.status,

        voucher: tx.voucher,

        devices: tx.pkg.devices

    });

});

// ======================================
// ADMIN DASHBOARD DATA
// ======================================

app.get('/api/admin/overview-data', (req, res) => {

    res.status(404).json({

        error: 'Use the authenticated admin overview endpoint.'

    });

});

// ======================================
// AUTOMATIC SUBSCRIPTION EXPIRY
// ======================================

cron.schedule('* * * * *', async () => {

    const now = Date.now();

    for (
        let i = activeSubscriptions.length - 1;
        i >= 0;
        i--
    ) {

        if (now >= activeSubscriptions[i].expiresAt) {

            const expiredUser =
                activeSubscriptions[i].username;

            try {

                await disconnectAndRemoveUser(expiredUser);

                console.log(
                    `Disconnected expired user: ${expiredUser}`
                );

                activeSubscriptions.splice(i, 1);

            } catch (err) {

                console.error(
                    `Failed to disconnect ${expiredUser}:`,
                    err.message
                );

            }

        }

    }

});

// ======================================
// ADMIN LOGIN PAGE
// ======================================

app.get('/admin', (req, res) => {

    res.redirect('/admin/login.html');

});

// ======================================
// SERVER START
// ======================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

    console.log(
        `WIFE CONNECT KENYA running on port ${PORT}`
    );

    console.log(
        'Admin dashboard: /admin/login.html'
    );

});
