# Aceitar, recusar e devolver ações

Na aba **Usuário**, os botões **Aceitar** e **Recusar** aparecem junto de **Programar data** nas ações em execução. A permissão segue a programação de data existente: contas aprovadas podem registrar a decisão. O usuário registrado é obtido da conta autenticada, sem digitação manual.

Ao recusar, a ação recebe o status `recusado`, sai da aba Usuário, das listas de execução e modificação, dos avisos de prazo e dos indicadores de ações ativas. A aba **Recusados** no painel de gestão mostra a ação, seu responsável, o usuário que recusou e o horário.

**Desfazer recusa e devolver ao usuário**, disponível à gestão, devolve a ação ao status `aprovado`, preservando o responsável, seu vínculo, fábrica, setor, prazo, fotos e descrição. A decisão fica pendente para uma nova aceitação ou recusa. A última identidade de recusa permanece no registro e as decisões também são enviadas à auditoria existente.

## Ativação

1. Publicar o conteúdo de `database.rules.json` em **Firebase Console → Realtime Database → Regras**. Alterar esse arquivo no GitHub não publica as regras do banco.
2. Integrar esta alteração à branch principal e publicar a página pelo processo existente. O arquivo `r2-preview/index.html` acompanha a mesma mudança.
3. Conferir com uma conta aprovada: aceitar, recusar e localizar a ação em Recusados. Com a conta de gestão, desfazer a recusa e verificar a volta ao mesmo responsável na aba Usuário.

## Validação automatizada

Execute `npm test`. Os testes verificam gravação conjunta de status e decisão, uso do usuário autenticado, preservação dos dados, restrição da devolução à gestão, falhas de gravação e as condições das regras. A avaliação das regras usa o harness local do projeto; não substitui o teste com o Firebase publicado.
