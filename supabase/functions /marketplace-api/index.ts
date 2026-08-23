import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Content-Type":"application/json"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const stripeKey=Deno.env.get("STRIPE_SECRET_KEY")||"";
const shippoKey=Deno.env.get("SHIPPO_API_TOKEN")||"";
const base=Deno.env.get("SUPABASE_URL")||"";
const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const sb=createClient(base,service);
const returnUrl=`${base}/functions/v1/marketplace-return`;

function requireStripe(){if(!stripeKey||!stripeKey.startsWith("sk_"))throw new Error("Stripe is not configured. Add STRIPE_SECRET_KEY in Supabase Edge Function Secrets, then redeploy marketplace-api.");}

async function stripe(path:string,method="GET",values?:Record<string,string>){
  const response=await fetch(`https://api.stripe.com/v1/${path}`,{method,headers:{Authorization:`Bearer ${stripeKey}`,...(values?{"Content-Type":"application/x-www-form-urlencoded"}:{})},body:values?new URLSearchParams(values):undefined});
  const data=await response.json(); if(!response.ok)throw new Error(data?.error?.message||"Stripe request failed"); return data;
}
async function shippo(path:string,method="POST",body?:unknown){
  const response=await fetch(`https://api.goshippo.com/${path}`,{method,headers:{Authorization:`ShippoToken ${shippoKey}`,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
  const data=await response.json(); if(!response.ok)throw new Error(data?.detail||data?.message||"Shippo request failed"); return data;
}
async function currentUser(req:Request){
  const token=(req.headers.get("Authorization")||"").replace("Bearer ","");
  const {data,error}=await sb.auth.getUser(token); if(error||!data.user)throw new Error("Sign in required"); return data.user;
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  try{
    const user=await currentUser(req); const body=await req.json(); const action=body.action;
    const {data:profile,error:profileError}=await sb.from("profiles").select("*").eq("id",user.id).single();
    if(profileError)throw new Error("Profile was not found");

    if(action==="connect_onboarding"){
      requireStripe();
      if(!profile.seller_approved)throw new Error("Seller approval required");
      let account=profile.stripe_account_id;
      if(account){try{await stripe(`accounts/${account}`)}catch(error){if(String(error).toLowerCase().includes("no such account"))account=null;else throw error}}
      if(!account){const created=await stripe("accounts","POST",{type:"express",country:"US",email:user.email||"","capabilities[card_payments][requested]":"true","capabilities[transfers][requested]":"true","business_profile[product_description]":"Live online auctions of consumer products","metadata[user_id]":user.id});account=created.id;const{error:updateError}=await sb.from("profiles").update({stripe_account_id:account,stripe_onboarding_complete:false,payouts_enabled:false}).eq("id",user.id);if(updateError)throw new Error("Could not save the Stripe account");}
      const link=await stripe("account_links","POST",{account,refresh_url:`${returnUrl}?result=refresh`,return_url:`${returnUrl}?result=success`,type:"account_onboarding","collection_options[fields]":"eventually_due"});
      return json({url:link.url});
    }
    if(action==="connect_status"){
      requireStripe();
      if(!profile.stripe_account_id)return json({complete:false,detailsSubmitted:false,chargesEnabled:false,payoutsEnabled:false,currentlyDue:[],errors:[],disabledReason:null});
      const account=await stripe(`accounts/${profile.stripe_account_id}`);
      const detailsSubmitted=!!account.details_submitted,chargesEnabled=!!account.charges_enabled,payoutsEnabled=!!account.payouts_enabled;
      const currentlyDue=account.requirements?.currently_due||[],errors=account.requirements?.errors||[],disabledReason=account.requirements?.disabled_reason||null;
      const complete=detailsSubmitted&&chargesEnabled&&payoutsEnabled&&currentlyDue.length===0;
      await sb.from("profiles").update({stripe_onboarding_complete:complete,payouts_enabled:payoutsEnabled}).eq("id",user.id);
      return json({complete,detailsSubmitted,chargesEnabled,payoutsEnabled,currentlyDue,errors,disabledReason});
    }
    if(action==="create_checkout"){
      const {data:order,error}=await sb.from("orders").select("*,products(*),buyer:profiles!orders_buyer_id_fkey(shipping_address),seller:profiles!orders_seller_id_fkey(shipping_address,stripe_account_id)").eq("id",body.orderId).eq("buyer_id",user.id).single();
      if(error||!order)throw new Error("Order not found"); if(!order.buyer?.shipping_address||!order.seller?.shipping_address)throw new Error("Buyer and seller shipping addresses are required");
      const p=order.products; const shipment=await shippo("shipments/","POST",{address_from:{...order.seller.shipping_address,country:"US"},address_to:{...order.buyer.shipping_address,country:"US"},parcels:[{length:String(p.length_in),width:String(p.width_in),height:String(p.height_in),distance_unit:"in",weight:String(p.weight_oz),mass_unit:"oz"}],async:false});
      const rates=(shipment.rates||[]).filter((r:any)=>r.amount).sort((a:any,b:any)=>Number(a.amount)-Number(b.amount)); if(!rates[0])throw new Error("No shipping rate was available");
      const shipping=Number(rates[0].amount),subtotal=Number(order.subtotal||order.total),total=subtotal+shipping;
      const session=await stripe("checkout/sessions","POST",{mode:"payment",success_url:`${returnUrl}?result=success`,cancel_url:`${returnUrl}?result=cancel`,customer_email:user.email||"","line_items[0][price_data][currency]":"usd","line_items[0][price_data][product_data][name]":p.title,"line_items[0][price_data][unit_amount]":String(Math.round(subtotal*100)),"line_items[0][quantity]":"1","line_items[1][price_data][currency]":"usd","line_items[1][price_data][product_data][name]":"Shipping","line_items[1][price_data][unit_amount]":String(Math.round(shipping*100)),"line_items[1][quantity]":"1","metadata[order_id]":order.id});
      await sb.from("orders").update({subtotal,shipping_total:shipping,total,shippo_shipment_id:shipment.object_id,shippo_rate_id:rates[0].object_id,stripe_checkout_session_id:session.id,payment_method:"stripe"}).eq("id",order.id);
      return json({url:session.url,shipping,total});
    }
    if(action==="verify_checkout"){
      const {data:order}=await sb.from("orders").select("*").eq("id",body.orderId).eq("buyer_id",user.id).single(); if(!order?.stripe_checkout_session_id)throw new Error("Checkout has not started");
      const session=await stripe(`checkout/sessions/${order.stripe_checkout_session_id}`); if(session.payment_status==="paid")await sb.from("orders").update({status:"paid",paid_at:new Date().toISOString()}).eq("id",order.id);
      return json({paid:session.payment_status==="paid"});
    }
    if(action==="buy_label"){
      const {data:order}=await sb.from("orders").select("*").eq("id",body.orderId).eq("seller_id",user.id).single(); if(!order||!["paid","packed"].includes(order.status))throw new Error("Paid order not found"); if(!order.shippo_rate_id)throw new Error("Shipping rate not found");
      const tx=await shippo("transactions/","POST",{rate:order.shippo_rate_id,label_file_type:"PDF",async:false}); if(tx.status!=="SUCCESS")throw new Error((tx.messages||[]).map((m:any)=>m.text).join(", ")||"Label purchase failed");
      await sb.from("orders").update({status:"shipped",shipping_label_url:tx.label_url,tracking_number:tx.tracking_number,shipping_carrier:tx.rate?.provider||"Carrier",shipped_at:new Date().toISOString()}).eq("id",order.id);
      return json({labelUrl:tx.label_url,trackingNumber:tx.tracking_number});
    }
    return json({error:"Unknown action"},400);
  }catch(error){return json({error:error instanceof Error?error.message:"Unknown error"},400);}
});
