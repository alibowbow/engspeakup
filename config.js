window.APP_CONFIG = window.APP_CONFIG || {};
window.APP_CONFIG.API_ENDPOINT =
  window.APP_CONFIG.API_ENDPOINT ||
  (typeof process !== 'undefined' && process.env && process.env.API_ENDPOINT) ||
  'https://magenta-morning-find.glitch.me/generate';
