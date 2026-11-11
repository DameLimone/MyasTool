export default function clientConfig(req,res,dependencies={}) {
  const env=dependencies.env||process.env;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET'){res.statusCode=405;res.setHeader('Allow','GET');return res.end(JSON.stringify({error:{code:'METHOD_NOT_ALLOWED'}}));}
  const key=env.CLERK_PUBLISHABLE_KEY||env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const ready=Boolean(key&&env.CLERK_SECRET_KEY&&env.CLERK_AUTHORIZED_PARTIES);
  res.statusCode=200;
  res.end(JSON.stringify({data:{ready,clerkPublishableKey:ready?key:null,storageReady:Boolean(env.POSTGRES_URL)}}));
}
