
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

// Provision user after M-Pesa payment succeeds
async function activateHotspotUser({ username, password, pkg, macAddress }) {
  const conn = getClient();
  await conn.connect();

  try {
    // Check if user already exists (e.g., renewing)
    const existing = await conn.write('/ip/hotspot/user/print', [
      `?name=${username}`
    ]);

    if (existing.length > 0) {
      await conn.write('/ip/hotspot/user/remove', [
        `=.id=${existing[0]['.id']}`
      ]);
    }

    // Build user parameters
    const userParams = [
      `=name=${username}`,
      `=password=${password}`,
      `=profile=${pkg.profile}`,
      `=limit-uptime=${pkg.uptime}`,
      `=comment=Paid_${pkg.id}_KES${pkg.price}`
    ];

    // Lock 1-device packages strictly to the paying device's MAC address
    if (pkg.devices === 1 && macAddress) {
      userParams.push(`=mac-address=${macAddress}`);
    }

    await conn.write('/ip/hotspot/user/add', userParams);
  } finally {
    conn.close();
  }
}

// Disconnect & remove expired user
async function disconnectAndRemoveUser(username) {
  const conn = getClient();
  await conn.connect();

  try {
    // 1. Kick from active hotspot sessions
    const active = await conn.write('/ip/hotspot/active/print', [
      `?user=${username}`
    ]);
    for (const session of active) {
      await conn.write('/ip/hotspot/active/remove', [
        `=.id=${session['.id']}`
      ]);
    }

    // 2. Remove user from hotspot users
    const users = await conn.write('/ip/hotspot/user/print', [
      `?name=${username}`
    ]);
    for (const u of users) {
      await conn.write('/ip/hotspot/user/remove', [
        `=.id=${u['.id']}`
      ]);
    }
  } finally {
    conn.close();
  }
}

module.exports = { activateHotspotUser, disconnectAndRemoveUser };
