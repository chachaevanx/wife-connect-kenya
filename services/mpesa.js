const axios = require('axios');

function cleanUrl(rawValue, fallbackValue) {
  const candidate = (typeof rawValue === 'string' && rawValue.trim()) ? rawValue.trim() : fallbackValue;
  return candidate.replace(/\/+$/, '');
}

function getMpesaConfig() {
  const env = String(process.env.MPESA_ENV || 'sandbox').trim().toLowerCase();
  const mpesaUrl = cleanUrl(process.env.MPESA_URL, 'https://sandbox.safaricom.co.ke');
  const baseUrl = cleanUrl(process.env.BASE_URL, 'https://wife-connect-kenya-1.onrender.com');
  const apiBaseUrl = env === 'production' ? 'https://api.safaricom.co.ke' : mpesaUrl;
  const callbackUrl = `${baseUrl}/api/mpesa/callback`;

  const consumerKey = String(process.env.MPESA_CONSUMER_KEY || '').trim();
  const consumerSecret = String(process.env.MPESA_CONSUMER_SECRET || '').trim();
  const shortcode = String(process.env.MPESA_SHORTCODE || '').trim();
  const tillNumber = String(process.env.MPESA_TILL_NUMBER || shortcode).trim();
  const passkey = String(process.env.MPESA_PASSKEY || '').trim();
  const transactionType = String(
    process.env.MPESA_TRANSACTION_TYPE || 'CustomerBuyGoodsOnline'
  ).trim();

  return {
    env,
    apiBaseUrl,
    callbackUrl,
    consumerKey,
    consumerSecret,
    shortcode,
    tillNumber,
    passkey,
    transactionType
  };
}

function assertValidHttpsUrl(label, value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (err) {
    throw new Error(`Invalid ${label} ("${value}"): ${err.message}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} ("${value}") must use HTTPS`);
  }
}

function validateConfig(cfg = getMpesaConfig()) {
  const requiredFields = [
    ['MPESA_CONSUMER_KEY', cfg.consumerKey],
    ['MPESA_CONSUMER_SECRET', cfg.consumerSecret],
    ['MPESA_SHORTCODE', cfg.shortcode],
    ['MPESA_PASSKEY', cfg.passkey]
  ];

  for (const [name, val] of requiredFields) {
    if (!val) {
      throw new Error(`Missing environment variable: ${name}`);
    }
  }

  if (!cfg.tillNumber) {
    throw new Error('Missing MPESA_TILL_NUMBER');
  }

  assertValidHttpsUrl('API_BASE_URL', cfg.apiBaseUrl);
  assertValidHttpsUrl('CALLBACK_URL', cfg.callbackUrl);

  return cfg;
}

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

  const values = {};
  for (const part of parts) {
    values[part.type] = part.value;
  }

  return (
    values.year +
    values.month +
    values.day +
    values.hour +
    values.minute +
    values.second
  );
}

function formatPhone(phone) {
  let clean = String(phone || '').replace(/\D/g, '');

  if (clean.startsWith('0')) {
    clean = '254' + clean.slice(1);
  } else if (clean.startsWith('7') || clean.startsWith('1')) {
    clean = '254' + clean;
  }

  if (!/^254[17]\d{8}$/.test(clean)) {
    throw new Error('Invalid phone number. Use 07XXXXXXXX, 01XXXXXXXX, or 2547XXXXXXXX.');
  }

  return clean;
}

async function getAccessToken(existingConfig) {
  const cfg = validateConfig(existingConfig);
  const credentials = Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString('base64');

  try {
    const response = await axios.get(
      `${cfg.apiBaseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: { Authorization: `Basic ${credentials}` },
        timeout: 20000
      }
    );

    if (!response.data || !response.data.access_token) {
      throw new Error('Safaricom did not return an access token.');
    }

    return response.data.access_token;
  } catch (error) {
    console.error('M-PESA TOKEN ERROR:', error.response?.data || error.message);
    throw error;
  }
}

async function initiateSTKPush({ phone, amount, accountRef = 'WIFI-PAYMENT', description = 'WiFi Payment' }) {
  try {
    const cfg = validateConfig();
    const formattedPhone = formatPhone(phone);
    const paymentAmount = Math.round(Number(amount));

    if (!Number.isFinite(paymentAmount) || paymentAmount < 1) {
      throw new Error('Payment amount must be at least KSh 1.');
    }

    const token = await getAccessToken(cfg);
    const timestamp = generateTimestamp();
    const password = Buffer.from(
      `${cfg.shortcode}${cfg.passkey}${timestamp}`
    ).toString('base64');

    const payload = {
      BusinessShortCode: cfg.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: cfg.transactionType,
      Amount: paymentAmount,
      PartyA: formattedPhone,
      PartyB: cfg.tillNumber,
      PhoneNumber: formattedPhone,
      CallBackURL: cfg.callbackUrl,
      AccountReference: String(accountRef).slice(0, 12),
      TransactionDesc: String(description).slice(0, 13)
    };

    console.log('Initiating M-Pesa STK Push...', {
      env: cfg.env,
      apiBaseUrl: cfg.apiBaseUrl,
      shortcode: cfg.shortcode,
      tillNumber: cfg.tillNumber,
      transactionType: cfg.transactionType,
      phone: formattedPhone,
      amount: paymentAmount,
      callbackUrl: cfg.callbackUrl
    });

    const response = await axios.post(
      `${cfg.apiBaseUrl}/mpesa/stkpush/v1/processrequest`,
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
    console.error('STK PUSH FAILED');
    console.error('HTTP STATUS:', error.response?.status);
    console.error('SAFARICOM RESPONSE:', error.response?.data || error.message);
    throw error;
  }
}

module.exports = {
  getAccessToken,
  initiateSTKPush,
  formatPhone
};
