# Fala CIPA no tipo de ocorrência

## Ativação

1. Publicar o conteúdo atualizado de `database.rules.json` em Firebase Console → Realtime Database → Regras. Salvar o arquivo no GitHub não publica as regras do Firebase.
2. Em Gestão → Contas e cadastros, localizar a conta CIPA de cada unidade e selecionar **CIPA — inspeções e Fala CIPA** em Perfil de acesso. Manter a unidade correta. As demais contas ficam como Usuário de inspeções.
3. Entrar novamente com a conta CIPA. Em Tipo de ocorrência, selecionar Fala CIPA. O formulário mostra somente o texto da denúncia, sem foto.
4. Conferir a chegada em Gestão → Fala CIPA na unidade da conta.

A identificação exibida passa a ser CIPA 101, CIPA 102 etc., usando a unidade cadastrada. O nome completo e o login originais são preservados.

## Comportamento

O perfil CIPA — inspeções e Fala CIPA mantém o papel interno user e recebe falaCipa=true, concedido somente pela gestão. O acesso fica limitado à unidade cadastrada. O perfil antigo CIPA — somente Fala CIPA permanece disponível e mantém suas restrições.

O envio usa exclusivamente cipa/{unitId}, com autor e unidade obtidos da conta autenticada; não cria uma ocorrência, não solicita número de inspeção nem envia fotos. O formulário de condições inseguras e incidentes permanece igual. Respostas e providências não encerram o relato. A gestão conclui manualmente, registrando a solução; o relato fica no histórico da gestão e sai do atendimento do destinatário.

## Verificação

56 testes locais aprovados, cobrindo o novo formulário e as regras, unidade de destino, bloqueio de usuários comuns, preservação de texto em falha, fotos, ocorrências, manutenção e interface administrativa. O teste real de envio depende da publicação das regras e da seleção do perfil.
