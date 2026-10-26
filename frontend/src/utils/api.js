/**
 * Helper to get normalized Backend API Base URL.
 * Safely handles missing /api suffix and trailing slashes in Vercel environment variables.
 */
export function getApiBase() {
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!envUrl) {
    return 'http://localhost:5000/api';
  }

  let url = envUrl.trim().replace(/\/+$/, '');
  if (!url.endsWith('/api')) {
    url = `${url}/api`;
  }
  return url;
}
