import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../cloudflare/worker.js';
import {createPhotoStorage} from '../photo-storage.js';
const jpeg=new Uint8Array([255,216,1,255,217]);
const origin='https://app.example';
const oldKey='photos/123/foto/00000000-0000-4000-8000-000000000000.jpg';
const unitKey='units/101/'+oldKey;
function fixture({unit='101',admin=false,dedicated='',routes={},reference={storage:'r2',key:oldKey},remoteStatus=201,remoteDescriptor={storage:'r2',key:unitKey,storageUnit:'101',unitId:'101'}}={}) {
 const calls=[];
 const env={ALLOWED_ORIGIN:origin,FIREBASE_DATABASE_URL:'https://db.example',FIREBASE_API_KEY:'key',UNIT_GATEWAYS:JSON.stringify(routes),PHOTO_UNIT_ID:dedicated,
 PHOTOS:{put:async(k,b,meta)=>calls.push(['put',k,meta]),get:async k=>{calls.push(['get',k]);return {body:jpeg};},delete:async k=>calls.push(['delete',k])}};
 const fetchImpl=async(input,options)=>{
  const url=String(input);
  if(url.includes('identitytoolkit')) return Response.json({users:[{localId:'u1'}]});
  if(url.includes('/users/u1.json'))return Response.json({status:'approved',role:admin?'admin':'user',unitId:unit});
  if(url.includes('/fotos/123/foto.json'))return Response.json(reference);
  calls.push(['remote',url,options]);
  if(remoteStatus!==201)return Response.json({error:'destino indisponível'},{status:remoteStatus});
  return Response.json(remoteDescriptor,{status:options.method==='GET'?200:201});
 };
 const handle=createHandler(fetchImpl);
 const send=(method='POST',query='unit=101')=>handle(new Request('https://gateway.workers.dev/photos/123/foto?'+query,{method,headers:{Origin:origin,Authorization:'Bearer token','Content-Type':'image/jpeg'},...(method==='POST'?{body:jpeg}:{})}),env);
 return {send,calls};
}
test('unit without its own destination stores in shared R2 under unit prefix',async()=>{
 const f=fixture({unit:'112'});const r=await f.send('POST','unit=112');const d=await r.json();
 assert.equal(r.status,201);assert.equal(d.storageUnit,'shared');assert.match(d.key,/^units\/112\/photos\/123\/foto\//);assert.equal(f.calls[0][0],'put');
});
test('configured destination forwards streaming upload and Firebase identity only to trusted worker',async()=>{
 const f=fixture({routes:{101:'https://ponte.workers.dev'}});const r=await f.send();assert.equal(r.status,201);
 assert.equal(f.calls.length,1);const [,url,options]=f.calls[0];assert.equal(url,'https://ponte.workers.dev/photos/123/foto?unit=101');assert.equal(options.headers.Authorization,'Bearer token');assert.equal(options.headers.Origin,origin);assert.equal(options.redirect,'manual');assert.ok(options.body);
});
test('a user cannot select a different unit; dedicated service rejects even admin requests for another unit',async()=>{
 const f=fixture();assert.equal((await f.send('POST','unit=102')).status,403);assert.equal(f.calls.length,0);
 const a=fixture({admin:true,dedicated:'101'});assert.equal((await a.send('POST','unit=102')).status,403);assert.equal(a.calls.length,0);
});
test('dedicated worker publishes its physical destination and unit identity',async()=>{
 const f=fixture({dedicated:'101'});const d=await (await f.send()).json();assert.equal(d.storageUnit,'101');assert.equal(d.unitId,'101');assert.equal(f.calls[0][2].customMetadata.unitId,'101');
});
test('photos already stored in shared R2 stay there after routing new uploads elsewhere',async()=>{
 const f=fixture({routes:{101:'https://ponte.workers.dev'}});assert.equal((await f.send('GET','key='+encodeURIComponent(oldKey))).status,200);assert.deepEqual(f.calls,[['get',oldKey]]);
});
test('missing or failed remote destination does not silently send data to shared storage',async()=>{
 const missing=fixture({reference:{storage:'r2',storageUnit:'101',key:unitKey}});assert.equal((await missing.send('GET','storage=101&key='+encodeURIComponent(unitKey))).status,503);assert.equal(missing.calls.length,0);
 const failed=fixture({routes:{101:'https://ponte.workers.dev'},remoteStatus:503});assert.equal((await failed.send()).status,503);assert.ok(!failed.calls.some(c=>c[0]==='put'));
});
test('remote reads require the exact published destination and key',async()=>{
 const f=fixture({routes:{101:'https://ponte.workers.dev'},reference:{storage:'r2',key:unitKey,storageUnit:'101'}});
 assert.equal((await f.send('GET','storage=101&key='+encodeURIComponent(unitKey))).status,200);
 const bad=fixture({routes:{101:'https://ponte.workers.dev'}});assert.equal((await bad.send('GET','storage=101&key='+encodeURIComponent(unitKey))).status,404);assert.equal(bad.calls.length,0);
});
test('route URLs cannot redirect credentials to arbitrary domains or the gateway itself',async()=>{
 for(const endpoint of ['http://ponte.workers.dev','https://evil.example','https://gateway.workers.dev','https://a.workers.dev/path']) {
 const f=fixture({routes:{101:endpoint}});assert.equal((await f.send()).status,503);assert.equal(f.calls.length,0);
 }
});
test('misconfigured remote worker cannot publish a descriptor for the wrong physical bucket',async()=>{
 const f=fixture({routes:{101:'https://ponte.workers.dev'},remoteDescriptor:{storage:'r2',key:unitKey,storageUnit:'shared',unitId:'101'}});
 assert.equal((await f.send()).status,503);assert.ok(!f.calls.some(c=>c[0]==='put'));
});
test('client includes unit on uploads and saved physical destination on reads and removals',async()=>{
 const urls=[];const store=createPhotoStorage({apiUrl:'https://gateway.workers.dev',getUser:()=>({getIdToken:async()=> 'token'}),fetchImpl:async(url,options)=>{urls.push(url);return options.method==='POST'?Response.json({storage:'r2',key:unitKey,storageUnit:'101'}):new Response(jpeg);}});
 const d=await store.upload(123,'foto','data:image/jpeg;base64,'+btoa(String.fromCharCode(...jpeg)),'101');await store.read(123,'foto',d);await store.remove(123,'foto',d);
 assert.match(urls[0],/\?unit=101$/);assert.match(urls[1],/&storage=101$/);assert.match(urls[2],/&storage=101$/);
});
