import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { PostCard } from '@/components/features/PostCard';
import { ComposePost } from '@/components/features/ComposePost';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Loader2, Users, TrendingUp, Lock, Globe, Shield,
  Crown, Settings, UserPlus, MessageSquare, Image,
  BookOpen, Plus, Trash2, X, Rss,
  ShieldCheck, ShieldOff, MoreVertical, Pin, PinOff,
  Camera, Check, Send, MessageCircle, Mail, Calendar,
  Trophy, Flame, Heart, Radio, BadgeCheck, Copy,
  CalendarDays, Clock, ChevronRight, BarChart3,
  ShoppingBag, Star, ExternalLink, Sparkles, Award,
} from 'lucide-react';
import { SchedulePostDialog } from '@/components/features/SchedulePostDialog';
import { CreatePollDialog } from '@/components/features/CreatePollDialog';
import { GifPicker } from '@/components/features/GifPicker';
import { useSEO, buildCommunityLD, buildOgImageUrl } from '@/hooks/useSEO';
import { useFeatureUnlock } from '@/hooks/useFeatureUnlock';
import { Post } from '@/types/app-types';
import { formatNumber } from '@/lib/utils';
import { toast as sonnerToast } from 'sonner';
import { formatDistanceToNow, isPast } from 'date-fns';
import { PageAdBanner } from '@/components/features/AdSenseAd';

// ── Module-level constants (esbuild-safe) ────────────────────────────────────
const LEADERBOARD_MEDALS = ['🥇', '🥈', '🥉'] as const;
const LEADERBOARD_PODIUM_H = ['h-16', 'h-20', 'h-14'] as const;
const COMM_TIP_AMTS = [1, 5, 10] as const;
const NFT_TIERS = [
  { min: 10, tier: 'legendary', emoji: '💎', label: 'Legendary', color: 'from-cyan-500/20 to-blue-500/20', border: 'border-cyan-500/30' },
  { min: 5,  tier: 'epic',      emoji: '🔮', label: 'Epic',      color: 'from-purple-500/20 to-violet-500/20', border: 'border-purple-500/30' },
  { min: 1,  tier: 'rare',      emoji: '🏅', label: 'Rare',      color: 'from-amber-500/20 to-yellow-500/20', border: 'border-amber-500/30' },
] as const;
const CHAT_EMOJIS = ['❤️', '🔥', '😂', '👏', '🎉', '💯'] as const;
const COMM_TAB_LIST = ['posts', 'members', 'chat', 'events'] as const;
type CommPageTab = typeof COMM_TAB_LIST[number];
const GIF_URL_RE = /^https:\/\/(media\.tenor|c\.tenor|media1\.tenor|media\.giphy|i\.giphy)\.com\//;

function getCommunityRssUrl(communityName: string) {
  return `${import.meta.env.VITE_SUPABASE_URL?.replace('/v1', '')}/functions/v1/podcast-rss?community=${encodeURIComponent(communityName)}`;
}
function CommunityAdBanner() { return <PageAdBanner />; }

interface FloatingReaction { id: string; emoji: string; x: number; }
interface Community {
  id: string; name: string; display_name: string; description?: string;
  icon_url?: string; banner_url?: string; member_count: number; post_count: number;
  created_by: string; is_private: boolean; rules?: any[];
}
interface CommunityMember {
  id: string; user_id: string; role: string;
  user_profiles: { username: string; avatar_url?: string; verified: boolean; };
}

