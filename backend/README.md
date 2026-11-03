# Backend — SOC Auth Investigation

API FastAPI (`/api`) com PostgreSQL. Sem ORM: psycopg com SQL parametrizado e migrações SQL versionadas.

## Pré-requisitos

- Python 3.13 e as dependências de `requirements.txt` já instaladas.
- Banco PostgreSQL 17 pelo `compose.yaml` da raiz, preparado com `scripts/setup-db.ps1`. Ele cria `.env` (ignorado pelo Git) com `DATABASE_URL` (banco `soc_auth`) e `TEST_DATABASE_URL` (banco `soc_auth_test`, exclusivo de testes).

Nunca abra o `.env` para copiar credenciais. Use `scripts/with-env.ps1`, que carrega as variáveis só para o processo filho.

## Migrações

A migração é idempotente: rodar de novo não aplica nada. Roda numa transação só, com lock consultivo.

```powershell
$env:PYTHONPATH = "backend"
powershell -NoProfile -File scripts/with-env.ps1 python -m app.migrate up     # aplica pendentes
powershell -NoProfile -File scripts/with-env.ps1 python -m app.migrate down --confirm-database soc_auth_test  # destrutivo: nome exato do banco
```

## Subir a API

```powershell
$env:PYTHONPATH = "backend"
powershell -NoProfile -File scripts/with-env.ps1 python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Só escuta em `127.0.0.1`.

**Controles de acesso local** (contrato, seção *Endurecimento após audits*):

- **Host**: somente `127.0.0.1` ou `localhost` (com ou sem porta). Qualquer outro `Host` recebe 400 em todas as rotas, inclusive GET. Isso mitiga DNS rebinding; não é autenticação.
- **Origin nas mutações**: `POST` e `PATCH` exigem `Origin: http://127.0.0.1:5173` exatamente. Ausente, `null` ou outro valor recebem 403. GET não exige `Origin`. CORS aceita só essa origem.
- **Clientes CLI/curl precisam enviar o Origin**:

```powershell
curl -H "Origin: http://127.0.0.1:5173" -F "file=@samples/lab_auth_v1.log;type=text/plain" http://127.0.0.1:8000/api/imports
curl -X PATCH -H "Origin: http://127.0.0.1:5173" -H "Content-Type: application/json" -d '{"status":"closed","classification":"benign","notes":""}' http://127.0.0.1:8000/api/alerts/<id>/investigation
```

Esta política reduz escrita vinda do navegador. **Não autentica processos locais**: qualquer processo com acesso ao loopback pode enviar o cabeçalho.

## Capacidade local

Tetos globais, definidos em `app/main.py` (`MAX_STORED_EVENTS = 50_000` eventos únicos e `MAX_IMPORTS = 1_000` registros de importação):

- Verificados sob o mesmo lock de importação, antes de qualquer escrita. Ao exceder, a importação inteira recebe **409** com a mensagem `Local capacity reached ... Nothing was imported`. Nada é truncado, apagado ou substituído.
- Linhas já armazenadas (mesmo SHA-256) não consomem capacidade de eventos. Uma reimportação ainda conta como um registro de importação.
- Os limites por upload (2 MiB e 10.000 linhas) continuam valendo e retornam 413 como antes.
- Para ampliar os tetos é preciso decidir sobre arquivamento. Não há limpeza automática.

## Testes

```powershell
python -m pytest backend/tests -q                                                  # só unitários (integração pula)
powershell -NoProfile -File scripts/with-env.ps1 python -m pytest backend/tests -q   # unitários + integração
```

A integração usa `TEST_DATABASE_URL`. Antes de cada teste ela recria o schema **somente** se o nome do banco terminar em `_test`; caso contrário, aborta. Nunca aponta para `soc_auth`.

## Endpoints (contrato v1)

| Método | Caminho | Observação |
|---|---|---|
| GET | `/api/health` | `{"status":"ok"}`; 503 sem banco |
| POST | `/api/imports` | multipart `file`; 201; 413 acima de 2 MiB ou 10.000 linhas; 422 se não for UTF-8 |
| GET | `/api/events` | filtros `source`, `username`, `outcome`, `from_time`, `to_time`; `limit` 1..100; `offset` ≥ 0 |
| GET | `/api/alerts` | filtros `rule_id`, `status`, `source`, `from_time`, `to_time`; mesma paginação |
| GET | `/api/summary` | totais globais (não são filtrados) |
| GET | `/api/alerts/{id}` | alerta, evidências em ordem cronológica e investigação |
| PATCH | `/api/alerts/{id}/investigation` | corpo `{status, classification, notes}`; substitui os campos |
| GET | `/api/alerts/{id}/report?format=json\|markdown` | download (`attachment`) |

Exemplo de importação:

```powershell
curl -H "Origin: http://127.0.0.1:5173" -F "file=@samples/lab_auth_v1.log;type=text/plain" http://127.0.0.1:8000/api/imports
```

