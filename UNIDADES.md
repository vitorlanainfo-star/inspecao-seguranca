# Acesso por unidade

O administrador mantém a visão geral. As contas de usuário precisam de uma unidade válida e carregam as ocorrências por consulta indexada `unitId`. As regras impedem leitura direta e alteração de ocorrências e referências de fotos de outras unidades, inclusive pelos caminhos de programação de prazo e decisões de manutenção. O serviço R2 já consulta essas referências com o token Firebase do usuário; recebe o bloqueio das novas regras, sem mudar os arquivos das fotos.

O catálogo contém: 101 Ponte, 102 Mutum, 103 Contagem, 104 Rio Pomba, 105 Muriae, 106 São Gotardo, 107 Antônio Carlos, 108 Dores de Rio Preto, 110 Valença, 111 Rio Novo, 112 CD Rio Novo, 113 São Gonçalo do Pará, 115 Campo Belo e 117 Miracema.

Contas existentes também podem receber ou perder **Acesso a todas as unidades** no painel. O campo `allUnits` amplia o alcance das unidades sem conceder o papel de administrador: cadastros, aprovação, exclusão e demais tarefas administrativas continuam restritos. Somente administrador aprovado pode conceder essa permissão. A revogação recarrega a sessão, limpa seus caches e restaura o filtro da unidade principal; as regras e o Worker verificam a permissão atual. Para preservar o acesso após revogar, mantenha uma unidade principal válida.

## Publicação e configuração inicial

1. Exporte um backup completo do Realtime Database pelo console. Guarde-o fora do GitHub.
2. Planeje uma janela de atualização: a versão antiga dos usuários consulta todos os registros e será bloqueada pelas novas regras. Publique o aplicativo atualizado, `units.js` e os respectivos arquivos de `r2-preview` junto com as regras. Evite liberar usuários entre as duas publicações.
3. Publique `database.rules.json` em **Firebase Console → Realtime Database → Regras**. Um commit no GitHub não publica as regras. Durante o intervalo até a publicação, a nova interface filtra as unidades, mas o isolamento no servidor ainda depende das regras antigas.
4. Entre como administrador. Em **Vincular unidades**, selecione e salve a unidade de cada responsável existente. Depois selecione e salve a unidade de cada fábrica. Todos os responsáveis cadastrados para a mesma fábrica precisam pertencer à mesma unidade. Nomes de fábricas são únicos entre unidades porque os fluxos existentes usam o nome como identidade; para novos cadastros, use nomes distintos, como `QUEIJO — PONTE` e `QUEIJO — MUTUM`.
5. O vínculo de uma fábrica atualiza as ocorrências existentes por transações individuais. Protocolos, fotos, prazos, decisões e demais campos são preservados. Uma falha informa vínculo incompleto; salve novamente para completar. Não apague registros. O sistema não adivinha a unidade dos dados antigos.
6. Em **Contas aprovadas**, selecione a unidade e clique em **Salvar unidade** para cada usuário. Cadastros pendentes precisam de unidade antes da aprovação. A associação entre responsável e conta por nome é limitada à unidade; correspondências ambíguas não escolhem uma conta. Contas sem unidade aguardam o administrador, sem carregar ocorrências. Alterar a unidade de uma conta recarrega sua sessão; ligações antigas em outras unidades são retiradas.
7. Atualize as páginas abertas. Confira com duas contas de unidades diferentes: fábricas visíveis, lançamento, consulta, programação, aceitação, recusa, conclusão e fotos. Confirme que o administrador vê todos os registros, inclusive os antigos ainda sem unidade.

## Armazenamento

O encaminhamento dos novos uploads para R2 próprios está preparado em `cloudflare/worker.js`; publicação e destinos reais ainda precisam ser configurados. Consulte [ROTEAMENTO.md](cloudflare/ROTEAMENTO.md). Sem `UNIT_GATEWAYS` configurado, todas as unidades continuam no armazenamento atual. Os e-mails criados não ativam destinos R2 automaticamente.

Separar por unidade reduz os registros transferidos e mantidos na memória de cada usuário. As fotos continuam no bucket R2 privado existente, carregadas sob demanda. Isso **não divide a capacidade ou a cobrança do banco e do bucket**. Criar contas de e-mail adicionais no mesmo projeto não cria armazenamento independente. Distribuição física exigiria configurar outros bancos/buckets e adaptar autenticação, migração e operação; esta alteração não faz essa migração.

O catálogo de responsáveis e fábricas contém metadados pequenos, lidos do caminho existente e filtrados na interface. Ocorrências e fotos têm isolamento no servidor. O administrador continua carregando os metadados de todas as ocorrências. Não há arquivamento ou exclusão automática.

## Validação

`node --test tests/*.test.js` executa os testes locais de gravação, fotos/R2, migração, manutenção, consultas por unidade, permissões e associação de nomes. O avaliador local de expressões de regras não substitui o compilador/emulador Firebase nem o teste com as regras publicadas. A verificação em duas sessões reais faz parte da ativação; não foi realizada contra o banco de produção nesta proposta.

Após configurar unidades, não volte para a interface antiga mantendo as regras novas: ela tenta ler todos os registros. Restaurar regras antigas removeria o isolamento. Para corrigir problemas, mantenha a gestão e atualize a implementação; preserve o backup e os arquivos R2 existentes.
