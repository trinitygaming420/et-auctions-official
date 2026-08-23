import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { AccessToken } from "npm:livekit-server-sdk@2.15.0";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  try{
    const {roomName,participantName,canPublish=false}=await req.json();
    if(!roomName||!participantName) throw new Error("roomName and participantName are required");
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(roomName)) throw new Error("Invalid room name");
    const apiKey=Deno.env.get("LIVEKIT_API_KEY"),secret=Deno.env.get("LIVEKIT_API_SECRET"),serverUrl=Deno.env.get("LIVEKIT_URL");
    if(!apiKey||!secret||!serverUrl) throw new Error("LiveKit secrets are not configured");
    const token=new AccessToken(apiKey,secret,{identity:String(participantName).slice(0,80),ttl:"2h"});
    token.addGrant({roomJoin:true,room:roomName,canPublish:Boolean(canPublish),canSubscribe:true,canPublishData:true});
    return new Response(JSON.stringify({token:await token.toJwt(),serverUrl}),{headers:{...cors,"Content-Type":"application/json"}});
  }catch(error){return new Response(JSON.stringify({error:error.message}),{status:400,headers:{...cors,"Content-Type":"application/json"}})}
});
