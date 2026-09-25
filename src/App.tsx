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
import { Loader2 } from 'lucide-react';
import { InterestOnboardingSheet } from '@/components/features/InterestOnboardingSheet';
import { supabase } from '@/lib/supabase';
import { startTestagramHeartbeat } from '@/services/heartbeatClient';
import { applyAppearance, getStoredAppearance } from '@/theme/themes';
import { useAuth } from '@/hooks/useAuth';
const HomePage = lazy(() => import('@/pages/HomePage'));
const FederatedOrganicDiscoveryPage = lazy(() => import('@/pages/FederatedOrganicDiscoveryPage'));
const AuthPage = lazy(() => import('@/pages/AuthPage'));
const VideosPage = lazy(() => import('@/pages/VideosPage'));
const FastPixShortsPage = lazy(() => import('@/pages/FastPixShortsPage'));
const ExplorePage = lazy(() => import('@/pages/ExplorePage'));
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'));
const MessagesPage = lazy(() => import('@/pages/MessagesPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const ProfileSectionPage = lazy(() => import('@/pages/ProfileSectionPage'));
const ProfilePostsPage = lazy(() => import('@/pages/profile/ProfilePostsPage'));
const ProfileThreadsPage = lazy(() => import('@/pages/profile/ProfileThreadsPage'));
const ProfileRepliesPage = lazy(() => import('@/pages/profile/ProfileRepliesPage'));
const ProfileMediaPage = lazy(() => import('@/pages/profile/ProfileMediaPage'));
const ProfileVideosPage = lazy(() => import('@/pages/profile/ProfileVideosPage'));
const ProfileLikesPage = lazy(() => import('@/pages/profile/ProfileLikesPage'));
const ProfileFollowersPage = lazy(() => import('@/pages/profile/ProfileFollowersPage'));
const ProfileFollowingPage = lazy(() => import('@/pages/profile/ProfileFollowingPage'));
const ProfileFeaturesPage = lazy(() => import('@/pages/ProfileFeaturesPage'));
const SearchPage = lazy(() => import('@/pages/SearchPage'));
const SpacesPage = lazy(() => import('@/pages/SpacesPage'));
const AIPage = lazy(() => import('@/pages/AIPage'));
const AnalyticsDashboard = lazy(() => import('@/pages/AnalyticsDashboard'));
const AdminPanel = lazy(() => import('@/pages/AdminPanel'));
const PostThreadPage = lazy(() => import('@/pages/PostThreadPage'));
const PostLikesPage = lazy(() => import('@/pages/PostLikesPage'));
const PostRepliesPage = lazy(() => import('@/pages/PostRepliesPage'));
const PostReplyChainPage = lazy(() => import('@/pages/PostReplyChainPage'));
const PostRepostsPage = lazy(() => import('@/pages/PostRepostsPage'));
const PostQuotesPage = lazy(() => import('@/pages/PostQuotesPage'));
const PostQuoteLikesPage = lazy(() => import('@/pages/PostQuoteLikesPage'));
const PostQuoteComposerPage = lazy(() => import('@/pages/PostQuoteComposerPage'));
const ThreadLikesPage = lazy(() => import('@/pages/ThreadLikesPage'));
const ThreadRepostsPage = lazy(() => import('@/pages/ThreadRepostsPage'));
const ThreadRepliesPage = lazy(() => import('@/pages/ThreadRepliesPage'));
const ThreadQuotesPage = lazy(() => import('@/pages/ThreadQuotesPage'));
const ThreadQuoteLikesPage = lazy(() => import('@/pages/ThreadQuoteLikesPage'));
const ThreadReplyLikesPage = lazy(() => import('@/pages/ThreadReplyLikesPage'));

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
const CreatorOverviewPage = lazy(() => import('@/pages/creator/CreatorOverviewPage'));
const CreatorAnalyticsPage = lazy(() => import('@/pages/creator/CreatorAnalyticsPage'));
const CreatorVideosPage = lazy(() => import('@/pages/creator/CreatorVideosPage'));
const CreatorEarningsPage = lazy(() => import('@/pages/creator/CreatorEarningsPage'));
const CreatorRevenuePage = lazy(() => import('@/pages/creator/CreatorRevenuePage'));
const CommunityPostsPage = lazy(() => import('@/pages/community/CommunityPostsPage'));
const CommunityMembersPage = lazy(() => import('@/pages/community/CommunityMembersPage'));
const CommunityChatPage = lazy(() => import('@/pages/community/CommunityChatPage'));
const CommunityEventsPage = lazy(() => import('@/pages/community/CommunityEventsPage'));
const CommunityShopPage = lazy(() => import('@/pages/community/CommunityShopPage'));
const DiscoverSuggestedPage = lazy(() => import('@/pages/discover/DiscoverSuggestedPage'));
const DiscoverPopularPage = lazy(() => import('@/pages/discover/DiscoverPopularPage'));
const DiscoverFediversePage = lazy(() => import('@/pages/discover/DiscoverFediversePage'));
const AdminOverviewPage = lazy(() => import('@/pages/admin/AdminOverviewPage'));
const AdminAdsPage = lazy(() => import('@/pages/admin/AdminAdsPage'));
const AdminUsersPage = lazy(() => import('@/pages/admin/AdminUsersPage'));
const AdminFraudPage = lazy(() => import('@/pages/admin/AdminFraudPage'));

const PremiumPage = lazy(() => import('@/pages/PremiumPage'));
const LiveStreamPage = lazy(() => import('@/pages/LiveStreamPage'));
const StartStreamPage = lazy(() => import('@/pages/StartStreamPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const SettingsAccountPage = lazy(() => import('@/pages/settings/SettingsAccountPage'));
const SettingsAppearancePage = lazy(() => import('@/pages/settings/SettingsAppearancePage'));
const SettingsConnectionsPage = lazy(() => import('@/pages/settings/SettingsConnectionsPage'));
const SettingsNotificationsPage = lazy(() => import('@/pages/settings/SettingsNotificationsPage'));
const SettingsPrivacyPage = lazy(() => import('@/pages/settings/SettingsPrivacyPage'));

const ThreadsPage = lazy(() => import('@/pages/ThreadsPage'));
const CreateThreadPage = lazy(() => import('@/pages/CreateThreadPage'));
const ThreadDetailPage = lazy(() => import('@/pages/ThreadDetailPage'));
const HistoryPage = lazy(() => import('@/pages/HistoryPage'));
const HelpPage = lazy(() => import('@/pages/HelpPage'));
const WalletPage = lazy(() => import('@/pages/WalletPage'));
const WalletHistoryPage = lazy(() => import('@/pages/WalletHistoryPage'));
const WalletSendPage = lazy(() => import('@/pages/WalletSendPage'));
const WalletReceivePage = lazy(() => import('@/pages/WalletReceivePage'));
const WalletAnalyticsPage = lazy(() => import('@/pages/WalletAnalyticsPage'));
const WalletReferralsPage = lazy(() => import('@/pages/WalletReferralsPage'));
const WalletScheduledPage = lazy(() => import('@/pages/WalletScheduledPage'));
const WalletSavingsPage = lazy(() => import('@/pages/WalletSavingsPage'));
const WalletRemindersPage = lazy(() => import('@/pages/WalletRemindersPage'));
const WalletSecurityPage = lazy(() => import('@/pages/WalletSecurityPage'));
const WalletConverterPage = lazy(() => import('@/pages/WalletConverterPage'));
const WalletPocketPage = lazy(() => import('@/pages/WalletPocketPage'));
const WalletMpesaPage = lazy(() => import('@/pages/WalletMpesaPage'));
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
const lazyWithChunkRecovery = (loader) => lazy(async () => {
  try {
    return await loader();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isChunkLoadFailure = /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError|dynamically imported module/i.test(message);
    if (isChunkLoadFailure && typeof window !== 'undefined') {
      const key = 'testagram-fediverse-chunk-recovery';
      const last = Number(window.sessionStorage.getItem(key) ?? '0');
      if (Date.now() - last >= 15000) {
        window.sessionStorage.setItem(key, String(Date.now()));
        window.location.reload();
      }
    }
    throw error;
  }
});

const FediversePage = lazyWithChunkRecovery(() => import('@/pages/FediversePage'));
const FediverseParityPage = lazy(() => import('@/pages/FediverseParityPage'));
const FediverseFeedPage = lazy(() => import('@/pages/FediverseFeedPage'));
const FediverseMastodonPage = lazy(() => import('@/pages/FediverseMastodonPage'));
const FediverseInboxPage = lazy(() => import('@/pages/FediverseInboxPage'));
const FediverseRelayPage = lazy(() => import('@/pages/FediverseRelayPage'));
const FediverseAnalyticsPage = lazy(() => import('@/pages/FediverseAnalyticsPage'));
const FediverseDiscoverPage = lazy(() => import('@/pages/FediverseDiscoverPage'));
const FediverseIdentityPage = lazy(() => import('@/pages/FediverseIdentityPage'));
const FediverseProfilePage = lazy(() => import('@/pages/FediverseProfilePage'));
const FediverseProfilePostsPage = lazy(() => import('@/pages/FediverseProfilePostsPage'));
const FediverseProfileThreadsPage = lazy(() => import('@/pages/FediverseProfileThreadsPage'));
const FediverseProfileRepliesPage = lazy(() => import('@/pages/FediverseProfileRepliesPage'));
const FediverseProfileMediaPage = lazy(() => import('@/pages/FediverseProfileMediaPage'));
const FediverseProfileVideosPage = lazy(() => import('@/pages/FediverseProfileVideosPage'));
const FediverseProfilePodcastsPage = lazy(() => import('@/pages/FediverseProfilePodcastsPage'));
const FediverseProfileSeriesPage = lazy(() => import('@/pages/FediverseProfileSeriesPage'));
const FediverseProfileLikesPage = lazy(() => import('@/pages/FediverseProfileLikesPage'));
const FediverseProfileTipsPage = lazy(() => import('@/pages/FediverseProfileTipsPage'));
const FediverseProfileGiftsPage = lazy(() => import('@/pages/FediverseProfileGiftsPage'));
const FediverseProfileFollowersPage = lazy(() => import('@/pages/FediverseProfileFollowersPage'));
const FediverseProfileFollowingPage = lazy(() => import('@/pages/FediverseProfileFollowingPage'));
const FediverseProfileAnalyticsPage = lazy(() => import('@/pages/FediverseProfileAnalyticsPage'));
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
const MarketProductPage = lazy(() => import('@/pages/MarketProductPage'));
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
function AppInner(){useCreatorTierAlert();useEffect(()=>{applyAppearance(getStoredAppearance());const mq=window.matchMedia('(prefers-color-scheme: dark)');const handler=()=>{const a=getStoredAppearance();if(a.mode==='system')applyAppearance(a)};mq.addEventListener('change',handler);return()=>mq.removeEventListener('change',handler)},[]);useEffect(()=>startTestagramHeartbeat('web-v1'),[]);useEffect(()=>{if(!Capacitor.isNativePlatform())return;(async()=>{try{await StatusBar.setOverlaysWebView({overlay:true});await StatusBar.setStyle({style:Style.Dark});try{await StatusBar.setBackgroundColor({color:'#00000000'})}catch{}}catch{try{await StatusBar.hide()}catch{}}})()},[]);return <AuthProvider><AppearanceBootstrap/><div className="flex min-h-screen bg-background overflow-x-hidden pb-20"><Sidebar/><main className="flex-1 max-w-2xl w-full border-x border-border overflow-x-hidden"><Suspense fallback={<PageLoader/>}><Routes><Route path="/" element={<HomePage/>}/><Route path="/auth" element={<AuthPage/>}/><Route path="/videos" element={<VideosPage/>}/><Route path="/shorts" element={<FastPixShortsPage/>}/><Route path="/explore" element={<ExplorePage/>}/>
<Route path="/discover" element={<DiscoverSuggestedPage/>}/>
<Route path="/discover/suggested" element={<DiscoverSuggestedPage/>}/>
<Route path="/discover/popular" element={<DiscoverPopularPage/>}/>
<Route path="/discover/fediverse" element={<DiscoverFediversePage/>}/><Route path="/notifications" element={<NotificationsPage/>}/><Route path="/messages" element={<MessagesPage/>}/><Route path="/spaces" element={<SpacesPage/>}/><Route path="/profile/:username" element={<ProfilePage/>}/>
<Route path="/profile/:username/posts" element={<ProfilePostsPage/>}/>
<Route path="/profile/:username/threads" element={<ProfileThreadsPage/>}/>
<Route path="/profile/:username/replies" element={<ProfileRepliesPage/>}/>
<Route path="/profile/:username/media" element={<ProfileMediaPage/>}/>
<Route path="/profile/:username/videos" element={<ProfileVideosPage/>}/>
<Route path="/profile/:username/likes" element={<ProfileLikesPage/>}/>
<Route path="/profile/:username/followers" element={<ProfileFollowersPage/>}/>
<Route path="/profile/:username/following" element={<ProfileFollowingPage/>}/>
<Route path="/profile/:username/podcasts" element={<ProfilePage/>}/>
<Route path="/profile/:username/series" element={<ProfilePage/>}/>
<Route path="/profile/:username/tips" element={<ProfilePage/>}/>
<Route path="/profile/:username/gifts" element={<ProfilePage/>}/>
<Route path="/profile/:username/analytics" element={<ProfilePage/>}/><Route path="/profile-features" element={<ProfileFeaturesPage/>}/><Route path="/search" element={<SearchPage/>}/><Route path="/ai" element={<AIPage/>}/><Route path="/analytics" element={<AnalyticsDashboard/>}/><Route path="/admin" element={<AdminPanel/>}/>
<Route path="/admin/overview" element={<AdminOverviewPage/>}/>
<Route path="/admin/ads-management" element={<AdminAdsPage/>}/>
<Route path="/admin/users" element={<AdminUsersPage/>}/>
<Route path="/admin/fraud" element={<AdminFraudPage/>}/><Route path="/post/:postId" element={<PostThreadPage/>}/><Route path="/post/:postId/likes" element={<PostLikesPage/>}/><Route path="/post/:postId/replies" element={<PostRepliesPage/>}/><Route path="/post/:postId/reply/:replyId" element={<PostReplyChainPage/>}/><Route path="/post/:postId/reposts" element={<PostRepostsPage/>}/><Route path="/post/:postId/quotes" element={<PostQuotesPage/>}/><Route path="/post/:postId/quote" element={<PostQuoteComposerPage/>}/><Route path="/post/:postId/quote-likes" element={<PostQuoteLikesPage/>}/><Route path="/communities" element={<CommunitiesPage/>}/><Route path="/c/:name" element={<CommunityPage/>}/>
<Route path="/c/:name/posts" element={<CommunityPostsPage/>}/>
<Route path="/c/:name/members" element={<CommunityMembersPage/>}/>
<Route path="/c/:name/chat" element={<CommunityChatPage/>}/>
<Route path="/c/:name/events" element={<CommunityEventsPage/>}/>
<Route path="/c/:name/shop" element={<CommunityShopPage/>}/><Route path="/hashtag/:tag" element={<HashtagPage/>}/><Route path="/ai-bot-setup" element={<AIBotSetup/>}/><Route path="/bookmarks" element={<BookmarksPage/>}/><Route path="/lists" element={<ListsPage/>}/><Route path="/monetization" element={<MonetizationDashboard/>}/><Route path="/products" element={<ProductsPage/>}/><Route path="/scheduled" element={<ScheduledPostsPage/>}/><Route path="/creator-studio" element={<CreatorStudio/>}/>
<Route path="/creator-studio/overview" element={<CreatorOverviewPage/>}/>
<Route path="/creator-studio/analytics" element={<CreatorAnalyticsPage/>}/>
<Route path="/creator-studio/videos" element={<CreatorVideosPage/>}/>
<Route path="/creator-studio/earnings" element={<CreatorEarningsPage/>}/>
<Route path="/creator-studio/revenue" element={<CreatorRevenuePage/>}/><Route path="/premium" element={<PremiumPage/>}/><Route path="/stream/:streamId" element={<LiveStreamPage/>}/><Route path="/start-stream" element={<StartStreamPage/>}/><Route path="/settings" element={<SettingsPage/>}/>
<Route path="/settings/account" element={<SettingsAccountPage/>}/>
<Route path="/settings/appearance" element={<SettingsAppearancePage/>}/>
<Route path="/settings/connections" element={<SettingsConnectionsPage/>}/>
<Route path="/settings/notifications" element={<SettingsNotificationsPage/>}/>
<Route path="/settings/privacy" element={<SettingsPrivacyPage/>}/><Route path="/threads" element={<ThreadsPage/>}/><Route path="/threads/create" element={<CreateThreadPage/>}/><Route path="/thread/:id" element={<ThreadDetailPage/>}/><Route path="/thread/:threadId/likes" element={<ThreadLikesPage/>}/><Route path="/thread/:threadId/replies" element={<ThreadRepliesPage/>}/><Route path="/thread/:threadId/reposts" element={<ThreadRepostsPage/>}/><Route path="/thread/:threadId/quotes" element={<ThreadQuotesPage/>}/><Route path="/thread/:threadId/quote-likes/:quoteId" element={<ThreadQuoteLikesPage/>}/><Route path="/thread/:threadId/reply-likes/:replyId" element={<ThreadReplyLikesPage/>}/><Route path="/history" element={<HistoryPage/>}/><Route path="/help" element={<HelpPage/>}/><Route path="/wallet" element={<WalletPage/>}/><Route path="/wallet/history" element={<WalletHistoryPage/>} /><Route path="/wallet/send" element={<WalletSendPage/>} /><Route path="/wallet/receive" element={<WalletReceivePage/>} /><Route path="/wallet/analytics" element={<WalletAnalyticsPage/>} /><Route path="/wallet/referrals" element={<WalletReferralsPage/>} /><Route path="/wallet/scheduled" element={<WalletScheduledPage/>} /><Route path="/wallet/savings" element={<WalletSavingsPage/>} /><Route path="/wallet/reminders" element={<WalletRemindersPage/>} /><Route path="/wallet/security" element={<WalletSecurityPage/>} /><Route path="/wallet/converter" element={<WalletConverterPage/>} /><Route path="/wallet/pocket" element={<WalletPocketPage/>} /><Route path="/wallet/mpesa" element={<WalletMpesaPage/>} /><Route path="/create-ad" element={<CreateAdPage/>}/><Route path="/my-ads" element={<MyAdsPage/>}/><Route path="/lists/:id" element={<ListDetailPage/>}/><Route path="/admin/ads" element={<AdConfigPage/>}/><Route path="/payouts" element={<PayoutsPage/>}/><Route path="/revenue-analytics" element={<RevenueAnalytics/>}/><Route path="/fraud-detection" element={<FraudDetection/>}/><Route path="/ad-performance" element={<AdPerformanceComparison/>}/><Route path="/admin/revenue" element={<AdminRevenueDashboard/>}/><Route path="/boost-analytics/:postId" element={<BoostAnalyticsPage/>}/><Route path="/boost-create" element={<BoostCreatePage/>}/><Route path="/rewards" element={<RewardedAdHistory/>}/><Route path="/post-analytics" element={<PostAnalyticsDashboard/>}/><Route path="/post-analytics/:postId" element={<PostAnalyticsDashboard/>}/><Route path="/verify" element={<VerificationRequestPage/>}/><Route path="/admin/verifications" element={<AdminVerificationPage/>}/><Route path="/fediverse" element={<FediversePage/>}/><Route path="/fediverse/controls" element={<FediverseParityPage/>}/>
<Route path="/fediverse/feed" element={<FediverseFeedPage/>}/>
<Route path="/fediverse/mastodon" element={<FediverseMastodonPage/>}/>
<Route path="/fediverse/inbox" element={<FediverseInboxPage/>}/>
<Route path="/fediverse/relay" element={<FediverseRelayPage/>}/>
<Route path="/fediverse/analytics" element={<FediverseAnalyticsPage/>}/>
<Route path="/fediverse/discover" element={<FediverseDiscoverPage/>}/><Route path="/fediverse/organic-discovery" element={<FederatedOrganicDiscoveryPage/>}/>
<Route path="/fediverse/identity" element={<FediverseIdentityPage/>}/><Route path="/fediverse/profile" element={<FediverseProfilePage/>}/>
<Route path="/fediverse/profile/posts" element={<FediverseProfilePostsPage/>}/>
<Route path="/fediverse/profile/threads" element={<FediverseProfileThreadsPage/>}/>
<Route path="/fediverse/profile/replies" element={<FediverseProfileRepliesPage/>}/>
<Route path="/fediverse/profile/media" element={<FediverseProfileMediaPage/>}/>
<Route path="/fediverse/profile/videos" element={<FediverseProfileVideosPage/>}/>
<Route path="/fediverse/profile/podcasts" element={<FediverseProfilePodcastsPage/>}/>
<Route path="/fediverse/profile/series" element={<FediverseProfileSeriesPage/>}/>
<Route path="/fediverse/profile/likes" element={<FediverseProfileLikesPage/>}/>
<Route path="/fediverse/profile/tips" element={<FediverseProfileTipsPage/>}/>
<Route path="/fediverse/profile/gifts" element={<FediverseProfileGiftsPage/>}/>
<Route path="/fediverse/profile/followers" element={<FediverseProfileFollowersPage/>}/>
<Route path="/fediverse/profile/following" element={<FediverseProfileFollowingPage/>}/>
<Route path="/fediverse/profile/analytics" element={<FediverseProfileAnalyticsPage/>}/><Route path="/daily-rewards" element={<DailyRewardsPage/>}/><Route path="/leaderboard" element={<LeaderboardPage/>}/><Route path="/leaderboard/challenges" element={<ChallengeLeaderboardPage/>}/><Route path="/discover" element={<DiscoverPage/>}/><Route path="/referral" element={<ReferralPage/>}/><Route path="/referrals" element={<ReferralPage/>}/><Route path="/space-recording/:id" element={<SpaceRecordingViewerPage/>}/><Route path="/spaces/:id" element={<SpaceDetailPage/>}/><Route path="/trending/:topic" element={<TrendingTopicFeedPage/>}/><Route path="/challenge/:id" element={<HashtagChallengePage/>}/><Route path="/admin/ads-review" element={<AdminAdsDashboard/>}/><Route path="/notification-preferences" element={<NotificationPreferencesPage/>}/><Route path="/wishlist" element={<WishlistPage/>}/><Route path="/marketplace" element={<MarketplacePage/>}/><Route path="/shop" element={<ShoppingMallPage/>}/><Route path="/p/:productId" element={<MarketProductPage/>}/><Route path="/polls" element={<PollsPage/>}/><Route path="/interests" element={<InterestOnboardingPage/>}/><Route path="/ad-analytics" element={<AdAnalyticsPage/>}/><Route path="/series" element={<SeriesPage/>}/><Route path="/platform-inbox" element={<PlatformInboxPage/>}/><Route path="/admin/seo" element={<SEOAuditPage/>}/><Route path="/videos/watchlater" element={<VideoWatchLaterPage/>}/><Route path="/hashtags" element={<HashtagDiscoveryPage/>}/><Route path="/podcasts/search" element={<PodcastSearchPage/>}/><Route path="/regulator" element={<RegulatorPanel/>}/>
<Route path="/regulator/employees" element={<RegulatorPanel/>}/>
<Route path="/regulator/features" element={<RegulatorPanel/>}/>
<Route path="/regulator/wallets" element={<RegulatorPanel/>}/>
<Route path="/regulator/moderation" element={<RegulatorPanel/>}/>
<Route path="/regulator/platform" element={<RegulatorPanel/>}/>
<Route path="/regulator/announce" element={<RegulatorPanel/>}/>
<Route path="/regulator/reports" element={<RegulatorPanel/>}/>
<Route path="/regulator/audit" element={<RegulatorPanel/>}/>
<Route path="/regulator/analytics" element={<RegulatorPanel/>}/><Route path="/podcasts/analytics" element={<PodcastAnalyticsPage/>}/><Route path="/team-chat" element={<TeamChatPage/>}/><Route path="/appeals" element={<AppealsPage/>}/><Route path="/leaderboard/creators" element={<CreatorLeaderboardPage/>}/><Route path="/policy" element={<ContentPolicyPage/>}/><Route path="/privacy" element={<PrivacyPolicyPage/>}/><Route path="/terms" element={<TermsOfServicePage/>}/><Route path="/sessions" element={<ActiveSessionsPage/>}/><Route path="/blocked" element={<BlockedUsersPage/>}/><Route path="/seller/:username" element={<SellerStorefrontPage/>}/><Route path="/orders" element={<OrdersPage/>}/><Route path="/story-analytics" element={<StoryAnalyticsDashboard/>}/><Route path="/admin/platform-revenue" element={<PlatformRevenueDashboard/>}/><Route path="*" element={<NotFoundPage/>}/></Routes></Suspense></main><RightSidebar/><LiveSpaceBanner/><LiveNotificationBanner/><BottomNav/><FloatingActionButton/><InterestOnboardingSheet/></div><Toaster/><Sonner position="top-center" richColors/><Analytics/></AuthProvider>}
export default function App(){return <BrowserRouter><AppInner/></BrowserRouter>}
