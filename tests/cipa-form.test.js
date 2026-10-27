import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const rules=JSON.parse(fs.readFileSync(new URL('../database.rules.json',import.meta.url),'utf8')).rules;
const helpers=html.slice(html.indexOf('function sincronizarTipoOcorrencia('),html.indexOf('function unidadeSelecionadaNoPainel('));
function form(profile) {
 const ids=['tipoOcorrencia','opcaoTipoFalaCipa','camposRegistroInspecao','camposDenunciaCipa','identificacaoDenunciaCipa','btnEnviarRegistro','denunciaCipaUsuario','statusDenunciaCipaUsuario'];
 const nodes=Object.fromEntries(ids.map(id=>[id,{value:'',hidden:false,disabled:false,textContent:''}]));
 nodes.tipoOcorrencia.value='Fala CIPA';
 const c={window:{firebasePerfilAtual:profile,unidadeValida:u=>['101','102'].includes(u),rotuloUnidade:u=>'Unidade '+u},document:{getElementById:id=>nodes[id]},alert:()=>{throw Error('envio inesperado')}};
 vm.runInNewContext(helpers,c);
 return {nodes,c};
}
test('only the enabled CIPA inspection profile gets the text-only selector; regular users cannot select it',()=>{
 const p={role:'user',status:'approved',unitId:'101',falaCipa:true};
 const {nodes,c}=form(p);c.sincronizarTipoOcorrencia();
 assert.equal(nodes.opcaoTipoFalaCipa.hidden,false);assert.equal(nodes.camposRegistroInspecao.hidden,true);assert.equal(nodes.camposDenunciaCipa.hidden,false);
 assert.match(nodes.identificacaoDenunciaCipa.textContent,/CIPA 101/);
 nodes.tipoOcorrencia.value='Incidente';c.sincronizarTipoOcorrencia();
 assert.equal(nodes.camposRegistroInspecao.hidden,false);assert.equal(nodes.camposDenunciaCipa.hidden,true);
 nodes.tipoOcorrencia.value='Fala CIPA';p.falaCipa=false;c.sincronizarTipoOcorrencia();
 assert.equal(nodes.opcaoTipoFalaCipa.disabled,true);assert.equal(nodes.tipoOcorrencia.value,'Condicao Insegura');
 const textOnly=html.slice(html.indexOf('<div id="camposDenunciaCipa"'),html.indexOf('<button class="btn-primary" id="btnEnviarRegistro"'));
 assert.doesNotMatch(textOnly,/type="file"/);assert.match(textOnly,/maxlength="5000"/);
});
test('CIPA sends directly to its own unit without uploading a photo or creating an inspection; failures preserve the text',async()=>{
 const {nodes,c}=form({role:'user',status:'approved',unitId:'102',falaCipa:true});
 nodes.denunciaCipaUsuario.value='Denúncia preservada';let count=0;
 c.window.fbEnviarCipa=async message=>{count++;assert.equal(message,'Denúncia preservada');throw Error('Sem conexão');};
 await c.enviarDenunciaCipaUsuario();assert.equal(count,1);assert.equal(nodes.denunciaCipaUsuario.value,'Denúncia preservada');assert.equal(nodes.btnEnviarRegistro.disabled,false);
 c.window.fbEnviarCipa=async()=> 'PROTOCOLO';
 await c.enviarDenunciaCipaUsuario();assert.equal(nodes.denunciaCipaUsuario.value,'');assert.match(nodes.statusDenunciaCipaUsuario.textContent,/unidade 102.*PROTOCOLO/);
 const report=html.slice(html.indexOf('function usuarioReportar('),html.indexOf('function usuarioReportar(')+400);
 assert.ok(report.indexOf('return enviarDenunciaCipaUsuario()')<report.indexOf('fotosEmProcessamento'));
});
test('Firebase CIPA payload is text only, derives unit and author from login and rejects ordinary users',async()=>{
 const writes=[];const c={window:{unidadeValida:u=>u==='101'},currentUser:{uid:'u'},currentProfile:{role:'user',status:'approved',falaCipa:true,unitId:'101',fullName:'Nome real'},db:{},ref:(_,p)=>p,push:p=>({path:p,key:'p'}),set:async(r,v)=>writes.push([r,v]),serverTimestamp:()=>1000};
 vm.runInNewContext(html.slice(html.indexOf('window.fbEnviarCipa ='),html.indexOf('window.fbConverterParaCipa =')),c);
 await c.window.fbEnviarCipa('  Denúncia  ');assert.equal(writes[0][0].path,'cipa/101');
 const payload=writes[0][1];assert.equal(payload.mensagem,'Denúncia');assert.equal(payload.identificacaoCipa,'CIPA 101');assert.equal(payload.autorUid,'u');assert.equal(payload.foto,undefined);assert.equal(payload.unitId,'101');
 c.currentProfile.falaCipa=false;await assert.rejects(c.window.fbEnviarCipa('texto'),/conta CIPA/);
});
class Snap {
 constructor(value){this.value=value;} child(p){let v=this.value;for(const k of String(p).split('/'))v=v?.[k];return new Snap(v);}
 val(){return this.value??null;}exists(){return this.value!=null;}
}
test('rules allow designated CIPA only in own unit, reject ordinary/pending accounts and do not allow self-designation',()=>{
 const item={mensagem:'Texto',unitId:'101',autorUid:'u',autor:'CIPA',criadoEm:1000,status:'novo'};
 const run=(profile,unit='101',old=null)=>vm.runInNewContext(rules.cipa.$unit.$message['.write'],{auth:{uid:'u'},$unit:unit,root:new Snap({users:{u:profile}}),data:new Snap(old),newData:new Snap(item)});
 const p={role:'user',status:'approved',unitId:'101',falaCipa:true};
 assert.equal(run(p),true);assert.equal(run(p,'102'),false);assert.equal(run({...p,falaCipa:false}),false);assert.equal(run({...p,status:'pending'}),false);assert.equal(run(p,'101',item),false);
 const flag=rules.users.$uid.falaCipa['.validate'];
 const grant=role=>vm.runInNewContext(flag,{auth:{uid:'u'},root:new Snap({users:{u:{role,status:'approved'}}}),newData:new Snap(true)});
 assert.equal(grant('admin'),true);assert.equal(grant('user'),false);assert.equal(grant('cipa'),false);
});
