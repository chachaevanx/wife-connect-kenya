```javascript
const RouterOSAPI = require('node-routeros').RouterOSAPI;

function getClient() {
    return new RouterOSAPI({
        host: process.env.MIKROTIK_HOST,
        port: Number(process.env.MIKROTIK_PORT || 8728),
        user: process.env.MIKROTIK_USER,
        password: process.env.MIKROTIK_PASS,
        timeout: 10
    });
}

// ======================================
// ACTIVATE HOTSPOT USER
// ======================================

async function activateHotspotUser({
    username,
    password,
    pkg,
    macAddress,
    expiresAt
}) {

    const conn = getClient();

    await conn.connect();

    try {

        if (!expiresAt || expiresAt <= Date.now()) {
            throw new Error('Invalid or expired voucher.');
        }

        const existing = await conn.write(
            '/ip/hotspot/user/print',
            [`?name=${username}`]
        );

        if (existing.length > 0) {
            throw new Error('Voucher already exists.');
        }

        const remainingSeconds = Math.floor(
            (expiresAt - Date.now()) / 1000
        );

        if (remainingSeconds <= 0) {
            throw new Error('Package has expired.');
        }

        const userParams = [
            `=name=${username}`,
            `=password=${password}`,
            `=profile=${pkg.profile}`,
            `=limit-uptime=${remainingSeconds}s`,
            `=comment=PAID_${pkg.id}_EXPIRES_${expiresAt}`
        ];

        // Restrict single-device packages.
        if (pkg.devices === 1 && macAddress) {
            userParams.push(
                `=mac-address=${macAddress}`
            );
        }

        await conn.write(
            '/ip/hotspot/user/add',
            userParams
        );

    } finally {

        conn.close();

    }

}

// ======================================
// DISCONNECT AND REMOVE EXPIRED USER
// ======================================

async function disconnectAndRemoveUser(username) {

    const conn = getClient();

    await conn.connect();

    try {

        // Find active sessions.
        const active = await conn.write(
            '/ip/hotspot/active/print',
            [`?user=${username}`]
        );

        // Disconnect every active device.
        for (const session of active) {

            await conn.write(
                '/ip/hotspot/active/remove',
                [`=.id=${session['.id']}`]
            );

        }

        // Find hotspot account.
        const users = await conn.write(
            '/ip/hotspot/user/print',
            [`?name=${username}`]
        );

        // Remove expired account.
        for (const user of users) {

            await conn.write(
                '/ip/hotspot/user/remove',
                [`=.id=${user['.id']}`]
            );

        }

    } finally {

        conn.close();

    }

}

module.exports = {
    activateHotspotUser,
    disconnectAndRemoveUser
};
```
