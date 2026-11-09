import { backendCapabilities } from '@/services/testagramCapabilityClient';

export async function listThreadLikes(threadId: string, limit = 50) {
  return backendCapabilities.listThreadLikes(threadId, limit);
}

export async function getThreadLikeState(threadId: string, _userId?: string) {
  return backendCapabilities.getThreadLikeState(threadId);
}

export async function toggleThreadLike(threadId: string, _userId?: string) {
  return backendCapabilities.toggleThreadLike(threadId);
}

export async function getThreadLikeStates(threadIds: string[], _userId?: string) {
  return backendCapabilities.getThreadLikeStates(threadIds);
}
