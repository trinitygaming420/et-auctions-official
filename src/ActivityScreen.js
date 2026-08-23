import React,{useCallback,useEffect,useState}from"react";
import{ScrollView,Text,View}from"react-native";
import{money,supabase}from"./config";
import{Empty,Header,s}from"./ui";
export default function ActivityScreen({profile,user}){
 const[orders,setOrders]=useState([]);
 const load=useCallback(async()=>{const{data}=await supabase.from("orders").select("id,total,status,payout_status,created_at,products(title)").or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`).order("created_at",{ascending:false}).limit(30);setOrders(data||[])},[user.id]);
 useEffect(()=>{load();const ch=supabase.channel(`activity-${user.id}`).on("postgres_changes",{event:"*",schema:"public",table:"orders"},load).subscribe();return()=>supabase.removeChannel(ch)},[load,user.id]);
 return <ScrollView contentContainerStyle={s.page}><Header title="ACTIVITY" subtitle="Orders and marketplace updates" profile={profile}/><Text style={s.section}>Recent activity</Text>{!orders.length&&<Empty icon="🔔" title="No activity yet" subtitle="Bids, orders and shipping updates appear here."/>}{orders.map(o=><View key={o.id} style={s.activity}><Text style={{fontSize:25}}>📦</Text><View style={{flex:1}}><Text style={s.title}>{o.products?.title||"Marketplace order"}</Text><Text style={s.muted}>{o.status} · Payout {o.payout_status||"held"}</Text></View><Text style={s.price}>{money(o.total)}</Text></View>)}</ScrollView>;
}
