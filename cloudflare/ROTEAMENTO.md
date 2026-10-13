# Encaminhamento das fotos por unidade

O Worker principal mantém o endereço atual. Novos uploads levam `unit=<codigo>`. O Worker confirma o usuário no Firebase e recusa uma unidade diferente da unidade do perfil; administrador aprovado pode enviar para qualquer uma das 14 unidades. O aplicativo obtém essa unidade do cadastro da fábrica. Tipo de ocorrência, fábrica, setor e demais dados permanecem no Firebase.

## Destinos independentes

Em cada conta Cloudflare destinada a uma unidade, publique `worker.js` com um bucket R2 privado vinculado como `PHOTOS`, as mesmas variáveis Firebase/origem do serviço atual e `PHOTO_UNIT_ID` definido com o código correspondente, por exemplo `101`. O Worker dessa conta não precisa de `UNIT_GATEWAYS`. A implantação e a criação das contas/buckets não são executadas por este commit.

No Worker principal, configure `UNIT_GATEWAYS` como texto JSON. Exemplo ilustrativo (substitua o endereço pelo Worker realmente publicado e testado):

```json
{"101":"https://fotos-ponte.sua-conta.workers.dev"}
```

Somente endpoints HTTPS `*.workers.dev` são aceitos. Tokens Firebase são encaminhados exclusivamente aos destinos configurados no servidor; nunca informe URLs a partir do navegador. Cada destino confirma novamente o token/perfil e sua própria unidade. Não há chaves administrativas no HTML. O principal não acompanha redirecionamentos nem envia cópia ao bucket compartilhado se um destino configurado falhar.

Uma unidade sem entrada em `UNIT_GATEWAYS` continua no bucket compartilhado, com chave `units/<codigo>/photos/<id>/<campo>/<uuid>.jpg`. Isso separa a organização e preserva o isolamento do Firebase, mas **não aumenta a franquia nem divide a cobrança**. As unidades 112, 113, 115 e 117 podem permanecer assim enquanto não tiverem destinos próprios. Contas Cloudflare diferentes precisam ser provisionadas de acordo com as condições do provedor; não se presume uma franquia adicional por e-mail.

## Fotos antigas e mudança de destino

Cada referência nova contém `storageUnit`: `shared` ou o código do serviço dedicado. Leituras e exclusões usam essa referência persistida, não o destino atual de novos uploads. Fotos antigas sem esse campo continuam no bucket compartilhado e as chaves `photos/...` permanecem válidas.

**Não remova um endpoint de `UNIT_GATEWAYS` enquanto houver fotos vinculadas a esse destino. Não substitua o endpoint por um bucket vazio.** A configuração também funciona como catálogo dos destinos históricos. Para retirar um destino antigo do recebimento de fotos sem interromper suas leituras, é necessária uma configuração futura que separe destinos atuais e históricos; não apague sua entrada nesta versão.

Não há migração ou exclusão automática de fotos R2 existentes. Redistribuir o histórico requer backup de referências e bytes, cópia, verificação, troca de referência por transação e só depois remoção controlada da cópia antiga. Até essa remoção, o espaço antigo continua ocupado. A ferramenta de manutenção de Base64 recebe a unidade da ocorrência; configure todas as fábricas/históricos antes de executá-la.

## Ordem de publicação

1. Backup do banco e das imagens; preserve os destinos atuais.
2. Publique as regras de unidade do Firebase, o aplicativo e os arquivos de prévia durante a janela de atualização descrita em `UNIDADES.md`.
3. Publique primeiro o Worker principal atualizado com `UNIT_GATEWAYS={}`. Ele entende referências antigas e novas, todas ainda no bucket atual.
4. Provisione e teste cada Worker/bucket dedicado. Adicione apenas destinos já verificados ao `UNIT_GATEWAYS` do principal.
5. Teste com contas de unidades diferentes: envio, leitura, conclusão, foto de conclusão, acesso recusado de outra unidade e retorno de falha quando um destino está indisponível. Confira uma foto histórica antes e depois de ativar um novo destino.

Para retornar, retire o direcionamento apenas antes de existirem referências naquele destino, ou preserve o catálogo de leitura enquanto migra as referências. Nunca retorne ao Worker antigo depois de gravar referências novas: ele não entende `storageUnit` nem o prefixo `units/`.

## Banco de dados

Um único projeto Firebase pode atender as 14 unidades. A divisão das fotos não cria bancos extras. O Spark possui 1 GB armazenado, 10 GB/mês baixados e 100 conexões simultâneas; confira o consumo e o plano reais no console. Se a carga ultrapassar a franquia, pode-se avaliar o Blaze no mesmo projeto, sem abrir novas contas Google. Fotos em R2, consulta indexada por unidade e cache sob demanda reduzem carga, mas o administrador ainda consulta todos os metadados e cada leitura de foto verifica autorização no Firebase. Não foi realizado teste de carga nem conferido o consumo de produção neste commit.

Fontes: https://firebase.google.com/pricing/ e https://firebase.google.com/docs/database/usage/limits
