import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
Deno.serve(async req=>{
 try{
  const auth=req.headers.get("Authorization")||"";
  const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:auth}}});
  const {data:{user}}=await sb.auth.getUser(); if(!user) return json({error:"Authentication required"},401);
  const b=await req.json().catch(()=>({})); const method=String(b.method||"GET").toUpperCase(), path=String(b.path||"");
  if(method==="GET"){
   const {data,error}=await sb.from("rides").select("*").eq("user_id",user.id).order("created_at",{ascending:false}).limit(50);
   if(error) throw error; return json({data:{rides:data||[]}});
  }
  if(method==="POST" && path==="/api/v1/rides"){
   const p=b.payload||{};
   const required=["pickup_latitude","pickup_longitude","dropoff_latitude","dropoff_longitude","pickup_address","dropoff_address"];
   if(required.some(k=>p[k]===undefined||p[k]===null||String(p[k]).trim()==="")) return json({error:"Incomplete ride request"},400);
   const fare=Number(p.fare||0); if(!Number.isFinite(fare)||fare<=0) return json({error:"A valid fare is required"},400);
   const distance=Number(p.distance_km||0); const duration=Number(p.duration_minutes||0);
   const {data,error}=await sb.from("rides").insert({
    user_id:user.id,pickup_latitude:Number(p.pickup_latitude),pickup_longitude:Number(p.pickup_longitude),
    dropoff_latitude:Number(p.dropoff_latitude),dropoff_longitude:Number(p.dropoff_longitude),
    pickup_address:String(p.pickup_address),dropoff_address:String(p.dropoff_address),
    ride_type:String(p.ride_type||"standard"),status:"requested",fare,currency:"KES",
    distance_km:Number.isFinite(distance)&&distance>0?distance:null,
    duration_minutes:Number.isFinite(duration)&&duration>0?Math.round(duration):null
   }).select().single();
   if(error) throw error; return json({data});
  }
  return json({error:"Unsupported ride operation"},400);
 }catch(e){ return json({error:e instanceof Error?e.message:"Ride service failed"},500); }
});