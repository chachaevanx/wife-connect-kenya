const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing.');
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 20000
});

pool.on('error', error => {
    console.error('PostgreSQL error:', error.message);
});

async function initDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS transactions (
            id BIGSERIAL PRIMARY KEY,
            checkout_id TEXT UNIQUE NOT NULL,
            phone TEXT NOT NULL,
            package_id TEXT NOT NULL,
            package_label TEXT,
            amount INTEGER NOT NULL,
            mac TEXT,
            status TEXT NOT NULL DEFAULT 'PENDING',
            voucher TEXT UNIQUE,
            mpesa_receipt TEXT UNIQUE,
            paid_at TIMESTAMPTZ,
            expires_at TIMESTAMPTZ,
            devices INTEGER DEFAULT 1,
            callback_data JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS subscriptions (
            id BIGSERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            phone TEXT NOT NULL,
            package_id TEXT NOT NULL,
            package_label TEXT,
            amount INTEGER NOT NULL,
            devices INTEGER DEFAULT 1,
            paid_at TIMESTAMPTZ NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            status TEXT NOT NULL DEFAULT 'ACTIVE',
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_transactions_status
        ON transactions(status);

        CREATE INDEX IF NOT EXISTS idx_subscription_expiry
        ON subscriptions(status, expires_at);
    `);

    console.log('Neon PostgreSQL database initialized.');
}

module.exports = {
    pool,
    initDatabase
};
