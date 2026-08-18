export default async (_request: Request, context: any) => {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('javascript')) return response;

  let js = await response.text();

  js = js.replace(
    "if (!response.ok) throw new Error(body.error || t(`Pilot cloud request failed (${response.status}).`,`试用云端请求失败（${response.status}）。`)); return body;",
    "if (!response.ok) throw new Error('['+resource+'] '+(body.error || t(`Pilot cloud request failed (${response.status}).`,`试用云端请求失败（${response.status}）。`))); return body;"
  );

  js += `\n;(function(){\n  async function registerPilotRoster(){\n    try{\n      if(!window.PilotCloud?.enabled)return;\n      const user=await window.PilotCloud.ready();\n      const token=user?.token?.access_token||await user.jwt();\n      if(!token)return;\n      const response=await fetch('/.netlify/functions/pilot-roster',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:'{}'});\n      if(!response.ok)console.warn('Pilot roster registration returned',response.status);\n    }catch(error){console.warn('Pilot roster registration skipped',error);}\n  }\n  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',registerPilotRoster,{once:true});else registerPilotRoster();\n})();\n`;

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store');
  return new Response(js, { status: response.status, statusText: response.statusText, headers });
};
