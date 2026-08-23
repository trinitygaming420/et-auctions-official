import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve((req)=>{
  const result=new URL(req.url).searchParams.get("result")||"return";
  const cancelled=result==="cancel";
  return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>E&T Live</title><style>body{font-family:system-ui;background:#080a0f;color:#fff;text-align:center;padding:55px 20px}main{max-width:520px;margin:auto;background:#121722;border:1px solid #252c39;border-radius:20px;padding:30px}h1{color:#ff5b2a}a{display:block;background:#ff5b2a;color:white;text-decoration:none;font-weight:800;border-radius:12px;padding:16px;margin-top:24px}</style></head><body><main><h1>E&T Live</h1><p>${cancelled?"Setup was cancelled. You can continue it at any time.":"Stripe has returned you to E&T Live. The app will securely check whether every required step is complete."}</p><a href="etlive://financial-setup">Return to the app</a></main></body></html>`,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
});
