export const APP_CONFIG = {
  appName: 'Inventory Intelligence Platform',
  version: '1.0.0',
  // In development the Vite dev server (5173) talks to FastAPI (8000) directly.
  // In production the built frontend is served by FastAPI itself, so API calls
  // use relative URLs (same origin). Override with VITE_API_BASE_URL if the
  // API is ever hosted elsewhere.
  apiBaseUrl:
    import.meta.env.VITE_API_BASE_URL ||
    (import.meta.env.DEV ? 'http://127.0.0.1:8000' : ''),
} as const
