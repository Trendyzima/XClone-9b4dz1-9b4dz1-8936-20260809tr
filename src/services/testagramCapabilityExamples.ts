import type { TestagramCapabilityClient } from "./testagramCapabilityClient";

/**
 * Sample workflows adapted from xdevplatform/samples.
 *
 * These examples are intentionally client-side TypeScript and target the
 * native Testagram capability contract. They never use X credentials or
 * arbitrary database access.
 */
export async function sampleSearchAndCreatePost(client: TestagramCapabilityClient, query: string, body: string) {
  const search = await client.searchPosts(query, 20);
  const created = await client.createPost(body);
  return { search, created };
}

export async function sampleSocialActions(client: TestagramCapabilityClient, postId: string, userId: string) {
  const [like, repost, follow] = await Promise.all([
    client.likePost(postId),
    client.repostPost(postId),
    client.followUser(userId, true),
  ]);
  return { like, repost, follow };
}

export async function sampleDiscovery(client: TestagramCapabilityClient) {
  const [trends, capabilities] = await Promise.all([
    client.getTrends(20),
    client.listCapabilities(),
  ]);
  return { trends, capabilities };
}

export async function samplePersonalWorkspace(client: TestagramCapabilityClient, listId: string) {
  const [timeline, wallet] = await Promise.all([
    client.getListTimeline(listId, 20),
    client.getWallet(),
  ]);
  return { timeline, wallet };
}
