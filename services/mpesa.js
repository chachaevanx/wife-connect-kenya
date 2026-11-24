const axios = require('axios');

// ==========================================
// M-PESA CONFIGURATION
// ==========================================

const MPESA_URL = (
    process.env.MPESA_URL || 'https://sandbox.safaricom.co.ke'
).trim().replace(/\/+$/, '');

const BASE_URL = (
    process.env.BASE_URL || 'https://wife-connect-kenya-1.onrender.com'
).trim().replace(/\/+$/, '');

const MPESA_ENV = (process.env.MPESA_ENV || 'sandbox').toLowerCase();

const API_BASE_URL = MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : MPESA_URL;

const CALLBACK_URL = `${BASE_URL}/api/mpesa/callback`;

const SHORTCODE = process.env.MPESA_SHORTCODE;
const TILL_NUMBER = process.env.MPESA_TILL_NUMBER || SHORTCODE;
const PASSKEY = process.env.MPESA_PASSKEY;

// ==========================================
// VALIDATE CONFIGURATION
// ==========================================

function validateConfig() {
    const required = [
        'MPESA_CONSUMER_KEY',
        'MPESA_CONSUMER_SECRET',
        'MPESA_SHORTCODE',
        'MPESA_PASSKEY'
    ];

    for (const variable of required) {
        if (!process.env[variable]) {
            throw new Error(`Missing environment variable: ${variable}`);
        }
    }

    if (!TILL_NUMBER) {
        throw new Error('Missing MPESA_TILL_NUMBER');
    }

    try {
        const apiUrl = new URL(API_BASE_URL);
        const callbackUrl = new URL(CALLBACK_URL);

        if (apiUrl.protocol !== 'https:' || callbackUrl.protocol !== 'https:') {
            throw new Error('M-Pesa URLs must use HTTPS');
        }
    } catch (error) {
        throw new Error(`Invalid M-Pesa URL: ${error.message}`);
    }
}

// ==========================================
// GENERATE NAIROBI TIMESTAMP
// ==========================================

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

// ==========================================
// FORMAT KENYAN PHONE NUMBER
// ==========================================

function formatPhone(phone) {
    let clean = String(phone).replace(/\D/g, '');

    if (clean.startsWith('0')) {
        clean = '254' + clean.substring(1);
    } else if (clean.startsWith('7') || clean.startsWith('1')) {
        clean = '254' + clean;
    }

    if (!/^254[17]\d{8}$/.test(clean)) {
        throw new Error('Invalid phone number. Use 07XXXXXXXX or 2547XXXXXXXX.');
    }

    return clean;
}

// ==========================================
// GET SAFARICOM ACCESS TOKEN
// ==========================================

async function getAccessToken() {
    validateConfig();

    const credentials = Buffer.from(
        `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
    ).toString('base64');

    try {
        const response = await axios.get(
            `${API_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
            {
                headers: {
                    Authorization: `Basic ${credentials}`
                },
                timeout: 20000
            }
        );

        if (!response.data.access_token) {
            throw new Error('Safaricom did not return an access token.');
        }

        return response.data.access_token;

    } catch (error) {
        console.error(
            'M-PESA TOKEN ERROR:',
            error.response?.data || error.message
        );

        throw new Error('Unable to obtain M-Pesa access token.');
    }
}

// ==========================================
// INITIATE STK PUSH
// ==========================================

async function initiateSTKPush({
    phone,
    amount,
    accountRef = 'WIFI-PAYMENT',
    description = 'WiFi Payment'
}) {
    try {
        validateConfig();

        const formattedPhone = formatPhone(phone);
        const paymentAmount = Math.round(Number(amount));

        if (!Number.isFinite(paymentAmount) || paymentAmount < 1) {
            throw new Error('Payment amount must be at least KSh 1.');
        }

        const token = await getAccessToken();

        const timestamp = generateTimestamp();

        const password = Buffer.from(
            `${SHORTCODE}${PASSKEY}${timestamp}`
        ).toString('base64');

        const payload = {
            BusinessShortCode: SHORTCODE,
            Password: password,
            Timestamp: timestamp,

            TransactionType:
                process.env.MPESA_TRANSACTION_TYPE ||
                'CustomerBuyGoodsOnline',

            Amount: paymentAmount,
            PartyA: formattedPhone,
            PartyB: TILL_NUMBER,
            PhoneNumber: formattedPhone,

            CallBackURL: CALLBACK_URL,

            AccountReference: String(accountRef).substring(0, 12),
            TransactionDesc: String(description).substring(0, 13)
        };

        console.log('Initiating M-Pesa STK Push...');
        console.log('Phone:', formattedPhone);
        console.log('Amount:', paymentAmount);
        console.log('Callback configured:', CALLBACK_URL);

        const response = await axios.post(
            `${API_BASE_URL}/mpesa/stkpush/v1/processrequest`,
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
        console.error(
            'SAFARICOM RESPONSE:',
            error.response?.data || error.message
        );

        throw error;
    }
}

// ==========================================
// EXPORT FUNCTIONS
// ==========================================

module.exports = {
    getAccessToken,
    initiateSTKPush,
    formatPhone
};
