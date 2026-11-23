/**
 * Push endpoints come from the browser, and the server POSTs to them, so only the real push
 * services are accepted (no requests to arbitrary or internal addresses).
 */
const PUSH_HOSTS = [
  "fcm.googleapis.com", // Chrome, Edge on Android, Samsung Internet, Opera
  "updates.push.services.mozilla.com", // Firefox
  "push.apple.com", // Safari / iPhone home-screen apps (web.push.apple.com)
  "notify.windows.com", // Edge on Windows (*.notify.windows.com)
];

export function isPushEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** "Chrome on Android" from a user agent, for the device list. */
export function deviceLabel(ua: string | null): string | null {
  if (!ua) return null;
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : null;
  const browser = /EdgA?\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  if (!os && !browser) return null;
  return [browser, os].filter(Boolean).join(" on ");
}
