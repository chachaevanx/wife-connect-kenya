-- WIFE CONNECT KENYA ADMIN DATABASE

CREATE TABLE IF NOT EXISTS admin_users (
    id SERIAL PRIMARY KEY,

    slot INTEGER NOT NULL UNIQUE
        CHECK (slot IN (1, 2)),

    full_name VARCHAR(150) NOT NULL,

    email VARCHAR(255) NOT NULL UNIQUE,

    phone VARCHAR(30),

    password_hash TEXT NOT NULL,

    profile_image BYTEA,

    profile_image_type VARCHAR(100),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster administrator login

CREATE INDEX IF NOT EXISTS
admin_users_email_index
ON admin_users (LOWER(email));

-- Only two administrator slots are permitted.
