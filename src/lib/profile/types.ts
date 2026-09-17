export type ProfileAccountType = 'personal' | 'creator' | 'business' | 'organization';

export type ProfileVisibility = 'public' | 'followers' | 'private';

export type FollowState = 'none' | 'requested' | 'following' | 'blocked';

export type MuteSettings = {
  posts: boolean;
  stories: boolean;
  notifications: boolean;
  notes: boolean;
  live: boolean;
};

export type TestagramProfile = {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  bio: string | null;
  websiteUrl: string | null;
  location: string | null;
  socialLinks: Record<string, string>;
  pronouns: string | null;
  accountType: ProfileAccountType;
  visibility: ProfileVisibility;
  isVerified: boolean;
  verifiedTier: string | null;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ProfileRelationship = {
  followState: FollowState;
  isBlocked: boolean;
  isMuted: boolean;
  mute: MuteSettings;
  isCloseFriend: boolean;
  canMessage: boolean;
  canViewProfile: boolean;
};
