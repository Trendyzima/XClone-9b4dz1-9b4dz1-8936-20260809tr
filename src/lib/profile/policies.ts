import type { FollowState, ProfileRelationship, TestagramProfile } from './types';

export function canViewProfile(profile: TestagramProfile, relationship?: Pick<ProfileRelationship, 'canViewProfile'>): boolean {
  if (relationship && !relationship.canViewProfile) return false;
  return profile.visibility !== 'private' || Boolean(relationship);
}

export function canFollowProfile(profile: TestagramProfile, relationship?: Pick<ProfileRelationship, 'isBlocked' | 'followState'>): boolean {
  if (relationship?.isBlocked) return false;
  return relationship?.followState !== 'following' && relationship?.followState !== 'requested';
}

export function followActionLabel(profile: TestagramProfile, state: FollowState): string {
  if (state === 'following') return 'Following';
  if (state === 'requested') return profile.visibility === 'private' ? 'Requested' : 'Following';
  if (state === 'blocked') return 'Blocked';
  return profile.visibility === 'private' ? 'Follow' : 'Follow';
}
