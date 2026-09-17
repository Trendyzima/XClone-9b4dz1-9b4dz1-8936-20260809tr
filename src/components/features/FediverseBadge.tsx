import { useState } from 'react';
import { Globe, Copy, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

interface FediverseBadgeProps {
  username: string;
  remoteFollowers?: number;
  compact?: boolean;
}

function getLocalFederationDomain(): string {
  if (typeof window !== 'undefined' && window.location.hostname) return window.location.hostname;
  return 'testagram.site';
}

export function FediverseBadge({ username, remoteFollowers = 0, compact = false }: FediverseBadgeProps) {
  const [copied, setCopied] = useState(false);
  const handle = `@${username}@${getLocalFederationDomain()}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(handle).then(() => {
      setCopied(true);
      toast.success('Fediverse handle copied!');
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => toast.error('Could not copy Fediverse handle'));
  };

  if (compact) {
    return (
      <button
        onClick={handleCopy}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 transition-colors text-xs font-medium text-purple-600 dark:text-purple-400"
        title="Copy Fediverse handle"
      >
        <Globe className="w-3 h-3" />
        <span className="hidden sm:inline">{handle}</span>
        <span className="sm:hidden">Fediverse</span>
        {copied ? <CheckCircle className="w-3 h-3" /> : <Copy className="w-3 h-3 opacity-60" />}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 p-3 bg-gradient-to-r from-purple-500/5 to-blue-500/5 border border-purple-500/15 rounded-xl">
      <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center shrink-0">
        <Globe className="w-4 h-4 text-purple-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-purple-600 dark:text-purple-400">Fediverse Identity</p>
        <p className="text-xs text-muted-foreground font-mono truncate">{handle}</p>
        {remoteFollowers > 0 && (
          <p className="text-xs text-muted-foreground">{remoteFollowers} remote followers</p>
        )}
      </div>
      <button
        onClick={handleCopy}
        className="p-2 hover:bg-purple-500/10 rounded-full transition-colors shrink-0"
        title="Copy handle"
      >
        {copied
          ? <CheckCircle className="w-4 h-4 text-green-500" />
          : <Copy className="w-4 h-4 text-muted-foreground" />}
      </button>
    </div>
  );
}
