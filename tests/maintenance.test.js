import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const moduleSource = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const source = moduleSource.slice(moduleSource.indexOf('window.fbDecidirManutencao ='), moduleSource.indexOf('window.fbSalvarPrazo ='));
const original = { id: 123, ticket: 'T-123', status: 'aprovado', tipoOcorrencia: 'Condicao Insegura', responsavel: 'JOÃO', responsavelUid: 'responsavel-1', local: 'FÁBRICA', setor: 'SETOR', dataConclusaoPrazo: '2026-10-20', temFoto: true, desc: 'AÇÃO' };
function harness({ item = original, admin = false, profileStatus = 'approved', fail = false } = {}) {
    let record = structuredClone(item);
    const writes = [], errors = [], audits = [];
    const context = {
        window: { firebasePodeGerenciar: admin }, currentUser: { uid: 'manutencao-1' }, currentProfile: { status: profileStatus, username: 'manutencao', fullName: 'Nome diferente' },
        db: {}, ref: (_, path) => path, serverTimestamp: () => 123456,
        get: async () => ({ val: () => record, exists: () => !!record }),
        update: async (path, changes) => { if (fail) throw new Error('Permission denied'); writes.push({path, changes}); record = {...record, ...changes}; },
        registrarAuditoria: async (...args) => audits.push(args), ocorrenciasPorId: new Map(), agendarRenderFirebase() {},
        alert: error => errors.push(error), console: { error() {} }
    };
    vm.runInNewContext(source, context);
    return { context, writes, errors, audits, decide: context.window.fbDecidirManutencao, record: () => record };
}
test('maintenance accepts with authenticated username and preserves assignment, date and photos', async () => {
    const f = harness();
    assert.equal(await f.decide(123, 'aceita'), true);
    assert.equal(f.record().status, 'aprovado');
    assert.equal(f.record().manutencao.usuario, 'manutencao');
    assert.equal(f.record().manutencao.uid, 'manutencao-1');
    for (const key of Object.keys(original)) assert.equal(f.record()[key], original[key]);
    assert.deepEqual(Object.keys(f.writes[0].changes), ['manutencao']);
});
test('refusal persists status and actor atomically, without changing action fields', async () => {
    const f = harness(); await f.decide(123, 'recusada');
    assert.equal(f.writes.length, 1);
    assert.equal(f.record().status, 'recusado');
    assert.equal(f.record().manutencao.ultimaRecusa.usuario, 'manutencao');
    for (const key of Object.keys(original).filter(k => k !== 'status')) assert.equal(f.record()[key], original[key]);
    assert.equal(f.context.ocorrenciasPorId.get('123').status, 'recusado');
    assert.equal(f.audits.length, 1);
});
test('management returns refused action to approved and retains refusal identity and assignment', async () => {
    const refused = harness(); await refused.decide(123, 'recusada');
    const f = harness({item: refused.record(), admin: true});
    f.context.currentProfile.username = 'gestao';
    assert.equal(await f.decide(123, 'pendente'), true);
    assert.equal(f.record().status, 'aprovado');
    assert.equal(f.record().manutencao.decisao, 'pendente');
    assert.equal(f.record().manutencao.usuario, 'gestao');
    assert.equal(f.record().manutencao.ultimaRecusa.usuario, 'manutencao');
    assert.equal(f.record().responsavelUid, original.responsavelUid);
    assert.equal(f.record().dataConclusaoPrazo, original.dataConclusaoPrazo);
});
test('reject invalid states, unapproved accounts and unauthorized undo without writing', async () => {
    for (const setup of [{profileStatus:'pending'}, {item:{...original,status:'concluido'}}, {item:{...original,status:'pendente'}}, {item:{...original,tipoOcorrencia:'Incidente'}}]) {
        const f=harness(setup); assert.equal(await f.decide(123,'recusada'),false); assert.equal(f.writes.length,0);
    }
    const f=harness({item:{...original,status:'recusado'}});
    assert.equal(await f.decide(123,'pendente'),false); assert.equal(f.writes.length,0);
});
test('Firebase failure does not change local action or create success audit', async () => {
    const f=harness({fail:true}); assert.equal(await f.decide(123,'recusada'),false);
    assert.equal(f.record().status,'aprovado'); assert.equal(f.context.ocorrenciasPorId.size,0); assert.equal(f.audits.length,0);
});

