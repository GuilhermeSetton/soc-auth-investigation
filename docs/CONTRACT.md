# Contrato inicial v1

Status: especificação para implementação, ainda não validada em execução.

## Arquitetura e limites

Aplicação local de analista único. React/TypeScript acessa FastAPI; PostgreSQL é a única persistência. Backend liga em 127.0.0.1:8000; frontend em 127.0.0.1:5173. CORS somente essa origem. Sem exposição em rede, contas, serviços externos ou execução de conteúdo importado. Chamadas mutáveis exigem Origin local permitido. Sem cookies de autenticação. Antes de exposição em rede, implementar autenticação e autorização.

Backend síncrono, psycopg com SQL parametrizado e migrações SQL versionadas; sem ORM, fila ou framework de regras. Testes unitários não dependem do banco; testes de integração exigem PostgreSQL real e banco de teste isolado.

## Endurecimento após audits

Host HTTP permitido somente `127.0.0.1` ou `localhost` (validação separada da porta); Host diferente retorna 400. Mutações POST/PATCH exigem Origin exatamente `http://127.0.0.1:5173`, inclusive clientes CLI devem enviar esse cabeçalho; Origin ausente, `null` ou diferente retorna 403. Esta política reduz exposição ao navegador e não equivale a autenticação de processos locais. GET permanece sem exigência de Origin, protegido pela allowlist de Host e bind loopback.

Capacidade local explícita: até 50.000 eventos únicos e 1.000 registros de importação. Ao exceder um desses tetos, rejeitar a transação inteira com 409 e mensagem de capacidade; nunca truncar, apagar ou substituir dados. Eventos duplicados não contam como novos eventos, mas uma importação registrada conta para o teto de importações. Tetos visam limitar recomputação e metadados; uma política de arquivamento/retention exigirá trabalho futuro. Reimportação em capacidade de eventos continua possível se não acrescentar eventos e ainda houver capacidade de importações.

Migração destrutiva `down` via CLI exige `--confirm-database <nome-exato-do-banco>`; ausência ou nome divergente aborta sem alteração. Não revelar DSN nem credencial. Migração normal `up` permanece idempotente e não exige confirmação. Testes destrutivos continuam restritos ao banco de teste.

## Formato de entrada

UTF-8 estrito, uma linha OpenSSH por evento, prefixo RFC3339 com offset obrigatório:

```text
2026-10-01T12:00:00Z lab sshd[101]: Failed password for invalid user alice from 192.0.2.10 port 50000 ssh2
2026-10-01T12:01:00+00:00 lab sshd[102]: Accepted publickey for alice from 192.0.2.10 port 50001 ssh2
```

Aceitar Failed/Accepted password/publickey, usuário válido ou marcador `invalid user` em falhas, IPv4/IPv6 validado, porta 1..65535. Documentar gramática exata. Datas sem offset, formatos syslog sem ano, mensagens alheias e linhas vazias são inválidas com motivo e número da linha. Não inferir ano/timezone. Normalizar UTC, precisão de microssegundos. Limites: 2 MiB por upload, 10.000 linhas, 8 KiB por linha, notas 10.000 caracteres, usuário/host 255 caracteres. Validar streaming antes de acumular conteúdo ilimitado. Exceder limites de arquivo/linhas retorna 413 sem alterações. UTF-8 inválido retorna 422 sem alterações. Linhas individuais inválidas são relatadas; linhas válidas importadas numa transação.

Deduplicação: SHA-256 da linha original sem CR/LF. Reimportação e linhas repetidas não criam eventos duplicados; informar contagens. Esta identidade preserva logs iguais de arquivos diferentes como uma única evidência; a referência original é a primeira importação, com linha e nome de arquivo de exibição sanitizado. IDs de alertas estáveis por versão de regra + origem + evento âncora; associação de evidências não se perde ao reimportar.

## Precisões de gramática e erros

Host: `[A-Za-z0-9._-]{1,255}`; usuário: `[A-Za-z0-9._@-]{1,255}`; PID positivo com até 10 dígitos; porta sem zero à esquerda. Fração de segundo opcional com 1..6 dígitos. IPv6 é comparado em forma canônica. Sufixos adicionais de OpenSSH, incluindo fingerprint após `ssh2`, estão fora deste formato v1 e devem produzir `unsupported_message`, sem descarte silencioso.

Linha acima de 8 KiB é inválida com `line_too_long`; limites globais de upload/linhas são 413. Códigos de motivo são estáveis e em inglês. Em `success_after_failures`, evidências incluem falhas e sucesso. Datas fora do intervalo representável após conversão UTC devem ser inválidas, sem erro interno.

## Detecções v1

