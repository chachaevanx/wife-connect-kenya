const axios = require('axios');

const BASE_MPESA_URL = process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

async function getAccessToken() {
  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString('base64');

  const res = await axios.get(
    `${BASE_MPESA_URL}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  return res.data.access_token;
}

function formatPhone(phone) {
  let clean = phone.replace(/\s+/g, '').replace('+', '');
  if (clean.startsWith('0')) clean = '254' + clean.slice(1);
  if (clean.startsWith('7') || clean.startsWith('1')) clean = '254' + clean;
  return clean;
}

async function initiateSTKPush({ phone, amount, accountRef, description }) {
  try {
    const token = await getAccessToken();
    const timestamp = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(
      `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
    ).toString('base64');

    const payload = {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: formatPhone(phone),
      PartyB: process.env.MPESA_SHORTCODE,
      PhoneNumber: formatPhone(phone),
      CallBackURL: `${(process.env.BASE_URL || 'https://wife-connect-kenya-1.onrender.com').replace(/\/+$/, '')}/api/mpesa/callback`,
      AccountReference: accountRef,
      TransactionDesc: description
    };

    const res = await axios.post(`${BASE_MPESA_URL}/mpesa/stkpush/v1/processrequest`, payload, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.data;
  } catch (err) {
    console.error('STK Push Error:', err.response?.data || err.message);
    throw err;
  }
}

module.exports = { initiateSTKPush, formatPhone };
