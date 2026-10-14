import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function functionSource(name, next) {
    const start = html.indexOf('function ' + name + '(');
    return html.slice(html.lastIndexOf('async ', start) === start - 6 ? start - 6 : start, html.indexOf(next, start));
}
function element(value = '') {
    const classes = new Set(['active']);
    return { value, innerHTML:'dados da conta anterior', hidden:false, style:{},
        classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)} };
}
test('switching from admin to unit or all-unit user clears private panels and restores the submission page', () => {
    const nodes = Object.fromEntries(['aba-gestor','aba-usuario','painelContasAcesso','listaCadastrosPendentes','listaAuditoriaAcesso','listaVinculosUnidades'].map(id=>[id,element()]));
    const context={window:{firebasePodeGerenciar:true}, document:{getElementById:id=>nodes[id]}};
    vm.runInNewContext(functionSource('sincronizarInterfaceAdministrativa','function solicitarAcessoGestor'),context);
    context.sincronizarInterfaceAdministrativa();
    assert.equal(nodes['aba-gestor'].hidden,false);
    context.window.firebasePodeGerenciar=false;
    context.window.firebasePerfilAtual={unitId:'102',allUnits:true,role:'user'};
    context.sincronizarInterfaceAdministrativa();
    assert.equal(nodes['aba-gestor'].hidden,true);
    assert.equal(nodes['aba-gestor'].style.display,'none');
    assert.equal(nodes['aba-gestor'].classList.contains('active'),false);
    assert.equal(nodes['aba-usuario'].classList.contains('active'),true);
    assert.equal(nodes.painelContasAcesso.hidden,true);
    for(const id of ['listaCadastrosPendentes','listaAuditoriaAcesso','listaVinculosUnidades']) assert.equal(nodes[id].innerHTML,'');
});
function factoryHarness({admin=true,reject=false}={}) {
    const fields={novoSetorNome:element('QUEIJO'),novoSetorResponsavel:element('ANA'),novoSetorUnidade:element('102')};
    const alerts=[],writes=[];
    const context={window:{firebasePodeGerenciar:admin,unidadeValida:u=>u==='102',fbSalvarSetores:async v=>{writes.push(v);if(reject)throw new Error('permission_denied');}},
        document:{getElementById:id=>fields[id]},listaGestores:[{nome:'ANA',unitId:'102'}],listaSetoresCadastrados:[],alert:m=>alerts.push(m),renderizarTelas(){}};
    vm.runInNewContext(functionSource('cadastrarSetor','function removerSetor'),context);
    return {context,alerts,writes,fields};
}
test('a non-admin cannot create factories even by calling the form handler directly',async()=>{
    const h=factoryHarness({admin:false}); await h.context.cadastrarSetor();
    assert.equal(h.writes.length,0);assert.equal(h.context.listaSetoresCadastrados.length,0);assert.match(h.alerts[0],/administrador/);
});
test('rejected factory writes preserve the form and never report success or add a phantom factory',async()=>{
    const h=factoryHarness({reject:true}); await h.context.cadastrarSetor();
    assert.equal(h.context.listaSetoresCadastrados.length,0);assert.equal(h.fields.novoSetorNome.value,'QUEIJO');
    assert.equal(h.alerts.length,1);assert.match(h.alerts[0],/Não foi possível salvar/);
});
test('confirmed factory writes keep the selected unit and responsible',async()=>{
    const h=factoryHarness();await h.context.cadastrarSetor();
    assert.equal(h.context.listaSetoresCadastrados[0].unitId,'102');assert.equal(h.context.listaSetoresCadastrados[0].responsavel,'ANA');
    assert.equal(h.fields.novoSetorNome.value,'');assert.match(h.alerts[0],/sucesso/);
});
test('factory labels show the unit without changing stored factory names',()=>{
    const context={window:{unidadeValida:u=>u==='102',unidadeDaFabrica:()=> '102'},listaSetoresCadastrados:[]};
    vm.runInNewContext(functionSource('rotuloFabrica','function sincronizarInterfaceAdministrativa'),context);
    assert.equal(context.rotuloFabrica('QUEIJO'),'QUEIJO — Unidade 102');
    assert.equal(context.rotuloFabrica('QUEIJO',''),'QUEIJO');
});

test('admin unit views isolate all statuses and factory lists without mutating the complete data',()=>{
    const nodes={'aba-gestor':element(),'filtroUnidadeGestao':element('102'),'filtroUnidadeVisualizacao':element('101')};
    const records=[{id:1,unitId:'101',status:'pendente'},{id:2,unitId:'102',status:'pendente'},{id:3,unitId:'102',tipoOcorrencia:'Incidente'}];
    const context={window:{firebasePodeGerenciar:true,unidadeValida:u=>['101','102'].includes(u)},document:{getElementById:id=>nodes[id]},ocorrencias:records};
    vm.runInNewContext(functionSource('unidadeSelecionadaNoPainel','function mudarUnidadeDoPainel'),context);
    assert.deepEqual(Array.from(context.ocorrenciasDaVisualizacao(),r=>r.id),[2,3]);
    const factories=[{nome:'QUEIJO',unitId:'101'},{nome:'ABACAXI',unitId:'102'}];
    assert.deepEqual(Array.from(context.dadosDaUnidadeSelecionada(factories),f=>f.nome),['ABACAXI']);
    assert.equal(records.length,3);assert.equal(factories.length,2);
    nodes['filtroUnidadeGestao'].value='todos';assert.equal(context.ocorrenciasDaVisualizacao(),records);
    nodes['aba-gestor'].classList.remove('active');
    assert.deepEqual(Array.from(context.ocorrenciasDaVisualizacao(),r=>r.id),[1]);
    context.window.firebasePodeGerenciar=false;
    assert.equal(context.ocorrenciasDaVisualizacao(),records,'common users retain the server-scoped collection rather than admin filters');
});
