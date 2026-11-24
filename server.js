require('dotenv').config();
const express = require('express');
const path = require('path');
const cron = require('node-cron');
const PACKAGES = require('./packages');
const { initiateSTKPush, formatPhone } = require('./services/mpesa');
const { activateHotspotUser, disconnectAndRemoveUser } = require('./services/mikrotik');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory store (Replace with PostgreSQL/MongoDB in production on Render)
const pendingTransactions = new Map();
const activeSubscriptions = [];

// 1. Fetch available packages
app.get('/api/packages', (req, res) => {
  res.json(PACKAGES);
});

// 2. Trigger STK Push when user clicks Pay
app.post('/api/pay', async (req, res) => {
  try {
    const { phone, packageId, mac } = req.body;
    const pkg = PACKAGES.find((p) => p.id === packageId);
    if (!pkg) return res.status(400).json({ error: 'Invalid package selected' });

    const formattedPhone = formatPhone(phone);
    const stkRes = await initiateSTKPush({
      phone: formattedPhone,
      amount: pkg.price,
      accountRef: pkg.id.toUpperCase(),
      description: pkg.label
    });

    // Save pending transaction keyed by CheckoutRequestID
    pendingTransactions.set(stkRes.CheckoutRequestID, {
      phone: formattedPhone,
      pkg,
      mac: mac || '',
      status: 'PENDING',
      voucher: null
    });

    res.json({
      message: 'STK Push sent. Enter your M-Pesa PIN.',
      checkoutRequestId: stkRes.CheckoutRequestID
    });
  } catch (err) {
    console.error('STK Push Error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to initiate M-Pesa payment' });
  }
});

// 3. Safaricom Daraja Callback URL
app.post('/api/mpesa/callback', async (req, res) => {
  const callbackData = req.body?.Body?.stkCallback;
  if (!callbackData) return res.sendStatus(400);

  const checkoutId = callbackData.CheckoutRequestID;
  const tx = pendingTransactions.get(checkoutId);

  if (callbackData.ResultCode === 0 && tx) {
    // Generate clean 6-character uppercase voucher/username
    const voucherCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    try {
      await activateHotspotUser({
        username: voucherCode,
        password: voucherCode, // Same username & password for easy 2nd device login
        pkg: tx.pkg,
        macAddress: tx.mac
      });

      const expiresAt = Date.now() + tx.pkg.hours * 60 * 60 * 1000;
      activeSubscriptions.push({ username: voucherCode, expiresAt });

      tx.status = 'SUCCESS';
      tx.voucher = voucherCode;
      console.log(`Activated ${voucherCode} (${tx.pkg.label}) for ${tx.phone}`);
    } catch (mikrotikErr) {
      console.error('MikroTik Provisioning Error:', mikrotikErr.message);
      tx.status = 'MIKROTIK_ERROR';
    }
  } else if (tx) {
    tx.status = 'FAILED';
  }

  // Always acknowledge receipt to Safaricom
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// 4. Frontend polls this endpoint to auto-login the user once paid
app.get('/api/status/:checkoutId', (req, res) => {
  const tx = pendingTransactions.get(req.params.checkoutId);
  if (!tx) return res.status(404).json({ status: 'NOT_FOUND' });
  res.json({
    status: tx.status,
    voucher: tx.voucher,
    devices: tx.pkg.devices
  });
});

// 5. Cron Job: Runs every minute to disconnect expired users
cron.schedule('* * * * *', async () => {
  const now = Date.now();
  for (let i = activeSubscriptions.length - 1; i >= 0; i--) {
    if (now >= activeSubscriptions[i].expiresAt) {
      const expiredUser = activeSubscriptions[i].username;
      try {
        await disconnectAndRemoveUser(expiredUser);
        console.log(`Disconnected expired user: ${expiredUser}`);
        activeSubscriptions.splice(i, 1);
      } catch (err) {
        console.error(`Failed to disconnect ${expiredUser}:`, err.message);
      }
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Billing server running on port ${PORT}`));
