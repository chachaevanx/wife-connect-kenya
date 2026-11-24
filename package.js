const PACKAGES = [
  // --- 1 DEVICE PACKAGES (No Sharing: shared-users = 1) ---
  { id: '1d_3h',   devices: 1, label: '3 Hours (1 Device)',   hours: 3,   price: 10,  profile: '1dev_3h',   uptime: '03:00:00', rateLimit: '3M/3M' },
  { id: '1d_6h',   devices: 1, label: '6 Hours (1 Device)',   hours: 6,   price: 20,  profile: '1dev_6h',   uptime: '06:00:00', rateLimit: '3M/3M' },
  { id: '1d_24h',  devices: 1, label: '24 Hours (1 Device)',  hours: 24,  price: 30,  profile: '1dev_24h',  uptime: '1d 00:00:00', rateLimit: '3M/3M' },
  { id: '1d_48h',  devices: 1, label: '48 Hours (1 Device)',  hours: 48,  price: 50,  profile: '1dev_48h',  uptime: '2d 00:00:00', rateLimit: '3M/3M' },
  { id: '1d_72h',  devices: 1, label: '72 Hours (1 Device)',  hours: 72,  price: 80,  profile: '1dev_72h',  uptime: '3d 00:00:00', rateLimit: '3M/3M' },
  { id: '1d_98h',  devices: 1, label: '98 Hours (1 Device)',  hours: 98,  price: 100, profile: '1dev_98h',  uptime: '4d 02:00:00', rateLimit: '3M/3M' },
  { id: '1d_168h', devices: 1, label: '7 Days (1 Device)',    hours: 168, price: 150, profile: '1dev_168h', uptime: '7d 00:00:00', rateLimit: '4M/4M' },
  { id: '1d_30d',  devices: 1, label: '1 Month (1 Device)',   hours: 720, price: 400, profile: '1dev_30d',  uptime: '30d 00:00:00', rateLimit: '4M/4M' },

  // --- 2 DEVICES PACKAGES (Phone + Laptop: shared-users = 2) ---
  { id: '2d_3h',   devices: 2, label: '3 Hours (2 Devices)',  hours: 3,   price: 30,  profile: '2dev_3h',   uptime: '03:00:00', rateLimit: '5M/5M' },
  { id: '2d_6h',   devices: 2, label: '6 Hours (2 Devices)',  hours: 6,   price: 50,  profile: '2dev_6h',   uptime: '06:00:00', rateLimit: '5M/5M' },
  { id: '2d_24h',  devices: 2, label: '24 Hours (2 Devices)', hours: 24,  price: 100, profile: '2dev_24h',  uptime: '1d 00:00:00', rateLimit: '5M/5M' },
  { id: '2d_48h',  devices: 2, label: '48 Hours (2 Devices)', hours: 48,  price: 150, profile: '2dev_48h',  uptime: '2d 00:00:00', rateLimit: '5M/5M' },
  { id: '2d_72h',  devices: 2, label: '72 Hours (2 Devices)', hours: 72,  price: 200, profile: '2dev_72h',  uptime: '3d 00:00:00', rateLimit: '5M/5M' },
  { id: '2d_96h',  devices: 2, label: '96 Hours (2 Devices)', hours: 96,  price: 250, profile: '2dev_96h',  uptime: '4d 00:00:00', rateLimit: '5M/5M' },
  { id: '2d_168h', devices: 2, label: '7 Days (2 Devices)',   hours: 168, price: 300, profile: '2dev_168h', uptime: '7d 00:00:00', rateLimit: '6M/6M' },
  { id: '2d_30d',  devices: 2, label: '1 Month (2 Devices)',  hours: 720, price: 750, profile: '2dev_30d',  uptime: '30d 00:00:00', rateLimit: '6M/6M' }
];

module.exports = PACKAGES;
