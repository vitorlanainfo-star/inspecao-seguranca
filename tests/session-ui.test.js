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

function chartHarness(records) {
    const canvas={hidden:false,parentElement:{style:{}},getContext:()=>({})};
    const empty={hidden:true},charts=[];
    const context={window:{unidadeValida:u=>['101','102','103'].includes(u),rotuloUnidade:u=>u==='101'?'101 — Ponte Nova':u+' — Unidade'},
        verificarVencimento:date=>Boolean(date)&&date<'2026-10-14',ocorrencias:records,chartUnidadesInstance:null,
        document:{getElementById:id=>id==='graficoUnidades'?canvas:empty},Chart:class{constructor(_,config){charts.push(config);}destroy(){}}};
    vm.runInNewContext(functionSource('resumoComparativoUnidades','function renderizarGraficosReais'),context);
    return {context,canvas,empty,charts};
}
test('unit comparison counts reports, overdue and completed separately, omitting empty units and preserving dates',()=>{
    const records=[{unitId:'101',status:'pendente'},{unitId:'101',status:'aprovado',dataConclusaoPrazo:'2026-10-13'},
        {unitId:'102',status:'concluido',dataConclusaoPrazo:'2026-10-01'},{unitId:'102',status:'aprovado',dataConclusaoPrazo:'2026-10-20'},
        {unitId:'103',status:'recusado'},{unitId:'103',status:'pendente',tipoOcorrencia:'Incidente'},{unitId:'999',status:'pendente'}];
    const h=chartHarness(records);const summary=h.context.resumoComparativoUnidades(records);
    assert.equal(summary.length,2);assert.equal(summary[0].rotulo,'101 — Ponte Nova');
    assert.deepEqual(Array.from(summary,g=>[g.unitId,g.apontamentos,g.vencidas,g.concluidas]),[['101',2,1,0],['102',2,0,1]]);
    h.context.renderizarComparativoUnidades();assert.equal(h.charts.length,1);
    assert.deepEqual(Array.from(h.charts[0].data.datasets,d=>d.label),['Apontamentos','Vencidas','Concluídas']);
    assert.equal(h.canvas.hidden,false);assert.equal(h.empty.hidden,true);assert.equal(records.length,7);
});
test('empty unit comparison shows a clear empty state instead of fourteen zero-value units',()=>{
    const h=chartHarness([]);h.context.renderizarComparativoUnidades();
    assert.equal(h.charts.length,0);assert.equal(h.canvas.hidden,true);assert.equal(h.empty.hidden,false);
});
