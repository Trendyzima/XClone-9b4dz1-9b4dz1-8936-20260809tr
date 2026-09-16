import { useSEO } from '@/hooks/useSEO';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, ArrowLeft, Search } from 'lucide-react';
import CallPage from '@/pages/CallPage';

export default function NotFoundPage() {
  const location = useLocation();
  if (location.pathname.startsWith('/call/')) return <CallPage />;

  useSEO({ noindex: true, title: 'Page Not Found — Testagram', url: '/404' });
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
      <div className="relative mb-6 select-none">
        <span className="text-[120px] font-black leading-none text-muted/20 block">404</span>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center"><Search className="w-8 h-8 text-primary" /></div>
        </div>
      </div>
      <h1 className="text-2xl font-bold mb-2">Page not found</h1>
      <p className="text-muted-foreground text-sm mb-8 max-w-xs">The page you're looking for doesn't exist, was removed, or the link might be broken.</p>
      <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
        <button onClick={() => navigate(-1)} className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-full border border-border text-sm font-semibold hover:bg-muted transition-colors"><ArrowLeft className="w-4 h-4" />Go Back</button>
        <button onClick={() => navigate('/')} className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"><Home className="w-4 h-4" />Home Feed</button>
      </div>
    </div>
  );
}
