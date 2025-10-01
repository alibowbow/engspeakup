window.APP_CONFIG = window.APP_CONFIG || {};
window.APP_CONFIG.API_ENDPOINT =
  window.APP_CONFIG.API_ENDPOINT ||
  (typeof process !== 'undefined' && process.env && process.env.API_ENDPOINT) ||
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';
