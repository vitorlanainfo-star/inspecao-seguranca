import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const html = read('index.html');
const module = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const unitsSource = read('units.js');
const units = { window: {} }; vm.runInNewContext(unitsSource, units);
const rules = JSON.parse(read('database.rules.json')).rules;
class Snapshot {
    constructor(root, path = []) { this.root = root; this.path = path; }
    child(key) { return new Snapshot(this.root, [...this.path, ...String(key).split('/')]); }
    parent() { return new Snapshot(this.root, this.path.slice(0, -1)); }
    val() { let value = this.root; for (const key of this.path) value = value?.[key]; return value ?? null; }
    exists() { return this.val() !== null; }
    isString() { return typeof this.val() === 'string'; }
    isNumber() { return typeof this.val() === 'number'; }
    hasChildren(keys) { return keys.every(key => this.child(key).exists()); }
}
function rule(expression, {profile = {role:'user',status:'approved',unitId:'101'}, item = {unitId:'101'}, next = item, path = ['ocorrencias','123'], query = {}, auth = {uid:'u1'}} = {}) {
    const old = {users:{u1:profile},ocorrencias:{123:item}};
    const updated = {...old,ocorrencias:{123:next}};
    return !!vm.runInNewContext(expression.replaceAll('.matches(', '.match('), {auth, query, $id:'123', now:1000, root:new Snapshot(old),data:new Snapshot(old,path),newData:new Snapshot(updated,path)});
}
test('all fourteen requested units are present, with distinct Rio Novo and CD Rio Novo', () => {
    assert.equal(Object.keys(units.window.inspecaoUnidades).length,14);
    assert.equal(units.window.rotuloUnidade('101'),'101 — Ponte Nova');
    assert.equal(units.window.rotuloUnidade('111'),'111 — Rio Novo');
    assert.equal(units.window.rotuloUnidade('112'),'112 — CD Rio Novo');
    assert.equal(units.window.unidadeValida('109'),false);
    assert.equal(units.window.unidadeDaFabrica(' queijo ',[{nome:'QUEIJO',unitId:'101'},{nome:'QUEIJO',unitId:'102'}]),'');
});
test('whole database reads and foreign-unit queries are blocked; own indexed query and admin view are allowed', () => {
    assert.equal(rule(rules.ocorrencias['.read']),false);
    assert.equal(rule(rules.ocorrencias['.read'],{query:{orderByChild:'unitId',equalTo:'101'}}),true);
    assert.equal(rule(rules.ocorrencias['.read'],{query:{orderByChild:'unitId',equalTo:'102'}}),false);
    assert.equal(rule(rules.ocorrencias['.read'],{profile:{role:'admin',status:'approved'}}),true);
    assert.equal(rule(rules.ocorrencias['.read'],{profile:{role:'user',status:'approved'},query:{orderByChild:'unitId',equalTo:null}}),false);
});
test('direct records and photos require the same unit, including legacy records and revoked accounts', () => {
    for (const expr of [rules.ocorrencias.$id['.read'],rules.fotos.$id['.read']]) {
        assert.equal(rule(expr),true);
        assert.equal(rule(expr,{item:{unitId:'102'}}),false);
        assert.equal(rule(expr,{item:{}}),false);
        assert.equal(rule(expr,{auth:null}),false);
        assert.equal(rule(expr,{profile:{role:'user',status:'pending',unitId:'101'}}),false);
        assert.equal(rule(expr,{profile:{role:'admin',status:'approved'},item:{}}),true);
    }
});
test('unit checks cover every child write grant, preventing bypass through dates, history, status or decisions', () => {
    const item={unitId:'102',status:'aprovado',responsavelUid:'u1',tipoOcorrencia:'Condicao Insegura'};
    const next={...item,status:'recusado',dataConclusaoPrazo:'2026-10-20',manutencao:{decisao:'recusada',uid:'u1'}};
    for (const field of ['dataConclusaoPrazo','historicoAlteracoes','manutencao','status']) {
        assert.equal(rule(rules.ocorrencias.$id[field]['.write'],{item,next,path:['ocorrencias','123',field]}),false,field);
    }
});
test('new occurrences cannot claim another unit or omit their unit', () => {
    const item={id:123,ticket:'P1',status:'pendente',createdByUid:'u1',local:'FABRICA',setor:'SETOR',desc:'TESTE',unitId:'101'};
    const expr=rules.ocorrencias.$id['.write'];
    assert.equal(rule(expr,{item:null,next:item}),true);
    assert.equal(rule(expr,{item:null,next:{...item,unitId:'102'}}),false);
    assert.equal(rule(expr,{item:null,next:{...item,unitId:null}}),false);
    assert.equal(rule(expr,{item:null,next:item,profile:{role:'user',status:'approved'}}),false);
});
test('matching names resolve only within the assigned unit', () => {
    const source=module.slice(module.indexOf('function encontrarContaResponsavelPorNome'),module.indexOf('function vincularResponsavelLegado'));
    const context={window:{}}; vm.runInNewContext(source,context);
    const profiles={a:{fullName:'Carlos Silva',status:'approved',unitId:'101'},b:{fullName:'Carlos Silva',status:'approved',unitId:'102'}};
    assert.equal(context.window.encontrarContaResponsavelPorNome('Carlos',profiles,'101'),'a');
    assert.equal(context.window.encontrarContaResponsavelPorNome('Carlos',profiles,'102'),'b');
    assert.equal(context.window.encontrarContaResponsavelPorNome('Carlos',profiles,'103'),null);
});
test('global unit access can be granted and revoked without granting administrator privileges', () => {
    const global={role:'user',status:'approved',unitId:'101',allUnits:true};
    assert.equal(rule(rules.ocorrencias['.read'],{profile:global}),true);
    assert.equal(rule(rules.ocorrencias.$id['.read'],{profile:global,item:{unitId:'102'}}),true);
    assert.equal(rule(rules.fotos.$id['.read'],{profile:global,item:{unitId:'102'}}),true);
    assert.equal(rule(rules.ocorrencias.$id['.read'],{profile:{...global,allUnits:false},item:{unitId:'102'}}),false);
    assert.equal(rule(rules.ocorrencias['.read'],{profile:{...global,status:'rejected'}}),false);
    assert.equal(rule(rules.config.setores['.write'],{profile:global}),false);
    const record={id:123,ticket:'P1',status:'pendente',createdByUid:'u1',local:'FABRICA',setor:'SETOR',desc:'TESTE',unitId:'102'};
    assert.equal(rule(rules.ocorrencias.$id['.write'],{profile:global,item:null,next:record}),true);
    assert.equal(rule(rules.ocorrencias.$id['.write'],{profile:global,item:null,next:{...record,createdByUid:'other'}}),false);
    assert.equal(rule(rules.ocorrencias.$id.unitId['.validate'],{profile:global,item:{unitId:'102'},next:{unitId:'103'},path:['ocorrencias','123','unitId']}),false);
    assert.equal(rule(rules.ocorrencias.$id.unitId['.validate'],{profile:global,item:{unitId:'102'},next:{unitId:'101'},path:['ocorrencias','123','unitId']}),false);
});
test('ordinary users cannot grant themselves global access, including during signup', () => {
    const expression=rules.users.$uid.allUnits['.validate'];
    const target={item:{unitId:true},path:['ocorrencias','123','unitId']};
    assert.equal(rule(expression,target),false);
    assert.equal(rule(expression,{...target,profile:{role:'user',status:'approved',allUnits:true}}),false);
    assert.equal(rule(expression,{...target,profile:{role:'admin',status:'approved'}}),true);
    assert.equal(rule(expression,{...target,profile:{role:'admin',status:'rejected'}}),false);
});
test('photo stamps use the record unit or selected factory, never a fixed unit or another open form', () => {
    const source=html.slice(html.indexOf('function unidadeParaFoto('),html.indexOf('async function comprimirFotoInput('));
    const context={window:units.window,ocorrencias:[{id:123,unitId:'103'}],listaSetoresCadastrados:[{nome:'MUTUM',unitId:'102'}],document:{getElementById:()=>({value:'MUTUM'})}};
    vm.runInNewContext(source,context);
    assert.equal(context.unidadeParaFoto('fotoUsuario'),'102');
    assert.equal(context.unidadeParaFoto('resolver-foto-123'),'103');
    assert.equal(context.unidadeParaFoto('fotoSubstituir-999'),'');
    assert.ok(!html.includes('ctx.fillText(`UNIDADE 101'));
});
test('factory binding uses latest transaction data, preserves photos/dates, ignores unrelated records and can retry failures', async () => {
    const source=module.slice(module.indexOf('window.fbVincularCadastroUnidade ='),module.indexOf('window.fbSalvarGestores ='));
    const record={id:123,local:'QUEIJO',ticket:'P3',unitId:'102',responsavel:'ANA',dataConclusaoPrazo:'2026-11-01',temFoto:true,versoesFotoCache:{foto:'keep'},status:'aprovado'};
    const calls=[],alerts=[];
    const context={window:{firebasePodeGerenciar:true,...units.window},listaSetoresCadastrados:[],listaGestores:[{nome:'ANA',unitId:'101'}],userProfiles:{},ocorrenciasRef:'ocorrencias',db:{},ref:(_,path)=>path,
        get:async path=>({val:()=>path==='config/setores'?{0:{nome:'QUEIJO',responsavel:'ANA'}}:{123:record,124:{local:'OUTRA'}}}),
        update:async(path,changes)=>calls.push(['config',path,changes]),
        runTransaction:async(path,fn)=>{const changed=fn({...record,desc:'EDIÇÃO CONCORRENTE'});calls.push(['record',path,changed]);return {committed:true};},
        encontrarContaResponsavelPorNome:()=> 'ana-101',registrarAuditoria:async()=>{},alert:m=>alerts.push(m)};
    vm.runInNewContext(source,context);
    await context.window.fbVincularCadastroUnidade('fabrica','QUEIJO','101');
    assert.equal(calls.length,2);const saved=calls[1][2];
    assert.equal(saved.unitId,'101');assert.equal(saved.desc,'EDIÇÃO CONCORRENTE');assert.equal(saved.responsavelUid,'ana-101');
    for(const field of ['ticket','temFoto','dataConclusaoPrazo','versoesFotoCache']) assert.deepEqual(saved[field],record[field]);
    context.runTransaction=async()=>{throw Error('rede indisponível');};
    await context.window.fbVincularCadastroUnidade('fabrica','QUEIJO','101');
    assert.match(alerts.at(-1),/Vínculo incompleto/);
});
test('all occurrence listeners and initial loading share the scoped query; preview contains the same implementation', () => {
    const source=module.slice(module.indexOf('function iniciarListenersDadosAprovados()'),module.indexOf('window.alterarSenhaConta'));
    const calls=[];
    const context={window:{firebasePodeGerenciar:false,unidadeValida:()=>true},currentProfile:{unitId:'101',role:'user'},currentUser:{uid:'u1'},stopCoreDataListeners:[],ocorrenciasRef:'ocorrencias',atualizarStatusCarregamentoOcorrencias(){},aplicarOcorrenciaRemota(){},db:{},ref:(_,path)=>path,
        orderByChild:field=>field,equalTo:value=>value,query:(...args)=>args,
        onChildAdded:q=>{calls.push(q);return ()=>{};},onChildChanged:q=>{calls.push(q);return ()=>{};},onChildRemoved:q=>{calls.push(q);return ()=>{};},onValue:()=>()=>{},get:q=>{calls.push(q);return Promise.resolve({exists:()=>false});},console};
    vm.runInNewContext(source,context);context.iniciarListenersDadosAprovados();
    assert.equal(calls.length,4);for(const q of calls) assert.deepEqual(Array.from(q),['ocorrencias','unitId','101']);
    assert.equal(read('r2-preview/index.html'),html);
    assert.equal(read('r2-preview/units.js'),unitsSource);
});
