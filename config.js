const path = require('path');

module.exports = {
  BOT_NAME: 'Supreme MD Bot',
  OWNER_NUMBER: '94742514900',
  PREFIX: '.',
  PORT: process.env.PORT || 5000,
  DASHBOARD_PASS: 'chathura123',
  ADMIN_USER: 'admin',
  ADMIN_PASS: 'chathura123',
  JWT_SECRET: 'supreme_md_jwt_secret_2026_!@#$',
  SESSION_DIR: path.join(__dirname, 'session'),
  DOWNLOAD_DIR: path.join(__dirname, 'downloads'),
  BROWSER: ['SupremeBot', 'Chrome', '131.0'],
  SEARCH_CACHE_TTL: 300000,
  AUTO_READ: true,
  AUTO_TYPING: true,
  NSFW_ENABLED: true,
  PREMIUM_CODE: 'SUPREME2026',
};
