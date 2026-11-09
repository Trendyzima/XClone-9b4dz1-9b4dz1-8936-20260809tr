import { backendCapabilities } from '@/services/testagramCapabilityClient';
import type { NotificationEventInput, NotificationEventRecord } from '@/types/notification';
export async function emitNotification(input:NotificationEventInput):Promise<NotificationEventRecord>{
 return backendCapabilities.call<NotificationEventRecord>('testagram.notifications.create_domain',{recipient_id:input.recipientId,kind:input.eventType,actor_id:input.actorId??null,post_id:input.entityType==='post'?input.entityId??null:null,type:input.eventType,data:{...(input.payload??{}),...(input.entityType?{entity_type:input.entityType}:{}),...(input.entityId?{entity_id:input.entityId}:{})},unique_key:input.uniqueKey??null});
}
export async function getMyNotifications(limit=50){const result=await backendCapabilities.listNotifications(Math.min(Math.max(limit,1),100));return result.items;}
export const notificationService={emitNotification,getMyNotifications};
export default notificationService;