const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules.ocorrencias.$id;
class Snapshot {
    constructor(root, path=[]) { this.root=root; this.path=path; }
    child(key) { return new Snapshot(this.root,[...this.path,...key.split('/')]); }
    parent() { return new Snapshot(this.root,this.path.slice(0,-1)); }
    val() { let value=this.root; for(const key of this.path) value=value?.[key]; return value??null; }
    exists() { return this.val()!==null; }
    hasChildren(keys) { return keys.every(key=>this.child(key).exists()); }
    isNumber() { return typeof this.val()==='number'; }
}
function evaluate(rule, previous, next, {role='user', status='approved', uid='u1',field='manutencao'}={}) {
    const old={users:{u1:{role,status,username:'login-real'}},ocorrencias:{123:previous}};
    const updated={...old,ocorrencias:{123:next}};
    return vm.runInNewContext(rule,{auth:uid?{uid}:null,now:1000,root:new Snapshot(old),data:new Snapshot(old,['ocorrencias','123',...(field?[field]:[])]),newData:new Snapshot(updated,['ocorrencias','123',...(field?[field]:[])])});
}
const rejected={...original,status:'recusado',manutencao:{decisao:'recusada',uid:'u1',usuario:'login-real',em:1000,ultimaRecusa:{uid:'u1',usuario:'login-real',em:1000}}};
test('rules allow scheduler account to refuse with real login in the same atomic write',()=>{
    assert.equal(evaluate(rules.status['.write'],original,rejected,{field:'status'}),true);
    assert.equal(evaluate(rules.manutencao['.write'],original,rejected),true);
    assert.equal(evaluate(rules.manutencao['.validate'],original,rejected),true);
    assert.equal(evaluate(rules['.validate'],original,rejected,{field:null}),true);
});
test('rules reject spoofed username, UID, stale acceptance and decisions on concluded actions',()=>{
    for(const change of [{usuario:'outra-pessoa'},{uid:'other'}]) {
        assert.equal(evaluate(rules.manutencao['.validate'],original,{...rejected,manutencao:{...rejected.manutencao,...change}}),false);
    }
    assert.equal(evaluate(rules.manutencao['.write'],{...original,status:'concluido'},rejected),false);
    const accepted={...rejected,manutencao:{decisao:'aceita',uid:'u1',usuario:'login-real',em:1000}};
    assert.equal(evaluate(rules.manutencao['.validate'],rejected,accepted),false);
    assert.equal(evaluate(rules.manutencao['.write'],original,rejected,{status:'pending'}),false);
});
test('only management can undo refusal and it must preserve the previous refusal identity',()=>{
    const next={...rejected,status:'aprovado',manutencao:{...rejected.manutencao,decisao:'pendente'}};
    assert.equal(evaluate(rules.status['.write'],rejected,next,{role:'admin',field:'status'}),true);
    assert.equal(evaluate(rules.manutencao['.validate'],rejected,next,{role:'admin'}),true);
    assert.equal(evaluate(rules.status['.write'],rejected,next,{field:'status'}),false);
    assert.equal(evaluate(rules.manutencao['.validate'],rejected,next),false);
    const forged={...next,manutencao:{...next.manutencao,ultimaRecusa:{usuario:'forjado',uid:'u1',em:1000}}};
    assert.equal(evaluate(rules.manutencao['.validate'],rejected,forged,{role:'admin'}),false);
    assert.equal(evaluate(rules['.validate'],rejected,{...rejected,status:'concluido'},{role:'admin',field:null}),false);
});
