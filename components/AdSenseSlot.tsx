import React, { useEffect, useRef } from 'react';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

const ADSENSE_CLIENT = String(import.meta.env.VITE_ADSENSE_CLIENT || '').trim();
const ADSENSE_SLOT = String(import.meta.env.VITE_ADSENSE_SLOT || '').trim();
const DEFAULT_ADSENSE_CLIENT = 'ca-pub-4973160293737562';
const RESOLVED_CLIENT = ADSENSE_CLIENT || DEFAULT_ADSENSE_CLIENT;
const VALID_CLIENT = /^ca-pub-\d{16}$/.test(RESOLVED_CLIENT) && RESOLVED_CLIENT !== 'ca-pub-0000000000000000';
const VALID_SLOT = /^\d{8,20}$/.test(ADSENSE_SLOT) && ADSENSE_SLOT !== '1234567890';
const ADS_READY = VALID_CLIENT && VALID_SLOT;

export function AdSenseSlot() {
  const pushedRef = useRef(false);

  useEffect(() => {
    if (!ADS_READY || typeof document === 'undefined') {
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]');
    if (existing || document.getElementById('aegisops-adsbygoogle-script')) {
      return;
    }
    const script = document.createElement('script');
    script.id = 'aegisops-adsbygoogle-script';
    script.async = true;
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${RESOLVED_CLIENT}`;
    script.crossOrigin = 'anonymous';
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!ADS_READY || pushedRef.current) {
      return;
    }
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      pushedRef.current = true;
    } catch (_err) {
      // no-op: ad runtime initializes asynchronously.
    }
  }, []);

  if (!ADS_READY) {
    return (
      <div className="rounded-md border border-dashed border-border p-3 text-xs text-text-muted">
        Sponsored slot is in standby mode. Set valid `VITE_ADSENSE_CLIENT` and `VITE_ADSENSE_SLOT`.
      </div>
    );
  }

  return (
    <ins
      className="adsbygoogle block w-full overflow-hidden rounded-md border border-border bg-bg p-1"
      style={{ minHeight: '96px' }}
      data-ad-client={RESOLVED_CLIENT}
      data-ad-slot={ADSENSE_SLOT}
      data-ad-format="auto"
      data-full-width-responsive="true"
    />
  );
}

export default AdSenseSlot;
