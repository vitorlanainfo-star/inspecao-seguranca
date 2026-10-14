import test from 'node:test';
import assert from 'node:assert/strict';
import {prepararArquivo,resumirArquivo,criarArquivoExcel} from '../excel-archive.js';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const lista=[
 {id:1,ticket:'P1',unitId:'101',local:'UHT',setor:'B',status:'pendente',dataCriacao:'14/10/2026'},
 {id:2,ticket:'P2',unitId:'102',local:'UHT',setor:'A',status:'concluido',dataCriacao:'2026-10-14',temFoto:true,temFotoConclusao:true,extra:{preservar:true}},
 {id:3,ticket:'P3',unitId:'101',local:'UHT',setor:'A',status:'aprovado',dataCriacao:'2025-10-14',dataConclusaoPrazo:'2026-10-01'},
 {id:4,ticket:'P4',unitId:'101',local:'UHT',setor:'A',status:'recusado',dataCriacao:'2026-10-14'}];
test('archive separates equal factory names across units, years, and sectors without dropping refused records',()=>{
 assert.deepEqual(prepararArquivo(lista,{unidade:'101',ano:'2026'}).map(x=>x.id),[4,1]);
 const groups=resumirArquivo(lista,'2026-10-14');
 assert.equal(groups.reduce((n,g)=>n+g.total,0),4);
 assert.equal(groups.reduce((n,g)=>n+g.pendentes,0),2);
 assert.equal(groups.reduce((n,g)=>n+g.concluidas,0),1);
 assert.equal(groups.reduce((n,g)=>n+g.recusadas,0),1);
 assert.equal(groups.reduce((n,g)=>n+g.vencidas,0),1);
 assert.equal(lista[0].id,1);
});
test('real Excel round trip preserves both embedded photos, original fields, summary and literal formula-like text',async()=>{
 const ExcelJS=require('exceljs');
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=';
 const records=prepararArquivo(lista.map(x=>({...x,desc:'=HYPERLINK("bad")'})));
 const result=await criarArquivoExcel({ExcelJS,registros:records,lerFoto:async item=>item.id===2?png:null,validar:()=>{},configuracao:{fabricas:[{nome:'UHT',unitId:'102'}]},contexto:'Teste de exportação'});
 assert.equal(result.fotos,2);
 const buffer=await result.workbook.xlsx.writeBuffer();
 const reopened=new ExcelJS.Workbook(); await reopened.xlsx.load(buffer);
 assert.equal(reopened.getWorksheet('Registros').rowCount,5);
 assert.equal(reopened.getWorksheet('Registros').getImages().length,2);
 assert.equal(reopened.getWorksheet('Resumo').getCell('B4').value,4);
 assert.equal(reopened.getWorksheet('Registros').getCell('I2').value,'=HYPERLINK("bad")');
 assert.ok(reopened.getWorksheet('Dados originais').getRows(2,5).some(r=>String(r.getCell(4).value).includes('preservar')));
});
test('expected missing photo or lost administrator session stops the archive',async()=>{
 const ExcelJS=require('exceljs');
 await assert.rejects(criarArquivoExcel({ExcelJS,registros:[lista[1]],lerFoto:async()=>null,validar:()=>{},contexto:'Teste'}),/Foto ausente/);
 await assert.rejects(criarArquivoExcel({ExcelJS,registros:[lista[0]],lerFoto:async()=>null,validar:()=>{throw Error('Sessão encerrada');},contexto:'Teste'}),/Sessão encerrada/);
});
