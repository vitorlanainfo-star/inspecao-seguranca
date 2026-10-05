import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const rules=JSON.parse(readFileSync(new URL('../database.rules.json',import.meta.url),'utf8')).rules;
class Snapshot{constructor(root,path=[]){this.root=root;this.path=path;}child(key){return new Snapshot(this.root,[...this.path,...String(key).split('/')]);}parent(){return new Snapshot(this.root,this.path.slice(0,-1));}val(){let v=this.root;for(const key of this.path)v=v?.[key];return v??null;}exists(){return this.val()!==null;}hasChildren(keys){return keys.every(key=>this.child(key).exists());}}
function allowed({uid='u1',status='approved',owner='u1',previous=null,photo={storage:'r2',key:'photos/123/foto/x.jpg'}}={}){const old={users:{u1:{status,role:'user'}}},next={...old,ocorrencias:{123:{createdByUid:owner,status:'pendente'}},fotos:{123:{foto:photo}}};if(previous!==null)old.fotos={123:{foto:previous}};return vm.runInNewContext(rules.fotos.$id.foto['.write'],{auth:uid?{uid}:null,$id:'123',root:new Snapshot(old),data:new Snapshot(old,['fotos','123','foto']),newData:new Snapshot(next,['fotos','123','foto'])});}
test('approved creator can atomically create occurrence and initial R2 photo',()=>assert.equal(allowed(),true));
test('photo publication still rejects missing login, pending users and other creators',()=>{assert.equal(allowed({uid:null}),false);assert.equal(allowed({status:'pending'}),false);assert.equal(allowed({owner:'other'}),false);});
test('ordinary user cannot overwrite or delete an existing initial photo',()=>{assert.equal(allowed({previous:'legacy'}),false);assert.equal(allowed({photo:null}),false);});
