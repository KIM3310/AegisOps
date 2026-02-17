import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, MessageCircle, Send } from 'lucide-react';

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

const FORMSPREE_ENDPOINT = String(import.meta.env.VITE_FORMSPREE_ENDPOINT || '').trim();
const DISQUS_SHORTNAME = String(import.meta.env.VITE_DISQUS_SHORTNAME || '').trim();
const DISQUS_IDENTIFIER = String(import.meta.env.VITE_DISQUS_IDENTIFIER || 'aegisops-community').trim();
const GISCUS_REPO = String(import.meta.env.VITE_GISCUS_REPO || '').trim();
const GISCUS_REPO_ID = String(import.meta.env.VITE_GISCUS_REPO_ID || '').trim();
const GISCUS_CATEGORY = String(import.meta.env.VITE_GISCUS_CATEGORY || '').trim();
const GISCUS_CATEGORY_ID = String(import.meta.env.VITE_GISCUS_CATEGORY_ID || '').trim();

declare global {
  interface Window {
    disqus_config?: () => void;
  }
}

export const CommunityHub: React.FC = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [state, setState] = useState<SubmitState>('idle');
  const [notice, setNotice] = useState('');
  const giscusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!DISQUS_SHORTNAME || typeof document === 'undefined') {
      return;
    }
    if (document.getElementById('aegisops-disqus-script')) {
      return;
    }

    window.disqus_config = function disqusConfig() {
      this.page.url = window.location.href;
      this.page.identifier = DISQUS_IDENTIFIER;
    };

    const script = document.createElement('script');
    script.id = 'aegisops-disqus-script';
    script.src = `https://${DISQUS_SHORTNAME}.disqus.com/embed.js`;
    script.async = true;
    script.setAttribute('data-timestamp', String(Date.now()));
    document.body.appendChild(script);

    return () => {
      delete window.disqus_config;
    };
  }, []);

  useEffect(() => {
    if (
      !giscusRef.current ||
      !GISCUS_REPO ||
      !GISCUS_REPO_ID ||
      !GISCUS_CATEGORY ||
      !GISCUS_CATEGORY_ID
    ) {
      return;
    }
    if (giscusRef.current.querySelector('script[data-giscus]')) {
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://giscus.app/client.js';
    script.async = true;
    script.setAttribute('data-giscus', '1');
    script.setAttribute('data-repo', GISCUS_REPO);
    script.setAttribute('data-repo-id', GISCUS_REPO_ID);
    script.setAttribute('data-category', GISCUS_CATEGORY);
    script.setAttribute('data-category-id', GISCUS_CATEGORY_ID);
    script.setAttribute('data-mapping', 'pathname');
    script.setAttribute('data-strict', '0');
    script.setAttribute('data-reactions-enabled', '1');
    script.setAttribute('data-emit-metadata', '0');
    script.setAttribute('data-input-position', 'top');
    script.setAttribute('data-theme', 'transparent_dark');
    script.setAttribute('data-lang', 'en');
    script.crossOrigin = 'anonymous';
    giscusRef.current.appendChild(script);
  }, []);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!FORMSPREE_ENDPOINT) {
      setState('error');
      setNotice('Missing VITE_FORMSPREE_ENDPOINT. Configure it to enable feedback collection.');
      return;
    }

    setState('submitting');
    setNotice('');
    try {
      const response = await fetch(FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          message: message.trim(),
          source: 'aegisops',
          page_url: window.location.href,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const detail = String(payload?.errors?.[0]?.message || payload?.error || 'Feedback request failed.');
        throw new Error(detail);
      }
      setState('success');
      setMessage('');
      setNotice('Feedback submitted. Thank you for helping improve AegisOps.');
    } catch (error) {
      setState('error');
      setNotice(error instanceof Error ? error.message : 'Unexpected request error.');
    }
  };

  return (
    <section className="max-w-4xl mx-auto px-4 pb-10 relative z-10">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Send className="w-4 h-4 text-accent" />
            Product Feedback (Formspree)
          </h2>
          <form onSubmit={onSubmit} className="space-y-2">
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name"
              className="w-full h-9 px-3 rounded-md bg-bg border border-border text-xs focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
            <input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email"
              className="w-full h-9 px-3 rounded-md bg-bg border border-border text-xs focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
            <textarea
              required
              rows={4}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="What should AegisOps improve next?"
              className="w-full p-3 rounded-md bg-bg border border-border text-xs resize-y focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
            <button
              disabled={state === 'submitting'}
              className="h-9 px-3 rounded-md bg-accent text-white text-xs font-medium disabled:opacity-60"
            >
              {state === 'submitting' ? 'Sending...' : 'Send feedback'}
            </button>
          </form>
          {notice && (
            <div className={`mt-3 text-2xs flex items-start gap-1.5 ${state === 'error' ? 'text-sev1' : 'text-sev3'}`}>
              {state === 'error' ? <AlertTriangle className="w-3.5 h-3.5 mt-0.5" /> : <CheckCircle2 className="w-3.5 h-3.5 mt-0.5" />}
              <span>{notice}</span>
            </div>
          )}
        </div>

        <div className="bg-bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-accent" />
            Community Discussions
          </h2>
          <div className="space-y-3">
            <div className="rounded-md border border-border p-3">
              <p className="text-2xs text-text-dim uppercase tracking-wider mb-2">Disqus</p>
              {DISQUS_SHORTNAME ? (
                <div id="disqus_thread" className="min-h-[120px]" />
              ) : (
                <p className="text-xs text-text-muted">Set `VITE_DISQUS_SHORTNAME` to enable Disqus.</p>
              )}
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-2xs text-text-dim uppercase tracking-wider mb-2">Giscus (OSS)</p>
              {GISCUS_REPO && GISCUS_REPO_ID && GISCUS_CATEGORY && GISCUS_CATEGORY_ID ? (
                <div ref={giscusRef} className="min-h-[90px]" />
              ) : (
                <p className="text-xs text-text-muted">Set `VITE_GISCUS_*` to enable GitHub Discussions thread.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CommunityHub;
