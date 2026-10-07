e_rate:y.frameRate,health_status:y.healthStatus,configuration_issues:y.configurationIssues}}),error:null});
  }catch(e:any){const ye=e instanceof BunnyStageError?e:new BunnyStageError("verify",e?.message||"Bunny state verification failed.");return json({ok:false,error:{code:"BUNNY_VERIFY_FAILED",message:ye.message,phase:ye.phase,http_status:ye.httpStatus,reason:ye.reason}},502)}
 }
 if(action==="stop"){
  if(!platformOwner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can stop this TV broadcast."}},403);
  if(s.bunny_broadcast_id&&bunnyReady())try{await ytTransitionComplete(s.bunny_broadcast_id)}catch{}
  await adminClient.from("tv_bunny_encoder_sessions").update({revoked_at:new Date().toISOString()}).eq("stream_id",id).is("revoked_at",null);
  const {error:e}=await adminClient.from("live_streams").update({is_live:false,ended_at:new Date().toISOString(),tv_connection_state:"offline",tv_last_heartbeat_at:null,tv_host_peer_id:null,viewer_count:0,bunny_status:"stopped",bunny_error:null}).eq("id",id).eq("user_id",s.user_id);
  if(e)return json({ok:false,error:{code:"TV_STOP_FAILED",message:"Could not stop this TV broadcast."}},409);
  return json({ok:true,data:await contract("host"),error:null});
 }
 if(action==="heartbeat"){
  if(!platformOwner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can send a TV heartbeat."}},403);
  if(!s.is_live)return json({ok:false,error:{code:"STREAM_NOT_LIVE",message:"Broadcast is not live."}},409);
  const state=["starting","connected","degraded","stale"].includes(b.connection_state)?b.connection_state:"degraded",count=Math.max(0,Math.min(100000,Number(b.viewer_count)||0)),peer=typeof b.peer_id==="string"&&b.peer_id.length<=128?b.peer_id:"";
  const now=new Date().toISOString();
  const {error:e}=await adminClient.from("live_streams").update({tv_last_heartbeat_at:now,tv_connection_state:state,tv_host_peer_id:peer||null,viewer_count:count}).eq("id",id).eq("user_id",s.user_id).eq("is_live",true);
  if(e)return json({ok:false,error:{code:"TV_HEARTBEAT_FAILED",message:"Could not update TV broadcast health."}},409);
  try{await upsertFirebaseLiveMetadata(id,{status:state,is_live:true,viewer_count:count,last_heartbeat_at:now,provider:"bunny"});}catch(e:any){return json({ok:false,error:{code:"FIREBASE_METADATA_FAILED",message:e?.message||"Firebase metadata store is unavailable."}},503)}
  return json({ok:true,data:{heartbeat_ok:true,connection_state:state,viewer_count:count},error:null});
 }
 if(action==="guest-control-list"){
  if(!platformOwner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can manage TV guests."}},403);
  const now=new Date().toISOString();
  const {data:rows,error:e}=await adminClient.from("tv_guest_invites").select("id,slot_number,expires_at,claimed_by,claimed_at,muted,blocked,used_at").eq("stream_id",id).gt("expires_at",now).order("slot_number",{ascending:true});
  if(e)return json({ok:false,error:{code:"GUEST_CONTROL_LIST_FAILED",message:"Could not load TV guest slots."}},409);
  return json({ok:true,data:{capacity:6,slots:(rows||[]).map((g:any)=>({id:g.id,slot:Number(g.slot_number),label:"Guest "+Number(g.slot_number),status:g.used_at?"connected":"invited",expires_at:g.expires_at,claimed_by:g.claimed_by??null,muted:Boolean(g.muted),blocked:Boolean(g.blocked)}))},error:null});
 }
 if(action==="guest-control"){
  if(!platformOwner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can control TV guests."}},403);
  const slot=Number(b.guest_slot||0),control=typeof b.control==="string"?b.control:"";
  if(!Number.isInteger(slot)||slot<1||slot>6)return json({ok:false,error:{code:"GUEST_SLOT_INVALID",message:"Guest slot must be between 1 and 6."}},400);
  if(!["mute","unmute","block","unblock"].includes(control))return json({ok:false,error:{code:"GUEST_CONTROL_INVALID",message:"Unsupported guest control."}},400);
  const {data:g,error:ge}=await adminClient.from("tv_guest_invites").select("id,slot_number,expires_at,used_at").eq("stream_id",id).eq("slot_number",slot).gt("expires_at",new Date().toISOString()).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(ge||!g)return json({ok:false,error:{code:"GUEST_SLOT_NOT_FOUND",message:"That guest slot is not currently allocated."}},404);
  const patch=control==="mute"?{muted:true}:control==="unmute"?{muted:false}:control==="block"?{blocked:true}: {blocked:false};
  const {error:ue}=await adminClient.from("tv_guest_invites").update(patch).eq("id",g.id);
  if(ue)return json({ok:false,error:{code:"GUEST_CONTROL_FAILED",message:"Could not update the guest control state."}},409);
  return json({ok:true,data:{slot,control,...patch},error:null});
 }
 if(action==="create-guest"){
  if(!platformOwner)return json({ok:false,error:{code:"HOST_REQUIRED",message:"Only the broadcaster can create a guest invite."}},403);
  const now=new Date().toISOString();
  const {data:activeInvites,error:listError}=await adminClient.from("tv_guest_invites").select("slot_number").eq("stream_id",id).gt("expires_at",now);
  if(listError)return json({ok:false,error:{code:"GUEST_CAPACITY_LOOKUP_FAILED",message:"Could not check guest slot capacity."}},409);
  const usedSlots=new Set((activeInvites||[]).map((row:any)=>Number(row.slot_number)).filter((slot:number)=>Number.isInteger(slot)&&slot>=1&&slot<=6));
  const slot=Array.from({length:6},(_,index)=>index+1).find(candidate=>!usedSlots.has(candidate));
  if(!slot)return json({ok:false,error:{code:"GUEST_CAPACITY_REACHED",message:"All six Testagram TV guest multiview slots are occupied."}},409);
  const t=randomToken(),expiresAt=new Date(Date.now()+3600000).toISOString();
  const {error:e}=await adminClient.from("tv_guest_invites").insert({stream_id:id,slot_number:slot,token_hash:await hash(t),expires_at:expiresAt});
  if(e)return json({ok:false,error:{code:"GUEST_INVITE_FAILED",message:"Could not create the guest invite."}},409);
  return json({ok:true,data:{invite_token:t,room_id:id,guest_slot:slot,guest_label:"Guest "+slot,expires_at:expiresAt,signaling_topic:"tv:"+id,ice_servers:await ice()},error:null});
 }
 if(action==="guest"){
  if(!invite)return json({ok:false,error:{code:"INVITE_REQUIRED",message:"A TV guest invite is required."}},401);
  if(!user)return json({ok:false,error:{code:"AUTH_REQUIRED",message:"Authentication is required to join the TV guest session."}},401);
  if(!secret)return json({ok:false,error:{code:"TV_CONTROL_MISCONFIGURED",message:"TV guest claiming requires the Supabase server secret."}},503);
  const now=new Date().toISOString();
  const {data:inviteRow,error:ie}=await adminClient.from("tv_guest_invites").select("id,slot_number,blocked,muted").eq("stream_id",id).eq("token_hash",await hash(invite)).is("used_at",null).gt("expires_at",now).maybeSingle();
  if(ie||!inviteRow)return json({ok:false,error:{code:"INVITE_INVALID",message:"This TV guest invite is invalid, expired, or already claimed."}},401);
  if(Boolean(inviteRow.blocked))return json({ok:false,error:{code:"GUEST_BLOCKED",message:"This guest slot has been blocked by the studio."}},403);
  const {data:claimed,error:e}=await adminClient.from("tv_guest_invites").update({used_at:now,claimed_by:user.id,claimed_at:now}).eq("id",inviteRow.id).is("used_at",null).select("id,slot_number,blocked,muted").maybeSingle();
  if(e||!claimed)return json({ok:false,error:{code:"INVITE_INVALID",message:"This TV guest invite is invalid, expired, or already claimed."}},401);
  return json({ok:true,data:{...(await contract("guest")),guest_token:invite,guest_slot:Number(claimed.slot_number||0),guest_label:"Guest "+Number(claimed.slot_number||0),muted:Boolean(claimed.muted),blocked:Boolean(claimed.blocked)},error:null});
 }
 if((action==="viewer"||action==="guest")&&platformOwner&&!s.is_live)return json({ok:true,data:await contract(action==="guest"?"guest":"host",{preview:true,on_air:false}),error:null});
 if(!s.is_live)return json({ok:false,error:{code:"STREAM_ENDED",message:"Broadcast is no longer live."}},409);
 return json({ok:true,data:await contract(action==="viewer"?"viewer":"unknown"),error:null});
});