# Frontend — SOC Auth Investigation (Plataforma de Investigação SSH)

Interface web local para triagem e investigação de autenticações SSH (SOC/Blue Team). Desenvolvida em React e TypeScript, sem bibliotecas de componentes externas pesadas ou roteadores desnecessários (Ponytail nível full), conectada à API FastAPI em `http://127.0.0.1:8000/api`.

---

## 🚀 Comandos Rápidos / Quick Start

### Pré-requisitos
- Node.js `22.23.2` ou superior e npm `11.x`
- Backend FastAPI em execução em `http://127.0.0.1:8000`

### Instalação (Dependências estritamente aprovadas)
```bash
cd frontend
npm ci
```

### Executar em Desenvolvimento (Vite com porta estrita 5173)
```bash
npm run dev
```
O servidor iniciará em `http://127.0.0.1:5173` (origem permitida pelo CORS do backend).

### Compilação de Produção e Checagem de Tipos
```bash
npm run build
```
Executa `tsc` para verificação rigorosa de tipos TypeScript e o Vite para empacotamento estático otimizado (saída em `dist/`).

### Execução da Suíte de Testes (Vitest 5.1.0)
```bash
npm run test
```
Executa 25 testes unitários e de interação com Vitest 5.1.0 e JSDOM.

---

## 📁 Estrutura de Arquivos / Project Structure

```text
frontend/
├── index.html                 # Ponto de entrada HTML sem dependências de CDN ou fontes externas
├── package.json               # Dependências aprovadas (React, TypeScript, Vite, Vitest, Testing Library)
├── package-lock.json          # Lockfile determinístico
├── tsconfig.json              # Configuração estrita do TypeScript (ES2022 / React JSX)
├── vite.config.ts             # Configuração do Vite com host 127.0.0.1 e strictPort: 5173
├── src/
│   ├── main.tsx               # Montagem do React root
│   ├── App.tsx                # Coordenação de navegação, abas e métricas globais
│   ├── types.ts               # Contratos de tipos (EventItem, AlertItem, Investigation, Summary, etc.)
│   ├── api.ts                 # Cliente HTTP com tipagem e tratamento de erros
│   ├── styles.css             # Design system sóbrio SOC Blue Team (dark slate, alto contraste e acessibilidade)
│   ├── vite-env.d.ts          # Tipos de ambiente do Vite
│   ├── components/
│   │   ├── SummaryHeader.tsx  # Métricas globais (Total Events, Alerts, Open, Logins) e status da API
│   │   ├── AlertsSection.tsx  # Listagem filtrada de alertas, disclaimer de triagem e modal de proteção
│   │   ├── AlertDetail.tsx    # Linha do tempo de evidências, formulário de notas/status e exportação
│   │   ├── EventsSection.tsx  # Tabela paginada de eventos com filtros exatos e logs brutos seguros
│   │   └── ImportSection.tsx  # Ingestão de arquivos com validação de 2 MiB e lista de linhas rejeitadas
│   └── test/
│       ├── setup.ts           # Matchers leves para DOM no Vitest
│       ├── matchers.d.ts      # Tipagem TypeScript para matchers de teste
│       ├── api.test.ts        # Testes unitários do cliente de API
│       ├── App.test.tsx       # Testes de integração da navegação e métricas
│       ├── AlertsSection.test.tsx # Testes de filtros de alerta e modal de notas não salvas
│       ├── AlertDetail.test.tsx   # Testes da timeline, salvamento via PATCH e exportação de relatórios
│       ├── EventsSection.test.tsx # Testes de paginação, filtros e prevenção contra XSS em logs
│       └── ImportSection.test.tsx # Testes de rejeição >2 MiB, tabela de erros e upload com sucesso
└── README.md                  # Esta documentação
```

---

## 🛡️ Decisões de Arquitetura e Design / Decisions

1. **Ponytail nível full (Menor implementação completa):**
   - Zero bibliotecas visuais pesadas (Tailwind, MUI, Bootstrap, etc.) e zero roteadores globais. O design system foi implementado puramente em CSS nativo através de variáveis semânticas de alta legibilidade, layout responsivo em grid/flexbox e classes utilitárias compactas.
   - Vite utilizando esbuild nativo para JSX, sem necessidade do `@vitejs/plugin-react` ou de pacotes não autorizados.

