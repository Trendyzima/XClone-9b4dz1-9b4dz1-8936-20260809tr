import { useState, useEffect, useRef } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import {
  Search, HelpCircle, MessageCircle, Shield, CreditCard, User,
  ChevronDown, ChevronUp, ExternalLink, Send, Loader2,
  TrendingUp, CheckCircle2, Hash, ThumbsUp, ThumbsDown, Star,
  Play, X, Clock, FileText, Ticket, Bot, Printer, ChevronRight, Share2,
} from 'lucide-react';
import { PageAdBanner } from '@/components/features/AdSenseAd';
import { toast } from 'sonner';

function HelpAdBanner() { return <PageAdBanner />; }

// ── Module-level help content (esbuild guard: no inline object arrays in render)
const ACCOUNT_TOPICS = [
  {
    q: 'How to change username',
    a: [
      'Go to your Profile by tapping your avatar in the bottom nav.',
      'Tap the Edit Profile button (pencil icon) near your profile photo.',
      'Update the Username field with your desired new handle.',
      'Tap Save — your username is changed immediately across the platform.',
      "Note: usernames must be unique. If the name is taken you'll see an error.",
    ],
  },
  {
    q: 'Update profile information',
    a: [
      'Open your Profile tab and tap Edit Profile.',
      'You can update: Display name, Bio (up to 160 chars), Website link, Location, and Profile photo.',
      'Tap the camera icon on your avatar to upload a new photo from your device.',
      'All changes are saved immediately when you tap Save.',
    ],
  },
  {
    q: 'Verify your account',
    a: [
      'Go to Settings → Verification Request (or tap /verification-request directly).',
      'Choose your verification tier: Basic, Creator, Business, or Celebrity.',
      'Pay the one-time verification fee via M-Pesa or wallet balance.',
      'Our admin team reviews your account within 24 hours.',
      "Once approved you'll get a coloured verified badge ✓ on your profile and all posts.",
    ],
  },
  {
    q: 'Delete your account',
    a: [
      'Go to Settings → Account → Delete Account.',
      'You will be asked to confirm by typing your username.',
      'All your posts, followers, and earnings data will be permanently removed within 30 days.',
      'Wallet balances should be withdrawn before deletion — they cannot be recovered after.',
      'If you change your mind, contact support@tsocial.com within 7 days of deletion.',
    ],
  },
  {
    q: 'Privacy settings',
    a: [
      'Open Settings → Privacy & Security to control account visibility and discovery.',
      'Private Account controls whether new followers need your approval before they can see protected posts.',
      'Discoverable by Username controls whether other people can find your profile through @username, display name, or bio search.',
      'Your public profile can be discovered even when your account is protected; protected posts remain limited to you and approved followers.',
      'Email and phone discovery are separate controls and do not make your email address or phone number public.',
      'Changes to discovery settings are saved to your profile and apply across Search, Explore, and public profile discovery.',
    ],
  },
];

const POSTS_TOPICS = [
  {
    q: 'How to post videos',
    a: [
      'Tap the green + FAB button on the Home screen to open the Compose sheet.',
      'Tap the video camera icon or "Attach Video" to select a video from your gallery.',
      'Videos up to 10 MB are supported. For longer videos use the upload-to-storage flow.',
      'Add a caption, hashtags (#), and mentions (@) before posting.',
      'Toggle "Monetize" on the post card to earn CPM revenue from video views.',
    ],
  },
  {
    q: 'Create polls',
    a: [
      'In the Compose sheet, tap the Poll icon (bar chart icon) in the toolbar.',
      'Enter your question and up to 4 answer options.',
      'Set the poll duration: 1 day, 3 days, or 7 days.',
      'Post normally — followers can tap an option to vote.',
      'Results are visible to everyone once you\'ve voted or after the poll expires.',
    ],
  },
  {
    q: 'Schedule posts',
    a: [
      'In the Compose sheet, tap the Clock/Calendar icon.',
      'Pick a date and time for your post to go live.',
      'Scheduled posts appear in your Scheduled Posts page (tap the calendar icon in your profile).',
      'You can edit or cancel a scheduled post before it goes live.',
      'The platform publishes it automatically at the chosen time — no action needed from you.',
    ],
  },
  {
    q: 'Use hashtags effectively',
    a: [
      'Type # followed by a keyword in your post (e.g. #Nairobi #TechKenya).',
      'Use 3–7 relevant hashtags for best reach — too many can look spammy.',
      'Follow hashtags from the Explore page to see all posts under that tag in your feed.',
      'Create hashtag challenges from the Explore → Challenges section (verified users only).',
      'Trending hashtags appear on the Explore tab — using them boosts discoverability.',
    ],
  },
  {
    q: 'Report inappropriate content',
    a: [
      'Tap the ··· three-dot menu on any post and select Report.',
      'Choose a reason: Spam, Harassment, Hate speech, Misinformation, Nudity, or Other.',
      'Add optional details and submit — our moderation team reviews within 24–48 hours.',
      'You can also report a user from their profile page via the three-dot menu.',
      'All reports are anonymous — the reported user is never told who reported them.',
    ],
  },
];

const PAYMENTS_TOPICS = [
  {
    q: 'Boost your posts',
    a: [
      'Go to any of your posts and tap Boost (rocket icon) or visit /boost-create.',
      'Set your boost budget (minimum $1), target audience, and duration.',
      'Pay from your wallet balance or top up via M-Pesa / PayPal.',
      'Boosted posts appear more prominently in feeds and Explore for the selected audience.',
      'View boost performance (impressions, clicks) in Boost Analytics from your profile.',
    ],
  },
  {
    q: 'Payment methods (PayPal, M-Pesa)',
    a: [
      'Go to Wallet → M-Pesa tab to deposit via STK push (Kenya only).',
      'Enter your Safaricom number, amount, and tap "Pay" — a PIN prompt appears on your phone.',
      'For PayPal: go to Wallet → Withdraw and enter your PayPal email for payouts.',
      'Minimum deposit via M-Pesa: KES 10. Minimum payout: $5 USD.',
      'All transactions are recorded in Wallet → History.',
    ],
  },
  {
    q: 'Creator earnings',
    a: [
      'Earnings come from: video CPM ($1.50–$3.50 per 1k views), tips (85% to you), ad revenue share, and subscriptions.',
      'Your CPM tier upgrades automatically as your video views grow.',
      'View your full earnings breakdown in Creator Studio → Earnings tab.',
      'Earnings are distributed daily by our automated system.',
      'Request a payout from Creator Studio → Earnings → Request Payout (minimum $5).',
    ],
  },
  {
    q: 'Premium subscriptions',
    a: [
      'Go to /premium to view available plans (Monthly or Annual).',
      'Premium removes all ads, gives you a Premium badge, and unlocks advanced creator tools.',
      'Pay with your wallet balance, M-Pesa, or PayPal.',
      'Your subscription auto-renews unless cancelled 24 hours before renewal.',
      'Cancel anytime from Settings → Premium → Cancel Subscription.',
    ],
  },
  {
    q: 'Refund policy',
    a: [
      'Digital purchases (boosts, premium, verification) are generally non-refundable once delivered.',
      'If a technical error prevented your boost from running, contact support within 7 days.',
      'M-Pesa deposits that fail but deduct your balance are refunded within 24 hours automatically.',
      'For all other refund requests email support@tsocial.com with your transaction reference.',
    ],
  },
];

