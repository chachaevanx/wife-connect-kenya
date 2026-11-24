const axios = require('axios');

const BASE_MPESA_URL = process.env.MPESA_ENV === 'production'
  ? '[https://api.safaricom.co.ke](https://api.safaricom.co.ke)'
  : '[https://sandbox.safaricom.co.ke](https://sandbox.safaricom.co.ke)';

// Generate OAuth access token
async function getAccessToken() {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    throw new Error('Missing M-Pesa API credentials');
  }

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

  const response = await axios.get(
    `${BASE_MPESA_URL}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 15000
    }
  );

  return response.data.access_token;
}

// Format Kenyan phone numbers to 2547XXXXXXXX or 2541XXXXXXXX
function formatPhone(phone) {
  let clean = String(phone || '')
    .replace(/\s+/g, '')
    .replace(/^\+/, '');

  if (clean.startsWith('0')) {
    clean = '254' + clean.slice(1);
  } else if (clean.startsWith('7') || clean.startsWith('1')) {
    clean = '254' + clean;
  }

  if (!/^254[17]\d{8}$/.test(clean)) {
    throw new Error('Invalid Kenyan phone number');
  }

  return clean;
}

// Generate Safaricom timestamp (YYYYMMDDHHmmss in EAT / UTC+3)
function generateTimestamp() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000)
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
}

// Initiate STK Push for Buy Goods (Till)
async function initiateSTKPush({ phone, amount, accountRef, description }) {
  try {
    const businessShortCode = process.env.MPESA_SHORTCODE;
    const tillNumber = process.env.MPESA_TILL_NUMBER || process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;

    if (!businessShortCode || !tillNumber || !passkey) {
      throw new Error('Missing MPESA_SHORTCODE, MPESA_TILL_NUMBER, or MPESA_PASSKEY');
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 1) {
      throw new Error('Invalid payment amount');
    }

    const customerPhone = formatPhone(phone);
    const token = await getAccessToken();
    const timestamp = generateTimestamp();
    const password = Buffer.from(
      `${businessShortCode}${passkey}${timestamp}`
    ).toString('base64');

    const baseUrl = (process.env.BASE_URL || '[https://wife-connect-kenya-1.onrender.com](https://wife-connect-kenya-1.onrender.com)')
      .trim()
      .replace(/\/+$/, '');
    const callbackURL = `${baseUrl}/api/mpesa/callback`;

    const payload = {
      BusinessShortCode: String(businessShortCode).trim(),
      Password: password,
      Timestamp: timestamp,
      TransactionType: process.env.MPESA_TRANSACTION_TYPE || 'CustomerBuyGoodsOnline',
      Amount: Math.round(numericAmount),
      PartyA: customerPhone,
      PartyB: String(tillNumber).trim(),
      PhoneNumber: customerPhone,
      CallBackURL: callbackURL,
      AccountReference: String(accountRef || 'GALAXY').slice(0, 12),
      TransactionDesc: String(description || 'WiFi Plan').slice(0, 13)
    };

    const response = await axios.post(
      `${BASE_MPESA_URL}/mpesa/stkpush/v1/processrequest`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    console.log('STK Push Response:', response.data);
    return response.data;
  } catch (error) {
    console.error(
      'STK PUSH FAILED:',
      JSON.stringify(error.response?.data || error.message, null, 2)
    );
    throw new Error(
      error.response?.data?.errorMessage ||
      error.response?.data?.ResponseDescription ||
      error.message ||
      'M-Pesa payment failed'
    );
  }
}

module.exports = { initiateSTKPush, formatPhone, getAccessToken };
