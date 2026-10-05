# Fotos privadas no Cloudflare R2

O sistema mantém autenticação, contas, permissões, ocorrências, configurações e auditoria no Firebase. As fotos novas são enviadas ao serviço privado https://inspecao-fotos.vitor-lana-info.workers.dev. O bucket Standard inspecao-fotos está privado, vinculado ao Worker pela variável PHOTOS. A configuração ativa fica em photo-storage.js. cloudflare/ contém o Worker e suas variáveis públicas, sem credenciais administrativas.

O Worker verifica o token no Firebase e o perfil aprovado atual. A leitura exige uma referência publicada para a mesma ocorrência. A exclusão exige administrador e referência já removida. O aplicativo aguarda o upload antes de salvar a ocorrência e a referência atomicamente. Fotos antigas em Base64 continuam compatíveis com leitura, zoom e cache.

## Validação

Em 05/10/2026, 27 testes locais passaram, incluindo fluxo real de fbSalvarOcorrencia, falhas e autorização simulada. A regra do criador foi corrigida para verificar o estado resultante da gravação atômica; as demais regras permanecem iguais. O console Firebase aceitou as regras e a simulação confirmou o bloqueio sem login. Um teste real administrativo enviou JPEG ao R2, publicou referência Firebase e leu os mesmos bytes. Ocorrência e foto descartáveis foram removidas. Isso não equivale a teste de carga ou validação de todos os fluxos possíveis.

## Migração

r2-preview/r2-maintenance.html exige administrador aprovado. Primeiro exporte ocorrências e fotos vinculadas, salve e verifique o backup local. A migração copia JPEG sem recompressão, troca a referência por transação somente se a foto original não mudou e verifica os bytes pela leitura autenticada. Alterações concorrentes são ignoradas. Uma falha de verificação tenta restaurar a referência anterior comparando a chave. Outros formatos e fotos embutidas na ocorrência não são migrados pela ferramenta. Não há limpeza automática de órfãos.

O backup contém dados privados: guarde-o fora do GitHub. A ferramenta não exporta contas, auditoria, configurações ou fotos órfãs; use a exportação JSON do console para backup completo do banco. Migrações posteriores precisam de novo backup.

## Operação e retorno

Antes de migrar, publique a versão que entende referências R2. Depois da migração, não volte à versão original nem esvazie PHOTO_API_URL: essas ações interromperiam a leitura das fotos R2. Para retornar ao Firebase, copie e verifique cada imagem antes de substituir a referência. Mantenha Worker e bucket enquanto houver referências R2. Sessões antigas devem atualizar a página após a implantação.

O cache é preservado porque o conteúdo das fotos não muda. O Worker usa Workers Free; o R2 tem franquia e cobrança por excedentes. Alertas de orçamento não bloqueiam gastos.

Documentação: https://developers.cloudflare.com/r2/pricing/ e https://developers.cloudflare.com/workers/platform/limits/

## Resultado da migração inicial

As 15 fotos existentes foram copiadas e verificadas sem recompressão. A comparação dos backups confirmou 15 ocorrências idênticas, 15 referências R2 e 32.353.358 bytes de imagens preservados. A conferência também corrigiu a exposição do manipulador de zoom para os cliques do HTML. Leituras reais sem login retornaram HTTP 401; sem origem autorizada, HTTP 403.