2. **Segurança e Tratamento de Dados Não Confiáveis:**
   - Todo conteúdo de logs SSH, nomes de usuário, endereços IP e mensagens brutas é renderizado exclusivamente como nós de texto nativos do React ou dentro de elementos `<pre className="code-block">`.
   - **Zero uso de `dangerouslySetInnerHTML`** — logs são tratados como texto, impedindo que payloads HTML/JavaScript nesses campos sejam interpretados como marcação. Isso não equivale a uma garantia geral contra XSS.
   - Validação prévia de tamanho no cliente: rejeita uploads maiores que 2 MiB antes mesmo de despachar requisições para a rede.

3. **Proteção Contra Perda de Trabalho e Acessibilidade dos Modais (F1, F3, N1 & N2):**
   - O componente `AlertDetail` rastreia alterações pendentes no formulário de investigação (status, classificação e notas de até 10.000 caracteres).
   - Se o analista tentar trocar de alerta na lista ou navegar para outra aba com notas não salvas, um modal acessível (`role="dialog"`, `aria-modal="true"`) é exibido com foco inicial em "Keep Editing".
   - **Focus Trap Nativo (N1):** A navegação via `Tab` e `Shift+Tab` é estritamente confinada aos controles do modal, impedindo que o foco alcance controles do fundo da página enquanto o diálogo estiver aberto.
   - **Teclado Escape & Retorno de Foco (N1 & N2):** Pressionar `Escape` cancela o diálogo de forma idêntica a "Keep Editing" sem descartar alterações. Ao cancelar ou fechar, o foco retorna imediatamente ao botão que disparou a abertura (gatilho).
   - **Contexto Pós-Navegação (N2):** Ao confirmar o descarte ("Discard & Switch"), o foco é direcionado ao contexto útil do destino (nova aba ativa ou novo alerta selecionado), evitando perda de foco para `BODY`.
   - A seleção do alerta ativo e o estado da interface são preservados ao alternar entre abas (painéis mantidos em DOM com `hidden` e `display: none`).

4. **Tratamento da Limitação Conhecida do Backend e Terminologia Precisa (F2):**
   - O backend preserva `import_id` e número da linha da primeira importação nas evidências e relatórios. Se a referência estiver ausente, a interface exibe `Unavailable`, sem inventar identificadores.
   - Terminologia rigorosa de SOC: rótulo neutro `Source IP` e classificação explícita `Confirmed incident (analyst judgment)`.

5. **Diferenciação Estrita entre Erros e Resultados Vazios (F4):**
   - Em caso de falha de consulta ou parâmetros inválidos (como HTTP 422 em `from_time > to_time`), a interface exibe a mensagem de erro específica da API e oculta contagens numéricas falsas `(0)` e controles de paginação.

6. **Ciclo de Vida Assíncrono no Salvamento (N3):**
   - Em `AlertDetail.tsx`, a guarda de fechamento redundante foi substituída por um controle de ciclo de vida nativo via `isMountedRef`. Respostas assíncronas de PATCH que completem após troca de alerta ou desmontagem são descartadas com segurança sem invocar callbacks ou atualizar estado indevido.

7. **Acessibilidade e Medição de Contraste (WCAG 2.1 AA):**
   - Cores ajustadas e verificadas via script matemático (`scripts/measure-contrast.js`) com composição precisa de transparência alfa sobre as superfícies CSS reais (`bgPrimary`, `bgSecondary`, `bgSurface`).
   - Asserções programáticas estritas garantem razão de contraste ≥ 4.5:1 para todos os tokens de texto, badges, caixas de erro e controles.
   - A validação empírica in-browser (via `getComputedStyle` e leitura direta do DOM renderizado) foi conduzida e aprovada pela equipe de Qualidade e Segurança (ver [validação](../docs/acceptance.md)). O sistema não alega conformidade universal irrestrita com todas as heurísticas WCAG, reportando com transparência as medições realizadas.
   - Foco visível de alto contraste (`outline: 2px solid #38bdf8`) em todos os elementos interativos.
   - Rótulos e descrições semânticas para leitores de tela (`aria-label`, `aria-selected`, `aria-live`, `role="tab"`, `role="dialog"`).

