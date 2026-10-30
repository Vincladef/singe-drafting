// Neon may serve a cached get-session response for token(). Never treat a session cookie as a JWT.
export interface AuthSource{getSession:(options?:any)=>Promise<any>;token:(options?:any)=>Promise<any>;}
function freshJwt(value:unknown,now=Date.now()):value is string{
 if(typeof value!=='string'||value.split('.').length!==3)return false;
 try{const p=JSON.parse(atob(value.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));return typeof p.exp==='number'&&p.exp*1000>now+30000;}catch{return false;}
}
export function tokenFromResponse(result:any,now=Date.now()):string|null{for(const value of [result?.data?.token,result?.data?.session?.token])if(freshJwt(value,now))return value;return null;}
export async function sessionToken(auth:AuthSource,refresh=false):Promise<string|null>{
 const options=refresh?{fetchOptions:{headers:{'X-Force-Fetch':'true'}}}:undefined;
 const session=await auth.getSession(options),cached=tokenFromResponse(session);if(cached)return cached;
 return tokenFromResponse(await auth.token({fetchOptions:{headers:{'X-Force-Fetch':'true'}}}));
}
