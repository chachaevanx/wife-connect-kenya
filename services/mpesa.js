```javascript
const axios = require('axios');

// Safaricom API environment
const BASE_MPESA_URL =
  process.env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

// Generate OAuth access token
async function getAccessToken() {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    throw new Error('Missing M-Pesa Consumer Key or Consumer Secret');
  }

  const auth = Buffer.from(
    `${consumerKey}:${consumerSecret}`
  ).toString('base64');

  const response = await axios.get(
    `${BASE_MPESA_URL}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: {
        Authorization: `Basic ${auth}`
      },
      timeout: 15000
    }
  );

  return response.data.access_token;
}

// Format Kenyan phone numbers
function formatPhone(phone) {
  let clean = String(phone || '')
    .trim()
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

// Generate timestamp in Kenya time
function generateTimestamp() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map(part => [part.type, part.value])
  );

  return (
    values.year +
    values.month +
    values.day +
    values.hour +
    values.minute +
    values.second
  );
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
    const tillNumber = process.env.MPESA_TILL_NUMBER;
    const passkey = process.env.MPESA_PASSKEY;

    if (!shortcode || !tillNumber || !passkey) {
      throw new Error('Missing M-Pesa shortcode, Till number or Passkey');
    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount < 1) {
      throw new Error('Invalid payment amount');
    }

    const customerPhone = formatPhone(phone);

    const token = await getAccessToken();

    const timestamp = generateTimestamp();

    // Generate STK Push password
    const password = Buffer.from(
      `${shortcode}${passkey}${timestamp}`
    ).toString('base64');

    // Callback URL
    const callbackBase =
      process.env.BASE_URL ||
      process.env.MPESA_URL ||
      'https://wife-connect-kenya-1.onrender.com';

    const callbackURL =
      `${callbackBase.trim().replace(/\/+$/, '')}/api/mpesa/callback`;

    // STK Push request
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

      AccountReference: String(accountRef || 'WIFI PAYMENT')
        .slice(0, 12),

      TransactionDesc: String(description || 'WiFi Payment')
        .slice(0, 13)
    };

    console.log('Initiating M-Pesa STK Push');
    console.log('Environment:', process.env.MPESA_ENV);
    console.log('Shortcode configured:', Boolean(shortcode));
    console.log('Till configured:', Boolean(tillNumber));
    console.log('Customer phone:', customerPhone);
    console.log('Amount:', payload.Amount);
    console.log('Callback URL:', callbackURL);

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

    console.log('STK PUSH RESPONSE:', response.data);

    return response.data;

  } catch (error) {
    console.error('========== MPESA ERROR ==========');
    console.error('HTTP STATUS:', error.response?.status);

    console.error(
      'SAFARICOM RESPONSE:',
      JSON.stringify(error.response?.data || {}, null, 2)
    );

    console.error('ERROR MESSAGE:', error.message);
    console.error('=================================');

    throw error;
  }
}

module.exports = {
  initiateSTKPush,
  formatPhone,
  getAccessToken
};
```
