# Validação e limites

Aplicação aprovada para demonstração local, com dados sintéticos. Nenhuma afirmação de segurança geral ou aptidão para deploy aberto.

## Evidências funcionais

Resultados históricos no ambiente Windows/Python 3.13.2 documentado: 140 testes backend com PostgreSQL real, 25 frontend e build TypeScript/Vite. Importar, filtrar, salvar/reabrir notas, modais por teclado e mobile 375 px foram verificados no navegador.

Na revisão de publicação de 2026-11-03: serviço local respondeu; reimportar a amostra resultou em 35 duplicatas e preservou 37 eventos/seis alertas existentes. O caso `erin` reuniu linhas 16–19, três falhas e um sucesso, preservando a primeira referência. Relatórios Markdown/JSON gerados por clique continham quatro eventos, classificação, estado, nota sintética e aviso de triagem. Salvar/reabrir, mobile e suítes não foram repetidos nessa revisão. Execução ocorreu no projeto original; o código da cópia de publicação foi comparado byte a byte. O setup portátil não foi executado nesta preparação.

## Segurança e privacidade

Checklist estático de segurança de API: Host restrito, Origin exato em mutações, limites de upload, SQL parametrizado, escaping de conteúdo, deduplicação e capacidade dentro de transação, confirmação para migração destrutiva e binds loopback. Busca limitada não identificou credencial real no conteúdo preparado. `.env` permanece fora do Git; capturas e amostras são sintéticas. Busca limitada não equivale a scanner completo.

A auditoria completa com a skill Cloudflare não foi executada: exige sandbox de SO que não estava verificada. A revisão parcial não certifica segurança. Consultas OSV por versão não substituem auditoria geral.

## Limites

- Sem autenticação: qualquer processo com acesso local pode operar. Host/Origin não autenticam processos locais.
- Pydantic 2.14.0a1 pré-release; instalação limpa não validada.
- Geração dos relatórios conferida no navegador; gravação automática em disco não comprovada.
- Capacidade de 50.000 eventos/1.000 importações coberta com limites reduzidos em testes, sem carga máxima real.
- Mobile 375 px e contraste por amostragem; sem certificação WCAG integral.
- Parser estrito: rejeita BOM, TAB, syslog sem ano e sufixos não documentados.
- Recomputação integral por importação; evoluir quando volume/frequência justificar. Não há truncamento silencioso ou arquivamento automático.

Build do frontend não torna seguro expor a aplicação. Publicação de código não implica deploy do serviço.
