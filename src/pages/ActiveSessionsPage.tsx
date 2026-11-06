import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { authService } from '@/lib/auth';
import { appwriteAuth } from '@/services/appwriteAuth';
import { toast } from 'sonner';
import {
  Smartphone, Monitor, Globe, Clock, LogOut, ShieldCheck, Loader2, CheckCircle2,
} from 'lucide-react';

// esbuild guard: module-level helper — no inline object creation inside component
function formatSessionDate(iso: string): string {
  if (!iso) return 'Unknown';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// esbuild guard: module-level helper — no switch/ternary with JSX inside .map()
function getDeviceIconNode(ua: string) {
  const lower = ua.toLowerCase();
  if (lower.includes('android') || lower.includes('iphone') || lower.includes('mobile')) {
    return <Smartphone className="w-5 h-5 text-primary" />;
  }
  return <Monitor className="w-5 h-5 text-primary" />;
}

// esbuild guard: module-level helper — parse browser name from UA string (no inline regex in JSX)
function parseBrowser(ua: string): string {
  if (!ua) return 'Unknown browser';
  if (ua.includes('Chrome') && !ua.includes('Edg'))  return 'Chrome';
  if (ua.includes('Firefox'))  return 'Firefox';
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
  if (ua.includes('Edg'))      return 'Edge';
  if (ua.includes('OPR'))      return 'Opera';
  return 'Browser';
}

// esbuild guard: module-level helper — parse OS from UA string
function parseOS(ua: string): string {
  if (!ua) return 'Unknown OS';
  if (ua.includes('Android'))  return 'Android';
  if (ua.includes('iPhone'))   return 'iOS';
  if (ua.includes('iPad'))     return 'iPadOS';
  if (ua.includes('Windows'))  return 'Windows';
  if (ua.includes('Mac'))      return 'macOS';
  if (ua.includes('Linux'))    return 'Linux';
  return 'Unknown OS';
}

export default function ActiveSessionsPage() {
  useSEO({ noindex: true, title: 'Active Sessions', url: '/sessions' });
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  // Session state — parallel primitives (esbuild guard: no typed interface arrays)
  const [sessionId, setSessionId] = useState('');
  const [sessionUA, setSessionUA] = useState('');
  const [sessionCreated, setSessionCreated] = useState('');
  const [sessionExpires, setSessionExpires] = useState('');
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [signedOutAll, setSignedOutAll] = useState(false);

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    const provider = (import.meta.env.VITE_TESTAGRAM_AUTH_PROVIDER ?? 'supabase').trim().toLowerCase();
    if (provider === 'appwrite') {
      appwriteAuth.getCurrentSession().then((session) => {
        setSessionId(session.$id.slice(0, 12) + '…');
        setSessionUA(typeof navigator !== 'undefined' ? navigator.userAgent : '');
        setSessionCreated(session.$createdAt || '');
        setSessionExpires(session.expire || '');
      }).catch(() => {}).finally(() => setLoading(false));
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      const s = data?.session;
      if (s) {
        setSessionId(s.access_token.slice(0, 12) + '…');
        setSessionUA(typeof navigator !== 'undefined' ? navigator.userAgent : '');
        setSessionCreated(s.user?.created_at ?? '');
        try {
          const payload = JSON.parse(atob(s.access_token.split('.')[1]));
          setSessionExpires(new Date((payload.exp ?? 0) * 1000).toISOString());
        } catch { setSessionExpires(''); }
      }
      setLoading(false);
    });
  }, [user?.id]);

  const handleSignOutAll = async () => {
    setSigningOut(true);
    try {
      await authService.signOutAll();
    } catch (error) {
      toast.error((error as Error)?.message || 'Failed to sign out all devices');
      setSigningOut(false);
      return;
    }
    setSignedOutAll(true);
    setSigningOut(false);
    toast.success('Signed out of all devices');
    logout();
    navigate('/auth');
  };

  const handleSignOutCurrent = async () => {
    setSigningOut(true);
    await authService.signOut();
    logout();
    navigate('/');
  };

  if (!user) return null;

  // Pre-compute display values (esbuild guard: no inline computations in JSX)
  const browser = parseBrowser(sessionUA);
  const os = parseOS(sessionUA);
  const createdLabel = formatSessionDate(sessionCreated);
  const expiresLabel = formatSessionDate(sessionExpires);
  const isMobile = sessionUA.toLowerCase().includes('mobile') ||
    sessionUA.toLowerCase().includes('android') ||
    sessionUA.toLowerCase().includes('iphone');
  const deviceLabel = isMobile ? 'Mobile device' : 'Desktop / Laptop';

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <TopBar title="Active Sessions" showBack />

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {/* Info banner */}
        <div className="flex items-start gap-3 p-4 bg-primary/5 border border-primary/15 rounded-2xl">
          <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold">Session security</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              If you see activity you don't recognise, sign out of all devices immediately and change your password.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading session…</span>
          </div>
        ) : (
          <>
            {/* Current session card */}
            <div className="border border-border rounded-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-muted/20 border-b border-border">
                <Globe className="w-4 h-4 text-primary" />
                <h2 className="font-black text-sm">Current Session</h2>
                <span className="ml-auto text-[10px] bg-green-500/10 text-green-600 font-bold px-2 py-0.5 rounded-full border border-green-500/20">
                  Active now
                </span>
              </div>

              <div className="p-4 space-y-4">
                {/* Device info */}
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                    {getDeviceIconNode(sessionUA)}
                  </div>
                  <div>
                    <p className="font-bold text-sm">{deviceLabel}</p>
                    <p className="text-xs text-muted-foreground">{browser} on {os}</p>
                  </div>
                </div>

                {/* Session metadata */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-muted/40 rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Account created</p>
                    </div>
                    <p className="text-xs font-semibold">{createdLabel}</p>
                  </div>
                  <div className="bg-muted/40 rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Session expires</p>
                    </div>
                    <p className="text-xs font-semibold">{expiresLabel || 'Auto-refreshes'}</p>
                  </div>
                </div>

                {sessionId && (
                  <div className="bg-muted/30 rounded-xl px-3 py-2">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-0.5">Token prefix</p>
                    <p className="text-xs font-mono text-foreground">{sessionId}</p>
                  </div>
                )}

                {/* Sign out this device */}
                <button
                  onClick={handleSignOutCurrent}
                  disabled={signingOut}
                  className="w-full flex items-center justify-center gap-2 py-2.5 border border-border rounded-xl text-sm font-semibold hover:bg-muted transition-colors disabled:opacity-50"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out this device
                </button>
              </div>
            </div>

            {/* Note on other devices */}
            <div className="border border-border rounded-2xl p-4 bg-muted/10">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Other devices</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Testagram uses secure JWT sessions. We can't list other active devices individually, but you can instantly invalidate all sessions including on other devices using the button below.
              </p>
            </div>

            {/* Sign out all devices */}
            {signedOutAll ? (
              <div className="flex items-center justify-center gap-2 py-4 text-green-600">
                <CheckCircle2 className="w-5 h-5" />
                <span className="text-sm font-bold">Signed out of all devices</span>
              </div>
            ) : (
              <button
                onClick={handleSignOutAll}
                disabled={signingOut}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-destructive text-destructive-foreground rounded-2xl text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {signingOut
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <LogOut className="w-4 h-4" />}
                Sign out of all devices
              </button>
            )}

            <p className="text-center text-[11px] text-muted-foreground leading-relaxed px-4">
              Signing out of all devices will immediately invalidate your current session on every browser and device. You'll need to log in again.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
