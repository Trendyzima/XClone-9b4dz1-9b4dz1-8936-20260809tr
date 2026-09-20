import { Analytics, StatusBar, Style, Capacitor } from '@/lib/capacitor-stub';
import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { AuthProvider } from '@/components/layout/AuthProvider';
import { Sidebar } from '@/components/layout/Sidebar';
import { RightSidebar } from '@/components/layout/RightSidebar';
import { BottomNav } from '@/components/layout/BottomNav';
import { FloatingActionButton } from '@/components/layout/FloatingActionButton';
import { LiveSpaceBanner } from '@/components/features/LiveSpaceBanner';
import { LiveNotificationBanner } from '@/components/features/LiveNotificationBanner';
import { useCreatorTierAlert } from '@/hooks/useCreatorTierAlert';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from 'sonner';
import { Loader2, Sparkles, Check, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import HomePage from '@/pages/HomePage';
import AuthPage from '@/pages/AuthPage';
import VideosPage from '@/pages/VideosPage';
const FastPixShortsPage = lazy(() => import('@/pages/FastPixShortsPage'));
const ExplorePage = lazy(() => import('@/pages/ExplorePage'));
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'));
const MessagesPage = lazy(() => import('@/pages/MessagesPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const ProfileFeaturesPage = lazy(() => import('@/pages/ProfileFeaturesPage'));
const SearchPage = lazy(() => import('@/pages/SearchPage'));
const SpacesPage = lazy(() => import('@/pages/SpacesPage'));
const AIPage = lazy(() => import('@/pages/AIPage'));
const AnalyticsDashboard = lazy(() => import('@/pages/AnalyticsDashboard'));
const AdminPanel = lazy(() => import('@/pages/AdminPanel'));
const PostThreadPage = lazy(() => import('@/pages/PostThreadPage'));
const CommunitiesPage = lazy(() => import('@/pages/CommunitiesPage'));
const CommunityPage = lazy(() => import('@/pages/CommunityPage'));
const HashtagPage = lazy(() => import('@/pages/HashtagPage'));
const AIBotSetup = lazy(() => import('@/pages/AIBotSetup'));
const BookmarksPage = lazy(() => import('@/pages/BookmarksPage').then(m => ({ default: m.BookmarksPage })));
const ListsPage = lazy(() => import('@/pages/ListsPage').then(m => ({ default: m.ListsPage })));
const MonetizationDashboard = lazy(() => import('@/pages/MonetizationDashboard').then(m => ({ default: m.MonetizationDashboard })));
const ProductsPage = lazy(() => import('@/pages/ProductsPage').then(m => ({ default: m.ProductsPage })));
const ScheduledPostsPage = lazy(() => import('@/pages/ScheduledPostsPage').then(m => ({ default: m.ScheduledPostsPage })));
const CreatorStudio = lazy(() => import('@/pages/CreatorStudio'));
const PremiumPage = lazy(() => import('@/pages/PremiumPage'));
const LiveStreamPage = lazy(() => import('@/pages/LiveStreamPage'));
const StartStreamPage = lazy(() => import('@/pages/StartStreamPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const ThreadsPage = lazy(() => import('@/pages/ThreadsPage'));
const CreateThreadPage = lazy(() => import('@/pages/CreateThreadPage'));
const ThreadDetailPage = lazy(() => import('@/pages/ThreadDetailPage'));
const HistoryPage = lazy(() => import('@/pages/HistoryPage'));
const HelpPage = lazy(() => import('@/pages/HelpPage'));
const WalletPage = lazy(() => import('@/pages/WalletPage'));
const CreateAdPage = lazy(() => import('@/pages/CreateAdPage'));
const MyAdsPage = lazy(() => import('@/pages/MyAdsPage'));
const ListDetailPage = lazy(() => import('@/pages/ListDetailPage'));
const AdConfigPage = lazy(() => import('@/pages/AdConfigPage'));
const PayoutsPage = lazy(() => import('@/pages/PayoutsPage'));
const RevenueAnalytics = lazy(() => import('@/pages/RevenueAnalytics'));
const FraudDetection = lazy(() => import('@/pages/FraudDetection'));
const AdPerformanceComparison = lazy(() => import('@/pages/AdPerformanceComparison'));
const AdminRevenueDashboard = lazy(() => import('@/pages/AdminRevenueDashboard'));
const BoostAnalyticsPage = lazy(() => import('@/pages/BoostAnalyticsPage'));
const BoostCreatePage = lazy(() => import('@/pages/BoostCreatePage'));
const RewardedAdHistory = lazy(() => import('@/pages/RewardedAdHistory'));
const PostAnalyticsDashboard = lazy(() => import('@/pages/PostAnalyticsDashboard'));
const FediversePage = lazy(() => import('@/pages/FediversePage'));
const VerificationRequestPage = lazy(() => import('@/pages/VerificationRequestPage'));
const AdminVerificationPage = lazy(() => import('@/pages/AdminVerificationPage'));
const DailyRewardsPage = lazy(() => import('@/pages/DailyRewardsPage'));
const LeaderboardPage = lazy(() => import('@/pages/LeaderboardPage'));
const ChallengeLeaderboardPage = lazy(() => import('@/pages/ChallengeLeaderboardPage'));
const DiscoverPage = lazy(() => import('@/pages/DiscoverPage'));
const ReferralPage = lazy(() => import('@/pages/ReferralPage'));
const SpaceRecordingViewerPage = lazy(() => import('@/pages/SpaceRecordingViewerPage'));
const SpaceDetailPage = lazy(() => import('@/pages/SpaceDetailPage'));
const TrendingTopicFeedPage = lazy(() => import('@/pages/TrendingTopicFeedPage'));
const HashtagChallengePage = lazy(() => import('@/pages/HashtagChallengePage'));
const AdminAdsDashboard = lazy(() => import('@/pages/AdminAdsDashboard'));
const NotificationPreferencesPage = lazy(() => import('@/pages/NotificationPreferencesPage'));
const WishlistPage = lazy(() => import('@/pages/WishlistPage'));
const MarketplacePage = lazy(() => import('@/pages/MarketplacePage'));
const ShoppingMallPage = lazy(() => import('@/pages/ShoppingMallPage'));
const PollsPage = lazy(() => import('@/pages/PollsPage'));
const InterestOnboardingPage = lazy(() => import('@/pages/InterestOnboardingPage'));
const SeriesPage = lazy(() => import('@/pages/SeriesPage'));
const PlatformInboxPage = lazy(() => import('@/pages/PlatformInboxPage'));
const AdAnalyticsPage = lazy(() => import('@/pages/AdAnalyticsPage'));
const SEOAuditPage = lazy(() => import('@/pages/SEOAuditPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));
const VideoWatchLaterPage = lazy(() => import('@/pages/VideoWatchLaterPage'));
const HashtagDiscoveryPage = lazy(() => import('@/pages/HashtagDiscoveryPage'));
const PodcastSearchPage = lazy(() => import('@/pages/PodcastSearchPage'));
const RegulatorPanel = lazy(() => import('@/pages/RegulatorPanel'));
const PodcastAnalyticsPage = lazy(() => import('@/pages/PodcastAnalyticsPage'));
const TeamChatPage = lazy(() => import('@/pages/TeamChatPage'));
const AppealsPage = lazy(() => import('@/pages/AppealsPage'));
const CreatorLeaderboardPage = lazy(() => import('@/pages/CreatorLeaderboardPage'));
const StoryAnalyticsDashboard = lazy(() => import('@/pages/StoryAnalyticsDashboard'));
const PlatformRevenueDashboard = lazy(() => import('@/pages/PlatformRevenueDashboard'));
const ContentPolicyPage = lazy(() => import('@/pages/ContentPolicyPage'));
const PrivacyPolicyPage = lazy(() => import('@/pages/PrivacyPolicyPage'));
const TermsOfServicePage = lazy(() => import('@/pages/TermsOfServicePage'));
const ActiveSessionsPage = lazy(() => import('@/pages/ActiveSessionsPage'));
const BlockedUsersPage = lazy(() => import('@/pages/BlockedUsersPage'));
const SellerStorefrontPage = lazy(() => import('@/pages/SellerStorefrontPage'));
const OrdersPage = lazy(() => import('@/pages/OrdersPage'));
function PageLoader(){return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="w-8 h-8 animate-spin text-primary"/></div>}
const INTEREST_CHIPS=[{tag:'technology',emoji:'💻'},{tag:'ai',emoji:'🤖'},{tag:'music',emoji:'🎵'},{tag:'art',emoji:'🎨'},{tag:'football',emoji:'⚽'},{tag:'fitness',emoji:'💪'},{tag:'food',emoji:'🍜'},{tag:'travel',emoji:'✈️'},{tag:'finance',emoji:'💰'},{tag:'science',emoji:'🔬'},{tag:'gaming',emoji:'🎮'},{tag:'news',emoji:'📰'}];
import { supabase } from '@/lib/supabase';
import { startTestagramHeartbeat } from '@/services/heartbeatClient';
import { applyAppearance, getStoredAppearance } from '@/theme/themes';
function InterestOnboardingSheet(){const{user}=useAuth();const navigate=useNavigate();const[show,setShow]=useState(false);const[selectedTags,setSelectedTags]=useState([] as string[]);const[saving,setSaving]=useState(false);useEffect(()=>{if(!user)return;const key=`ts-interest-onboarded-${user.id}`;if(localStorage.getItem(key))return;const t=setTimeout(()=>setShow(true),1800);return()=>clearTimeout(t)},[user?.id]);const toggle=(tag:string)=>setSelectedTags(p=>p.includes(tag)?p.filter(t=>t!==tag):[...p,tag]);const handleSave=async()=>{if(!user||selectedTags.length<3)return;setSaving(true);for(const tag of selectedTags){let hashtagId:string|null=null;const{data:existing}=await supabase.from('hashtags').select('id').eq('tag',tag).maybeSingle();if(existing?.id)hashtagId=existing.id;else{const{data:newTag}=await supabase.from('hashtags').insert({tag}).select('id').single();hashtagId=newTag?.id??null}if(hashtagId)await supabase.from('user_interests').upsert({user_id:user.id,hashtag_id:hashtagId,interest_score:1},{onConflict:'user_id,hashtag_id'}).catch(()=>{})}localStorage.setItem(`ts-interest-onboarded-${user.id}`,'1');setSaving(false);setShow(false)};const handleDismiss=()=>{if(user)localStorage.setItem(`ts-interest-onboarded-${user.id}`,'1');setShow(false)};if(!show||!user)return null;return <div className="fixed inset-0 z-[600] flex items-end justify-center" onClick={handleDismiss}><div className="w-full max-w-2xl bg-background rounded-t-3xl border-t border-border shadow-2xl p-5 pb-8 max-h-[80vh] overflow-y-auto animate-in slide-in-from-bottom duration-300" onClick={e=>e.stopPropagation()}><div className="flex justify-center mb-4"><div className="w-10 h-1.5 rounded-full bg-muted"/></div><div className="flex items-start justify-between mb-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center"><Sparkles className="w-5 h-5 text-primary"/></div><div><h2 className="font-bold text-lg">What are you into?</h2><p className="text-xs text-muted-foreground mt-0.5">Pick at least 3 topics to personalise your feed</p></div></div><button onClick={handleDismiss} className="p-1.5 rounded-full hover:bg-muted text-muted-foreground"><X className="w-4 h-4"/></button></div><div className="flex flex-wrap gap-2 mb-5">{INTEREST_CHIPS.map(({tag,emoji})=>{const sel=selectedTags.includes(tag);return <button key={tag} onClick={()=>toggle(tag)} className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold transition-all active:scale-95 ${sel?'bg-primary border-primary text-primary-foreground shadow-sm':'bg-muted/30 border-border text-foreground hover:border-primary/40 hover:bg-primary/5'}`}><span className="text-base leading-none">{emoji}</span><span>#{tag}</span>{sel&&<Check className="w-3 h-3"/>}</button>})}</div><div className="flex gap-3"><button onClick={()=>{navigate('/interests');handleDismiss()}} className="flex-1 py-2.5 border border-border rounded-xl text-sm font-semibold hover:bg-muted">See all topics</button><button onClick={handleSave} disabled={saving||selectedTags.length<3} className={`flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 ${selectedTags.length>=3?'bg-primary text-primary-foreground':'bg-muted text-muted-foreground'}`}>{saving?<Loader2 className="w-4 h-4 animate-spin"/>:<><Sparkles className="w-4 h-4"/>Save {selectedTags.length>=3?`${selectedTags.length} interests`:`(${3-selectedTags.length} more)`}</>}</button></div></div></div>}
function AppearanceBootstrap() {
  const { user } = useAuth();
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const local = getStoredAppearance();
      applyAppearance(local);
      if (!user) return;
      const { data } = await (supabase.from('profiles') as any)
        .select('appearance_settings')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      const remote = data?.appearance_settings;
      if (!remote || typeof remote !== 'object') return;
      const merged = { ...local, ...remote };
      applyAppearance(merged);
    };
    void load();
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const appearance = getStoredAppearance();
      if (appearance.mode === 'system') applyAppearance(appearance);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return null;
}
function AppInner(){useCreatorTierAlert();useEffect(()=>{applyAppearance(getStoredAppearance());const mq=window.matchMedia('(prefers-color-scheme: dark)');const handler=()=>{const a=getStoredAppearance();if(a.mode==='system')applyAppearance(a)};mq.addEventListener('change',handler);return()=>mq.removeEventListener('change',handler)},[]);useEffect(()=>startTestagramHeartbeat('web-v1'),[]);useEffect(()=>{if(!Capacitor.isNativePlatform())return;(async()=>{try{await StatusBar.setOverlaysWebView({overlay:true});await StatusBar.setStyle({style:Style.Dark});try{await StatusBar.setBackgroundColor({color:'#00000000'})}catch{}}catch{try{await StatusBar.hide()}catch{}}})()},[]);return <AuthProvider><AppearanceBootstrap/><div className="flex min-h-screen bg-background overflow-x-hidden pb-20"><Sidebar/><main className="flex-1 max-w-2xl w-full border-x border-border overflow-x-hidden"><Suspense fallback={<PageLoader/>}><Routes><Route path="/" element={<HomePage/>}/><Route path="/auth" element={<AuthPage/>}/><Route path="/videos" element={<VideosPage/>}/><Route path="/shorts" element={<FastPixShortsPage/>}/><Route path="/explore" element={<ExplorePage/>}/><Route path="/notifications" element={<NotificationsPage/>}/><Route path="/messages" element={<MessagesPage/>}/><Route path="/spaces" element={<SpacesPage/>}/><Route path="/profile/:username" element={<ProfilePage/>}/><Route path="/profile-features" element={<ProfileFeaturesPage/>}/><Route path="/search" element={<SearchPage/>}/><Route path="/ai" element={<AIPage/>}/><Route path="/analytics" element={<AnalyticsDashboard/>}/><Route path="/admin" element={<AdminPanel/>}/><Route path="/post/:postId" element={<PostThreadPage/>}/><Route path="/communities" element={<CommunitiesPage/>}/><Route path="/c/:name" element={<CommunityPage/>}/><Route path="/hashtag/:tag" element={<HashtagPage/>}/><Route path="/ai-bot-setup" element={<AIBotSetup/>}/><Route path="/bookmarks" element={<BookmarksPage/>}/><Route path="/lists" element={<ListsPage/>}/><Route path="/monetization" element={<MonetizationDashboard/>}/><Route path="/products" element={<ProductsPage/>}/><Route path="/scheduled" element={<ScheduledPostsPage/>}/><Route path="/creator-studio" element={<CreatorStudio/>}/><Route path="/premium" element={<PremiumPage/>}/><Route path="/stream/:streamId" element={<LiveStreamPage/>}/><Route path="/start-stream" element={<StartStreamPage/>}/><Route path="/settings" element={<SettingsPage/>}/><Route path="/threads" element={<ThreadsPage/>}/><Route path="/threads/create" element={<CreateThreadPage/>}/><Route path="/thread/:id" element={<ThreadDetailPage/>}/><Route path="/history" element={<HistoryPage/>}/><Route path="/help" element={<HelpPage/>}/><Route path="/wallet" element={<WalletPage/>}/><Route path="/create-ad" element={<CreateAdPage/>}/><Route path="/my-ads" element={<MyAdsPage/>}/><Route path="/lists/:id" element={<ListDetailPage/>}/><Route path="/admin/ads" element={<AdConfigPage/>}/><Route path="/payouts" element={<PayoutsPage/>}/><Route path="/revenue-analytics" element={<RevenueAnalytics/>}/><Route path="/fraud-detection" element={<FraudDetection/>}/><Route path="/ad-performance" element={<AdPerformanceComparison/>}/><Route path="/admin/revenue" element={<AdminRevenueDashboard/>}/><Route path="/boost-analytics/:postId" element={<BoostAnalyticsPage/>}/><Route path="/boost-create" element={<BoostCreatePage/>}/><Route path="/rewards" element={<RewardedAdHistory/>}/><Route path="/post-analytics" element={<PostAnalyticsDashboard/>}/><Route path="/post-analytics/:postId" element={<PostAnalyticsDashboard/>}/><Route path="/verify" element={<VerificationRequestPage/>}/><Route path="/admin/verifications" element={<AdminVerificationPage/>}/><Route path="/fediverse" element={<FediversePage/>}/><Route path="/daily-rewards" element={<DailyRewardsPage/>}/><Route path="/leaderboard" element={<LeaderboardPage/>}/><Route path="/leaderboard/challenges" element={<ChallengeLeaderboardPage/>}/><Route path="/discover" element={<DiscoverPage/>}/><Route path="/referral" element={<ReferralPage/>}/><Route path="/referrals" element={<ReferralPage/>}/><Route path="/space-recording/:id" element={<SpaceRecordingViewerPage/>}/><Route path="/spaces/:id" element={<SpaceDetailPage/>}/><Route path="/trending/:topic" element={<TrendingTopicFeedPage/>}/><Route path="/challenge/:id" element={<HashtagChallengePage/>}/><Route path="/admin/ads-review" element={<AdminAdsDashboard/>}/><Route path="/notification-preferences" element={<NotificationPreferencesPage/>}/><Route path="/wishlist" element={<WishlistPage/>}/><Route path="/marketplace" element={<MarketplacePage/>}/><Route path="/shop" element={<ShoppingMallPage/>}/><Route path="/polls" element={<PollsPage/>}/><Route path="/interests" element={<InterestOnboardingPage/>}/><Route path="/ad-analytics" element={<AdAnalyticsPage/>}/><Route path="/series" element={<SeriesPage/>}/><Route path="/platform-inbox" element={<PlatformInboxPage/>}/><Route path="/admin/seo" element={<SEOAuditPage/>}/><Route path="/videos/watchlater" element={<VideoWatchLaterPage/>}/><Route path="/hashtags" element={<HashtagDiscoveryPage/>}/><Route path="/podcasts/search" element={<PodcastSearchPage/>}/><Route path="/regulator" element={<RegulatorPanel/>}/><Route path="/podcasts/analytics" element={<PodcastAnalyticsPage/>}/><Route path="/team-chat" element={<TeamChatPage/>}/><Route path="/appeals" element={<AppealsPage/>}/><Route path="/leaderboard/creators" element={<CreatorLeaderboardPage/>}/><Route path="/policy" element={<ContentPolicyPage/>}/><Route path="/privacy" element={<PrivacyPolicyPage/>}/><Route path="/terms" element={<TermsOfServicePage/>}/><Route path="/sessions" element={<ActiveSessionsPage/>}/><Route path="/blocked" element={<BlockedUsersPage/>}/><Route path="/seller/:username" element={<SellerStorefrontPage/>}/><Route path="/orders" element={<OrdersPage/>}/><Route path="/story-analytics" element={<StoryAnalyticsDashboard/>}/><Route path="/admin/platform-revenue" element={<PlatformRevenueDashboard/>}/><Route path="*" element={<NotFoundPage/>}/></Routes></Suspense></main><RightSidebar/><LiveSpaceBanner/><LiveNotificationBanner/><BottomNav/><FloatingActionButton/><InterestOnboardingSheet/></div><Toaster/><Sonner position="top-center" richColors/><Analytics/></AuthProvider>}
export default function App(){return <BrowserRouter><AppInner/></BrowserRouter>}
