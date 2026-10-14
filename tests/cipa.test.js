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
test('CIPA sees only its own panel, clears old admin details and comments; ordinary users never see CIPA',()=>{
 const node=()=>({hidden:false,style:{},innerHTML:'privado',textContent:'',replaceChildren(){this.innerHTML='';},classList:{add(){},remove(){}}});
 const ids=['aba-cipa','aba-usuario','aba-gestor','painelContasAcesso','controleUnidadeVisualizacao','listaGestorCipa','unidadeFalaCipa','modalDetalhe','modalZoomImg','modalLoginGestor','modalGraficoLocal','conteudoDetalheModal'];
 const nodes=Object.fromEntries(ids.map(id=>[id,node()]));
 const c={window:{firebasePodeGerenciar:false,firebasePerfilAtual:{role:'cipa',status:'approved',unitId:'102'},rotuloUnidade:u=>'Unidade '+u},document:{getElementById:id=>nodes[id]}};
 const start=html.indexOf('function sincronizarInterfaceAdministrativa('),end=html.indexOf('function solicitarAcessoGestor(',start);
 vm.runInNewContext(html.slice(start,end),c); c.sincronizarInterfaceAdministrativa();
 assert.equal(nodes['aba-cipa'].style.display,'block');assert.equal(nodes['aba-usuario'].style.display,'none');assert.equal(nodes['aba-gestor'].style.display,'none');
 assert.equal(nodes.modalDetalhe.style.display,'none');assert.equal(nodes.conteudoDetalheModal.innerHTML,'');assert.equal(nodes.unidadeFalaCipa.textContent,'Unidade 102');
 c.window.firebasePerfilAtual.role='user';c.sincronizarInterfaceAdministrativa();
 assert.equal(nodes['aba-cipa'].style.display,'none');assert.equal(nodes['aba-usuario'].hidden,false);
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
test('only an approved administrator can preserve a CIPA tombstone for an existing action',()=>{
 const old={id:123,unitId:'101',status:'aprovado',local:'UHT',setor:'Produção',desc:'Original',ticket:'A-123'};
 const next={id:123,unitId:'101',status:'cipa',tipoOcorrencia:'Fala CIPA',temFoto:true};
 const expression=rules.ocorrencias.$id['.validate'];
 const run=(role,item)=>vm.runInNewContext(expression,{auth:{uid:'u'},root:new Snap({users:{u:{role,status:'approved'}}}),data:new Snap(old),newData:new Snap(item)});
 assert.equal(run('admin',next),true);assert.equal(run('user',next),false);assert.equal(run('cipa',next),false);assert.equal(run('admin',{...next,unitId:'102'}),false);
});
test('Excel reads permitted configuration children and never the restricted configuration root',()=>{
 const part=html.slice(html.indexOf('window.fbPrepararArquivoExcel ='),html.indexOf('async function carregarFotoNoElemento'));
 assert.match(part,/get\(ref\(db,'config\/gestores'\)\)/);assert.match(part,/get\(ref\(db,'config\/setores'\)\)/);assert.doesNotMatch(part,/get\(ref\(db,\s*'config'\)\)/);
});
test('management navigation activates the CIPA tab and renders its unit controls',()=>{
 const buttons=Array.from({length:11},()=>({active:false,classList:{remove(){},add(){buttons[10].active=true;}}}));
 const content={active:false,classList:{add(){content.active=true;}}};let rendered=0;
 const start=html.indexOf('function mudarSubAba('),end=html.indexOf('function normalizarChaveDuplicado(',start);
 const c={document:{querySelectorAll:selector=>selector==='.sub-tab-btn'?buttons:[],getElementById:id=>{assert.equal(id,'sub-aba-cipa');return content;}},renderizarGestorCipa:()=>rendered++};
 vm.runInNewContext(html.slice(start,end),c);c.mudarSubAba('cipa');assert.equal(content.active,true);assert.equal(buttons[10].active,true);assert.equal(rendered,1);
});
test('CIPA assignments allow only the recipient query, responses and status updates; no foreign-unit access or editing the original comment',()=>{
 const u=rules.cipa.$unit,m=u.$message;
 const tree={users:{u:{role:'user',status:'approved',unitId:'101',fullName:'Usuário'},v:{role:'user',status:'approved',unitId:'102'}},cipa:{101:{m:{unitId:'101',mensagem:'Original',responsavelUid:'u',status:'encaminhado',respostas:{}}}}};
 const response={uid:'u',autor:'Usuário',tipo:'devolver',comentario:'Resolvido, conferir',em:1000};
 const run=(expr,path=[],newValue=null,uid='u',q={orderByChild:'responsavelUid',equalTo:'u'})=>vm.runInNewContext(expr,{auth:{uid},$unit:'101',query:q,root:new Snap(tree),data:new Snap(tree,path),newData:new Snap(newValue),now:1000});
 assert.equal(run(u['.read']),true);assert.equal(run(u['.read'],[],null,'v'),false);assert.equal(run(u['.read'],[],null,'u',{}),false);
 assert.equal(run(m['.read'],['cipa','101','m']),true);assert.equal(run(m['.read'],['cipa','101','m'],null,'v'),false);
 assert.equal(run(m['.write'],['cipa','101','m'],tree.cipa[101].m),false);
 assert.equal(run(m.status['.write'],['cipa','101','m','status'],'devolvido'),true);assert.equal(run(m.status['.write'],['cipa','101','m','status'],'concluido'),false);
 assert.equal(run(m.respostas.$resposta['.write'],['cipa','101','m','respostas','new'],response),true);
 assert.equal(run(m.respostas.$resposta['.validate'],[],response),true);
 assert.equal(run(m.respostas.$resposta['.validate'],[],{...response,uid:'v'}),false);
 tree.cipa[101].m.status='concluido';assert.equal(run(m.status['.write'],['cipa','101','m','status'],'devolvido'),false);
});
test('administrator forwards, recipient accepts and returns, then administrator concludes without losing original data',async()=>{
 const fala={mensagem:'Sugestão',unitId:'101',autorUid:'c',autor:'CIPA',criadoEm:1000,status:'novo',registroOriginal:{extra:'Preservado'}};
 const tree={cipa:{101:{m:fala}}};let seq=0;
 const context={window:{firebasePodeGerenciar:true,unidadeValida:()=>true},currentUser:{uid:'a'},currentProfile:{role:'admin',status:'approved',fullName:'Admin'},userProfiles:{u:{role:'user',status:'approved',unitId:'101',fullName:'Usuário'}},db:{},ref:(_,p='')=>p,get:async p=>new Snap(tree,p.split('/')),push:p=>({key:'r'+(++seq)}),serverTimestamp:()=>1000,registrarAuditoria:async()=>{},runTransaction:async(p,fn)=>{const old=new Snap(tree,p.split('/')).val(),v=fn(old);if(v===undefined)return {committed:false};tree.cipa[101].m=v;return{committed:true};},update:async(_,updates)=>{for(const [p,v]of Object.entries(updates)){let t=tree;let parts=p.split('/');for(const k of parts.slice(0,-1))t=t[k]??={};t[parts.at(-1)]=v;}},Date};
 const start=html.indexOf('window.fbEncaminharCipa ='),end=html.indexOf('window.fbLerFotoCipa =',start);vm.runInNewContext(html.slice(start,end),context);
 await context.window.fbEncaminharCipa('101','m','u');assert.equal(tree.cipa[101].m.status,'encaminhado');
 context.currentUser.uid='u';context.currentProfile={role:'user',status:'approved',fullName:'Usuário'};context.window.firebasePodeGerenciar=false;
 await context.window.fbResponderCipa('101','m','aceitar','');assert.equal(tree.cipa[101].m.status,'em_atendimento');
 await context.window.fbResponderCipa('101','m','devolver','Correção feita');assert.equal(tree.cipa[101].m.status,'devolvido');assert.equal(Object.keys(tree.cipa[101].m.respostas).length,2);
 await assert.rejects(context.window.fbConcluirCipa('101','m','Feito'),/administrador/);
 context.currentUser.uid='a';context.currentProfile={role:'admin',fullName:'Admin'};context.window.firebasePodeGerenciar=true;
 await context.window.fbConcluirCipa('101','m','Conferido e concluído');assert.equal(tree.cipa[101].m.status,'concluido');assert.equal(tree.cipa[101].m.conclusao.descricao,'Conferido e concluído');assert.equal(tree.cipa[101].m.registroOriginal.extra,'Preservado');assert.equal(Object.keys(tree.cipa[101].m.respostas).length,2);
});
