import React,{useCallback,useEffect,useState}from"react";
import{SafeAreaView,StatusBar,Text,Pressable,View}from"react-native";
import{StatusBar as ExpoStatusBar}from"expo-status-bar";
import{colors as C,supabase}from"./src/config";
import{s}from"./src/ui";
import AuthScreen from"./src/AuthScreen";
import HomeScreen from"./src/HomeScreen";
import SellScreen from"./src/SellScreen";
import ActivityScreen from"./src/ActivityScreen";
import AccountScreen from"./src/AccountScreen";

export default function App(){
 const[session,setSession]=useState(null),[profile,setProfile]=useState(null),[tab,setTab]=useState("Home"),[loading,setLoading]=useState(true),[notice,setNotice]=useState("");
 const loadProfile=useCallback(async user=>{if(!user)return setProfile(null);const{data}=await supabase.from("profiles").select("*").eq("id",user.id).maybeSingle();setProfile(data||{id:user.id,display_name:user.email?.split("@")[0],role:"buyer",seller_approved:false})},[]);
 useEffect(()=>{supabase.auth.getSession().then(({data})=>{setSession(data.session);loadProfile(data.session?.user).finally(()=>setLoading(false))});const{data:listener}=supabase.auth.onAuthStateChange((_event,next)=>{setSession(next);loadProfile(next?.user)});return()=>listener.subscription.unsubscribe()},[loadProfile]);
 const flash=text=>{setNotice(text);setTimeout(()=>setNotice(""),2600)};
 if(loading)return <View style={s.center}><Text style={s.text}>Loading E&T Live…</Text></View>;
 if(!session)return <AuthScreen/>;
 const props={profile,user:session.user,flash};
 return <SafeAreaView style={s.safe}><StatusBar barStyle="light-content"/><ExpoStatusBar style="light"/><View style={{flex:1}}>{tab==="Home"&&<HomeScreen {...props}/>} {tab==="Sell"&&<SellScreen {...props}/>} {tab==="Activity"&&<ActivityScreen {...props}/>} {tab==="Account"&&<AccountScreen {...props} setProfile={setProfile}/>}</View><View style={s.nav}>{["Home","Sell","Activity","Account"].map((name,index)=><Pressable key={name} onPress={()=>setTab(name)} style={s.navItem}><Text style={[s.navIcon,tab===name&&{color:C.orange}]}>{["⌂","＋","●","☺"][index]}</Text><Text style={[s.navText,tab===name&&{color:C.orange}]}>{name}</Text></Pressable>)}</View>{!!notice&&<View style={s.toast}><Text style={s.toastText}>✓ {notice}</Text></View>}</SafeAreaView>;
}