const SAFETY_TOPICS = [
  {
    q: 'Block or mute users',
    a: [
      "To Block: visit the user's profile → tap ··· → Block. They can no longer see your content.",
      "To Mute: visit their profile → tap ··· → Mute. Their posts won't appear in your feed but they can still follow you.",
      'Manage your block/mute list in Settings → Privacy → Blocked & Muted.',
      'Blocked users cannot message you, follow you, or see your posts.',
      "Muted users don't know they're muted — the action is silent.",
    ],
  },
  {
    q: 'Report abuse',
    a: [
      'Tap the ··· menu on a post or user profile and select Report.',
      'For urgent safety concerns (threats, CSAM) use the Priority Report option.',
      'All abuse reports go to our Safety team and are reviewed within 24 hours.',
      'You can also email abuse@tsocial.com for sensitive or urgent matters.',
      'Our platform regulators can issue temporary bans, strikes, or permanent bans.',
    ],
  },
  {
    q: 'Two-factor authentication',
    a: [
      'Go to Settings → Security → Two-Factor Authentication.',
      'Currently 2FA is implemented via OTP code sent to your registered email.',
      'Every new login from an unrecognised device triggers an OTP verification step.',
      'Do not share your OTP codes with anyone — Testagram staff will never ask for them.',
      'If you lose access to your email, contact support immediately to recover your account.',
    ],
  },
  {
    q: 'Suspicious activity',
    a: [
      "If you notice logins you don't recognise, go to Settings → Security → Active Sessions and sign out all devices.",
      'Change your password immediately and enable 2FA.',
      'Check your Wallet → History for any unauthorised transactions.',
      'Report compromised accounts to support@tsocial.com with "ACCOUNT COMPROMISED" in the subject.',
      'We may temporarily lock your account during investigation to protect your funds.',
    ],
  },
  {
    q: 'Content guidelines',
    a: [
      'Testagram prohibits: hate speech, harassment, graphic violence, NSFW content, and spam.',
      'Posts are reviewed by our AI moderation system and human regulators.',
      'First violation: warning + content removal. Second: temporary ban. Third: permanent ban.',
      'You can appeal a ban via the Appeals page (/appeals).',
      'Read the full Content Policy at /content-policy.',
    ],
  },
];

// ── Flat list for search (esbuild guard: module-level, no typed annotation) ──
const ALL_TOPICS = [
  ...ACCOUNT_TOPICS.map(t => ({ category: 'Account & Profile', q: t.q, a: t.a })),
  ...POSTS_TOPICS.map(t => ({ category: 'Posts & Engagement', q: t.q, a: t.a })),
  ...PAYMENTS_TOPICS.map(t => ({ category: 'Payments & Monetization', q: t.q, a: t.a })),
  ...SAFETY_TOPICS.map(t => ({ category: 'Safety & Security', q: t.q, a: t.a })),
];

const CATEGORIES = [
  { icon: User,          title: 'Account & Profile',       topics: ACCOUNT_TOPICS,  color: 'text-blue-600',   bg: 'bg-blue-500/10',   catId: 'help-cat-account'   },
  { icon: MessageCircle, title: 'Posts & Engagement',      topics: POSTS_TOPICS,    color: 'text-green-600',  bg: 'bg-green-500/10',  catId: 'help-cat-posts'     },
  { icon: CreditCard,    title: 'Payments & Monetization', topics: PAYMENTS_TOPICS, color: 'text-purple-600', bg: 'bg-purple-500/10', catId: 'help-cat-payments'  },
  { icon: Shield,        title: 'Safety & Security',       topics: SAFETY_TOPICS,   color: 'text-red-600',    bg: 'bg-red-500/10',    catId: 'help-cat-safety'    },
];

// ── Contact form subject options (esbuild guard: module-level) ───────────────
const CONTACT_SUBJECTS = [
  'Account Issues',
  'Payment & Billing',
  'Technical Problem',
  'Content Moderation',
  'Creator Earnings',
  'Feature Request',
  'Other',
];

// ── Video Guides (module-level, esbuild guard: no inline objects in render) ───
const VIDEO_GUIDES = [
  {
    title: 'Create a Post',
    duration: '1:24',
    desc: 'Compose text, photos, videos and polls — plus how to add hashtags for reach.',
    thumb: 'https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=480&q=80',
    articleSlug: 'how-to-post-videos',
  },
  {
    title: 'Set Up Monetization',
    duration: '2:10',
    desc: 'Enable CPM earnings, connect your PayPal, and configure your payout schedule.',
    thumb: 'https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?w=480&q=80',
    articleSlug: 'creator-earnings',
  },
  {
    title: 'Send Money & M-Pesa',
    duration: '0:58',
    desc: 'Top up your wallet via M-Pesa STK push and transfer funds to other users.',
    thumb: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=480&q=80',
    articleSlug: 'payment-methods-paypal-m-pesa',
  },
  {
    title: 'Get Verified',
    duration: '1:33',
    desc: 'Apply for your verified badge and unlock higher-tier creator features.',
    thumb: 'https://images.unsplash.com/photo-1614680376573-df3480f0c6ff?w=480&q=80',
    articleSlug: 'verify-your-account',
  },
];

// ── Analytics storage key (module-level) ─────────────────────────────────────
const HELP_ANALYTICS_KEY = 'ts-help-search-analytics';

// ── Article ratings storage key (module-level) ────────────────────────────────
const HELP_RATINGS_KEY = 'ts-help-article-ratings';

// esbuild guard: module-level constant — no inline string in useEffect dep
const HELP_CHAT_HISTORY_KEY = 'ts-help-chat-history';

// esbuild guard: module-level helper — no inline object literal creation inside component function body
function buildShareData(q: string, firstBullet: string, url: string) {
  return { title: `Testagram Help: ${q}`, text: firstBullet, url };
}

// esbuild guard: module-level — no inline array literal inside JSX .map() callback
const CHAT_SUGGESTION_QUESTIONS = [
  'How do I get verified?',
  'How does creator earnings work?',
  'How do I send money via M-Pesa?',
];

// esbuild guard: module-level helper — no inline object creation in .map() inside component
function buildChatMessages(roles: string[], texts: string[]): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = [];
  for (let i = 0; i < roles.length; i++) out.push({ role: roles[i], content: texts[i] });
  return out;
}

// ── FAQ structured data — module-level (esbuild guard: no map() with inline nested objects inside component) ──
const HELP_FAQ_STRUCTURED_DATA = ALL_TOPICS.map(t => ({
  '@type': 'Question',
  name: t.q,
  acceptedAnswer: { '@type': 'Answer', text: t.a.join(' ') },
}));

// ── Static structured data for SEO — module-level (esbuild guard: no inline object arrays in component body) ──
const HELP_STRUCTURED_DATA = [
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: HELP_FAQ_STRUCTURED_DATA,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://testagram.site' },
      { '@type': 'ListItem', position: 2, name: 'Help Center', item: 'https://testagram.site/help' },
    ],
  },
  {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Testagram Help Center',
    description: 'Comprehensive help and support documentation for Testagram users and creators.',
    url: 'https://testagram.site/help',
  },
];

