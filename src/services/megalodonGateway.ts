import { invokeBackendFunction } from '@/services/backendClient';

export type MegalodonAction =
  | 'detect'
  | 'register_app'
  | 'instance'
  | 'verify'
  | 'account'
  | 'status'
  | 'public_timeline'
  | 'home_timeline'
  | 'search'
  | 'post'
  | 'favourite'
  | 'unfavourite'
  | 'reblog'
  | 'unreblog'
  | 'follow'
  | 'unfollow';

export interface MegalodonRequest {
  [key: string]: unknown;
  action: MegalodonAction;
  instance: string;
  accessToken?: string;
  accountId?: string;
  statusId?: string;
  query?: string;
  type?: 'accounts' | 'statuses' | 'hashtags';
  limit?: number;
  redirectUri?: string;
  scopes?: string;
  status?: string;
  visibility?: 'public' | 'unlisted' | 'private' | 'direct';
  sensitive?: boolean;
  spoilerText?: string;
  inReplyToId?: string;
}

export interface MegalodonResponse<T = unknown> {
  ok: true;
  user_id: string;
  provider: string;
  instance?: unknown;
  account?: T;
  status?: T;
  statuses?: T[];
  result?: T;
  relationship?: T;
}

export async function megalodonGateway<T = unknown>(request: MegalodonRequest): Promise<MegalodonResponse<T>> {
  const instance = request.instance.trim().replace(/\/$/, '');
  if (!instance) throw new Error('Fediverse instance is required');
  if (!/^https:\/\//i.test(instance)) throw new Error('Fediverse instance must use HTTPS');

  return invokeBackendFunction<MegalodonResponse<T>, MegalodonRequest>('megalodon-gateway', {
    ...request,
    instance,
  });
}

export const megalodonGatewayService = {
  detect: (instance: string) => megalodonGateway({ action: 'detect', instance }),
  registerApp: (instance: string, redirectUri?: string) => megalodonGateway({ action: 'register_app', instance, redirectUri }),
  getInstance: (instance: string) => megalodonGateway({ action: 'instance', instance }),
  verify: (instance: string, accessToken: string) => megalodonGateway({ action: 'verify', instance, accessToken }),
  getAccount: (instance: string, accountId: string, accessToken?: string) => megalodonGateway({ action: 'account', instance, accountId, accessToken }),
  getStatus: (instance: string, statusId: string, accessToken?: string) => megalodonGateway({ action: 'status', instance, statusId, accessToken }),
  getPublicTimeline: (instance: string, limit = 20, accessToken?: string) => megalodonGateway({ action: 'public_timeline', instance, limit, accessToken }),
  getHomeTimeline: (instance: string, accessToken: string, limit = 20) => megalodonGateway({ action: 'home_timeline', instance, accessToken, limit }),
  search: (instance: string, query: string, type: MegalodonRequest['type'] = 'statuses', accessToken?: string) => megalodonGateway({ action: 'search', instance, query, type, accessToken }),
  post: (instance: string, accessToken: string, status: string, options: Pick<MegalodonRequest, 'visibility' | 'sensitive' | 'spoilerText' | 'inReplyToId'> = {}) => megalodonGateway({ action: 'post', instance, accessToken, status, ...options }),
  favourite: (instance: string, accessToken: string, statusId: string) => megalodonGateway({ action: 'favourite', instance, accessToken, statusId }),
  unfavourite: (instance: string, accessToken: string, statusId: string) => megalodonGateway({ action: 'unfavourite', instance, accessToken, statusId }),
  reblog: (instance: string, accessToken: string, statusId: string) => megalodonGateway({ action: 'reblog', instance, accessToken, statusId }),
  unreblog: (instance: string, accessToken: string, statusId: string) => megalodonGateway({ action: 'unreblog', instance, accessToken, statusId }),
  follow: (instance: string, accessToken: string, accountId: string) => megalodonGateway({ action: 'follow', instance, accessToken, accountId }),
  unfollow: (instance: string, accessToken: string, accountId: string) => megalodonGateway({ action: 'unfollow', instance, accessToken, accountId }),
};

export default megalodonGatewayService;
