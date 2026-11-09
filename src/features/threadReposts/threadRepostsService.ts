import { backendCapabilities } from '@/services/testagramCapabilityClient';

export async function listThreadReposts(threadId: string, limit = 50) {
  return backendCapabilities.listThreadReposts(threadId, limit);
}

export async function toggleThreadRepost(threadId: string, _userId?: string) {
  return backendCapabilities.toggleThreadRepost(threadId);
}

export async function getThreadRepostStates(threadIds: string[], _userId?: string) {
  return backendCapabilities.getThreadRepostStates(threadIds);
}

export async function getThreadRepostState(threadId: string, _userId?: string) {
  return backendCapabilities.getThreadRepostState(threadId);
}
