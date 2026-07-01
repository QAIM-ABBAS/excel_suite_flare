/**
 * Central API utility.
 * API requests are handled by Cloudflare Workers backend.
 * Frontend calls the Worker URL for all API operations.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

/**
 * Fetch wrapper for API calls.
 * Prepends the Worker URL to the path.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = API_BASE ? `${API_BASE}${path}` : path;
  return fetch(url, init);
}

/**
 * Build a download URL.
 * Returns the full URL to the Worker endpoint.
 */
export function downloadUrl(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path;
}