// ── Date formatter (module-level — esbuild guard: no try/catch inside .map() callbacks) ──
function formatTicketDate(d: string): string {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

// ── Article last-updated dates (module-level, esbuild guard: no Record<string,string> annotation) ──
const ARTICLE_LAST_UPDATED = {
  'how-to-change-username': 'Aug 2026',
  'update-profile-information': 'Aug 2026',
  'verify-your-account': 'Aug 2026',
  'delete-your-account': 'Jul 2026',
  'privacy-settings': 'Aug 2026',
  'how-to-post-videos': 'Aug 2026',
  'create-polls': 'Jul 2026',
  'schedule-posts': 'Aug 2026',
  'use-hashtags-effectively': 'Jul 2026',
  'report-inappropriate-content': 'Jun 2026',
  'boost-your-posts': 'Aug 2026',
  'payment-methods-paypal-m-pesa': 'Aug 2026',
  'creator-earnings': 'Aug 2026',
  'premium-subscriptions': 'Jul 2026',
  'refund-policy': 'Jun 2026',
  'block-or-mute-users': 'Jul 2026',
  'report-abuse': 'Aug 2026',
  'two-factor-authentication': 'Jun 2026',
  'suspicious-activity': 'Jul 2026',
  'content-guidelines': 'Aug 2026',
};

// ── Article date lookup (esbuild guard: module-level — no inline lookup in JSX) ──
function getArticleDate(slug: string): string {
  return (ARTICLE_LAST_UPDATED as any)[slug] ?? '';
}

// ── URL slug generator (module-level) ────────────────────────────────────────
function toSlug(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// esbuild guard: module-level helper — no `const Icon = cat.icon` inside .map()
function getCatIconNode(title: string, colorClass: string) {
  if (title === 'Account & Profile')       return <User className={`w-4.5 h-4.5 ${colorClass}`} size={18} />;
  if (title === 'Posts & Engagement')      return <MessageCircle className={`w-4.5 h-4.5 ${colorClass}`} size={18} />;
  if (title === 'Payments & Monetization') return <CreditCard className={`w-4.5 h-4.5 ${colorClass}`} size={18} />;
  return <Shield className={`w-4.5 h-4.5 ${colorClass}`} size={18} />;
}

// ── Live support status (module-level — EAT UTC+3, Mon-Fri 08:00-18:00) ──────
function getSupportStatus(): { online: boolean; label: string; sub: string } {
  const now = new Date();
  const eatH = (now.getUTCHours() + 3) % 24;
  const day = now.getUTCDay(); // 0=Sun, 6=Sat
  const online = day >= 1 && day <= 5 && eatH >= 8 && eatH < 18;
  if (online) return { online: true, label: 'Support is online', sub: 'Typically replies within 2 hours' };
  // Calculate next open time
  const nextDay = day === 0 ? 'Monday' : day === 6 ? 'Monday' : 'next business day';
  return { online: false, label: 'Support is offline', sub: `Replies by ${nextDay} (EAT business hours)` };
}

// ── Accordion item ────────────────────────────────────────────────────────────
function HelpAccordionItem({
  q, a, defaultOpen, itemId, onOpen, myVote, upCount, downCount, onRate, onShare, lastUpdated,
}: {
  q: string;
  a: string[];
  defaultOpen?: boolean;
  itemId?: string;
  onOpen?: (slug: string) => void;
  myVote?: string | null;
  upCount?: number;
  downCount?: number;
  onRate?: (slug: string, vote: string) => void;
  onShare?: any;
  lastUpdated?: string;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const ref = useRef(null);

  // When defaultOpen changes (e.g. deep link resolved), update open state
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && itemId && onOpen) onOpen(itemId);
  };

  // Pre-compute rating values before render
  const totalVotes = (upCount ?? 0) + (downCount ?? 0);
  const helpfulPct = totalVotes > 0 ? Math.round(((upCount ?? 0) / totalVotes) * 100) : null;
  const votedUp = myVote === 'up';
  const votedDown = myVote === 'down';

  return (
    <div id={itemId} ref={ref} className="border-b border-border last:border-b-0">
      <button
        onClick={toggle}
        className="w-full px-4 py-4 text-left hover:bg-muted/40 transition-colors flex items-center justify-between gap-3 group"
      >
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">{q}</span>
          {lastUpdated && (
            <span className="text-[9px] text-muted-foreground/60 font-medium">Updated {lastUpdated}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {totalVotes > 0 && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <ThumbsUp className="w-2.5 h-2.5" />{helpfulPct}%
            </span>
          )}
          {open
            ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 bg-muted/20 border-t border-border/50 animate-in slide-in-from-top-1 duration-150">
          <ul className="mt-3 space-y-2">
            {a.map((line, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground leading-relaxed">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0" />
                <span>{line}</span>
              </li>
            ))}
          </ul>

          {/* ── Article Rating ── */}
          {itemId && onRate && (
            <div className="mt-4 pt-3 border-t border-border/40">
              <p className="text-[11px] font-semibold text-muted-foreground mb-2">Was this helpful?</p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => onRate(itemId, 'up')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all active:scale-95 ${
                    votedUp
                      ? 'bg-green-500/10 border-green-500/40 text-green-600'
                      : 'border-border hover:border-green-500/40 hover:text-green-600 text-muted-foreground'
                  }`}
                >
                  <ThumbsUp className="w-3 h-3" />
                  Yes {upCount && upCount > 0 ? `(${upCount})` : ''}
                </button>
                <button
                  onClick={() => onRate(itemId, 'down')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all active:scale-95 ${
                    votedDown
                      ? 'bg-red-500/10 border-red-500/40 text-red-600'
                      : 'border-border hover:border-red-500/40 hover:text-red-600 text-muted-foreground'
                  }`}
                >
                  <ThumbsDown className="w-3 h-3" />
                  No {downCount && downCount > 0 ? `(${downCount})` : ''}
                </button>
                {totalVotes > 0 && (
                  <span className="text-[10px] text-muted-foreground ml-1">
                    {helpfulPct}% of {totalVotes} found this helpful
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Actions row: Print + Copy link */}
          {itemId && (
            <div className="mt-3 flex items-center gap-4">
              {/* Print / Export */}
              <button
                onClick={() => {
                  const win = window.open('', '_blank', 'width=700,height=600');
                  if (!win) { toast.error('Allow popups to print articles'); return; }
                  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${q}</title><style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 24px;color:#111}h1{font-size:20px;font-weight:800;margin-bottom:16px;color:#111}ul{padding-left:0;list-style:none;margin:0}li{display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;font-size:15px;line-height:1.6;color:#333}.dot{width:6px;height:6px;border-radius:50%;background:#4f46e5;margin-top:8px;flex-shrink:0}footer{margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280}@media print{body{margin:20px}}</style></head><body><h1>${q}</h1><ul>${a.map(l => `<li><span class="dot"></span><span>${l}</span></li>`).join('')}</ul><footer>Testagram Help Center — testagram.site/help#${itemId}</footer><script>window.onload=function(){window.print();}<\/script></body></html>`;
                  win.document.write(html);
                  win.document.close();
                }}
                className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
              >
                <Printer className="w-3 h-3" /> Print / Export
              </button>
              {/* Copy link */}
              <button
                onClick={() => {
                  const url = `${window.location.origin}/help#${itemId}`;
                  navigator.clipboard.writeText(url).then(() => toast.success('Link copied!')).catch(() => {});
                }}
                className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
              >
                <Hash className="w-3 h-3" /> Copy link
              </button>
              {/* Share */}
              {onShare && (
                <button
                  onClick={() => onShare(itemId!, q, a[0] ?? '')}
                  className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
                >
                  <Share2 className="w-3 h-3" /> Share
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function HelpPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  // Deep-link state
  const [deepLinkSlug, setDeepLinkSlug] = useState('');
  // esbuild guard: plain parallel arrays — no Record<string,number>
  const [analyticsQueries, setAnalyticsQueries] = useState([]);
  const [analyticsCounts, setAnalyticsCounts] = useState([]);
  // Article ratings — parallel arrays: slugs, myVotes (per user), upCounts, downCounts
  // esbuild guard: plain useState([]) — no typed generics
  const [ratingSlugs, setRatingSlugs] = useState([]);
  const [ratingMyVotes, setRatingMyVotes] = useState([]);
  const [ratingUpCounts, setRatingUpCounts] = useState([]);
  const [ratingDownCounts, setRatingDownCounts] = useState([]);
  // Contact form
  const [contactSubject, setContactSubject] = useState('Account Issues');
  const [contactMessage, setContactMessage] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactSending, setContactSending] = useState(false);
  const [contactSent, setContactSent] = useState(false);
  // Video guide modal
  const [videoModalIdx, setVideoModalIdx] = useState(-1);
  // Ticket history — parallel arrays (esbuild guard: plain useState([]))
  const [ticketSubjects, setTicketSubjects] = useState([]);
  const [ticketDates, setTicketDates] = useState([]);
  const [ticketRead, setTicketRead] = useState([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const searchDebounceRef = useRef(null);

  // Pre-fill email from auth
  useEffect(() => {
    if (user?.email) setContactEmail(user.email);
  }, [user?.email]);

  // Load support ticket history from platform_inbox
  useEffect(() => {
    if (!user?.id) return;
    setTicketsLoading(true);
    supabase
      .from('platform_inbox')
      .select('subject, sent_at, read')
      .eq('user_id', user.id)
      .like('subject', '[Support]%')
      .order('sent_at', { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (!data) { setTicketsLoading(false); return; }
        const subs: string[] = [];
        const dates: string[] = [];
        const reads: boolean[] = [];
        for (let i = 0; i < data.length; i++) {
          subs.push(data[i].subject ?? '');
          dates.push(data[i].sent_at ?? '');
          reads.push(!!data[i].read);
        }
        setTicketSubjects(subs as any);
        setTicketDates(dates as any);
        setTicketRead(reads as any);
        setTicketsLoading(false);
      });
  }, [user?.id]);

  // Load search analytics from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HELP_ANALYTICS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setAnalyticsQueries(parsed.queries ?? []);
        setAnalyticsCounts(parsed.counts ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  // Load article ratings from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HELP_RATINGS_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        setRatingSlugs(data.slugs ?? []);
        setRatingMyVotes(data.myVotes ?? []);
        setRatingUpCounts(data.upCounts ?? []);
        setRatingDownCounts(data.downCounts ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  // Deep-link: parse hash on mount, open matching accordion
  useEffect(() => {
    const hash = window.location.hash.replace('#', '').trim();
    if (!hash) return;
    setDeepLinkSlug(hash);
    // Scroll after short delay to let render complete
    setTimeout(() => {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 350);
  }, []);

  // Track a search query in localStorage analytics
  const trackSearch = (q: string) => {
    if (!q.trim() || q.trim().length < 2) return;
    const clean = q.trim().toLowerCase();
    try {
      const raw = localStorage.getItem(HELP_ANALYTICS_KEY);
      const data = raw ? JSON.parse(raw) : { queries: [], counts: [] };
      const idx = (data.queries as string[]).indexOf(clean);
      if (idx >= 0) data.counts[idx] += 1;
      else { data.queries.push(clean); data.counts.push(1); }
      localStorage.setItem(HELP_ANALYTICS_KEY, JSON.stringify(data));
      setAnalyticsQueries(data.queries as any);
      setAnalyticsCounts(data.counts as any);
    } catch { /* ignore */ }
  };

  // Debounced search tracking
  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      if (val.trim().length >= 2) trackSearch(val);
    }, 1000);
  };

  // Article rating handler
  const handleRate = (slug: string, vote: string) => {
    const slugs = ratingSlugs as string[];
    const myVotes = ratingMyVotes as string[];
    const upCounts = ratingUpCounts as number[];
    const downCounts = ratingDownCounts as number[];

    const idx = slugs.indexOf(slug);
    const prev = idx >= 0 ? myVotes[idx] : null;

    let newSlugs = [...slugs];
    let newMyVotes = [...myVotes];
    let newUp = [...upCounts];
    let newDown = [...downCounts];

    if (idx < 0) {
      // New entry
      newSlugs.push(slug);
      newMyVotes.push(vote);
      newUp.push(vote === 'up' ? 1 : 0);
      newDown.push(vote === 'down' ? 1 : 0);
    } else if (prev === vote) {
      // Toggle off
      newMyVotes[idx] = '';
      if (vote === 'up') newUp[idx] = Math.max(0, newUp[idx] - 1);
      else newDown[idx] = Math.max(0, newDown[idx] - 1);
    } else {
      // Switch vote
      newMyVotes[idx] = vote;
      if (prev === 'up') newUp[idx] = Math.max(0, newUp[idx] - 1);
      if (prev === 'down') newDown[idx] = Math.max(0, newDown[idx] - 1);
      if (vote === 'up') newUp[idx] = (newUp[idx] ?? 0) + 1;
      if (vote === 'down') newDown[idx] = (newDown[idx] ?? 0) + 1;
    }

    setRatingSlugs(newSlugs as any);
    setRatingMyVotes(newMyVotes as any);
    setRatingUpCounts(newUp as any);
    setRatingDownCounts(newDown as any);

    try {
      localStorage.setItem(HELP_RATINGS_KEY, JSON.stringify({
        slugs: newSlugs, myVotes: newMyVotes, upCounts: newUp, downCounts: newDown,
      }));
    } catch { /* ignore */ }

    const feedbackVote = prev === vote ? 'removed' : vote === 'up' ? 'helpful ✓' : 'not helpful';
    toast.success(`Feedback: ${feedbackVote}`, { duration: 1200 });
  };

  const handleContactSubmit = async () => {
    if (!contactMessage.trim()) { toast.error('Please write a message'); return; }
    if (!contactEmail.trim()) { toast.error('Please provide your email'); return; }
    setContactSending(true);
    try {
      // Insert into platform_inbox for user record
      const { error } = await supabase.from('platform_inbox').insert({
        user_id: user?.id ?? null,
        subject: `[Support] ${contactSubject}: from ${contactEmail}`,
        body: `From: ${contactEmail}\nSubject: ${contactSubject}\n\n${contactMessage.trim()}`,
        type: 'news',
        icon_emoji: '📩',
        cta_label: 'View in Dashboard',
        cta_url: '/admin',
      });
      if (error) throw error;

      // Also post to team_chat_messages so staff see it in Team Chat immediately
      await supabase.from('team_chat_messages').insert({
        user_id: user?.id ?? null,
        message: `📩 [SUPPORT TICKET] Subject: ${contactSubject}\nFrom: ${contactEmail}\n\n${contactMessage.trim()}`,
        department: 'Support',
      });

      setContactSent(true);
      setContactMessage('');
      toast.success("Support request sent! We'll get back to you soon.");
    } catch (e: any) {
      toast.error(e.message || 'Failed to send. Please try again.');
    } finally {
      setContactSending(false);
    }
  };

  // ── AI Chatbot state ──────────────────────────────────────────────────────
  const [chatOpen, setChatOpen] = useState(false);
  // esbuild guard: parallel arrays instead of {role,content}[] typed array
  const [chatRoles, setChatRoles] = useState([]);
  const [chatTexts, setChatTexts] = useState([]);
  const [chatHistoryLoaded, setChatHistoryLoaded] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef(null);

  // Load chat history from localStorage on first open
  useEffect(() => {
    if (!chatOpen || chatHistoryLoaded) return;
    try {
      const raw = localStorage.getItem(HELP_CHAT_HISTORY_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        const savedRoles = (data.roles ?? []).slice(-40);
        const savedTexts = (data.texts ?? []).slice(-40);
        if (savedRoles.length > 0) {
          setChatRoles(savedRoles);
          setChatTexts(savedTexts);
        }
      }
    } catch { /* ignore */ }
    setChatHistoryLoaded(true);
  }, [chatOpen, chatHistoryLoaded]);

  // Persist chat history to localStorage whenever messages change
  useEffect(() => {
    if (!chatHistoryLoaded) return;
    try {
      const roles = chatRoles as string[];
      const texts = chatTexts as string[];
      if (roles.length === 0) { localStorage.removeItem(HELP_CHAT_HISTORY_KEY); return; }
      localStorage.setItem(HELP_CHAT_HISTORY_KEY, JSON.stringify({
        roles: roles.slice(-40),
        texts: texts.slice(-40),
      }));
    } catch { /* ignore */ }
  }, [chatRoles, chatTexts, chatHistoryLoaded]);

  // Scroll chat to bottom when messages change
  useEffect(() => {
    if (chatOpen) chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatRoles.length, chatOpen]);

  // Clear chat history
  const handleClearChat = () => {
    setChatRoles([] as any);
    setChatTexts([] as any);
    try { localStorage.removeItem(HELP_CHAT_HISTORY_KEY); } catch { /* ignore */ }
    toast.success('Chat cleared', { duration: 1200 });
  };

  // Article share handler (module-level-safe: no inline object in JSX)
  const handleArticleShare = (slug: string, q: string, firstBullet: string) => {
    const url = `${window.location.origin}/help#${slug}`;
    // esbuild guard: use module-level buildShareData — no inline object literal in component function body
    const shareData = buildShareData(q, firstBullet, url);
    if (navigator.share) {
      navigator.share(shareData).catch(() => {});
    } else {
      navigator.clipboard.writeText(url)
        .then(() => toast.success('Link copied!'))
        .catch(() => toast.error('Could not copy link'));
    }
  };

  const handleChatSend = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    setChatInput('');

    // Append user message
    const newRoles = [...(chatRoles as string[]), 'user'];
    const newTexts = [...(chatTexts as string[]), text];
    setChatRoles(newRoles as any);
    setChatTexts(newTexts as any);
    setChatLoading(true);

    // Build messages array for edge function
    const msgs = buildChatMessages(newRoles, newTexts);

    const { data, error } = await supabase.functions.invoke('help-chatbot', { body: { messages: msgs } });

    if (error || !data?.reply) {
      const errMsg = 'Sorry, I could not connect to support AI. Please try again.';
      setChatRoles([...newRoles, 'assistant'] as any);
      setChatTexts([...newTexts, errMsg] as any);
    } else {
      setChatRoles([...newRoles, 'assistant'] as any);
      setChatTexts([...newTexts, data.reply] as any);
    }
    setChatLoading(false);
  };

  // ── Pre-compute chat display values (esbuild guard: no inline ops in JSX) ──
  const chatRolesArr = chatRoles as string[];
  const chatTextsArr = chatTexts as string[];
  const hasChatMessages = chatRolesArr.length > 0;

  // ── Pre-compute values before JSX (esbuild guard) ──────────────────────────
  const searchLow = searchQuery.toLowerCase().trim();
  const hasSearch = searchLow.length >= 2;

  // esbuild guard: pre-compute live support status before JSX
  const supportStatus = getSupportStatus();

  // esbuild guard: cast arrays ONCE, never cast in JSX
  const rSlugArr = ratingSlugs as string[];
  const rVoteArr = ratingMyVotes as string[];
  const rUpArr = ratingUpCounts as number[];
  const rDownArr = ratingDownCounts as number[];

  // esbuild guard: pre-compute per-topic rating data as flat parallel arrays (no getRatingProps function returning inline object)
  // One entry per ALL_TOPICS index — same order, so JSX uses index lookups not function calls
  const topicSlugs: string[] = ALL_TOPICS.map(t => toSlug(t.q));
  const topicMyVotes: (string | null)[] = topicSlugs.map(slug => {
    const i = rSlugArr.indexOf(slug); return i >= 0 ? rVoteArr[i] : null;
  });
  const topicUpCounts: number[] = topicSlugs.map(slug => {
    const i = rSlugArr.indexOf(slug); return i >= 0 ? rUpArr[i] : 0;
  });
  const topicDownCounts: number[] = topicSlugs.map(slug => {
    const i = rSlugArr.indexOf(slug); return i >= 0 ? rDownArr[i] : 0;
  });

  // esbuild guard: pre-compute most-helpful list with ALL rating fields merged (no inline calcs in JSX .map())
  // Filter+sort+slice before JSX; enrich with upCount/downCount/myVote/helpfulPct so JSX is pure display
  const mhRaw = ALL_TOPICS.map((t, ti) => {
    const up = topicUpCounts[ti];
    const down = topicDownCounts[ti];
    const total = up + down;
    const pct = total > 0 ? Math.round((up / total) * 100) : 0;
    return { q: t.q, a: t.a, slug: topicSlugs[ti], up, down, total, pct, myVote: topicMyVotes[ti], net: up - down };
  });
  const mostHelpfulTopics = mhRaw.filter(t => t.up > 0).sort((a, b) => b.net - a.net).slice(0, 3);
  const hasMostHelpful = mostHelpfulTopics.length > 0;
  const searchResults = hasSearch
    ? ALL_TOPICS.filter(t => t.q.toLowerCase().includes(searchLow) || t.a.some(l => l.toLowerCase().includes(searchLow)))
    : [];
  const searchResultsSuffix = searchResults.length !== 1 ? 's' : '';
  const searchResultsLabel = searchResults.length > 0
    ? `${searchResults.length} result${searchResultsSuffix} for "${searchQuery}"`
    : `No results for "${searchQuery}"`;

  // esbuild guard: pre-compute top searches — no typed annotation, no inline object creation in sort
  const analyticsQueriesArr = analyticsQueries as string[];
  const analyticsCountsArr = analyticsCounts as number[];
  // esbuild guard: no ': string[]' type annotation on let declaration
  let topSearches = [] as any[];
  if (analyticsQueriesArr.length > 0) {
    const idxArr = analyticsQueriesArr.map((_, i) => i);
    idxArr.sort((a, b) => (analyticsCountsArr[b] ?? 0) - (analyticsCountsArr[a] ?? 0));
    topSearches = idxArr.slice(0, 5).map(i => analyticsQueriesArr[i]);
  }
  const hasTopSearches = topSearches.length > 0 && !hasSearch;

  // esbuild guard: pre-compute video modal data before JSX (no inline ternaries in render)
  const videoModalActive = videoModalIdx >= 0 && videoModalIdx < VIDEO_GUIDES.length;
  const activeGuideTitle = videoModalActive ? VIDEO_GUIDES[videoModalIdx].title : '';
  const activeGuideDesc = videoModalActive ? VIDEO_GUIDES[videoModalIdx].desc : '';
  const activeGuideThumb = videoModalActive ? VIDEO_GUIDES[videoModalIdx].thumb : '';
  const activeGuideSlug = videoModalActive ? VIDEO_GUIDES[videoModalIdx].articleSlug : '';
  const activeGuideDuration = videoModalActive ? VIDEO_GUIDES[videoModalIdx].duration : '';

  // esbuild guard: pre-compute ticket display data as flat arrays (no inline object creation in JSX)
  const tSubArr = ticketSubjects as string[];
  const tDateArr = ticketDates as string[];
  const tReadArr = ticketRead as boolean[];
  const hasTickets = tSubArr.length > 0;
  // Strip '[Support] ' prefix from subjects for display
  const tDisplaySubs = tSubArr.map(s => s.replace(/^\[Support\]\s*/, ''));
  // esbuild guard: use module-level formatTicketDate — no try/catch inside inline .map() callback
  const tDisplayDates = tDateArr.map(formatTicketDate);

  // esbuild guard: use module-level HELP_STRUCTURED_DATA — no inline object construction inside component
  useSEO({
    title: 'Help Center — Testagram Support & FAQ',
    description: 'Find step-by-step answers to common questions about Testagram. Learn how to post videos, earn money, manage your account, use M-Pesa, report issues, and get the most from your creator experience.',
    url: '/help',
    type: 'website',
    keywords: 'testagram help, support faq, how to post videos, creator earnings, mpesa payments, account settings, verify account, privacy settings, report abuse, schedule posts',
    structuredData: HELP_STRUCTURED_DATA,
  });

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <TopBar title="Help Center" showBack />
      <HelpAdBanner />

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">

        {/* Hero */}
        <div className="text-center pt-2 pb-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <HelpCircle className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-black mb-1">How can we help you?</h1>
          <p className="text-sm text-muted-foreground">Search for answers or browse categories below</p>
        </div>

        {/* ── Video Guides ── */}
        <div className="border border-border rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-muted/20 border-b border-border">
            <Play className="w-4 h-4 text-primary" />
            <h2 className="font-black text-sm">Video Guides</h2>
            <span className="text-[10px] text-muted-foreground ml-auto">Quick visual tutorials</span>
          </div>
          <div className="grid grid-cols-2 gap-0 divide-x divide-y divide-border">
            {VIDEO_GUIDES.map((guide, gi) => (
              <button
                key={gi}
                onClick={() => setVideoModalIdx(gi)}
                className="relative group text-left overflow-hidden hover:bg-muted/20 transition-colors"
              >
                {/* Thumbnail */}
                <div className="relative w-full aspect-video overflow-hidden bg-muted">
                  <img
                    src={guide.thumb}
                    alt={guide.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                  {/* Play overlay */}
                  <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center">
                      <Play className="w-4 h-4 text-primary fill-primary" />
                    </div>
                  </div>
                  {/* Duration badge */}
                  <div className="absolute bottom-1.5 right-1.5 bg-black/70 text-white text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5">
                    <Clock className="w-2.5 h-2.5" />{guide.duration}
                  </div>
                </div>
                {/* Title */}
                <div className="px-3 py-2">
                  <p className="text-xs font-bold text-foreground leading-snug">{guide.title}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Most Helpful Articles ── (shown when users have rated articles) */}
        {hasMostHelpful && (
          <div className="border border-border rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 bg-muted/20 border-b border-border">
              <Star className="w-4 h-4 text-amber-500" />
              <h2 className="font-black text-sm">Most Helpful Articles</h2>
              <span className="text-[10px] text-muted-foreground ml-auto">Based on reader ratings</span>
            </div>
            {mostHelpfulTopics.map((t, i) => (
              <HelpAccordionItem
                key={i}
                q={t.q}
                a={t.a}
                itemId={t.slug}
                myVote={t.myVote}
                upCount={t.up}
                downCount={t.down}
                onRate={handleRate}
                onShare={handleArticleShare}
                onOpen={(s) => {
                  if (window.history.replaceState) window.history.replaceState(null, '', `/help#${s}`);
                }}
              />
            ))}
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search help articles…"
            value={searchQuery}
            onChange={e => handleSearchChange(e.target.value)}
            className="pl-10 h-11 rounded-xl"
          />
        </div>

        {/* ── Category Quick Jump ── */}
        {/* esbuild guard: explicit buttons, no dynamic component variable (const X = cat.icon) inside map */}
        {!hasSearch && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            <button
              onClick={() => { const el = document.getElementById('help-cat-account'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-border bg-blue-500/10 shrink-0 text-xs font-bold transition-all hover:scale-105 active:scale-95"
            >
              <User className="w-3.5 h-3.5 text-blue-600" />
              <span className="whitespace-nowrap">Account & Profile</span>
            </button>
            <button
              onClick={() => { const el = document.getElementById('help-cat-posts'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-border bg-green-500/10 shrink-0 text-xs font-bold transition-all hover:scale-105 active:scale-95"
            >
              <MessageCircle className="w-3.5 h-3.5 text-green-600" />
              <span className="whitespace-nowrap">Posts & Engagement</span>
            </button>
            <button
              onClick={() => { const el = document.getElementById('help-cat-payments'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-border bg-purple-500/10 shrink-0 text-xs font-bold transition-all hover:scale-105 active:scale-95"
            >
              <CreditCard className="w-3.5 h-3.5 text-purple-600" />
              <span className="whitespace-nowrap">Payments & Monetization</span>
            </button>
            <button
              onClick={() => { const el = document.getElementById('help-cat-safety'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-border bg-red-500/10 shrink-0 text-xs font-bold transition-all hover:scale-105 active:scale-95"
            >
              <Shield className="w-3.5 h-3.5 text-red-600" />
              <span className="whitespace-nowrap">Safety & Security</span>
            </button>
          </div>
        )}

        {/* ── Most Searched Chips ── (shown when not searching) */}
        {hasTopSearches && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingUp className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Most Searched</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {topSearches.map((q, i) => (
                <button
                  key={i}
                  onClick={() => setSearchQuery(q)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/60 hover:bg-primary/10 border border-border hover:border-primary/30 rounded-full text-xs font-medium text-foreground transition-colors"
                >
                  <Search className="w-2.5 h-2.5 text-muted-foreground" />
                  {q}
                </button>
              ))}
              <button
                onClick={() => {
                  try { localStorage.removeItem(HELP_ANALYTICS_KEY); } catch { /* ignore */ }
                  setAnalyticsQueries([] as any);
                  setAnalyticsCounts([] as any);
                }}
                className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors px-1"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Search Results */}
        {hasSearch && (
          <div className="border border-border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 bg-muted/30 border-b border-border">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
                {searchResultsLabel}
              </p>
            </div>
            {searchResults.length === 0 ? (
              <div className="px-4 py-8 text-center text-muted-foreground">
                <p className="text-sm mb-1">No articles found</p>
                <p className="text-xs">Try a different keyword or browse the categories below</p>
              </div>
            ) : (
              <div>
                {searchResults.map((item, i) => {
                  // esbuild guard: look up pre-computed per-topic arrays by slug index (no getRatingProps)
                  const slug = toSlug(item.q);
                  const ti = topicSlugs.indexOf(slug);
                  const srMyVote = ti >= 0 ? topicMyVotes[ti] : null;
                  const srUp = ti >= 0 ? topicUpCounts[ti] : 0;
                  const srDown = ti >= 0 ? topicDownCounts[ti] : 0;
                  return (
                    <div key={i}>
                      <div className="px-4 pt-2 pb-0">
                        <span className="text-[10px] font-bold text-primary/70 uppercase tracking-wide">{item.category}</span>
                      </div>
                      <HelpAccordionItem
                        q={item.q}
                        a={item.a}
                        defaultOpen
                        itemId={slug}
                        myVote={srMyVote}
                        upCount={srUp}
                        downCount={srDown}
                        onRate={handleRate}
                        onShare={handleArticleShare}
                        onOpen={trackSearch}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Category Sections */}
        {!hasSearch && CATEGORIES.map(cat => (
            <div key={cat.title} id={cat.catId} className="border border-border rounded-2xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3.5 bg-muted/20 border-b border-border">
                <div className={`w-9 h-9 rounded-xl ${cat.bg} flex items-center justify-center shrink-0`}>
                  {getCatIconNode(cat.title, cat.color)}
                </div>
                <h2 className="font-black text-base">{cat.title}</h2>
              </div>
              <div>
                {cat.topics.map((topic, ti) => {
                  // esbuild guard: index into pre-computed arrays (no getRatingProps)
                  const slug = toSlug(topic.q);
                  const tIdx = topicSlugs.indexOf(slug);
                  const catMyVote = tIdx >= 0 ? topicMyVotes[tIdx] : null;
                  const catUp = tIdx >= 0 ? topicUpCounts[tIdx] : 0;
                  const catDown = tIdx >= 0 ? topicDownCounts[tIdx] : 0;
                  const isDeepLinked = deepLinkSlug === slug;
                  return (
                    <HelpAccordionItem
                      key={ti}
                      q={topic.q}
                      a={Array.isArray(topic.a) ? topic.a : [topic.a]}
                      defaultOpen={isDeepLinked}
                      itemId={slug}
                      myVote={catMyVote}
                      upCount={catUp}
                      downCount={catDown}
                      onRate={handleRate}
                      onShare={handleArticleShare}
                      lastUpdated={getArticleDate(slug)}
                      onOpen={(s) => {
                        if (window.history.replaceState) {
                          window.history.replaceState(null, '', `/help#${s}`);
                        }
                      }}
                    />
                  );
                })}
              </div>
            </div>
        ))}

        {/* ── Contact Support Form ── */}
        <div className="border border-border rounded-2xl overflow-hidden" id="contact-support">
          <div className="px-4 py-3.5 border-b border-border bg-muted/20 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <MessageCircle className="w-4.5 h-4.5 text-primary" size={18} />
            </div>
            <div>
              <h2 className="font-black text-base">Contact Support</h2>
              <p className="text-xs text-muted-foreground">Send a request to our team</p>
            </div>
          </div>

          {/* Live Support Status Banner */}
          <div className={`flex items-center gap-2.5 px-4 py-2.5 border-b border-border ${
            supportStatus.online ? 'bg-green-500/5' : 'bg-muted/20'
          }`}>
            <span className={`w-2 h-2 rounded-full shrink-0 ${
              supportStatus.online ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/40'
            }`} />
            <div>
              <p className={`text-xs font-bold ${
                supportStatus.online ? 'text-green-600' : 'text-muted-foreground'
              }`}>{supportStatus.label}</p>
              <p className="text-[10px] text-muted-foreground">{supportStatus.sub}</p>
            </div>
          </div>

          {contactSent ? (
            <div className="px-4 py-10 text-center space-y-3">
              <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7 text-green-500" />
              </div>
              <p className="font-black text-lg">Request sent!</p>
              <p className="text-sm text-muted-foreground">We'll get back to you at <span className="font-semibold text-foreground">{contactEmail}</span> within 24 hours.</p>
              <button
                onClick={() => setContactSent(false)}
                className="text-xs text-primary font-semibold hover:underline"
              >
                Send another request
              </button>
            </div>
          ) : (
            <div className="px-4 py-4 space-y-4">
              {/* Subject */}
              <div>
                <label className="text-xs font-bold text-muted-foreground mb-1.5 block uppercase tracking-wide">Subject</label>
                <select
                  value={contactSubject}
                  onChange={e => setContactSubject(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none cursor-pointer"
                >
                  {CONTACT_SUBJECTS.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              {/* Email */}
              <div>
                <label className="text-xs font-bold text-muted-foreground mb-1.5 block uppercase tracking-wide">Your Email</label>
                <Input
                  type="email"
                  value={contactEmail}
                  onChange={e => setContactEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="h-10 rounded-xl"
                />
              </div>
              {/* Message */}
              <div>
                <label className="text-xs font-bold text-muted-foreground mb-1.5 block uppercase tracking-wide">Message</label>
                <textarea
                  value={contactMessage}
                  onChange={e => setContactMessage(e.target.value)}
                  placeholder="Describe your issue in detail. Include any relevant post IDs, transaction references, or error messages…"
                  rows={4}
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 leading-relaxed"
                />
                <p className="text-[10px] text-muted-foreground mt-1 text-right">{contactMessage.length}/1000</p>
              </div>
              <button
                onClick={handleContactSubmit}
                disabled={contactSending || !contactMessage.trim() || !contactEmail.trim()}
                className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-bold text-sm hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 transition-opacity"
              >
                {contactSending
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                  : <><Send className="w-4 h-4" /> Send Support Request</>}
              </button>
              <p className="text-[10px] text-muted-foreground text-center">
                Or email us directly at{' '}
                <a href="mailto:support@tsocial.com" className="text-primary hover:underline">support@tsocial.com</a>
              </p>
            </div>
          )}
        </div>

        {/* ── Ticket History Tracker ── */}
        {user?.id && (
          <div className="border border-border rounded-2xl overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border bg-muted/20">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Ticket className="w-4.5 h-4.5 text-primary" size={18} />
              </div>
              <div>
                <h2 className="font-black text-base">My Support Tickets</h2>
                <p className="text-xs text-muted-foreground">Your recent support requests</p>
              </div>
              <button
                onClick={() => {
                  const el = document.getElementById('contact-support');
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="ml-auto text-xs text-primary font-semibold hover:underline flex items-center gap-1"
              >
                <FileText className="w-3 h-3" /> New ticket
              </button>
            </div>
            {ticketsLoading ? (
              <div className="px-4 py-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                Loading tickets…
              </div>
            ) : hasTickets ? (
              <div>
                {tDisplaySubs.map((sub, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${tReadArr[i] ? 'bg-muted-foreground/30' : 'bg-primary'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate text-foreground">{sub}</p>
                      <p className="text-[10px] text-muted-foreground">{tDisplayDates[i]}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                      tReadArr[i]
                        ? 'bg-muted text-muted-foreground'
                        : 'bg-primary/10 text-primary'
                    }`}>
                      {tReadArr[i] ? 'Viewed' : 'Sent'}
                    </span>
                  </div>
                ))}
                <div className="px-4 py-3 border-t border-border">
                  <button
                    onClick={() => {
                      const el = document.getElementById('contact-support');
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className="text-xs text-primary font-semibold hover:underline"
                  >
                    + Submit another request
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-4 py-8 text-center">
                <Ticket className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground font-medium">No support tickets yet</p>
                <p className="text-xs text-muted-foreground mt-1">Submit a request using the Contact Support form above.</p>
              </div>
            )}
          </div>
        )}

        {/* ── Still need help CTA ── */}
        <div className="bg-gradient-to-br from-primary/8 via-purple-500/5 to-background border border-primary/15 rounded-2xl p-7 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <MessageCircle className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-xl font-black mb-1">Still need help?</h3>
          <p className="text-sm text-muted-foreground mb-5">Our support team is here to help you</p>
          <button
            onClick={() => {
              const el = document.getElementById('contact-support');
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-full font-bold text-sm hover:opacity-90 transition-opacity"
          >
            <MessageCircle className="w-4 h-4" />
            Open Support Form
          </button>
        </div>

        {/* ── Footer Links ── */}
        <div className="py-4 border-t border-border">
          <div className="flex items-center justify-center flex-wrap gap-x-4 gap-y-2">
            <button
              onClick={() => navigate('/privacy')}
              className="text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              Privacy Policy
            </button>
            <span className="text-muted-foreground/40 text-xs">·</span>
            <button
              onClick={() => navigate('/terms')}
              className="text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              Terms of Service
            </button>
            <span className="text-muted-foreground/40 text-xs">·</span>
            <button
              onClick={() => navigate('/policy')}
              className="text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              Community Guidelines
            </button>
          </div>
          <p className="text-center text-[10px] text-muted-foreground/50 mt-2">© 2026 Testagram · Help Center</p>
        </div>

        {/* Quick Links */}
        <div className="space-y-3">
          <button
            onClick={() => navigate('/policy')}
            className="w-full flex items-center justify-between p-4 border border-border rounded-xl hover:bg-muted/40 transition-colors text-left"
          >
            <div>
              <p className="font-bold text-sm">Community Guidelines</p>
              <p className="text-xs text-muted-foreground">Learn about our rules</p>
            </div>
            <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
          </button>
          <button
            onClick={() => navigate('/privacy')}
            className="w-full flex items-center justify-between p-4 border border-border rounded-xl hover:bg-muted/40 transition-colors text-left"
          >
            <div>
              <p className="font-bold text-sm">Privacy Policy</p>
              <p className="text-xs text-muted-foreground">How we protect your data</p>
            </div>
            <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
          </button>
          <button
            onClick={() => navigate('/terms')}
            className="w-full flex items-center justify-between p-4 border border-border rounded-xl hover:bg-muted/40 transition-colors text-left"
          >
            <div>
              <p className="font-bold text-sm">Terms of Service</p>
              <p className="text-xs text-muted-foreground">Terms and conditions</p>
            </div>
            <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
          </button>
        </div>

      </div>

      {/* ── AI Chatbot floating button ── */}
      <button
        onClick={() => setChatOpen(o => !o)}
        aria-label="Open help chatbot"
        className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-40 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-2xl shadow-primary/30 flex items-center justify-center hover:opacity-90 active:scale-95 transition-all"
      >
        {chatOpen ? <X className="w-6 h-6" /> : <Bot className="w-6 h-6" />}
      </button>

      {/* ── AI Chatbot panel ── */}
      {chatOpen && (
        <div className="fixed bottom-36 right-4 md:bottom-24 md:right-6 z-40 w-80 max-h-[480px] bg-background border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-2 duration-200">
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 bg-gradient-to-r from-primary/10 to-primary/5 border-b border-border">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-xs font-black">Testagram AI Support</p>
              <p className="text-[10px] text-muted-foreground">Powered by Gemini 3 Flash</p>
            </div>
            {hasChatMessages && (
              <button onClick={handleClearChat} className="text-[10px] text-muted-foreground hover:text-destructive font-semibold transition-colors px-1.5 py-0.5 rounded-lg hover:bg-destructive/10">
                Clear
              </button>
            )}
            <button onClick={() => setChatOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {!hasChatMessages && (
              <div className="text-center py-4">
                <Bot className="w-8 h-8 text-primary/30 mx-auto mb-2" />
                <p className="text-xs font-semibold text-foreground">Hi! I'm your Testagram assistant.</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Ask me anything about the platform.</p>
                <div className="mt-3 space-y-1.5">
                  {CHAT_SUGGESTION_QUESTIONS.map((q, qi) => (
                    <button key={qi} onClick={() => { setChatInput(q); }}
                      className="w-full text-left text-[11px] px-3 py-2 rounded-xl bg-muted/60 hover:bg-primary/10 border border-border hover:border-primary/30 transition-colors flex items-center gap-2">
                      <ChevronRight className="w-3 h-3 text-primary shrink-0" />{q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {chatRolesArr.map((role, ci) => (
              <div key={ci} className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                  role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-br-sm'
                    : 'bg-muted text-foreground rounded-bl-sm'
                }`}>
                  {chatTextsArr[ci]}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2 flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t border-border flex items-center gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChatSend(); } }}
              placeholder="Ask a question…"
              className="flex-1 text-xs bg-muted/60 border border-border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground/60"
            />
            <button
              onClick={handleChatSend}
              disabled={!chatInput.trim() || chatLoading}
              className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0"
            >
              {chatLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      )}

      {/* ── Video Guide Modal ── */}
      {videoModalActive && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setVideoModalIdx(-1)}
        >
          <div
            className="w-full max-w-sm bg-background rounded-2xl overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Thumbnail header */}
            <div className="relative w-full aspect-video bg-muted">
              <img src={activeGuideThumb} alt={activeGuideTitle} className="w-full h-full object-cover" />
              {/* Simulated play indicator */}
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <div className="w-16 h-16 rounded-full bg-white/95 flex items-center justify-center shadow-lg">
                  <Play className="w-7 h-7 text-primary fill-primary ml-0.5" />
                </div>
              </div>
              {/* Duration */}
              <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1">
                <Clock className="w-3 h-3" />{activeGuideDuration}
              </div>
              {/* Close */}
              <button
                onClick={() => setVideoModalIdx(-1)}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* Info */}
            <div className="p-5">
              <h3 className="font-black text-lg mb-1">{activeGuideTitle}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">{activeGuideDesc}</p>
              <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl px-4 py-3 mb-4">
                <p className="text-xs font-bold text-amber-700 dark:text-amber-400 mb-0.5">Video coming soon</p>
                <p className="text-[11px] text-amber-600 dark:text-amber-400/80">Full video tutorials are being recorded. Read the step-by-step guide in the meantime.</p>
              </div>
              <button
                onClick={() => {
                  setVideoModalIdx(-1);
                  const el = document.getElementById(activeGuideSlug);
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    if (window.history.replaceState) window.history.replaceState(null, '', `/help#${activeGuideSlug}`);
                  }
                }}
                className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-bold text-sm hover:opacity-90 flex items-center justify-center gap-2 transition-opacity"
              >
                <FileText className="w-4 h-4" /> Read Step-by-Step Guide
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