Processar eventos ordenados por timestamp e ID estável; janela inclusiva [t-300s,t]. Recalcular sobre conjunto completo após importação, inclusive eventos antigos; preservar investigação por identidade de alerta. Toda regra é sinal para triagem, nunca comprovação de invasão.

- `repeated_failures`: ao menos 5 falhas da mesma origem em 300s; um alerta por evento de falha âncora que atingir o limiar. Evidências: todas as falhas da origem na janela.
- `multiple_users`: ao menos 5 usuários distintos em falhas da mesma origem em 300s; um alerta por evento de falha âncora que atingir o limiar. Evidências: todas as falhas da origem na janela.
- `success_after_failures`: sucesso após ao menos 3 falhas da mesma origem e mesmo usuário em [t-300s,t), sucesso em t. Um alerta por sucesso. Falhas com timestamp igual ao sucesso não contam como anteriores.

Justificativas incluem limiar, janela e contagens reais. Falsos positivos: senha esquecida, NAT/bastion compartilhado, automações e varredura autorizada. Não fundir alertas entre regras. Mostrar sobreposição e contagem real.

## Limites de implementação das evidências

No núcleo, evidências devem usar sequência compartilhada e intervalo de índices, sem uma cópia completa por alerta; materializar somente ao consultar um alerta. Na persistência, preferir origem/usuário e limites temporais da regra para consultar evidências, sem tabela de associações quadrática. Todas as evidências continuam acessíveis; sem truncamento silencioso. O detalhe atual retorna todas as evidências de um único alerta, limitado pelo conjunto local; paginação adicional só se necessária na revisão da API.

Subtração da janela em datas próximas ao ano 1 usa mínimo UTC como limite inferior. Conversões UTC fora de datetime são linhas inválidas. BOM inicial não é removido e torna primeira linha inválida; TAB e outros caracteres de controle são rejeitados. Documentar estas restrições na importação.

## API /api

JSON em snake_case; UUIDs como strings; timestamps RFC3339 UTC. Erro: `{"detail":"mensagem"}` ou validação padrão FastAPI. Paginação `limit` (1..100, padrão 50), `offset` >= 0. Ordenação estável por timestamp e ID. Filtros temporais inclusivos `from_time`, `to_time`, validar início <= fim.

- GET `/health`: `{status:"ok"}`; 503 se banco indisponível.
- POST `/imports`: multipart `file`; 201 `{id,filename,total_lines,imported_events,duplicate_events,invalid_lines:[{line_number,reason}]}`. Contagens somam total_lines. Arquivo totalmente inválido gera importação com zero eventos e erros, sem alertas.
- GET `/events?source=&username=&outcome=&from_time=&to_time=&limit=&offset=`: `{items:[Event],total}`. outcome `failure|success`; filtros exatos.
- GET `/alerts?rule_id=&status=&source=&from_time=&to_time=&limit=&offset=`: `{items:[Alert],total}`.
- GET `/summary`: `{events,alerts,open_alerts,successful_authentications,failed_authentications}`; totais globais rotulados como tais na UI.
- GET `/alerts/{id}`: `{alert:Alert,events:[Event],investigation:Investigation}`; eventos em ordem cronológica compõem timeline.
- PATCH `/alerts/{id}/investigation`: `{status,classification,notes}` substitui campos; retorna Investigation; 404 para alerta ausente.
- GET `/alerts/{id}/report?format=json|markdown`: download attachment; JSON contém `{schema_version:1,generated_at,alert,events,investigation,disclaimer}`. Markdown inclui mesmas evidências, notas como texto escapado, aviso de sinal não conclusivo e falsos positivos. Nenhum HTML ativo.

Event: `{id,timestamp,host,source,username,outcome,method,import_id,line_number,raw_line}`.

Alert: `{id,rule_id,rule_version:1,source,timestamp,title,reason,false_positives:[string],event_count,status}`.

Investigation: `{alert_id,status,classification,notes,updated_at}`. status `open|in_progress|closed`; classification `unclassified|benign|suspicious|confirmed_incident`; padrão open/unclassified/notas vazias. Classificação é julgamento explícito do analista. Não exige transições especiais. Concorrência entre múltiplos analistas fora da v1 local.

## Critérios de evidência

Parser: positivo, negativo, IPv6, offset, UTF-8, limites. Regras: abaixo/no limiar, janela em 300s/300s+1us, sucesso anterior/mesmo timestamp, origem/usuário distintos. Integração: migração, rollback, reimportação, importação fora de ordem, persistência após reabrir, filtros/paginação e exportação. UI: importação, erros por linha, filtros, detalhe/timeline, salvar/reabrir/exportar; loading/empty/error/success; teclado, foco, contraste e viewport estreita. Evidência executada deve ser separada de pendências.
