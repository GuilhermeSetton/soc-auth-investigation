# Dados sintéticos v1

Todos os dados são fictícios: IPs de documentação (RFC 5737/3849), usuários de laboratório e host `lab`. Gabarito completo em `expected_v1.json`.

## lab_auth_v1.log — 35 linhas válidas, 0 inválidas

| Cenário | Linhas | Resultado esperado |
|---|---|---|
| Login normal, publickey e password, offset `+00:00` e `+02:00` | 1–4 | Sem alerta |
| Força bruta de `198.51.100.7` contra `root`: 6 falhas a cada 30 s | 5–10 | 2 alertas `repeated_failures` (âncoras 12:12:00 com 5 eventos e 12:12:30 com 6) |
| Password spray de `203.0.113.50`: 5 usuários distintos em 80 s | 11–15 | 1 `repeated_failures` e 1 `multiple_users` (âncora 12:21:20, 5 eventos cada) |
| `erin` com 3 falhas e sucesso 3 min depois | 16–19 | 1 `success_after_failures` (4 eventos) |
| `frank`: primeira falha exatamente 300 s antes do sucesso | 20–23 | 1 `success_after_failures` (4 eventos; limite inclusivo) |
| `gina`: falhas no mesmo instante do sucesso não contam | 24–27 | Sem alerta |
| `ivan`: falha 1 µs antes da janela de 300 s | 28–31 | Sem alerta |
| `judy` falha, `kate` tem sucesso (usuários diferentes) | 32–35 | Sem alerta |

Totais: 27 falhas, 8 sucessos, 6 alertas (3 `repeated_failures`, 1 `multiple_users`, 2 `success_after_failures`).

## invalid_lines_v1.log — 13 linhas, 2 válidas, 11 inválidas

| Linha | Motivo |
|---|---|
| 1 | `timestamp_without_offset` |
| 2 | `invalid_format` (syslog sem ano) |
| 3 | `empty_line` |
| 4 | `invalid_format` (outro processo) |
| 5 | `unsupported_message` |
| 6 | `invalid_ip` |
| 7 | `invalid_port` (0) |
| 8 | `invalid_timestamp` (30 de fevereiro) |
| 9 | `invalid_timestamp` (offset +24:00) |
| 10 | `unsupported_message` (`invalid user` em sucesso) |
| 11 | válida: falha de IPv6 `2001:db8::1` |
| 12 | `invalid_port` (65536) |
| 13 | válida: publickey de sucesso |

Sem alertas: as duas linhas válidas não atingem nenhum limiar.
