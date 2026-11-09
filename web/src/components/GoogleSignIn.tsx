import { useEffect, useRef, useState } from 'react';
import { auth, publicGet } from '../api/client';

declare global {
  interface Window {
    google?: any;
  }
}

const SCRIPT = 'https://accounts.google.com/gsi/client';
let loading: Promise<void> | null = null;
function loadScript() {
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error('Google sign-in could not be loaded.'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * "Sign in with Google", shown only when the server has a Google client id (GET /auth/options). Errors go to
 * [onError]; the password form stays usable whatever happens here.
 */
export function GoogleSignIn({ onError, onBusy }: { onError: (e: unknown) => void; onBusy: (busy: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    publicGet<{ google_client_id: string | null }>('/auth/options')
      .then((o) => setClientId(o.google_client_id))
      .catch(() => setClientId(null));
  }, []);

  useEffect(() => {
    if (!clientId || !ref.current) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          ux_mode: 'popup',
          callback: async ({ credential }: { credential?: string }) => {
            if (!credential) return onError(new Error('Google sign-in was cancelled. You can sign in with your password instead.'));
            onBusy(true);
            onError(null);
            try {
              await auth.loginWithGoogle(credential);
            } catch (e) {
              onError(e);
            } finally {
              onBusy(false);
            }
          },
        });
        const width = Math.min(380, Math.max(200, Math.floor(ref.current.getBoundingClientRect().width)));
        window.google.accounts.id.renderButton(ref.current, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', width });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (!clientId) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="or-divider" role="separator">
        <span>or</span>
      </div>
      {failed ? <p className="muted" style={{ margin: 0 }}>Google sign-in is not available right now. Sign in with your password.</p> : <div ref={ref} style={{ minHeight: 44, display: 'flex', justifyContent: 'center' }} />}
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Use the Google account with the same email as your TMS account.</p>
    </div>
  );
}
