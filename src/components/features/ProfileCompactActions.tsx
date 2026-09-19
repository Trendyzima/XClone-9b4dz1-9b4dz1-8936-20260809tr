import { useState } from 'react';
import { BadgeCheck, Ban, Check, Crown, DollarSign, Gift, Globe, MessageCircle, MoreHorizontal, Send, Share2, ShieldCheck, Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';

export type ProfileCompactActionsProps = {
  isOwnProfile: boolean;
  username: string;
  verified?: boolean;
  isCreator?: boolean;
  isFollowing: boolean;
  isBlocked: boolean;
  isMuted: boolean;
  hasFederation: boolean;
  profileShared: boolean;
  onEdit?: () => void;
  onFollow: () => void;
  onMessage: () => void;
  onSend: () => void;
  onTip: () => void;
  onGiftPremium?: () => void;
  onSubscribe?: () => void;
  onUnsubscribe?: () => void;
  subscribed?: boolean;
  onShare: () => void;
  onMute: () => void;
  onBlock: () => void;
  onFederation?: () => void;
};

/**
 * Compact profile action surface. Keep the header to one primary action row;
 * secondary monetization, safety and federation actions live behind More.
 */
export function ProfileCompactActions({
  isOwnProfile,
  username,
  verified,
  isCreator,
  isFollowing,
  isBlocked,
  isMuted,
  hasFederation,
  profileShared,
  onEdit,
  onFollow,
  onMessage,
  onSend,
  onTip,
  onGiftPremium,
  onSubscribe,
  onUnsubscribe,
  subscribed,
  onShare,
  onMute,
  onBlock,
  onFederation,
}: ProfileCompactActionsProps) {
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);
  const share = () => { close(); onShare(); };

  return (
    <div className="relative flex items-center gap-2">
      {isOwnProfile ? (
        <>
          <button onClick={onEdit} className="px-4 py-2 rounded-full border border-border font-semibold text-sm hover:bg-muted transition-colors">
            Edit profile
          </button>
          <button onClick={share} aria-label="Share profile" className="p-2 rounded-full border border-border hover:bg-muted transition-colors">
            {profileShared ? <Check className="w-4 h-4 text-green-500" /> : <Share2 className="w-4 h-4" />}
          </button>
        </>
      ) : (
        <>
          <button onClick={onFollow} disabled={isBlocked} className={`px-4 py-2 rounded-full font-semibold text-sm transition-colors ${isFollowing ? 'border border-border hover:bg-muted' : 'bg-foreground text-background hover:opacity-90'} disabled:opacity-40`}>
            {isFollowing ? 'Following' : 'Follow'}
          </button>
          <button onClick={onMessage} className="p-2 rounded-full border border-border hover:bg-muted transition-colors" aria-label={`Message @${username}`}>
            <MessageCircle className="w-4 h-4" />
          </button>
          <button onClick={share} className="p-2 rounded-full border border-border hover:bg-muted transition-colors" aria-label="Share profile">
            {profileShared ? <Check className="w-4 h-4 text-green-500" /> : <Share2 className="w-4 h-4" />}
          </button>
        </>
      )}

      <button onClick={() => setOpen(v => !v)} aria-expanded={open} aria-label="More profile actions" className="p-2 rounded-full border border-border hover:bg-muted transition-colors">
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div className="absolute right-0 top-full mt-2 z-50 w-60 rounded-2xl border border-border bg-background shadow-xl overflow-hidden">
            {!isOwnProfile && (
              <>
                <button onClick={() => { close(); onTip(); }} className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted">
                  <DollarSign className="w-4 h-4 text-yellow-600" /> Send a tip
                </button>
                <button onClick={() => { close(); onSend(); }} className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted">
                  <Send className="w-4 h-4 text-primary" /> Send money
                </button>
                {onGiftPremium && (
                  <button onClick={() => { close(); onGiftPremium(); }} className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted">
                    <Gift className="w-4 h-4 text-amber-500" /> Gift Premium
                  </button>
                )}
                {isCreator && onSubscribe && (
                  <button onClick={() => { close(); subscribed ? onUnsubscribe?.() : onSubscribe(); }} className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted">
                    <Crown className="w-4 h-4 text-purple-600" /> {subscribed ? 'Cancel subscription' : 'Subscribe'}
                  </button>
                )}
                {hasFederation && onFederation && (
                  <button onClick={() => { close(); onFederation(); }} className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted">
                    <Globe className="w-4 h-4 text-purple-600" /> Copy Fediverse handle
                  </button>
                )}
                <div className="border-t border-border" />
                <button onClick={() => { close(); onMute(); }} className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted">
                  {isMuted ? <Volume2 className="w-4 h-4 text-primary" /> : <VolumeX className="w-4 h-4 text-muted-foreground" />}
                  {isMuted ? `Unmute @${username}` : `Mute @${username}`}
                </button>
                <button onClick={() => { close(); onBlock(); }} className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-destructive hover:bg-destructive/5">
                  <Ban className="w-4 h-4" /> {isBlocked ? `Unblock @${username}` : `Block @${username}`}
                </button>
                <button onClick={() => { close(); toast.success('Report submitted'); }} className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-muted-foreground hover:bg-muted">
                  <ShieldCheck className="w-4 h-4" /> Report account
                </button>
              </>
            )}
            {isOwnProfile && (
              <>
                {hasFederation && onFederation && (
                  <button onClick={() => { close(); onFederation(); }} className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted">
                    <Globe className="w-4 h-4 text-purple-600" /> Copy Fediverse handle
                  </button>
                )}
                <button onClick={() => { close(); onShare(); }} className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted">
                  <Share2 className="w-4 h-4" /> Share profile
                </button>
              </>
            )}
          </div>
        </>
      )}

      {verified && <span className="sr-only">Verified profile</span>}
      {isCreator && <span className="sr-only">Creator profile</span>}
    </div>
  );
}