8. **Refinamentos Visuais e Ergonômicos (Taste Skill Audit):**
   - **Eliminação de Emojis Decorativos:** Remoção completa de emojis em títulos de abas, cabeçalhos de seções, caixas de diálogo e diretrizes textuais (`App.tsx`, `AlertsSection.tsx`, `AlertDetail.tsx`, `EventsSection.tsx`, `ImportSection.tsx`), garantindo seriedade e sobriedade técnica de ambiente analítico SOC sem sinais artificiais de geração ("tells").
   - **Cabeçalhos de Tabela em Sentence Case:** Cabeçalhos das tabelas de dados (`.data-table th`) ajustados para `12px`, `font-weight: 500` e caixa natural (sem `uppercase` ou espaçamento artificial forçado).
   - **Alinhamento Numérico à Direita:** Coluna `Line #` (`th` e `td`) explicitamente alinhada à direita (`text-align: right;`) com classe utilitária `.col-line`, preservando alinhamento padrão à esquerda para IPs, UUIDs e strings.
   - **Numerais Tabulares (`tabular-nums`):** Declaração explícita de `font-variant-numeric: tabular-nums` em cards de métricas (`.metric-value`), identificadores numéricos, timestamps e células de dados monoespaciais, prevenindo trepidação ("jitter") na alternância de dígitos.
   - **Sentence Case em Rótulos e Legendas:** Rótulos de formulário (`.form-label`) e subtítulos de métricas (`.metrics-caption`) convertidos para formato natural sentence case, reduzindo fadiga e ruído visual.
   - **Navegação Horizontal em Viewports Estreitas (Mobile):** Configuração de `overflow-x: auto; flex-wrap: nowrap; -webkit-overflow-scrolling: touch;` na barra de abas (`.app-nav`) para viewports ≤ 640px, permitindo rolagem lateral suave dos botões sem comprimir o texto nem causar overflow horizontal no documento (`clientWidth === scrollWidth`).

---

## 🧪 Verificação e Cobertura de Testes / Testing

A suíte conta com 25 testes automatizados cobrindo os seguintes cenários:
- **`api.test.ts`**: montagem correta de query params para filtros e limites; rejeição síncrona de arquivos >2 MiB; tratamento de erros HTTP (413, 422, 503); acionamento do download de relatórios JSON e Markdown com spy em `HTMLAnchorElement.prototype.click`.
- **`ImportSection.test.tsx`**: bloqueio imediato de arquivos >2 MiB; exibição de métricas após ingestão (linhas totais, eventos importados, duplicatas); exibição da tabela de linhas inválidas com números de linha e motivos (`invalid_timestamp`, `unsupported_message`).
- **`EventsSection.test.tsx`**: renderização da lista com timestamps UTC e badges de resultado; aplicação de filtros e atualização de paginação; **teste de vetor de ataque XSS** comprovando que tags como `<script>` e `<img onerror>` são tratadas como texto inofensivo; **diferenciação de erro 422** sem exibição de falsas contagens `(0)` ou paginação (F4).
- **`AlertsSection.test.tsx`**: listagem com status, regras e IPs de origem; verificação do banner de triagem; **testes de teclado e foco no modal (N1 & N2)**: foco inicial em Keep Editing, ciclo Tab / Shift+Tab confinado, cancelamento com Escape mantendo rascunho e restaurando foco ao gatilho, e descarte com foco no novo alerta.
- **`AlertDetail.test.tsx`**: renderização detalhada de metadados e timeline cronológica de evidências; exibição segura de `import_id` nulo como `Unavailable`; formulário de triagem com contador de caracteres (limite 10.000); envio de PATCH para `/api/alerts/{id}/investigation`; download de relatórios; **teste de resolução assíncrona tardia após desmontagem (N3)** garantindo ausência de efeitos colaterais.
- **`App.test.tsx`**: carregamento integrado de saúde e métricas globais; alternância de abas; indicação visual quando o backend estiver desconectado; **teste de regressão F1, F3, N1 & N2** comprovando proteção de notas, retenção de seleção entre abas, focus trap com Tab/Shift+Tab, Escape com retorno de foco e navegação com foco na aba de destino.
