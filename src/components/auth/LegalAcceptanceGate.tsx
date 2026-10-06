import { useMemo, useState } from 'react';
import { Check, ExternalLink, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useNavigate } from 'react-router-dom';

export const LEGAL_POLICY_VERSION = '2026-09';
export const LEGAL_CONSENT_STORAGE_KEY = 'testagram-legal-consent';

type ConsentPayload = { birthDate: string; version: string; acceptedAt: string };

export function readLegalConsent(): ConsentPayload | null {
  try {
    const raw = window.localStorage.getItem(LEGAL_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentPayload;
    if (parsed?.version !== LEGAL_POLICY_VERSION || !parsed.birthDate) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearLegalConsent() {
  try { window.localStorage.removeItem(LEGAL_CONSENT_STORAGE_KEY); } catch {}
}

export function LegalAcceptanceGate({ onAccepted }: { onAccepted: () => void }) {
  const navigate = useNavigate();
  const existing = useMemo(() => readLegalConsent(), []);
  const [checked, setChecked] = useState(!!existing);
  const [birthDate, setBirthDate] = useState(existing?.birthDate || '');
  const [error, setError] = useState('');

  const age = useMemo(() => {
    if (!birthDate) return null;
    const dob = new Date(birthDate + 'T00:00:00');
    if (Number.isNaN(dob.getTime())) return null;
    const now = new Date();
    let years = now.getFullYear() - dob.getFullYear();
    const month = now.getMonth() - dob.getMonth();
    if (month < 0 || (month === 0 && now.getDate() < dob.getDate())) years -= 1;
    return years;
  }, [birthDate]);

  const submit = () => {
    setError('');
    if (!checked) {
      setError('You must accept the Terms, Privacy Policy, and Community Guidelines before continuing.');
      return;
    }
    if (!birthDate || age === null) {
      setError('Enter your date of birth to confirm your age.');
      return;
    }
    if (age < 18) {
      setError('Testagram is for adults aged 18 and above. You cannot continue.');
      return;
    }
    const payload: ConsentPayload = { birthDate, version: LEGAL_POLICY_VERSION, acceptedAt: new Date().toISOString() };
    window.localStorage.setItem(LEGAL_CONSENT_STORAGE_KEY, JSON.stringify(payload));
    onAccepted();
  };

  return (
    <div className="w-full max-w-lg">
      <div className="rounded-3xl border border-primary/20 bg-card shadow-xl p-6 sm:p-8">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-black">Before you enter Testagram</h1>
            <p className="text-xs text-muted-foreground">Adult-only platform · 18+</p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-muted/30 p-4 mb-5">
          <label className="flex items-start gap-3 cursor-pointer">
            <button
              type="button"
              role="checkbox"
              aria-checked={checked}
              onClick={() => setChecked(v => !v)}
              className={'mt-0.5 w-6 h-6 shrink-0 rounded-md border-2 flex items-center justify-center transition-colors ' + (checked ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/40 bg-background')}
            >
              {checked && <Check className="w-4 h-4" />}
            </button>
            <span className="text-sm leading-relaxed">
              I confirm that I am <strong>18 years or older</strong>, and I have read and agree to the{' '}
              <button type="button" onClick={() => navigate('/terms')} className="text-primary font-semibold hover:underline inline">Terms of Service</button>,{' '}
              <button type="button" onClick={() => navigate('/privacy')} className="text-primary font-semibold hover:underline inline">Privacy Policy</button>, and{' '}
              <button type="button" onClick={() => navigate('/policy')} className="text-primary font-semibold hover:underline inline">Community Guidelines</button>.
            </span>
          </label>
          <p className="text-[11px] text-muted-foreground mt-3 ml-9">These policies are part of the account-access flow. You must accept them before authentication can complete.</p>
        </div>

        <div className="space-y-2 mb-5">
          <label className="text-sm font-semibold" htmlFor="legal-birth-date">Date of birth</label>
          <Input id="legal-birth-date" type="date" value={birthDate} onChange={e => setBirthDate(e.target.value)} max={new Date().toISOString().slice(0, 10)} className="h-12" />
          <p className="text-[11px] text-muted-foreground">Your date of birth is used to enforce the 18+ requirement.</p>
        </div>

        {error && <div role="alert" className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}

        <Button type="button" onClick={submit} className="w-full h-12 rounded-full font-bold" disabled={!checked || !birthDate || age === null || age < 18}>
          Accept & continue to sign in
        </Button>

        <div className="mt-4 flex flex-wrap justify-center gap-3 text-[11px] text-muted-foreground">
          <button type="button" onClick={() => navigate('/terms')} className="hover:text-primary inline-flex items-center gap-1">Terms <ExternalLink className="w-3 h-3" /></button>
          <button type="button" onClick={() => navigate('/privacy')} className="hover:text-primary inline-flex items-center gap-1">Privacy <ExternalLink className="w-3 h-3" /></button>
          <button type="button" onClick={() => navigate('/policy')} className="hover:text-primary inline-flex items-center gap-1">Community rules <ExternalLink className="w-3 h-3" /></button>
        </div>
      </div>
    </div>
  );
}
