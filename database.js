const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing from environment variables.');
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 20000
});

pool.on('error', (error) => {
    console.error('Unexpected PostgreSQL error:', error.message);
});

async function initDatabase() {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // M-PESA TRANSACTIONS
        await client.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id BIGSERIAL PRIMARY KEY,
                checkout_id TEXT UNIQUE NOT NULL,
                merchant_request_id TEXT,
                checkout_request_id TEXT UNIQUE,
                phone TEXT NOT NULL,
                package_id TEXT NOT NULL,
                amount INTEGER NOT NULL,
                mac_address TEXT,
                status TEXT NOT NULL DEFAULT 'PENDING',
                mpesa_receipt TEXT UNIQUE,
                result_code TEXT,
                result_description TEXT,
                paid_at TIMESTAMPTZ,
                expires_at TIMESTAMPTZ,
                voucher_username TEXT,
                voucher_password TEXT,
                provisioning_status TEXT DEFAULT 'WAITING',
                callback_data JSONB,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // WIFI SUBSCRIPTIONS
        await client.query(`
            CREATE TABLE IF NOT EXISTS subscriptions (
                id BIGSERIAL PRIMARY KEY,
                checkout_id TEXT UNIQUE NOT NULL
                    REFERENCES transactions(checkout_id),
                username TEXT UNIQUE NOT NULL,
                package_id TEXT NOT NULL,
                phone TEXT NOT NULL,
                devices INTEGER NOT NULL DEFAULT 1,
                paid_at TIMESTAMPTZ NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // ADMINISTRATORS
        await client.query(`
            CREATE TABLE IF NOT EXISTS administrators (
                id BIGSERIAL PRIMARY KEY,
                slot INTEGER UNIQUE NOT NULL,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                phone TEXT,
                picture BYTEA,
                picture_type TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // DATABASE INDEXES
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_transactions_status
            ON transactions(status);
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_transactions_created
            ON transactions(created_at);
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_subscriptions_expiry
            ON subscriptions(expires_at);
        `);

        await client.query('COMMIT');

        console.log('PostgreSQL database initialized successfully.');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Database initialization failed:', error.message);
        throw error;

    } finally {
        client.release();
    }
}

module.exports = {
    pool,
    initDatabase
};
