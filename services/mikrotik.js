const RouterOSAPI = require('node-routeros').RouterOSAPI;

function getClient() {
    if (
        !process.env.MIKROTIK_HOST ||
        !process.env.MIKROTIK_USER ||
        !process.env.MIKROTIK_PASS
    ) {
        throw new Error('MikroTik environment variables are missing.');
    }

    return new RouterOSAPI({
        host: process.env.MIKROTIK_HOST,
        port: Number(process.env.MIKROTIK_PORT || 8728),
        user: process.env.MIKROTIK_USER,
        password: process.env.MIKROTIK_PASS,
        timeout: 10
    });
}

// CREATE OR UPDATE HOTSPOT USER
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
        const existing = await conn.write(
            '/ip/hotspot/user/print',
            ['?name=' + username]
        );

        for (const user of existing) {
            await conn.write(
                '/ip/hotspot/user/remove',
                ['=.id=' + user['.id']]
            );
        }

        const userParams = [
            '=name=' + username,
            '=password=' + password,
            '=profile=' + pkg.profile,
            '=limit-uptime=' + pkg.uptime,
            '=comment=Paid_' + pkg.id + '_KES' + pkg.price
        ];

        if (pkg.devices === 1 && macAddress) {
            userParams.push('=mac-address=' + macAddress);
        }

        await conn.write(
            '/ip/hotspot/user/add',
            userParams
        );

        console.log('MikroTik voucher created:', username);

    } finally {
        conn.close();
    }
}

// DISCONNECT AND REMOVE EXPIRED USER
async function disconnectAndRemoveUser(username) {
    const conn = getClient();

    await conn.connect();

    try {
        const activeUsers = await conn.write(
            '/ip/hotspot/active/print',
            ['?user=' + username]
        );

        for (const session of activeUsers) {
            await conn.write(
                '/ip/hotspot/active/remove',
                ['=.id=' + session['.id']]
            );
        }

        const users = await conn.write(
            '/ip/hotspot/user/print',
            ['?name=' + username]
        );

        for (const user of users) {
            await conn.write(
                '/ip/hotspot/user/remove',
                ['=.id=' + user['.id']]
            );
        }

        console.log('Expired MikroTik user removed:', username);

    } finally {
        conn.close();
    }
}

module.exports = {
    activateHotspotUser,
    disconnectAndRemoveUser
};
