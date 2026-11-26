// Google Analytics 4 (gtag.js) loader.
// Measurement ID is a public identifier; override via VITE_GA_MEASUREMENT_ID if needed.
const MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID || 'G-TZNJL4RSXX';

type GtagFn = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: GtagFn;
  }
}

let initialized = false;

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function initAnalytics(): void {
  if (initialized || !MEASUREMENT_ID || !import.meta.env.PROD) return;
  if (typeof window === 'undefined' || isLocalHost(window.location.hostname)) return;

  initialized = true;
  window.dataLayer = window.dataLayer || [];
  // gtag.js requires `arguments` objects (not Arrays) to be pushed onto dataLayer.
  const gtag: GtagFn = function () {
    window.dataLayer!.push(arguments);
  };
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', MEASUREMENT_ID);

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`;
  document.head.appendChild(script);
}

export function trackEvent(name: string, params?: Record<string, unknown>): void {
  window.gtag?.('event', name, params);
}
