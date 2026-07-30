export const APP_CONFIG = {
  appName: 'Inventory Intelligence Platform',
  version: '1.0.0',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000',
} as const
