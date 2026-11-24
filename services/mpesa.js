?:::
```javascript
const axios = require('axios');

const BASE_MPESA_URL =
  process.env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

// Generate OAuth access token
async function getAccessToken() {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    throw new Error('Missing M-Pesa API credentials');
  }

  const auth = Buffer.from(
    `${consumerKey}:${consumerSecret}`
  ).toString('base64');

  const response = await axios.get(
    `${BASE_MPESA_URL}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: {
        Authorization: `Basic ${auth}`
      }
    }
  );

  return response.data.access_token;
}

// Format Kenyan phone numbers
function formatPhone(phone) {
  let clean = String(phone)
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

// Generate Safaricom timestamp
function generateTimestamp() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000)
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
}

// Initiate STK Push
async function initiateSTKPush({
  phone,
  amount,
  accountRef,
  description
}) {
  try {
    const shortcode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;
    const tillNumber = process.env.MPESA_TILL_NUMBER;

    if (!shortcode || !passkey || !tillNumber) {
      throw new Error('Missing M-Pesa shortcode, passkey or Till number');
    }

    const numericAmount = Number(amount);

    if (
      !Number.isFinite(numericAmount) ||
      numericAmount < 1
    ) {
      throw new Error('Invalid payment amount');
    }

    const customerPhone = formatPhone(phone);

    const token = await getAccessToken();

    const timestamp = generateTimestamp();

    const password = Buffer.from(
      `${shortcode}${passkey}${timestamp}`
    ).toString('base64');

    const callbackURL =
      `${process.env.BASE_URL.replace(/\/+$/, '')}/api/mpesa/callback`;

    const payload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,

      TransactionType:
        process.env.MPESA_TRANSACTION_TYPE ||
        'CustomerBuyGoodsOnline',

      Amount: Math.round(numericAmount),

      PartyA: customerPhone,

      PartyB: tillNumber,

      PhoneNumber: customerPhone,

      CallBackURL: callbackURL,

      AccountReference: String(accountRef || 'PAYMENT')
        .slice(0, 12),

      TransactionDesc: String(description || 'Website payment')
        .slice(0, 13)
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
      JSON.stringify(
        error.response?.data || error.message,
        null,
        2
      )
    );

    throw new Error(
      error.response?.data?.errorMessage ||
      error.response?.data?.ResponseDescription ||
      error.message ||
      'M-Pesa payment failed'
    );
  }
}

module.exports = {
  initiateSTKPush,
  formatPhone,
  getAccessToken
};
```
