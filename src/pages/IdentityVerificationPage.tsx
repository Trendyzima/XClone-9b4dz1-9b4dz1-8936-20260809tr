import { ArrowLeft, ShieldCheck, LockKeyhole, HardDrive } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useSEO } from '@/hooks/useSEO';

export default function IdentityVerificationPage() {
  const navigate = useNavigate();
  useSEO({ noindex: true, title: 'Identity verification migration · Testagram', url: '/verify-identity' });

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,hsl(var(--primary)/.12),transparent_42%),hsl(var(--background))] p-4 sm:p-8">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-xl items-center justify-center">
        <section className="w-full rounded-3xl border border-border/70 bg-card p-6 shadow-xl sm:p-8">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <ShieldCheck className="h-7 w-7 text-primary" />
          </div>
          <p className="text-xs font-black uppercase tracking-[.18em] text-primary">Testagram account security</p>
          <h1 className="mt-2 text-2xl font-black">Identity verification is being upgraded</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            We are moving identity registration, verification evidence and approval records into the private Go Backend, Appwrite identity records and protected Backblaze B2 storage.
          </p>
          <div className="my-6 space-y-3 rounded-2xl border border-border bg-muted/30 p-4">
            <div className="flex items-start gap-3"><LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><p className="text-sm leading-5">Your identity evidence must remain private and must never be uploaded to an unapproved public bucket.</p></div>
            <div className="flex items-start gap-3"><HardDrive className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><p className="text-sm leading-5">The new flow will use verified B2 uploads, Backend-controlled approval and Appwrite account creation. Registration stays paused until those checks are complete.</p></div>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">Existing accounts are not deleted or changed. If you already started registration, your account will not be activated by an incomplete verification flow.</p>
          <Button type="button" onClick={() => navigate('/auth', { replace: true })} className="mt-6 h-12 w-full rounded-2xl font-bold">
            <ArrowLeft className="mr-2 h-4 w-4" /> Return to sign in
          </Button>
        </section>
      </div>
    </main>
  );
}
