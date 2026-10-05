import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../r2-maintenance.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf("document.getElementById('migrate').onclick="),html.indexOf('</script>'));
function fixture({concurrent=false,corrupt=false}={}){
 const original='data:image/jpeg;base64,/9j/2Q==',photos={'fotos/123/foto':original},button={},messages=[],removed=[];
 const records={123:{desc:'Preservar',ticket:9}};
 const context={document:{getElementById:()=>button},action:fn=>fn(),backedUp:true,db:{},ref:(_,path)=>path,say:text=>messages.push(text),
 get:async path=>({val:()=>path==='ocorrencias'?records:photos[path]??null}),
 onValue:(path,callback)=>{callback({val:()=>photos[path]??null});return()=>{};},
 runTransaction:async(path,fn)=>{const next=fn(photos[path]??null);if(next===undefined)return{committed:false};photos[path]=next;return{committed:true};},
 storage:{enabled:true,upload:async()=>{if(concurrent)photos['fotos/123/foto']='updated';return{storage:'r2',key:'key'};},read:async()=>corrupt?'corrupt':original,remove:async(_,__,value)=>removed.push(value.key)}};
 vm.runInNewContext(source,context);return{run:button.onclick,original,photos,messages,removed,records};
}
test('migration preserves image bytes and occurrence metadata',async()=>{const f=fixture();await f.run();assert.equal(f.photos['fotos/123/foto'].storage,'r2');assert.equal(f.records[123].desc,'Preservar');assert.match(f.messages.at(-1),/1 fotos/);});
test('migration does not overwrite concurrently edited photo',async()=>{const f=fixture({concurrent:true});await f.run();assert.equal(f.photos['fotos/123/foto'],'updated');assert.deepEqual(f.removed,['key']);assert.match(f.messages.at(-1),/0 fotos/);});
test('verification failure restores original reference before surfacing error',async()=>{const f=fixture({corrupt:true});await assert.rejects(f.run(),/Verificação/);assert.equal(f.photos['fotos/123/foto'],f.original);});
