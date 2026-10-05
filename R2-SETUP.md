# Integração de fotos com Cloudflare R2 — preparação

## Estado

A integração está desativada (`PHOTO_API_URL = ''`). O site continua lendo e salvando fotos no Firebase enquanto essa configuração estiver vazia. Nenhuma conta, regra, ocorrência ou foto de produção foi alterada. O Worker precisa ser publicado e validado antes de ativar o cliente.

## Arquitetura e compatibilidade

- Login, cadastros, aprovação, protocolos, ocorrências, gráficos, prazos, auditoria e relatórios permanecem no Firebase e no código existente.
- Apenas os bytes de novas fotos são enviados para um bucket R2 privado. `fotos/<id>/<campo>` passa a guardar `{ storage: 'r2', key, bytes, contentType }`.
- Fotos antigas em Base64 continuam funcionando. Cache local, versão das fotos, carregamento sob demanda, carimbo e zoom são reaproveitados.
- O Worker valida o token com Firebase Authentication e consulta o perfil atual. Contas pendentes, rejeitadas e desativadas não têm acesso. A leitura também exige a referência exata publicada e a permissão das regras do Firebase.
- Uploads são imutáveis: uma substituição nunca sobrescreve a imagem anterior. A ocorrência só é publicada depois do upload; falhas são informadas e não provocam fallback silencioso para Base64.
- Exclusão retira ocorrência e referência em uma atualização atômica, e tenta limpar a imagem do R2 depois. Uma falha de limpeza mantém um objeto privado sem referência, não uma ocorrência incompleta.

## Pré-requisitos de ativação

1. O titular cria a conta Cloudflare e conclui a ativação do R2, incluindo eventual cadastro de pagamento/aceite de termos.
2. Criar bucket **Standard** `inspecao-fotos`, sem acesso público, domínio público ou `r2.dev` público.
3. Publicar `cloudflare/worker.js` com a configuração de `cloudflare/wrangler.jsonc`. Vincular o bucket como `PHOTOS`. Não publicar credenciais S3 no GitHub ou no navegador.
4. Validar o domínio de produção `ALLOWED_ORIGIN` e o projeto Firebase. A API key Firebase presente na configuração é a chave pública do app, não uma credencial administrativa.
5. Exportar um backup JSON completo do Realtime Database e verificar que contém ocorrências, usuários e os bytes das fotos. O CSV de limpeza existente não é um backup de fotos.
6. Testar em ambiente separado com usuários administrador, responsável e usuário comum. Validar ambas as fotos (antes/depois), zoom, atualização, aprovação/conclusão, prazos, cadastros, gráficos, CSV e exclusão. Testar rede indisponível durante upload e commit, e contas rejeitadas.
7. Somente após os testes preencher `PHOTO_API_URL` com a URL HTTPS do Worker e publicar o site com `photo-storage.js` no mesmo diretório de `index.html`.

## Regras do Firebase

As regras observadas em 05/10/2026 permitem leitura de `fotos/<id>` para contas aprovadas e não impõem validação de string no valor da foto; portanto aceitam referências R2 sem tornar o bucket público.

Há um ponto existente a validar antes da ativação: a regra de criação de `fotos/<id>/foto` consulta `root.child('ocorrencias')`, que representa o estado anterior à atualização. Na criação de ocorrência e foto em uma única atualização, a ocorrência ainda não existe nesse estado. O teste de criação com foto por usuário comum deve incluir essa situação. Se reproduzido, a correção deve consultar o estado resultante através de `newData.parent().parent().parent().child('ocorrencias')`, mantendo a checagem de `createdByUid == auth.uid`. Não aplicar regras permissivas para contornar esse problema. Nenhuma regra foi modificada nesta preparação.

## Migração das fotos atuais (etapa posterior, não executada)

O leitor misto permite migrar gradualmente depois de ativar a conta e validar a integração. Com backup confirmado, copiar uma foto por vez ao R2, substituir o valor Base64 por uma referência usando transação/ETag que confira que o original ainda é o mesmo, e verificar a leitura da referência. Se houver atualização concorrente, não sobrescrever a foto nova. Registrar id, campo e resultado para retomar com segurança.

Não apagar o backup nem os objetos anteriores durante a validação. Não ativar migração automática junto com o primeiro lançamento. Falhas de upload podem deixar objetos privados órfãos; fotos substituídas também são retidas para recuperação e precisam de limpeza posterior, após comparar com as referências atuais.

## Retorno seguro

Antes de migrar qualquer foto, é possível manter o serviço desativado e voltar ao site original. Depois que houver referências R2, manter o leitor misto e o Worker disponíveis; esvaziar a URL ou voltar ao leitor antigo quebraria a leitura dessas referências. Para voltar integralmente ao Firebase, copiar cada imagem R2 de volta e verificar antes de remover o serviço.

## Validação local

Executar `node --test tests/*.test.js`. Testes usam dados fictícios e serviços simulados, sem tocar na produção. Cobrem gateway privado, aprovação, erros, limites, exclusão, leitura Base64/R2, versão/cache e salvamento atômico. Esses testes não substituem a validação no Cloudflare real e no Firebase Emulator.

Referências: [R2 Workers](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [Firebase REST](https://firebase.google.com/docs/database/rest/auth), [Firebase Authentication REST](https://firebase.google.com/docs/reference/rest/auth#section-get-account-info).