Resposta (conteúdo real do exemplo, reimportado):

```json
{"id":"673e66df-…","filename":"lab_auth_v1.log","total_lines":35,"imported_events":0,"duplicate_events":35,"invalid_lines":[]}
```

## Segurança

Host/Origin, limites transacionais, SQL parametrizado e confirmação de migração são controles locais. Não substituem autenticação. Veja [validação e limitações](../docs/acceptance.md).

## Como funciona

1. **Parser** (`app/parser.py`): lê o upload em blocos e valida limites durante a leitura. Linhas inválidas recebem um código de motivo estável e o número da linha. A identidade de cada evento é o SHA-256 da linha original sem CR/LF.
2. **Importação** (`app/main.py`): dentro de uma transação com lock consultivo, grava a importação, insere eventos por hash (`ON CONFLICT DO NOTHING`) e recalcula alertas sobre **todos** os eventos do banco. Assim, importações antigas entram nas regras, e importações fora de ordem produzem o mesmo resultado.
3. **Detecções** (`app/detections.py`): funções puras. A evidência de cada alerta é uma visão sobre uma lista compartilhada por origem, sem cópia por alerta. A contagem de usuários é deslizante, em O(n).
4. **Evidência persistida**: não há tabela de associações. O detalhe de um alerta reconstrói as evidências pela regra, pela origem (e usuário) e pelo intervalo de tempo.
5. **Investigação**: status, classificação e notas ficam em `investigations`; alerta sem linha ali é tratado como `open`/`unclassified`.

## Decisões e limites

- Linha acima de 8 KiB: linha inválida (`line_too_long`). Só o arquivo como um todo produz 413 ou 422.
- Datas: `t - 300 s` é limitado ao mínimo UTC (`0001-01-01T00:00:00Z`). Conversões UTC fora de `datetime` são linhas inválidas (`invalid_timestamp`).
- BOM no início do arquivo torna a primeira linha inválida. TAB e outros caracteres de controle são rejeitados (`control_character`).
- O limite de corpo é medido enquanto os bytes chegam (não se confia em `Content-Length`). Há folga de 64 KiB para o envelope multipart; o limite exato do arquivo é aplicado pelo parser.
- O nome do arquivo é apenas exibido, sanitizado e truncado em 255 caracteres. Nunca é usado como caminho.
- Alertas só crescem nesta versão, porque eventos não são apagados. O upsert por ID estável é suficiente.
- `open_alerts` conta alertas com status diferente de `closed`.
- Erros de banco são separados por classe:
  - 503 `{"detail":"Database unavailable"}` quando o banco não está acessível (falha operacional ou `DATABASE_URL` ausente);
  - 500 `{"detail":"Internal server error"}` para qualquer outro erro SQL, que indica defeito, não indisponibilidade.
  - Em ambos os casos, o log registra só a classe da exceção, o método e o caminho. Nunca registra a mensagem do driver, parâmetros, notas ou linhas importadas.
- Erros de validação (422) devolvem apenas local e mensagem. O valor rejeitado (por exemplo, notas acima de 10.000 caracteres) não é ecoado.
- A referência `import_id` de cada evidência é sempre a **primeira** importação que gravou a linha. Reimportações não a alteram.
- Sem autenticação: adequado só ao uso local. Antes de qualquer exposição de rede, é preciso autenticar e autorizar.

## Limitações conhecidas

- Sem autenticação nem autorização (contrato v1). Não expor a API em rede.
- Host/Origin reduzem risco do navegador; processos locais no loopback não são bloqueados.
- Ambiente Python atual mantido por decisão do usuário: sem `.venv` e instalação limpa **não verificada**. Pydantic `2.14.0a1` (pré-release) segue instalado; não substituído.
- Pacotes atualizados: fastapi 0.162.0, starlette 1.10.0, anyio 4.16.0 (com transitivas listadas em `requirements.txt`). O aviso de `python-multipart` desapareceu com a nova stack.
- Auditoria de dependências (`pip-audit`/`npm audit`) não executada; a consulta foi feita na OSV por nome e versão.

- Recomputação integral por importação (atalho da V1, marcado em `app/store.py` com `shortcut:`): cada importação relê todos os eventos e reescreve todos os alertas. Medido: cerca de 4 s para 10.000 eventos. Evoluir para recomputação incremental quando houver cerca de 50.000 eventos ou importações frequentes. Não há truncamento: todos os eventos e alertas são sempre considerados.
- O limite de 10.000 linhas e 2 MiB vale por upload. O teto global é de 50.000 eventos únicos e 1.000 importações; excesso retorna 409 sem escrita parcial.
- O detalhe de um alerta devolve todas as evidências de uma vez. Em rajadas grandes a resposta é grande; paginar fica para uma próxima revisão da API.
- `pydantic==2.14.0a1` é um pré-lançamento instalado localmente. A compatibilidade com outra versão não foi validada.