export default function CommunityPage() {
  const { name } = useParams<{ name: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [community, setCommunity] = useState<Community | null>(null);

  useSEO({
    title: community ? `${community.display_name} Community` : 'Community',
    description: community ? (community.description?.slice(0, 155) || `Join ${community.display_name} on Testagram`) : 'Explore communities on Testagram',
    image: community ? buildOgImageUrl({ community: community.name }) : undefined,
    url: community ? `/c/${community.name}` : undefined,
    type: 'website',
    structuredData: community ? buildCommunityLD(community) : undefined,
  });

  const [posts, setPosts] = useState<Post[]>([]);
  const [isMember, setIsMember] = useState(false);
  const [userRole, setUserRole] = useState<string>('member');
  const [members, setMembers] = useState<CommunityMember[]>([]);

  const shopUnlocked = useFeatureUnlock('community_shop');
  const nftUnlocked  = useFeatureUnlock('nft_badges');
  const [activeTab, setActiveTab] = useState<CommPageTab | 'shop'>('posts');

  // Shop state
  const [shopProducts, setShopProducts] = useState<any[]>([]);
  const [loadingShop, setLoadingShop] = useState(false);
  const [shopFetched, setShopFetched] = useState(false);
  const [nftBadges, setNftBadges] = useState<any[]>([]);
  const [mintingNft, setMintingNft] = useState(false);

  const fetchShopProducts = useCallback(async (_communityId: string) => {
    if (shopFetched) return;
    setLoadingShop(true);
    const keyword = community?.display_name?.split(' ')[0] ?? '';
    const { data } = await supabase.from('products')
      .select('id, name, description, price, image_url, avg_rating, review_count, external_link, user_id, user_profiles:user_id(username, avatar_url)')
      .eq('is_active', true).ilike('name', `%${keyword}%`).order('sales_count', { ascending: false }).limit(20);
    const { data: featured } = await supabase.from('products')
      .select('id, name, description, price, image_url, avg_rating, review_count, external_link, user_id, user_profiles:user_id(username, avatar_url)')
      .eq('is_active', true).eq('is_featured', true).order('sales_count', { ascending: false }).limit(10);
    const combined = [...(featured ?? []), ...(data ?? [])];
    setShopProducts(combined.filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i));
    setLoadingShop(false);
    setShopFetched(true);
  }, [shopFetched, community?.display_name]);

  const fetchNftBadges = useCallback(async (communityId: string) => {
    const { data } = await supabase.from('community_nft_badges')
      .select('*, user_profiles:owner_id(username, avatar_url, verified)')
      .eq('community_id', communityId).order('minted_at', { ascending: false });
    setNftBadges(data ?? []);
  }, []);

  const handleMintNft = useCallback(async () => {
    if (!user || !community) return;
    setMintingNft(true);
    const { data: userPosts } = await supabase.from('posts').select('likes_count').eq('community_id', community.id).eq('user_id', user.id);
    const totalLikes = (userPosts ?? []).reduce((s: number, p: any) => s + (p.likes_count ?? 0), 0);
    const nftDef = NFT_TIERS.find(t => totalLikes >= t.min) ?? NFT_TIERS[2];
    const { error } = await supabase.from('community_nft_badges').upsert({
      community_id: community.id, owner_id: user.id,
      badge_name: `${community.display_name} ${nftDef.label} Badge`,
      badge_emoji: nftDef.emoji, badge_tier: nftDef.tier,
    }, { onConflict: 'community_id,owner_id' });
    if (error) { sonnerToast.error('Could not mint badge'); setMintingNft(false); return; }
    sonnerToast.success(`${nftDef.emoji} ${nftDef.label} Badge minted!`);
    fetchNftBadges(community.id);
    setMintingNft(false);
  }, [user, community, fetchNftBadges]);

  const [loadingPosts, setLoadingPosts] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [editingRules, setEditingRules] = useState(false);
  const [rules, setRules] = useState<string[]>([]);
  const [newRuleText, setNewRuleText] = useState('');
  const [savingRules, setSavingRules] = useState(false);
  const [promotingMemberId, setPromotingMemberId] = useState<string | null>(null);
  const [showRoleMenu, setShowRoleMenu] = useState<string | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editForm, setEditForm] = useState({ display_name: '', description: '' });
  const [editIconFile, setEditIconFile] = useState<File | null>(null);
  const [editIconPreview, setEditIconPreview] = useState<string | null>(null);
  const [editBannerFile, setEditBannerFile] = useState<File | null>(null);
  const [editBannerPreview, setEditBannerPreview] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);
  const [leaderboardFetched, setLeaderboardFetched] = useState(false);
  const [commRssCopied, setCommRssCopied] = useState(false);
  const [showSupportDialog, setShowSupportDialog] = useState(false);
  const [supportAmount, setSupportAmount] = useState<number | null>(null);
  const [sendingSupport, setSendingSupport] = useState(false);
  const [supportSent, setSupportSent] = useState(false);

  const handleSupportCommunity = useCallback(async () => {
    if (!user || !community || !supportAmount) return;
    setSendingSupport(true);
    const { error: deductErr } = await supabase.rpc('deduct_from_wallet', { p_user_id: user.id, p_amount: supportAmount });
    if (deductErr) { sonnerToast.error('Insufficient wallet balance'); setSendingSupport(false); return; }
    await supabase.rpc('add_to_wallet', { p_user_id: community.created_by, p_amount: supportAmount }).catch(() => {});
    await supabase.from('tips').insert({ from_user_id: user.id, to_user_id: community.created_by, amount: supportAmount, message: `Support for c/${community.name}` }).catch(() => {});
    await supabase.from('platform_inbox').insert({ user_id: community.created_by, subject: `💰 Your community received a $${supportAmount} support tip!`, body: `@${user.username ?? 'A member'} sent $${supportAmount} to support c/${community.name}.`, type: 'update', icon_emoji: '💰' }).catch(() => {});
    sonnerToast.success(`$${supportAmount} support sent!`);
    setSupportSent(true); setShowSupportDialog(false); setSupportAmount(null); setSendingSupport(false);
    setTimeout(() => setSupportSent(false), 4000);
  }, [user, community, supportAmount]);

  const fetchLeaderboard = useCallback(async (communityId: string) => {
    setLoadingLeaderboard(true);
    const since30d = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data } = await supabase.from('posts')
      .select('user_id, likes_count, user_profiles!posts_user_id_fkey(id, username, avatar_url, verified)')
      .eq('community_id', communityId).gte('created_at', since30d);
    if (data) {
      const agg: any = {};
      for (const row of data) {
        if (!row.user_id) continue;
        if (!agg[row.user_id]) agg[row.user_id] = { profile: row.user_profiles, likes: 0, posts: 0 };
        agg[row.user_id].likes += row.likes_count ?? 0;
        agg[row.user_id].posts += 1;
      }
      setLeaderboard((Object.values(agg) as Array<{ profile: any; likes: number; posts: number }>).sort((a, b) => b.likes - a.likes).slice(0, 3));
    }
    setLeaderboardFetched(true);
    setLoadingLeaderboard(false);
  }, []);

  const [digestPosts, setDigestPosts] = useState<any[]>([]);
  const [showDigest, setShowDigest] = useState(true);
  const fetchWeeklyDigest = useCallback(async (communityId: string) => {
    const since7d = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data } = await supabase.from('posts')
      .select('id, content, likes_count, created_at, user_profiles(username, avatar_url)')
      .eq('community_id', communityId).gte('created_at', since7d)
      .order('likes_count', { ascending: false }).limit(3);
    setDigestPosts(data ?? []);
  }, []);

  const [relatedSpaces, setRelatedSpaces] = useState<any[]>([]);
  const fetchRelatedSpaces = useCallback(async (_communityName: string, communityDisplayName: string) => {
    const keyword = communityDisplayName.split(' ')[0];
    const { data } = await supabase.from('spaces')
      .select('id, title, listener_count, host:user_profiles!spaces_host_id_fkey(username, avatar_url, verified), category')
      .eq('is_live', true).ilike('title', `%${keyword}%`).limit(3);
    if (!data || data.length === 0) {
      const { data: fallback } = await supabase.from('spaces')
        .select('id, title, listener_count, host:user_profiles!spaces_host_id_fkey(username, avatar_url, verified), category')
        .eq('is_live', true).order('listener_count', { ascending: false }).limit(3);
      setRelatedSpaces(fallback ?? []);
    } else { setRelatedSpaces(data); }
  }, []);

  // Chat state
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  // @mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<{ id: string; username: string; avatar_url: string | null }[]>([]);
  const chatInputRef = useRef<HTMLInputElement | null>(null);

  const handleChatInputChange = useCallback((val: string) => {
    setChatInput(val);
    const match = val.match(/@(\w*)$/);
    if (match) {
      const q = match[1].toLowerCase();
      setMentionQuery(q);
      const suggestions = members
        .map(m => ({ id: (m.user_profiles as any)?.id ?? m.user_id ?? '', username: m.user_profiles?.username ?? '', avatar_url: m.user_profiles?.avatar_url ?? null }))
        .filter(m => m.username && (q.length === 0 || m.username.toLowerCase().includes(q)))
        .slice(0, 6);
      setMentionResults(suggestions);
    } else {
      setMentionQuery(null);
      setMentionResults([]);
    }
  }, [members]);

  const insertMention = useCallback((uname: string) => {
    setChatInput(prev => prev.replace(/@\w*$/, `@${uname} `));
    setMentionQuery(null);
    setMentionResults([]);
    chatInputRef.current?.focus();
  }, []);
  const [chatSending, setChatSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{ id: string; text: string; username: string } | null>(null);
  const [showEmojiPickerFor, setShowEmojiPickerFor] = useState<string | null>(null);
  // messageReactions — parallel arrays instead of nested index-sig state (esbuild guard)
  const [reactionMsgIds, setReactionMsgIds] = useState<string[]>([]);
  const [reactionData, setReactionData] = useState<any[]>([]);
  const getReactions = (msgId: string): any => {
    const i = reactionMsgIds.indexOf(msgId);
    return i >= 0 ? reactionData[i] : {};
  };
  const setReactionForMsg = (msgId: string, updater: (prev: any) => any) => {
    setReactionMsgIds(prev => {
      const i = prev.indexOf(msgId);
      if (i >= 0) {
        setReactionData(d => { const n = [...d]; n[i] = updater(n[i] ?? {}); return n; });
        return prev;
      }
      setReactionData(d => [...d, updater({})]);
      return [...prev, msgId];
    });
  };
  const [pinnedChatIds, setPinnedChatIds] = useState<string[]>([]);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const chatPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const reactionsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showChatGifPicker, setShowChatGifPicker] = useState(false);

  const handleSendGif = useCallback(async (gifUrl: string) => {
    if (!user || !community || chatSending) return;
    setShowChatGifPicker(false); setChatSending(true);
    await supabase.from('community_chat').insert({ community_id: community.id, user_id: user.id, message: gifUrl });
    const rawData = await supabase.from('community_chat')
      .select('*, user_profiles(id, username, avatar_url, verified)')
      .eq('community_id', community.id).order('created_at', { ascending: true }).limit(100);
    if (rawData.data) setChatMessages(rawData.data);
    setChatSending(false);
  }, [user, community, chatSending]);

  const [showCommunityPollDialog, setShowCommunityPollDialog] = useState(false);
  const handleCommunityPollCreated = useCallback(async (pollData: { question: string; options: string[]; duration: number }) => {
    if (!user || !community) return;
    setShowCommunityPollDialog(false);
    const { data: pollPost, error: ppErr } = await supabase.from('posts')
      .insert({ user_id: user.id, content: pollData.question, community_id: community.id }).select().single();
    if (ppErr || !pollPost) { sonnerToast.error('Failed to create poll'); return; }
    const pollExpAt = new Date(Date.now() + pollData.duration * 60 * 1000);
    const { data: pollRow, error: prErr } = await supabase.from('polls')
      .insert({ post_id: pollPost.id, question: pollData.question, expires_at: pollExpAt.toISOString() }).select().single();
    if (prErr || !pollRow) { sonnerToast.error('Failed to create poll'); return; }
    await supabase.from('poll_options').insert(pollData.options.map((opt: string) => ({ poll_id: pollRow.id, option_text: opt })));
    sonnerToast.success('Community poll created! 📊');
    fetchPosts();
  }, [user, community]);

  const triggerFloat = useCallback((emoji: string) => {
    const fr: FloatingReaction = { id: `${Date.now()}-${Math.random()}`, emoji, x: 20 + Math.random() * 60 };
    setFloatingReactions(prev => [...prev, fr]);
    if (reactionsTimerRef.current) clearTimeout(reactionsTimerRef.current);
    reactionsTimerRef.current = setTimeout(() => setFloatingReactions(prev => prev.filter(r => r.id !== fr.id)), 2000);
  }, []);

  const fetchChat = useCallback(async () => {
    if (!community) return;
    const { data } = await supabase.from('community_chat')
      .select('*, user_profiles(id, username, avatar_url, verified)')
      .eq('community_id', community.id).order('created_at', { ascending: true }).limit(100);
    if (data) {
      setChatMessages(data);
      try { const rr = localStorage.getItem(`chat_reactions_${community.id}`); if (rr) { const parsed = JSON.parse(rr); const ids = Object.keys(parsed); setReactionMsgIds(ids); setReactionData(ids.map((k: string) => parsed[k])); } } catch { /* ignore */ }
      const raw = localStorage.getItem(`chat_pinned_${community.id}`);
      if (raw) setPinnedChatIds(JSON.parse(raw));
    }
  }, [community]);

  const handleAddReaction = useCallback((msgId: string, emoji: string) => {
    if (!community) return;
    setReactionForMsg(msgId, prev => {
      const updated = { ...prev, [emoji]: (prev[emoji] ?? 0) + 1 };
      return updated;
    });
    triggerFloat(emoji);
    setShowEmojiPickerFor(null);
  }, [community, triggerFloat]);

  const handlePinChatMessage = useCallback((msgId: string) => {
    if (!community) return;
    setPinnedChatIds(prev => {
      const updated = prev.includes(msgId) ? prev.filter(id => id !== msgId) : [...prev, msgId];
      localStorage.setItem(`chat_pinned_${community.id}`, JSON.stringify(updated));
      return updated;
    });
    setShowRoleMenu(null);
  }, [community]);

  useEffect(() => {
    if (activeTab === 'chat' && community) {
      fetchChat();
      chatPollingRef.current = setInterval(fetchChat, 5000);
    } else { if (chatPollingRef.current) clearInterval(chatPollingRef.current); }
    return () => { if (chatPollingRef.current) clearInterval(chatPollingRef.current); };
  }, [activeTab, community?.id]);

  useEffect(() => { if (activeTab === 'chat') chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages, activeTab]);

  const handleSendChat = async () => {
    if (!user || !community || !chatInput.trim() || chatSending) return;
    const text = chatInput.trim(); const replyInfo = replyingTo;
    setChatInput(''); setReplyingTo(null); setChatSending(true);
    const msgContent = replyInfo ? `[↩ @${replyInfo.username}: "${replyInfo.text.slice(0, 40)}…"] ${text}` : text;
    await supabase.from('community_chat').insert({ community_id: community.id, user_id: user.id, message: msgContent });
    await fetchChat();
    setChatSending(false);
    // Send @mention notifications to mentioned users
    const mentionMatches = text.match(/@(\w+)/g);
    if (mentionMatches && mentionMatches.length > 0) {
      const mentionedUsernames = mentionMatches.map(m => m.slice(1)).filter((u, i, a) => a.indexOf(u) === i).filter(u => u !== user.username);
      if (mentionedUsernames.length > 0) {
        const { data: mentionedProfiles } = await supabase
          .from('user_profiles')
          .select('id, username')
          .in('username', mentionedUsernames.slice(0, 5));
        if (mentionedProfiles && mentionedProfiles.length > 0) {
          await Promise.allSettled(mentionedProfiles.map((p: any) =>
            supabase.from('platform_inbox').insert({
              user_id: p.id,
              subject: `@${user.username} mentioned you in c/${community.name}`,
              body: `"${text.slice(0, 120)}${text.length > 120 ? '…' : ''}"`,
              type: 'update',
              icon_emoji: '💬',
              cta_label: `Go to c/${community.name}`,
              cta_url: `/c/${community.name}`,
            })
          ));
        }
      }
    }
  };

  // Events state
  const [events, setEvents] = useState<any[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  // rsvpSet — plain array (esbuild guard: no Set constructor in useState)
  const [rsvpArr, setRsvpArr] = useState<string[]>([]);
  const rsvpSet = { has: (id: string) => rsvpArr.indexOf(id) >= 0 };
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [eventForm, setEventForm] = useState({ title: '', description: '', scheduled_for: '' });
  const [creatingEvent, setCreatingEvent] = useState(false);

  const fetchEvents = useCallback(async (communityId: string) => {
    setLoadingEvents(true);
    const { data } = await supabase.from('scheduled_posts')
      .select('id, content, scheduled_for, created_at, user_profiles:user_id(username, avatar_url)')
      .eq('user_id', community?.created_by ?? '').order('scheduled_for', { ascending: true }).limit(20);
    const commKey = `community_events_${communityId}`;
    try {
      const raw = localStorage.getItem(commKey);
      const localEvents: any[] = raw ? JSON.parse(raw) : [];
      const combined = [...localEvents, ...(data ?? [])];
      const unique = combined.filter((e, i, arr) => arr.findIndex(x => x.id === e.id) === i);
      setEvents(unique.sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime()));
    } catch { setEvents(data ?? []); }
    try { const rsvpRawData = localStorage.getItem(`rsvp_${communityId}`); if (rsvpRawData) setRsvpArr(JSON.parse(rsvpRawData)); } catch { /* ignore */ }
    setLoadingEvents(false);
  }, [community?.created_by]);

  const handleRsvp = useCallback((eventId: string) => {
    if (!community) return;
    setRsvpArr(prev => {
      const wasIn = prev.indexOf(eventId) >= 0;
      const next = wasIn ? prev.filter(id => id !== eventId) : [...prev, eventId];
      localStorage.setItem(`rsvp_${community.id}`, JSON.stringify(next));
      sonnerToast.success(!wasIn ? "You're going! 🎉" : 'RSVP cancelled');
      // Schedule 1-hour-before reminder notification when RSVPing
      if (!wasIn && user) {
        const ev = events.find((e: any) => e.id === eventId);
        if (ev) {
          const evMs = new Date(ev.scheduled_for).getTime();
          const now  = Date.now();
          const reminderMs = evMs - 60 * 60 * 1000; // 1 hour before
          const evTitle = (ev.content ?? '').split('\n')[0] ?? 'Event';
          if (reminderMs > now) {
            // Store pending reminder in localStorage for polling
            try {
              const rKey = `event_reminders_${user.id}`;
              const existing: any[] = JSON.parse(localStorage.getItem(rKey) ?? '[]');
              const deduped = existing.filter((r: any) => r.eventId !== eventId);
              deduped.push({ eventId, communityId: community.id, communityName: community.name, title: evTitle, reminderAt: reminderMs });
              localStorage.setItem(rKey, JSON.stringify(deduped));
            } catch { /* ignore */ }
          }
        }
      }
      return next;
    });
  }, [community, user, events]);

  const handleCreateEvent = async () => {
    if (!user || !community || !eventForm.title.trim() || !eventForm.scheduled_for) return;
    setCreatingEvent(true);
    const newEvent = { id: `local_${Date.now()}`, content: eventForm.title.trim() + (eventForm.description ? `\n\n${eventForm.description}` : ''), scheduled_for: new Date(eventForm.scheduled_for).toISOString(), created_at: new Date().toISOString(), user_profiles: { username: user.username ?? 'you', avatar_url: null } };
    const commKey = `community_events_${community.id}`;
    try { const raw = localStorage.getItem(commKey); const existing: any[] = raw ? JSON.parse(raw) : []; existing.push(newEvent); localStorage.setItem(commKey, JSON.stringify(existing)); } catch { /* ignore */ }
    setEvents(prev => [...prev, newEvent].sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime()));
    setShowCreateEvent(false); setEventForm({ title: '', description: '', scheduled_for: '' }); setCreatingEvent(false);
    sonnerToast.success('Event added!');
  };

  useEffect(() => { if (activeTab === 'events' && community) fetchEvents(community.id); }, [activeTab, community?.id]);
  useEffect(() => { if (activeTab === 'members' && community && !leaderboardFetched) fetchLeaderboard(community.id); }, [activeTab, community?.id, leaderboardFetched]);
  useEffect(() => { if (activeTab === 'shop' && community && !shopFetched) fetchShopProducts(community.id); }, [activeTab, community?.id, shopFetched]);
  useEffect(() => { if (activeTab === 'members' && community && nftUnlocked) fetchNftBadges(community.id); }, [activeTab, community?.id, nftUnlocked]);

  // pinnedPostIds — plain array (esbuild guard: no Set constructor in useState)
  const [pinnedPostArr, setPinnedPostArr] = useState<string[]>([]);
  const pinnedPostIds = { has: (id: string) => pinnedPostArr.indexOf(id) >= 0 };
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [scheduleContent, setScheduleContent] = useState('');

  const handleScheduleCommunityPost = async (date: Date) => {
    if (!user || !community || !scheduleContent.trim()) return;
    try {
      const { error } = await supabase.from('scheduled_posts').insert({ user_id: user.id, content: scheduleContent.trim(), scheduled_for: date.toISOString(), status: 'pending' });
      if (error) throw error;
      sonnerToast.success(`Post scheduled for ${date.toLocaleDateString()}`);
      setShowScheduleDialog(false); setScheduleContent('');
    } catch (err: any) { toast({ title: 'Error', description: err.message, variant: 'destructive' }); }
  };

  const openEditDialog = () => {
    if (!community) return;
    setEditForm({ display_name: community.display_name, description: community.description ?? '' });
    setEditIconPreview(community.icon_url ?? null); setEditBannerPreview(community.banner_url ?? null);
    setEditIconFile(null); setEditBannerFile(null); setShowEditDialog(true);
  };

  const handleSaveEdit = async () => {
    if (!community) return;
    setSavingEdit(true);
    try {
      let iconUrl = community.icon_url ?? null; let bannerUrl = community.banner_url ?? null;
      const uploadImage = async (file: File, path: string) => {
        const ext = file.name.split('.').pop();
        const fileName = `${path}/${Date.now()}.${ext}`;
        const { error } = await supabase.storage.from('posts').upload(fileName, file, { upsert: true });
        if (error) throw error;
        const { data: { publicUrl } } = supabase.storage.from('posts').getPublicUrl(fileName);
        return publicUrl;
      };
      if (editIconFile) iconUrl = await uploadImage(editIconFile, `communities/icons/${user!.id}`);
      if (editBannerFile) bannerUrl = await uploadImage(editBannerFile, `communities/banners/${user!.id}`);
      const { error } = await supabase.from('communities').update({ display_name: editForm.display_name.trim() || community.display_name, description: editForm.description.trim(), icon_url: iconUrl, banner_url: bannerUrl }).eq('id', community.id);
      if (error) throw error;
      setCommunity(prev => prev ? { ...prev, display_name: editForm.display_name.trim() || prev.display_name, description: editForm.description.trim(), icon_url: iconUrl ?? prev.icon_url, banner_url: bannerUrl ?? prev.banner_url } : null);
      setShowEditDialog(false); sonnerToast.success('Community updated!');
    } catch (err: any) { toast({ title: 'Error', description: err.message, variant: 'destructive' }); }
    finally { setSavingEdit(false); }
  };

  useEffect(() => { if (name) fetchCommunity(); }, [name, user]);
  useEffect(() => {
    if (!community?.id) return;
    supabase.from('platform_settings').select('setting_value').eq('setting_key', `community_pinned_${community.id}`).maybeSingle()
      .then(({ data }) => { if (data?.setting_value?.pinned) setPinnedPostArr(data.setting_value.pinned); });
  }, [community?.id]);
  useEffect(() => {
    if (community?.rules) setRules(Array.isArray(community.rules) ? community.rules.map((r: any) => typeof r === 'string' ? r : r.text ?? r.rule ?? String(r)) : []);
  }, [community?.rules]);
  useEffect(() => { if (community && isMember) fetchPosts(); else if (community && !community.is_private) fetchPosts(); }, [community, isMember]);
  useEffect(() => {
    if (!community) return;
    const sub = supabase.channel(`community-posts-${community.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts', filter: `community_id=eq.${community.id}` }, () => { fetchPosts(); }).subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [community?.id]);
  useEffect(() => { if (community?.id) { fetchWeeklyDigest(community.id); fetchRelatedSpaces(community.name, community.display_name); } }, [community?.id]);

  // ── Event reminder polling — fires 1 hour before RSVPed events ──
  useEffect(() => {
    if (!user) return;
    const rKey = `event_reminders_${user.id}`;
    const sentKey = `event_reminders_sent_${user.id}`;
    const check = async () => {
      try {
        const raw = localStorage.getItem(rKey);
        if (!raw) return;
        const reminders: any[] = JSON.parse(raw);
        if (reminders.length === 0) return;
        const sentRaw = localStorage.getItem(sentKey);
        const sent: string[] = sentRaw ? JSON.parse(sentRaw) : [];
        const now = Date.now();
        const toFire = reminders.filter((r: any) => r.reminderAt <= now && !sent.includes(r.eventId));
        for (const r of toFire) {
          await supabase.from('platform_inbox').insert({
            user_id: user.id,
            subject: `⏰ Reminder: "${r.title}" starts in 1 hour!`,
            body: `You RSVPed to "${r.title}" in c/${r.communityName}. It starts in about 1 hour!`,
            type: 'update',
            icon_emoji: '📅',
            cta_label: `View c/${r.communityName}`,
            cta_url: `/c/${r.communityName}`,
          }).catch(() => {});
          sent.push(r.eventId);
          sonnerToast(`⏰ "${r.title}" starts in 1 hour!`, { duration: 6000 });
        }
        if (toFire.length > 0) localStorage.setItem(sentKey, JSON.stringify(sent));
        // Clean up past reminders
        const future = reminders.filter((r: any) => r.reminderAt > now - 2 * 3600 * 1000);
        if (future.length !== reminders.length) localStorage.setItem(rKey, JSON.stringify(future));
      } catch { /* ignore */ }
    };
    check();
    const iv = setInterval(check, 60_000); // check every minute
    return () => clearInterval(iv);
  }, [user?.id]);

  const fetchCommunity = async () => {
    if (!name) return;
    try {
      const { data, error } = await supabase.from('communities').select('*').eq('name', name).single();
      if (error) throw error;
      setCommunity(data);
      if (user) {
        const { data: memberData } = await supabase.from('community_members').select('id, role').eq('community_id', data.id).eq('user_id', user.id).maybeSingle();
        setIsMember(!!memberData);
        if (memberData) setUserRole(memberData.role);
      }
      const { data: membersData } = await supabase.from('community_members').select('*, user_profiles(username, avatar_url, verified)').eq('community_id', data.id).order('role', { ascending: true }).limit(20);
      if (membersData) setMembers(membersData);
    } catch { toast({ title: 'Community not found', variant: 'destructive' }); navigate('/communities'); }
    finally { setLoading(false); }
  };

  const fetchPosts = async () => {
    if (!community) return;
    setLoadingPosts(true);
    try {
      const { data } = await supabase.from('posts').select('*, user_profiles(*)').eq('community_id', community.id).order('created_at', { ascending: false });
      if (data) setPosts(data);
    } catch (err) { console.error('fetchPosts error:', err); }
    finally { setLoadingPosts(false); }
  };

  const handleJoinToggle = async () => {
    if (!user) { navigate('/auth'); return; }
    if (!community) return;
    try {
      if (isMember) {
        if (userRole === 'owner') { toast({ title: 'Error', description: 'Owners cannot leave.', variant: 'destructive' }); return; }
        await supabase.from('community_members').delete().match({ community_id: community.id, user_id: user.id });
        setIsMember(false); toast({ title: 'Left community' });
      } else {
        await supabase.from('community_members').insert({ community_id: community.id, user_id: user.id });
        setIsMember(true); toast({ title: '✅ Joined community!' });
      }
      fetchCommunity();
    } catch (error: any) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); }
  };

  const handlePromoteRole = async (memberId: string, _userId: string, newRole: 'member' | 'moderator') => {
    if (!community || !isOwner) return;
    setPromotingMemberId(memberId);
    const { error } = await supabase.from('community_members').update({ role: newRole }).eq('id', memberId).eq('community_id', community.id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); }
    else { setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role: newRole } : m)); toast({ title: newRole === 'moderator' ? '🛡 Promoted to Moderator' : 'Role changed to Member' }); }
    setPromotingMemberId(null); setShowRoleMenu(null);
  };

  const handlePinPost = async (postId: string) => {
    if (!community || !isAdmin) return;
    const wasPin = pinnedPostIds.has(postId);
    const updatedArr = wasPin ? pinnedPostArr.filter(id => id !== postId) : [...pinnedPostArr, postId];
    setPinnedPostArr(updatedArr);
    await supabase.from('platform_settings').upsert({ setting_key: `community_pinned_${community.id}`, setting_value: { pinned: updatedArr } }, { onConflict: 'setting_key' });
    toast({ title: !wasPin ? 'Post pinned' : 'Post unpinned' });
  };

  const handleModDeletePost = async (postId: string) => {
    if (!isAdmin) return;
    if (!window.confirm('Delete this post as moderator?')) return;
    const { error } = await supabase.from('posts').delete().eq('id', postId);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    setPosts(prev => prev.filter(p => p.id !== postId));
    toast({ title: 'Post deleted by moderator' });
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!community) return null;

  const isOwner = userRole === 'owner';
  const isAdmin = ['owner', 'moderator'].includes(userRole);
  const canSeeContent = !community.is_private || isMember;
  const onlineMembersEstimate = Math.max(1, Math.floor(community.member_count * 0.04));

  return (
    <div className="min-h-screen bg-background pb-20">
      <TopBar title={`c/${community.name}`} showBack />
      <CommunityAdBanner />

      {community.banner_url ? (
        <div className="h-36 bg-muted overflow-hidden"><img src={community.banner_url} alt={community.display_name} className="w-full h-full object-cover" /></div>
      ) : (
        <div className="h-20 bg-gradient-to-r from-primary/20 to-purple-500/20" />
      )}

      {/* Community Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 border-4 border-background flex items-center justify-center -mt-8 overflow-hidden flex-shrink-0">
              {community.icon_url ? <img src={community.icon_url} alt={community.display_name} className="w-full h-full object-cover" /> : <span className="text-2xl font-bold text-primary">{community.display_name[0]}</span>}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold">{community.display_name}</h1>
                {community.is_private
                  ? <span className="flex items-center gap-1 text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-600 px-2 py-0.5 rounded-full"><Lock className="w-3 h-3" /> Private</span>
                  : <span className="flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full"><Globe className="w-3 h-3" /> Public</span>}
                {isMember && (
                  <span className="flex items-center gap-1 text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
                    {isOwner ? <Crown className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
                    {isOwner ? 'Owner' : isAdmin ? 'Mod' : 'Member'}
                  </span>
                )}
                <span className="flex items-center gap-1 text-[10px] text-green-600 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />~{onlineMembersEstimate} online
                </span>
              </div>
              <p className="text-sm text-muted-foreground">c/{community.name}</p>
            </div>
          </div>
          {user && (
            <Button onClick={handleJoinToggle} variant={isMember ? 'outline' : 'default'} className="rounded-full flex-shrink-0" size="sm">
              {isMember ? 'Joined' : (<><UserPlus className="w-4 h-4 mr-1" />Join</>)}
            </Button>
          )}
        </div>

        {community.description && <p className="mt-3 text-sm text-muted-foreground">{community.description}</p>}
        {isAdmin && (
          <button onClick={openEditDialog} className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border hover:bg-muted transition-colors text-xs font-semibold text-muted-foreground">
            <Settings className="w-3.5 h-3.5" />Edit Community
          </button>
        )}
        {rules.length > 0 && (
          <button onClick={() => setShowRulesModal(true)} className="mt-3 flex items-center gap-2 px-3 py-1.5 rounded-full border border-border hover:bg-muted transition-colors text-xs font-semibold text-muted-foreground">
            <BookOpen className="w-3.5 h-3.5" />{rules.length} Rule{rules.length !== 1 ? 's' : ''}
          </button>
        )}
        {isAdmin && rules.length === 0 && (
          <button onClick={() => { setShowRulesModal(true); setEditingRules(true); }} className="mt-3 flex items-center gap-2 px-3 py-1.5 rounded-full border border-dashed border-border hover:bg-muted transition-colors text-xs font-semibold text-muted-foreground">
            <Plus className="w-3.5 h-3.5" /> Add Rules
          </button>
        )}

        <div className="flex items-center gap-6 mt-3 text-sm flex-wrap">
          <button onClick={() => setActiveTab('members')} className="flex items-center gap-1.5 hover:text-primary transition-colors">
            <Users className="w-4 h-4 text-muted-foreground" /><span className="font-bold">{formatNumber(community.member_count)}</span><span className="text-muted-foreground">members</span>
          </button>
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-muted-foreground" /><span className="font-bold">{formatNumber(community.post_count)}</span><span className="text-muted-foreground">posts</span>
          </div>
          {user && !isOwner && (
            <button onClick={() => setShowSupportDialog(true)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-[10px] font-bold transition-all ${supportSent ? 'border-yellow-500/40 bg-yellow-500/15 text-yellow-600' : 'border-border text-muted-foreground hover:border-yellow-500/30 hover:text-yellow-600'}`}>
              {supportSent ? '✓ Supported!' : '💰 Support'}
            </button>
          )}
          <button onClick={() => { navigator.clipboard.writeText(getCommunityRssUrl(community.name)).then(() => { setCommRssCopied(true); setTimeout(() => setCommRssCopied(false), 2000); sonnerToast.success('RSS copied!'); }); }}
            className={`ml-auto flex items-center gap-1 px-2.5 py-1 rounded-full border text-[10px] font-bold transition-all ${commRssCopied ? 'border-orange-500/40 bg-orange-500/15 text-orange-600' : 'border-border text-muted-foreground hover:border-orange-500/30 hover:text-orange-500'}`}>
            {commRssCopied ? <Check className="w-3 h-3" /> : <Rss className="w-3 h-3" />}
            {commRssCopied ? 'Copied!' : 'RSS'}
          </button>
        </div>

        {relatedSpaces.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border">
            <div className="flex items-center gap-2 mb-2">
              <Radio className="w-3.5 h-3.5 text-red-500" /><span className="text-xs font-bold text-red-500">Live Spaces</span>
              <span className="text-[10px] text-muted-foreground ml-auto">related to this community</span>
            </div>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
              {relatedSpaces.map(space => (
                <button key={space.id} onClick={() => navigate('/spaces')}
                  className="flex items-center gap-2 px-3 py-2 bg-red-500/5 border border-red-500/20 rounded-xl hover:bg-red-500/10 transition-colors shrink-0 max-w-[180px]">
                  <div className="w-6 h-6 rounded-full overflow-hidden bg-muted shrink-0">
                    {space.host?.avatar_url ? <img src={space.host.avatar_url} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-[9px] font-bold">{space.host?.username?.[0]?.toUpperCase()}</div>}
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="text-xs font-bold truncate leading-tight">{space.title}</p>
                    <p className="text-[9px] text-red-500 flex items-center gap-0.5"><span className="w-1 h-1 rounded-full bg-red-500 animate-pulse inline-block" />{space.listener_count ?? 0} listening</p>
                  </div>
                </button>
              ))}
              <button onClick={() => navigate('/spaces')} className="flex items-center gap-1 px-3 py-2 border border-border rounded-xl text-xs text-muted-foreground hover:bg-muted transition-colors shrink-0">
                All Spaces <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {showEditDialog && isAdmin && (
        <div className="fixed inset-0 z-[300] bg-black/60 flex items-end" onClick={() => setShowEditDialog(false)}>
          <div className="w-full bg-background rounded-t-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-background border-b border-border px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2"><Settings className="w-5 h-5 text-primary" /><h2 className="font-bold text-lg">Edit Community</h2></div>
              <button onClick={() => setShowEditDialog(false)} className="p-2 rounded-full hover:bg-muted"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 space-y-5">
              <div>
                <p className="text-sm font-semibold mb-2">Banner Image</p>
                <div className="relative h-28 rounded-xl overflow-hidden border-2 border-dashed border-border bg-gradient-to-r from-primary/10 to-purple-500/10">
                  {editBannerPreview && <img src={editBannerPreview} className="w-full h-full object-cover" alt="" />}
                  <label className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer gap-1">
                    <Camera className="w-6 h-6 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{editBannerPreview ? 'Change' : 'Upload banner'}</span>
                    <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) { setEditBannerFile(f); setEditBannerPreview(URL.createObjectURL(f)); } }} />
                  </label>
                  {editBannerPreview && <button onClick={e => { e.preventDefault(); setEditBannerFile(null); setEditBannerPreview(null); }} className="absolute top-2 right-2 w-7 h-7 bg-black/70 rounded-full flex items-center justify-center text-white z-10"><X className="w-3.5 h-3.5" /></button>}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 border-2 border-dashed border-border overflow-hidden flex items-center justify-center">
                    {editIconPreview ? <img src={editIconPreview} className="w-full h-full object-cover" alt="" /> : <span className="text-2xl font-bold text-primary">{community.display_name[0]}</span>}
                  </div>
                  <label className="absolute inset-0 cursor-pointer rounded-2xl"><input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) { setEditIconFile(f); setEditIconPreview(URL.createObjectURL(f)); } }} /></label>
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-primary rounded-full flex items-center justify-center shadow"><Camera className="w-3 h-3 text-white" /></div>
                </div>
                <div><p className="text-sm font-semibold">Community Icon</p><p className="text-xs text-muted-foreground mt-0.5">Tap to change</p></div>
              </div>
              <div>
                <label className="text-sm font-semibold block mb-1.5">Display Name</label>
                <Input value={editForm.display_name} onChange={e => setEditForm(p => ({ ...p, display_name: e.target.value }))} placeholder="Community Name" maxLength={60} />
              </div>
              <div>
                <label className="text-sm font-semibold block mb-1.5">Description</label>
                <Textarea value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} rows={3} maxLength={300} />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowEditDialog(false)} className="flex-1 py-3 border border-border rounded-xl text-sm font-semibold hover:bg-muted">Cancel</button>
                <button onClick={handleSaveEdit} disabled={savingEdit || !editForm.display_name.trim()} className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2">
                  {savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Support Dialog */}
      {showSupportDialog && user && (
        <div className="fixed inset-0 z-[250] bg-black/60 flex items-center justify-center p-4" onClick={() => setShowSupportDialog(false)}>
          <div className="bg-background border border-border rounded-2xl p-5 w-full max-w-xs shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-yellow-500/10 flex items-center justify-center"><span className="text-xl">💰</span></div>
              <div><h3 className="font-bold">Support Community</h3><p className="text-xs text-muted-foreground">c/{community?.name}</p></div>
              <button onClick={() => setShowSupportDialog(false)} className="ml-auto p-1.5 rounded-full hover:bg-muted"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {COMM_TIP_AMTS.map(amt => (
                <button key={amt} onClick={() => setSupportAmount(amt)}
                  className={`py-2.5 rounded-xl font-bold text-base border-2 transition-all ${supportAmount === amt ? 'border-yellow-500 bg-yellow-500/10 text-yellow-600' : 'border-border hover:border-yellow-500/40'}`}>${amt}</button>
              ))}
            </div>
            <button onClick={handleSupportCommunity} disabled={sendingSupport || !supportAmount}
              className="w-full py-3 bg-gradient-to-r from-yellow-500 to-amber-500 text-white rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90">
              {sendingSupport ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>💰</span>}
              {sendingSupport ? 'Sending…' : `Send $${supportAmount ?? '—'} Support`}
            </button>
          </div>
        </div>
      )}

      {showCommunityPollDialog && <CreatePollDialog onClose={() => setShowCommunityPollDialog(false)} onPollCreated={handleCommunityPollCreated} />}
      {showChatGifPicker && <GifPicker onSelect={handleSendGif} onClose={() => setShowChatGifPicker(false)} />}
      {showScheduleDialog && <SchedulePostDialog onClose={() => setShowScheduleDialog(false)} onSchedule={handleScheduleCommunityPost} />}

      {showRulesModal && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-end" onClick={() => { setShowRulesModal(false); setEditingRules(false); setNewRuleText(''); }}>
          <div className="w-full bg-background rounded-t-3xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-background border-b border-border px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2"><BookOpen className="w-5 h-5 text-primary" /><h2 className="font-bold text-lg">Community Rules</h2></div>
              <div className="flex items-center gap-2">
                {isAdmin && <button onClick={() => setEditingRules(e => !e)} className={`px-3 py-1.5 rounded-full text-xs font-semibold ${editingRules ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{editingRules ? 'Done' : 'Edit'}</button>}
                <button onClick={() => { setShowRulesModal(false); setEditingRules(false); }} className="p-2 rounded-full hover:bg-muted"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="px-5 py-4 space-y-3">
              {rules.length === 0 && !editingRules && <p className="text-sm text-muted-foreground text-center py-6">No rules set.</p>}
              {rules.map((rule, idx) => (
                <div key={idx} className="flex items-start gap-3 p-3 rounded-xl border border-border bg-muted/20">
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">{idx + 1}</div>
                  <p className="flex-1 text-sm leading-relaxed pt-0.5">{rule}</p>
                  {editingRules && <button onClick={async () => { const updated = rules.filter((_, i) => i !== idx); setSavingRules(true); await supabase.from('communities').update({ rules: updated }).eq('id', community.id); setRules(updated); setSavingRules(false); }} className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>}
                </div>
              ))}
              {editingRules && isAdmin && (
                <div className="mt-2 space-y-2">
                  <textarea value={newRuleText} onChange={e => setNewRuleText(e.target.value)} rows={2} placeholder="Describe the rule…" className="w-full px-4 py-3 rounded-xl border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary" />
                  <button disabled={!newRuleText.trim() || savingRules} onClick={async () => { if (!newRuleText.trim()) return; const updated = [...rules, newRuleText.trim()]; setSavingRules(true); await supabase.from('communities').update({ rules: updated }).eq('id', community.id); setRules(updated); setNewRuleText(''); setSavingRules(false); toast({ title: 'Rule added' }); }} className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
                    {savingRules ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}Add Rule
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="sticky top-14 z-20 bg-background border-b border-border">
        <div className="flex overflow-x-auto scrollbar-hide">
          {COMM_TAB_LIST.map(tab => {
            const TabIcon = tab === 'posts' ? MessageSquare : tab === 'members' ? Users : tab === 'chat' ? MessageCircle : CalendarDays;
            const tabLabel = tab === 'posts' ? 'Posts' : tab === 'members' ? 'Members' : tab === 'chat' ? 'Chat' : 'Events';
            return (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`flex-shrink-0 flex-1 py-3 text-sm font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors min-w-0 ${activeTab === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}>
                <TabIcon className="w-4 h-4" />
                {tabLabel}
                {tab === 'posts' && posts.length > 0 && <span className="ml-0.5 text-[10px] bg-primary/10 text-primary font-bold px-1.5 py-0.5 rounded-full">{posts.length}</span>}
              </button>
            );
          })}
          {shopUnlocked && (
            <button onClick={() => setActiveTab('shop')}
              className={`flex-shrink-0 flex-1 py-3 text-sm font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors min-w-0 ${activeTab === 'shop' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}>
              <ShoppingBag className="w-4 h-4" /> Shop
            </button>
          )}
        </div>
      </div>

      {/* POSTS TAB */}
      {activeTab === 'posts' && (
        !canSeeContent ? (
          <div className="flex flex-col items-center justify-center text-center py-16 px-6">
            <div className="w-20 h-20 rounded-full bg-orange-100 dark:bg-orange-900/20 flex items-center justify-center mb-4"><Lock className="w-10 h-10 text-orange-500" /></div>
            <h3 className="text-xl font-bold mb-2">Private Community</h3>
            <p className="text-muted-foreground text-sm mb-6 max-w-sm">Join to see posts and connect with members.</p>
            {user ? <Button onClick={handleJoinToggle} className="rounded-full px-8"><UserPlus className="w-4 h-4 mr-2" />Request to Join</Button> : <Button onClick={() => navigate('/auth')} className="rounded-full px-8">Sign in to Join</Button>}
          </div>
        ) : (
          <div>
            {isMember && <div className="border-b border-border"><ComposePost onSuccess={fetchPosts} communityId={community.id} /></div>}
            {isMember && (
              <div className="px-4 py-2 flex items-center gap-2 border-b border-border bg-muted/20">
                <button onClick={() => setShowCommunityPollDialog(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-background text-xs font-semibold text-muted-foreground hover:border-primary/30 hover:text-primary transition-colors">
                  <BarChart3 className="w-3.5 h-3.5" />Create Poll
                </button>
                <span className="text-[10px] text-muted-foreground">Ask the community a question</span>
              </div>
            )}
            {digestPosts.length > 0 && showDigest && (
              <div className="mx-4 mt-4 mb-2 border border-amber-500/20 bg-amber-500/5 rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-amber-500/15">
                  <div className="flex items-center gap-2"><Trophy className="w-3.5 h-3.5 text-amber-500" /><span className="text-xs font-bold text-amber-700 dark:text-amber-400">Weekly Top Posts</span></div>
                  <button onClick={() => setShowDigest(false)} className="text-[10px] text-muted-foreground px-1">✕</button>
                </div>
                <div className="divide-y divide-amber-500/10">
                  {digestPosts.map((dp: any, i: number) => (
                    <button key={dp.id} onClick={() => navigate(`/post/${dp.id}`)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-amber-500/5 text-left">
                      <span className="text-base shrink-0">{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate">{dp.content?.slice(0, 60)}</p>
                        <p className="text-[10px] text-muted-foreground flex items-center gap-2 mt-0.5"><Heart className="w-2.5 h-2.5 text-pink-500" />{dp.likes_count ?? 0} likes · @{dp.user_profiles?.username}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {loadingPosts ? (
              <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
            ) : posts.length === 0 ? (
              <div className="flex flex-col items-center text-center py-12 text-muted-foreground"><Image className="w-12 h-12 mb-3 opacity-40" /><p className="font-semibold">No posts yet</p></div>
            ) : (
              [...posts].sort((a, b) => (pinnedPostIds.has(b.id) ? 1 : 0) - (pinnedPostIds.has(a.id) ? 1 : 0)).map(post => (
                <div key={post.id} className="relative">
                  {pinnedPostIds.has(post.id) && <div className="flex items-center gap-1.5 px-4 pt-2 pb-0 text-xs font-semibold text-amber-600"><Pin className="w-3 h-3" /> Pinned</div>}
                  <PostCard post={post} onUpdate={fetchPosts} />
                  {isAdmin && (
                    <div className="absolute top-2 right-12 z-10">
                      <button onClick={e => { e.stopPropagation(); setShowRoleMenu(p => p === post.id ? null : post.id); }} className="p-1.5 rounded-full bg-background/80 backdrop-blur-sm border border-border text-muted-foreground">
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                      {showRoleMenu === post.id && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setShowRoleMenu(null)} />
                          <div className="absolute right-0 mt-1 w-44 bg-background border border-border rounded-xl shadow-lg z-50 overflow-hidden">
                            <button onClick={e => { e.stopPropagation(); handlePinPost(post.id); setShowRoleMenu(null); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted">
                              {pinnedPostIds.has(post.id) ? <><PinOff className="w-4 h-4 text-amber-500" />Unpin</> : <><Pin className="w-4 h-4 text-amber-500" />Pin</>}
                            </button>
                            <button onClick={e => { e.stopPropagation(); handleModDeletePost(post.id); setShowRoleMenu(null); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-destructive/10 text-destructive">
                              <Trash2 className="w-4 h-4" />Delete (mod)
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )
      )}

      {/* CHAT TAB */}
      {activeTab === 'chat' && (
        <div className="flex flex-col relative" style={{ height: 'calc(100vh - 300px)', minHeight: 420 }}>
          <div className="pointer-events-none absolute inset-0 overflow-hidden z-20">
            {floatingReactions.map(fr => (
              <div key={fr.id} className="absolute bottom-16 text-2xl animate-bounce" style={{ left: `${fr.x}%`, animationDuration: '0.8s', animationIterationCount: 3 }}>{fr.emoji}</div>
            ))}
          </div>
          {pinnedChatIds.length > 0 && (
            <div className="px-4 py-2 bg-primary/5 border-b border-primary/15">
              <div className="flex items-center gap-1.5 mb-1"><Pin className="w-3 h-3 text-primary" /><span className="text-[10px] font-bold text-primary">Pinned Messages</span></div>
              {chatMessages.filter(m => pinnedChatIds.includes(m.id)).slice(0, 2).map(m => (
                <p key={m.id} className="text-[11px] text-foreground truncate"><span className="font-semibold text-primary">@{m.user_profiles?.username}:</span> {GIF_URL_RE.test(m.message) ? '🖼 GIF' : m.message}</p>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
            {chatMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-10 text-muted-foreground">
                <MessageCircle className="w-12 h-12 mb-3 opacity-30" /><p className="font-semibold">No messages yet</p>
                {isMember ? <p className="text-sm mt-1">Start the conversation!</p> : <p className="text-sm mt-1">Join to chat</p>}
              </div>
            ) : (
              chatMessages.map((msg: any, i: number) => {
                const isOwn = msg.user_id === user?.id;
                const prev = chatMessages[i - 1];
                const showHeader = !prev || prev.user_id !== msg.user_id;
                const reactions = getReactions(msg.id);
                const isPinned = pinnedChatIds.includes(msg.id);
                const isGif = GIF_URL_RE.test(msg.message);
                return (
                  <div key={msg.id} className={`group flex items-end gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`w-7 h-7 rounded-full overflow-hidden bg-muted flex-shrink-0 ${showHeader ? '' : 'invisible'}`}>
                      {msg.user_profiles?.avatar_url ? <img src={msg.user_profiles.avatar_url} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-[10px] font-bold">{msg.user_profiles?.username?.[0]?.toUpperCase()}</div>}
                    </div>
                    <div className={`max-w-[78%] flex flex-col gap-0.5 ${isOwn ? 'items-end' : 'items-start'}`}>
                      {showHeader && !isOwn && (
                        <div className="flex items-center gap-1.5 px-1">
                          <span className="text-[11px] font-bold">{msg.user_profiles?.username}</span>
                          <button onClick={() => navigate(`/messages?to=${msg.user_profiles?.username}`)} className="text-muted-foreground hover:text-primary"><Mail className="w-3 h-3" /></button>
                        </div>
                      )}
                      <div className={`relative ${isPinned ? 'ring-1 ring-primary/30 rounded-2xl' : ''}`}>
                        {isPinned && <div className="absolute -top-1.5 left-1"><Pin className="w-2.5 h-2.5 text-primary" /></div>}
                        {isGif ? (
                          <img src={msg.message} alt="GIF" className="max-w-[200px] max-h-[150px] rounded-xl object-cover" loading="lazy" />
                        ) : (
                          <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed break-words ${isOwn ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted text-foreground rounded-bl-sm'}`}>
                            {msg.message}
                          </div>
                        )}
                      </div>
                      {Object.keys(reactions).length > 0 && (
                        <div className="flex gap-1 flex-wrap px-1">
                          {Object.keys(reactions).map(emoji => (
                            <button key={emoji} onClick={() => handleAddReaction(msg.id, emoji)}
                              className="flex items-center gap-0.5 text-[11px] bg-muted/80 hover:bg-muted border border-border rounded-full px-1.5 py-0.5">
                              {emoji} <span className="text-[10px] font-bold text-muted-foreground">{reactions[emoji]}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      <div className={`opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 px-1 ${isOwn ? 'flex-row-reverse' : ''}`}>
                        <button onClick={() => setShowEmojiPickerFor(p => p === msg.id ? null : msg.id)} className="text-[14px] hover:scale-110 transition-transform">😊</button>
                        <button onClick={() => setReplyingTo({ id: msg.id, text: isGif ? '📸 GIF' : msg.message, username: msg.user_profiles?.username ?? 'user' })} className="text-[10px] text-muted-foreground hover:text-primary font-semibold px-1">↩</button>
                        {isAdmin && <button onClick={() => handlePinChatMessage(msg.id)} className="text-[10px] text-muted-foreground hover:text-primary"><Pin className="w-3 h-3" /></button>}
                      </div>
                      {showEmojiPickerFor === msg.id && (
                        <div className="flex gap-1 bg-background border border-border rounded-2xl px-2 py-1.5 shadow-lg z-30">
                          {CHAT_EMOJIS.map(e => <button key={e} onClick={() => handleAddReaction(msg.id, e)} className="text-xl hover:scale-125 transition-transform">{e}</button>)}
                        </div>
                      )}
                      {showHeader && <span className="text-[9px] text-muted-foreground px-1">{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={chatEndRef} />
          </div>
          {isMember ? (
            <div className="border-t border-border bg-background shrink-0">
              {replyingTo && (
                <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 border-b border-primary/15">
                  <span className="text-[10px] text-primary font-semibold flex-1 truncate">↩ @{replyingTo.username}: "{replyingTo.text.slice(0, 40)}…"</span>
                  <button onClick={() => setReplyingTo(null)} className="text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
                </div>
              )}
              <div className="px-3 pt-2 pb-0 flex items-center gap-2">
                <input type="text" value={scheduleContent} onChange={e => setScheduleContent(e.target.value)} placeholder="Write to schedule a post…" maxLength={280}
                  className="flex-1 text-xs bg-muted/40 border border-border/60 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/30" />
                <button onClick={() => { if (scheduleContent.trim()) setShowScheduleDialog(true); else sonnerToast.info('Write something first'); }}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-primary/10 text-primary rounded-xl text-xs font-semibold hover:bg-primary/20 shrink-0">
                  <Calendar className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="p-3 flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 bg-muted/60 border border-border rounded-2xl px-3 py-2">
                  {/* @mention autocomplete dropdown */}
                  {mentionQuery !== null && mentionResults.length > 0 && (
                    <div className="absolute bottom-full left-0 right-0 mb-2 bg-background border border-border rounded-2xl shadow-xl overflow-hidden z-50">
                      {mentionResults.map(m => (
                        <button
                          key={m.id}
                          onMouseDown={e => { e.preventDefault(); insertMention(m.username); }}
                          className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-muted transition-colors text-left"
                        >
                          <div className="w-7 h-7 rounded-full bg-muted overflow-hidden shrink-0">
                            {m.avatar_url
                              ? <img src={m.avatar_url} alt={m.username} className="w-full h-full object-cover" />
                              : <div className="w-full h-full flex items-center justify-center text-[11px] font-bold">{m.username[0]?.toUpperCase()}</div>}
                          </div>
                          <span className="text-sm font-semibold">@{m.username}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    ref={chatInputRef}
                    type="text" value={chatInput} onChange={e => handleChatInputChange(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                    placeholder="Message the community… (@mention)" maxLength={280}
                    className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/60" />
                  <span className="text-[10px] text-muted-foreground/50 shrink-0">{chatInput.length}/280</span>
                </div>
                <button onClick={() => setShowChatGifPicker(true)} className="w-10 h-10 rounded-full border border-border text-muted-foreground hover:border-primary/30 hover:text-primary flex items-center justify-center transition-colors shrink-0">
                  <span className="text-[10px] font-black leading-none">GIF</span>
                </button>
                <button onClick={handleSendChat} disabled={!chatInput.trim() || chatSending}
                  className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0">
                  {chatSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ) : (
            <div className="border-t border-border p-4 text-center shrink-0">
              <p className="text-sm text-muted-foreground">Join to participate in live chat</p>
              {user && <button onClick={handleJoinToggle} className="mt-2 px-5 py-2 bg-primary text-primary-foreground rounded-full text-sm font-semibold">Join &amp; Chat</button>}
            </div>
          )}
        </div>
      )}

      {/* EVENTS TAB */}
      {activeTab === 'events' && (
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div><h3 className="font-bold text-base">Community Events</h3><p className="text-xs text-muted-foreground mt-0.5">AMAs, announcements, meetups</p></div>
            {isMember && <button onClick={() => setShowCreateEvent(true)} className="flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-bold hover:opacity-90"><Plus className="w-3.5 h-3.5" />Add Event</button>}
          </div>
          {loadingEvents ? <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div> :
           events.length === 0 ? <div className="text-center py-16 text-muted-foreground"><CalendarDays className="w-14 h-14 mx-auto mb-3 opacity-20" /><p className="font-semibold">No events yet</p></div> : (
            <div className="space-y-3">
              {events.map((ev: any) => {
                const evDate = new Date(ev.scheduled_for);
                const passed = isPast(evDate);
                const timeLeft = !passed ? formatDistanceToNow(evDate, { addSuffix: false }) : null;
                const isRsvp = rsvpSet.has(ev.id);
                const lines = (ev.content ?? '').split('\n');
                const evTitle = lines[0] ?? '';
                const evDesc = lines.slice(1).join('\n').trim();
                return (
                  <div key={ev.id} className={`border rounded-2xl overflow-hidden ${passed ? 'border-border bg-muted/20 opacity-70' : 'border-primary/20 bg-primary/5 hover:border-primary/40'}`}>
                    <div className="p-4">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        {!passed ? <span className="flex items-center gap-1 text-[10px] font-black text-green-600 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />Upcoming</span> : <span className="text-[10px] font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Past</span>}
                        {timeLeft && <span className="flex items-center gap-1 text-[10px] text-primary font-bold"><Clock className="w-2.5 h-2.5" />{timeLeft} away</span>}
                      </div>
                      <p className="font-bold text-sm leading-snug">{evTitle}</p>
                      {evDesc && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{evDesc}</p>}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2 mb-3">
                        <span className="flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" />{evDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{evDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      {!passed && isMember && (
                        <button onClick={() => handleRsvp(ev.id)}
                          className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold border-2 transition-all ${isRsvp ? 'border-green-500/30 bg-green-500/10 text-green-600' : 'border-primary/30 bg-background text-primary hover:bg-primary/5'}`}>
                          {isRsvp ? <><Check className="w-3.5 h-3.5" />You're going!</> : <><CalendarDays className="w-3.5 h-3.5" />RSVP</>}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {showCreateEvent && (
            <div className="fixed inset-0 z-[200] bg-black/60 flex items-end" onClick={() => setShowCreateEvent(false)}>
              <div className="w-full bg-background rounded-t-3xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between"><h3 className="font-bold text-lg">Add Event</h3><button onClick={() => setShowCreateEvent(false)} className="p-2 rounded-full hover:bg-muted"><X className="w-5 h-5" /></button></div>
                <div className="space-y-3">
                  <div><label className="text-sm font-semibold mb-1 block">Title *</label><Input value={eventForm.title} onChange={e => setEventForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Weekly AMA" maxLength={80} /></div>
                  <div><label className="text-sm font-semibold mb-1 block">Description</label><Textarea value={eventForm.description} onChange={e => setEventForm(p => ({ ...p, description: e.target.value }))} rows={2} maxLength={300} /></div>
                  <div><label className="text-sm font-semibold mb-1 block">Date & Time *</label><input type="datetime-local" value={eventForm.scheduled_for} onChange={e => setEventForm(p => ({ ...p, scheduled_for: e.target.value }))} className="w-full h-10 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none" /></div>
                </div>
                <button onClick={handleCreateEvent} disabled={creatingEvent || !eventForm.title.trim() || !eventForm.scheduled_for} className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90">
                  {creatingEvent ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarDays className="w-4 h-4" />}Add Event
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MEMBERS TAB */}
      {activeTab === 'members' && (
        <div className="p-4 space-y-3">
          <div className="rounded-2xl border border-border overflow-hidden mb-1">
            <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-amber-500/8 to-orange-500/5 border-b border-border">
              <Trophy className="w-4 h-4 text-amber-500" /><h3 className="font-bold text-sm">Top Contributors</h3><span className="text-[10px] text-muted-foreground ml-1">last 30 days</span>
            </div>
            {loadingLeaderboard ? <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div> :
             leaderboard.length === 0 ? <p className="text-xs text-muted-foreground text-center py-5">No activity in last 30 days</p> : (
              <div className="flex items-end justify-center gap-3 px-4 pt-4 pb-5">
                {[leaderboard[1], leaderboard[0], leaderboard[2]].map((entry, podiumIdx) => {
                  if (!entry) return <div key={podiumIdx} className="w-20" />;
                  const rank = podiumIdx === 0 ? 2 : podiumIdx === 1 ? 1 : 3;
                  const medalEmoji = LEADERBOARD_MEDALS[rank - 1];
                  const podiumH = LEADERBOARD_PODIUM_H[podiumIdx];
                  return (
                    <div key={entry.profile?.id ?? podiumIdx} className="flex flex-col items-center gap-1.5 flex-1 max-w-[80px]">
                      <span className="text-xl">{medalEmoji}</span>
                      <button onClick={() => navigate(`/profile/${entry.profile?.username}`)} className="w-12 h-12 rounded-full overflow-hidden bg-muted border-2 border-border hover:border-primary/40 transition-colors">
                        {entry.profile?.avatar_url ? <img src={entry.profile.avatar_url} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center font-bold text-sm">{entry.profile?.username?.[0]?.toUpperCase()}</div>}
                      </button>
                      <p className="text-[10px] font-bold text-center truncate w-full">{entry.profile?.username}</p>
                      <p className="text-[9px] text-pink-500 font-semibold">{entry.likes} ♥</p>
                      <p className="text-[9px] text-muted-foreground">{entry.posts} posts</p>
                      <div className={`w-full ${podiumH} ${rank === 1 ? 'bg-amber-500/20 border-amber-500/30' : rank === 2 ? 'bg-slate-400/15 border-slate-400/25' : 'bg-orange-400/15 border-orange-400/25'} border rounded-t-lg`} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <h3 className="font-bold text-sm text-muted-foreground uppercase tracking-wide">{formatNumber(community.member_count)} Members</h3>
          {members.map(member => (
            <div key={member.id} className="flex items-center justify-between p-3 bg-card rounded-xl border border-border hover:border-primary/30 transition-colors">
              <div className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/profile/${member.user_profiles?.username}`)}>
                <div className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0">
                  {member.user_profiles?.avatar_url ? <img src={member.user_profiles.avatar_url} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center font-bold">{member.user_profiles?.username?.[0]?.toUpperCase()}</div>}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="font-semibold text-sm truncate">{member.user_profiles?.username}</p>
                    {member.role === 'owner' && <Crown className="w-3.5 h-3.5 text-yellow-500 shrink-0" />}
                    {member.role === 'moderator' && <Shield className="w-3.5 h-3.5 text-blue-500 shrink-0" />}
                  </div>
                  <p className="text-xs text-muted-foreground capitalize">{member.role}</p>
                </div>
              </div>
              {isOwner && member.role !== 'owner' && (
                <div className="relative ml-2 shrink-0">
                  <button onClick={() => setShowRoleMenu(p => p === member.id ? null : member.id)} className="p-2 rounded-full hover:bg-muted transition-colors text-muted-foreground"><MoreVertical className="w-4 h-4" /></button>
                  {showRoleMenu === member.id && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowRoleMenu(null)} />
                      <div className="absolute right-0 mt-1 w-48 bg-background border border-border rounded-xl shadow-xl z-50 overflow-hidden">
                        {member.role === 'member' && <button onClick={() => handlePromoteRole(member.id, member.user_id, 'moderator')} disabled={promotingMemberId === member.id} className="w-full flex items-center gap-2 px-3 py-3 text-sm hover:bg-muted text-blue-600">{promotingMemberId === member.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}Promote to Moderator</button>}
                        {member.role === 'moderator' && <button onClick={() => handlePromoteRole(member.id, member.user_id, 'member')} disabled={promotingMemberId === member.id} className="w-full flex items-center gap-2 px-3 py-3 text-sm hover:bg-muted text-orange-600">{promotingMemberId === member.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldOff className="w-4 h-4" />}Remove Moderator</button>}
                        <button onClick={async () => { if (!window.confirm(`Remove @${member.user_profiles?.username}?`)) return; await supabase.from('community_members').delete().eq('id', member.id); setMembers(prev => prev.filter(m => m.id !== member.id)); setShowRoleMenu(null); toast({ title: 'Member removed' }); }} className="w-full flex items-center gap-2 px-3 py-3 text-sm hover:bg-destructive/10 text-destructive border-t border-border"><Trash2 className="w-4 h-4" />Remove</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          {community.member_count > 20 && <p className="text-center text-sm text-muted-foreground py-4">+{formatNumber(community.member_count - 20)} more members</p>}
        </div>
      )}

      {/* SHOP TAB */}
      {activeTab === 'shop' && shopUnlocked && (
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <ShoppingBag className="w-5 h-5 text-primary" />
            <div><h3 className="font-bold text-base">Community Shop</h3><p className="text-xs text-muted-foreground mt-0.5">Products from community members</p></div>
          </div>
          {nftUnlocked ? (
            <div className="border border-cyan-500/20 bg-cyan-500/5 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-cyan-500/15">
                <div className="flex items-center gap-2"><Award className="w-4 h-4 text-cyan-500" /><span className="text-sm font-bold">Community NFT Badges</span><span className="text-[10px] text-muted-foreground">{nftBadges.length} minted</span></div>
                {isMember && <button onClick={handleMintNft} disabled={mintingNft} className="flex items-center gap-1 px-2.5 py-1.5 bg-cyan-500 text-white rounded-xl text-xs font-bold disabled:opacity-50 hover:opacity-90">{mintingNft ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}{mintingNft ? 'Minting…' : 'Mint Badge'}</button>}
              </div>
              {nftBadges.length === 0 ? <p className="text-xs text-muted-foreground text-center py-4">No badges minted yet — be the first!</p> : (
                <div className="flex gap-3 px-4 py-3 overflow-x-auto scrollbar-hide">
                  {nftBadges.slice(0, 8).map((b: any) => {
                    const nftMeta = NFT_TIERS.find(t => t.tier === b.badge_tier) ?? NFT_TIERS[2];
                    return (
                      <div key={b.id} className={`flex flex-col items-center gap-1 p-2 rounded-xl bg-gradient-to-br ${nftMeta.color} border ${nftMeta.border} shrink-0 min-w-[60px]`}>
                        <span className="text-2xl">{b.badge_emoji}</span>
                        <p className="text-[9px] font-bold truncate w-full text-center">{b.user_profiles?.username}</p>
                        <p className="text-[8px] text-muted-foreground">{nftMeta.label}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 px-4 py-3 bg-muted/40 border border-border rounded-xl">
              <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
              <div><p className="text-xs font-semibold">NFT Badges locked</p><p className="text-[10px] text-muted-foreground">Contact @Shee to unlock</p></div>
            </div>
          )}
          {loadingShop ? <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div> :
           shopProducts.length === 0 ? <div className="text-center py-12 text-muted-foreground"><ShoppingBag className="w-14 h-14 mx-auto mb-3 opacity-20" /><p className="font-semibold">No products yet</p></div> : (
            <div className="grid grid-cols-2 gap-3">
              {shopProducts.map((p: any) => (
                <div key={p.id} className="bg-card border border-border rounded-2xl overflow-hidden hover:border-primary/20 transition-colors">
                  <div className="aspect-square bg-muted overflow-hidden">
                    {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><ShoppingBag className="w-8 h-8 text-muted-foreground opacity-30" /></div>}
                  </div>
                  <div className="p-3">
                    <p className="font-bold text-sm line-clamp-2 leading-snug">{p.name}</p>
                    {p.description && <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{p.description}</p>}
                    <div className="flex items-center justify-between mt-2">
                      <span className="font-black text-base text-primary">${Number(p.price).toFixed(2)}</span>
                      {(p.avg_rating ?? 0) > 0 && <span className="flex items-center gap-0.5 text-[10px] text-amber-500 font-bold"><Star className="w-2.5 h-2.5 fill-current" />{Number(p.avg_rating).toFixed(1)}</span>}
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <div className="w-4 h-4 rounded-full bg-muted overflow-hidden shrink-0">{p.user_profiles?.avatar_url ? <img src={p.user_profiles.avatar_url} className="w-full h-full object-cover" alt="" /> : null}</div>
                      <span className="text-[9px] text-muted-foreground truncate">@{p.user_profiles?.username}</span>
                    </div>
                    {p.external_link && (
                      <a href={p.external_link} target="_blank" rel="noopener noreferrer" className="mt-2 flex items-center justify-center gap-1 w-full py-2 bg-primary text-primary-foreground rounded-xl text-xs font-bold hover:opacity-90">
                        <ExternalLink className="w-3 h-3" />Buy Now
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
