// Relatório offline: imagens incorporadas, sem URLs que dependem do servidor.
export function anoRegistro(item) {
    const value = String(item.dataCriacao || '');
    return value.match(/^(\d{4})[-/]/)?.[1] || value.match(/\d{2}\/\d{2}\/(\d{4})/)?.[1] || 'Sem data';
}
export function prepararArquivo(lista, {unidade = 'todos', ano = 'todos'} = {}) {
    return lista.filter(item => (unidade === 'todos' || item.unitId === unidade) && (ano === 'todos' || anoRegistro(item) === ano))
        .sort((a,b) => String(a.unitId || '').localeCompare(String(b.unitId || ''), 'pt-BR', {numeric:true}) || String(a.local || '').localeCompare(String(b.local || ''),'pt-BR') || String(a.setor || '').localeCompare(String(b.setor || ''),'pt-BR') || String(a.dataCriacao || '').localeCompare(String(b.dataCriacao || '')) || String(a.id).localeCompare(String(b.id)));
}
export function resumirArquivo(lista, hoje) {
    const grupos = new Map();
    for (const item of lista) {
        const chave = JSON.stringify([anoRegistro(item), item.unitId || '', item.local || '', item.setor || '']);
        if (!grupos.has(chave)) grupos.set(chave, {ano:anoRegistro(item), unidade:item.unitId || '', fabrica:item.local || '', setor:item.setor || '', total:0, concluidas:0, pendentes:0, aprovacao:0, execucao:0, recusadas:0, incidentes:0, vencidas:0});
        const g = grupos.get(chave); g.total++;
        if (item.status === 'concluido') g.concluidas++;
        else if (item.status === 'recusado') g.recusadas++;
        else { g.pendentes++; if (item.status === 'pendente') g.aprovacao++; else g.execucao++;
            if (/^\d{4}-\d{2}-\d{2}$/.test(item.dataConclusaoPrazo || '') && item.dataConclusaoPrazo < hoje) g.vencidas++;
        }
        if (item.tipoOcorrencia === 'Incidente') g.incidentes++;
    }
    return [...grupos.values()];
}
let excelPromise;
export function carregarExcel() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    if (!excelPromise) excelPromise = new Promise((resolve,reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
        script.onload = () => window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error('Biblioteca Excel indisponível.'));
        script.onerror = () => reject(new Error('Não foi possível carregar o gerador Excel. Confira sua conexão.'));
        document.head.appendChild(script);
    }).catch(error => { excelPromise = null; throw error; });
    return excelPromise;
}
function cabecalho(sheet, linha, values) {
    const row = sheet.getRow(linha); row.values = values; row.height = 32;
    row.eachCell(cell => { cell.font = {bold:true,color:{argb:'FFFFFFFF'}}; cell.fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FF005B32'}}; cell.alignment = {vertical:'middle',wrapText:true}; });
}
async function tamanhoFoto(data) {
    if (typeof Image === 'undefined') return {width:270,height:180};
    const img = new Image();
    await new Promise((resolve,reject) => {img.onload=resolve;img.onerror=()=>reject(new Error('A foto está inválida; o arquivo não foi gerado.'));img.src=data;});
    const width = img.naturalWidth || img.width, height = img.naturalHeight || img.height;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Não foi possível determinar o tamanho de uma foto.');
    const escala = Math.min(270/width,180/height);
    return {width:width*escala,height:height*escala};
}
export async function criarArquivoExcel({ExcelJS, registros, lerFoto, configuracao, contexto, validar, progresso = () => {}}) {
    const wb = new ExcelJS.Workbook(); wb.creator = 'Inspeção de Condições Inseguras'; wb.created = new Date();
    const resumo = wb.addWorksheet('Resumo');
    resumo.columns = Array.from({length:13},(_,i)=>({width:i===2||i===3?28:16}));
    resumo.mergeCells('A1:M1'); resumo.getCell('A1').value = 'Arquivo de inspeções — resumo por ano, unidade, fábrica e setor'; resumo.getCell('A1').font = {size:18,bold:true,color:{argb:'FF005B32'}}; resumo.getRow(1).height=35;
    resumo.mergeCells('A2:M2'); resumo.getCell('A2').value = contexto;
    const hoje = new Date().toLocaleDateString('en-CA');
    const grupos = resumirArquivo(registros, hoje);
    resumo.getRow(4).values = ['Total', registros.length, 'Concluídas', grupos.reduce((n,g)=>n+g.concluidas,0), 'Pendentes / em execução', grupos.reduce((n,g)=>n+g.pendentes,0), 'Recusadas', grupos.reduce((n,g)=>n+g.recusadas,0)]; resumo.getRow(4).font={bold:true,size:12}; resumo.getRow(4).height=36; resumo.getRow(4).alignment={wrapText:true};
    resumo.mergeCells('A6:M6'); resumo.getCell('A6').value = 'Pendentes incluem aguardando aprovação, em execução e comentários Fala CIPA. Recusadas ficam separadas. Incidentes e Fala CIPA estão incluídos no total; veja o tipo na aba Registros.'; resumo.getCell('A6').alignment={wrapText:true}; resumo.getRow(6).height=35;
    cabecalho(resumo,8,['Ano','Unidade','Fábrica','Setor','Total','Concluídas','Pendentes','Aguardando aprovação','Em execução','Recusadas','Incidentes','Vencidas','Fotos incorporadas']);
    for(const g of grupos) resumo.addRow([g.ano,g.unidade,g.fabrica,g.setor,g.total,g.concluidas,g.pendentes,g.aprovacao,g.execucao,g.recusadas,g.incidentes,g.vencidas,0]);
    resumo.views=[{state:'frozen',ySplit:8}]; resumo.autoFilter={from:'A8',to:`M${8+grupos.length}`};
    const dados=wb.addWorksheet('Registros');
    const headers=['Protocolo','ID','Ano','Unidade','Fábrica','Setor','Tipo','Status','Descrição','Gravidade','Criador','Responsável','Validador','Criação','Prazo','Conclusão','Data foto antes','Data foto depois','Foto antes','Foto depois','Histórico'];
    dados.columns=headers.map((_,i)=>({width:[8,18,19,20].includes(i)?44: i===0?17:22}));
    cabecalho(dados,1,headers); dados.views=[{state:'frozen',ySplit:1,xSplit:6}];
    const originais=wb.addWorksheet('Dados originais'); originais.columns=[{width:22},{width:20},{width:14},{width:100}]; cabecalho(originais,1,['Categoria','ID','Parte','Conteúdo JSON (partes consecutivas)']);
    function guardarOriginal(categoria,id,value) { const text=JSON.stringify(value); for(let offset=0;offset<text.length;offset+=30000) originais.addRow([categoria,String(id),(offset/30000)+1,text.slice(offset,offset+30000)]); }
    guardarOriginal('cadastros','config',configuracao || {});
    let fotos=0;
    for(let index=0;index<registros.length;index++) {
        validar(); const item=registros[index]; progresso(index+1,registros.length);
        const row=dados.addRow([item.ticket||'',String(item.id),anoRegistro(item),item.unitId||'',item.local||'',item.setor||'',item.tipoOcorrencia||'Condicao Insegura',item.status||'',item.desc||'',item.gravidade||'',item.criador||item.nome||'',item.responsavel||'',item.validor||'',item.dataCriacao||'',item.dataConclusaoPrazo||'',item.dataConclusaoReal||'',item.timestampFotoAntes||'',item.timestampFotoDepois||'','Sem foto','Sem foto',(item.historicoAlteracoes||[]).join('\n')]);
        row.alignment={vertical:'top',wrapText:true}; row.height=155;
        if(index%2===0) row.eachCell(cell=>cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF0F7F3'}});
        const original={...item}; delete original.foto; delete original.fotoConclusao; guardarOriginal('ocorrencia',item.id,original);
        for(const [campo,col] of [['foto',19],['fotoConclusao',20]]) {
            const data=await lerFoto(item,campo); validar();
            if (!data) { if(item[campo] || item[campo==='foto'?'temFoto':'temFotoConclusao']) throw new Error(`Foto ausente no protocolo ${item.ticket || item.id} (${campo}). O arquivo não foi baixado; não limpe o banco.`); continue; }
            const match=data.match(/^data:image\/(jpeg|png|gif);base64,/);
            if(!match) throw new Error(`Formato de imagem não suportado no protocolo ${item.ticket || item.id}.`);
            const id=wb.addImage({base64:data,extension:match[1]});
            dados.addImage(id,{tl:{col:col-1+0.05,row:row.number-1+0.05},ext:await tamanhoFoto(data),editAs:'oneCell'});
            row.getCell(col).value='Foto incorporada'; fotos++;
            const gi=grupos.findIndex(g=>g.ano===anoRegistro(item)&&g.unidade===(item.unitId||'')&&g.fabrica===(item.local||'')&&g.setor===(item.setor||''));
            const cell=resumo.getCell(9+gi,13); cell.value=Number(cell.value||0)+1;
        }
    }
    dados.autoFilter={from:'A1',to:`U${registros.length+1}`};
    resumo.mergeCells('A5:M5'); resumo.getCell('A5').value=`${fotos} fotos incorporadas. Abra e confira o arquivo salvo antes de limpar o banco. Este relatório não restaura automaticamente o sistema.`;
    originais.views=[{state:'frozen',ySplit:1}];
    validar(); return {workbook:wb, fotos};
}
