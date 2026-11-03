# Demonstração local — 3 a 5 minutos

Siga o README para iniciar banco, API e interface. Use somente amostras sintéticas; não apague dados para repetir a apresentação.

1. Importe `samples/lab_auth_v1.log`: banco vazio produz 35 eventos e seis alertas. Reimporte: 35 duplicatas, zero eventos novos.
2. Selecione `success_after_failures` de `192.0.2.88`, usuário `erin`. Mostre as quatro evidências, horários UTC e primeira referência da importação.
3. Explique a hipótese e falsos positivos do [caso](portfolio-case.md). Alerta não confirma invasão.
4. Em laboratório, salve nota sintética, estado e classificação. Selecione outro alerta e reabra para conferir persistência.
5. Exporte Markdown/JSON e confira notas, quatro evidências e aviso de triagem. Não mostre `.env`.
6. Mostre um caso negativo no gabarito `samples/SCENARIOS.md`; explique por que não dispara.

Validações realizadas e lacunas estão em [aceite](acceptance.md). Capturas: [timeline](screenshots/desktop-timeline.png), [abas mobile](screenshots/mobile-tabs.png), [modal](screenshots/mobile-modal.png). A nota da captura é uma nota sintética de teste, não a conclusão analítica do caso.
