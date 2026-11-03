# Caso sintético: falhas seguidas de sucesso

Fonte: `samples/lab_auth_v1.log`, linhas 16–19; gabarito em `samples/SCENARIOS.md`. Todos os dados são de laboratório.

## Evidências e detecção

Usuário `erin`, origem `192.0.2.88`: falhas em 2026-10-01 às 12:30, 12:31 e 12:32 UTC; sucesso às 12:33 UTC. A regra `success_after_failures` encontra três falhas anteriores do mesmo usuário/origem na janela de 300 segundos e inclui o sucesso como quarta evidência. Falhas simultâneas ao sucesso são excluídas pelo contrato.

## Hipótese e alternativas

O padrão justifica investigar possível acesso indevido após tentativas de senha. Também pode representar senha esquecida, automação com credencial antiga ou uso legítimo de origem compartilhada. O padrão sozinho não permite escolher uma dessas explicações.

## Próximos passos do analista

Confirmar se o acesso era esperado; correlacionar origem e horário com contexto do usuário; obter logs de sessão, comandos e processos do host. Essas fontes não são integradas nesta versão, nem foram obtidas neste exercício.

## Conclusão

Inconclusivo, requer contexto adicional. A aplicação reúne evidências e registra decisão do analista; não declara comprometimento automaticamente. Salvar a análise, reabrir, exportar Markdown/JSON e reimportar a amostra demonstra persistência e deduplicação. Este texto é um exemplo analítico, não um incidente real nem uma nota já salva no banco.
