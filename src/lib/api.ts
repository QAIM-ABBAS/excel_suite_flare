/**
 * Central API utility.
 * API requests are handled by Next.js API routes which invoke the Python backend.
 * Frontend can call /api/tools/* directly.
 */

/**
 * Fetch wrapper for API calls. Just a passthrough since Next.js handles the proxying.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, init);
}

/**
 * Build a download URL. Just returns the path directly.
 */
export function downloadUrl(path: string): string {
  return path;
}
