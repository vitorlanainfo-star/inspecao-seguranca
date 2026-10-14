import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const rules=JSON.parse(fs.readFileSync(new URL('../database.rules.json',import.meta.url),'utf8')).rules;
class Snap {
 constructor(tree,path=[]){this.tree=tree;this.path=path;}
 child(key){return new Snap(this.tree,[...this.path,...String(key).split('/')]);}
 parent(){return new Snap(this.tree,this.path.slice(0,-1));}
 val(){let v=this.tree;for(const k of this.path)v=v?.[k];return v??null;}
 exists(){return this.val()!==null;} isString(){return typeof this.val()==='string';} isNumber(){return typeof this.val()==='number';}
 hasChildren(names){return names.every(n=>this.child(n).exists());}
}
function evalRule(expression,role='cipa',unit='101',newItem={},oldItem=null){
 const tree={users:{u:{role,status:'approved',unitId:unit,allUnits:true,fullName:'CIPA 101'}},ocorrencias:{123:{unitId:'101',status:'pendente'}},cipa:{101:{m:oldItem}}};
 const next=structuredClone(tree);next.cipa[101].m=newItem;
 return !!vm.runInNewContext(expression,{auth:{uid:'u'},$unit:'101',$message:'m',$id:'123',query:{orderByChild:'unitId',equalTo:'101'},now:1000,root:new Snap(tree),data:new Snap(tree,['cipa','101','m']),newData:new Snap(next,['cipa','101','m'])});
}
test('CIPA cannot read or write any occurrence, photo, or configuration grant even with allUnits',()=>{
 function visit(node){for(const [k,v] of Object.entries(node)){if(k==='.read'||k==='.write') assert.equal(evalRule(v),false);else if(v&&typeof v==='object')visit(v);}}
 visit(rules.ocorrencias);visit(rules.fotos);visit(rules.config);
 assert.equal(evalRule(rules.cipa['.read']),false);
 assert.equal(evalRule(rules.cipa['.read'],'admin'),true);
});
test('CIPA writes only new comments in its own unit; ordinary users, edits and forged conversion payloads fail',()=>{
 const item={mensagem:'Sugestão',unitId:'101',autorUid:'u',autor:'CIPA 101',criadoEm:1000,status:'novo'};
 const rule=rules.cipa.$unit.$message['.write'];
 assert.equal(evalRule(rule,'cipa','101',item),true);
 assert.equal(evalRule(rule,'cipa','102',item),false);
 assert.equal(evalRule(rule,'user','101',item),false);
 assert.equal(evalRule(rule,'cipa','101',item,item),false);
 assert.equal(evalRule(rule,'cipa','101',{...item,registroOriginal:{id:123}}),false);
 assert.equal(evalRule(rule,'cipa','101',{...item,autorUid:'another'}),false);
});
test('action to CIPA and back preserves ID, unit, photos, original metadata and conversion history atomically',async()=>{
 const action={id:123,ticket:'P123',unitId:'101',local:'UHT',setor:'ENVASE',desc:'Relato',status:'concluido',temFoto:true,temFotoConclusao:true,dataConclusaoReal:'2026-10-14',historicoAlteracoes:['Preservar'],extra:{campo:7}};
 const tree={ocorrencias:{123:structuredClone(action)},cipa:{},fotos:{123:{foto:{storage:'r2',key:'antes'},fotoConclusao:{storage:'r2',key:'depois'}}}};
 const updates=[];
 const c={window:{firebasePodeGerenciar:true,unidadeValida:u=>u==='101',unidadeDaFabrica:()=> '101'},db:{},currentUser:{uid:'admin'},currentProfile:{},userProfiles:{},listaSetoresCadastrados:[],camposFoto:['foto','fotoConclusao'],document:{getElementById:()=>null},ref:(_,path='')=>path,
 get:async path=>new Snap(tree,path.split('/')),update:async(_,changes)=>{updates.push(changes);for(const [path,value] of Object.entries(changes)){const p=path.split('/');let target=tree;for(const k of p.slice(0,-1))target=target[k]??={};if(value===null)delete target[p.at(-1)];else target[p.at(-1)]=value;}},registrarAuditoria:async()=>{},Date};
 vm.runInNewContext(html.slice(html.indexOf('window.fbDefinirPerfilConta ='),html.indexOf('onAuthStateChanged(auth, async user')),c);
 await c.window.fbConverterParaCipa(123);
 assert.equal(updates.length,1);assert.equal(tree.ocorrencias[123].status,'cipa');assert.equal(tree.ocorrencias[123].desc,undefined);
 assert.equal(tree.cipa[101].acao_123.registroOriginal.extra.campo,7);
 await c.window.fbConverterCipaParaAcao('101','acao_123','UHT','ENVASE');
 assert.equal(updates.length,2);assert.equal(tree.ocorrencias[123].status,'pendente');assert.equal(tree.ocorrencias[123].id,123);
 assert.equal(tree.ocorrencias[123].unitId,'101');assert.equal(tree.ocorrencias[123].temFotoConclusao,true);
 assert.equal(tree.ocorrencias[123].historicoAlteracoes[0],'Preservar');assert.equal(tree.ocorrencias[123].historicoConversoes.length,2);
 assert.equal(tree.fotos[123].foto.key,'antes');assert.equal(tree.fotos[123].fotoConclusao.key,'depois');assert.equal(tree.cipa[101].acao_123,undefined);
 c.window.firebasePodeGerenciar=false;await assert.rejects(c.window.fbConverterParaCipa(123),/administrador/);
});
