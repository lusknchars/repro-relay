# reptest — Repro Relay frontend prototype

Frontend de teste para o Repro Relay, recompondo os blocos do template PaceUI / Shadcn UI Kit
(sidebar com grupos, topbar com workspace switcher, tabelas, charts, chat, file manager, AI analytics,
customizador de tema) para a proposta do brief de 14 Sep 2026.

## Rodar

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # gera dist/index.html (single-file, abre direto no navegador)
```

Stack: Vite + React 18 + TypeScript + Tailwind v4 + lucide-react + recharts. Componentes seguem a
convenção shadcn (`cn`, `cva`) para migrar depois para os componentes Radix do template real.

## Mapa de telas → blocos do PaceUI reaproveitados

| Destino | Blocos do template | O que virou |
|---|---|---|
| **Work** | Orders table, Chats app, Notes, Kanban states | Lista ordenada de trabalho (Needs your decision / Working / Blocked / Finished) + workspace com Conversa e Agent work (Findings / Changes / Tests / Activity / Context used) + barra de decisão com estado real (`Checking whether the action started`, `Evidence changed`, `Stopping`). |
| **Team** | Mail app (3 painéis + card "Pace AI Insights") e Chat app (lista de conversas, thread, "Shared media & info") | Canais por work record/projeto + DMs; thread com cards de contexto (work record linkado, Relay summary com fontes, evidência, pedido de fato ao owner gravado como human observation, pedido de decisão com o mesmo escopo/estado do Work); rail "Shared context" (registro, decisões, evidências, arquivos, membros). |
| **Knowledge** | Notes, File Manager list | Três camadas: reviewed knowledge, private notes (hide local ≠ delete cloud), revoked; view de context changes. |
| **Usage** | Crypto Wallet dashboard (target cards com barra segmentada, Market Trends, Comparison, Portfolio donut, Secure Vault, My Wallets, API card) + AI Analytics | Caps por runtime (cooperativo, não prepago), *Spend on one problem* (gasto por work record com seletor), *Cost per attempt* (tokens por run, tentativa mais cara destacada), *Where the money went* (por fase), *Spend by problem* (alocação + custo por resultado verificado), cards de agentes, *Efficiency* (custo por outcome verificado, baseline obrigatório para claims de economia), tabela de auditoria. `Cost not reported` nunca vira zero. |
| **Settings** | Connections/CRM cards, Vercel-style scoped settings, HR/team | Conexões com próxima ação real (Test / Fix / Open billing / Reconnect), painel de detalhe (alias, scope, endpoint, credencial mascarada, último request verificado), permissões, automação, Plow statuses, time/convites. |
| **Setup** | Onboarding stepper | 7 passos com Back, critério de conclusão, erro recuperável (`provider credit balance`). |
| **Appearance** | Theme customizer do PaceUI | Mode, accent presets, radius, sidebar variant (sidebar/floating/inset), collapsed, layout full/centered, densidade, tamanho de texto, reduce motion, ambient effect. Persistido em `localStorage` (`reptest.theme.v1`). |

## Convenções do brief aplicadas

- Tokens semânticos compartilhados light/dark em `src/index.css`; accent azul é o default e casa com o efeito ASCII da sidebar e o perspective grid.
- Linhas + separadores para conteúdo repetido; cards só para decisões distintas. Sem grid de contadores.
- Body 14–16px, `tnum` para números, mono só em paths/commands/diffs.
- Feedback de controle 140 ms, painéis 200 ms; `prefers-reduced-motion` e toggle manual respeitados; efeito ambiente pausa com a aba oculta.
- Cada frame carrega uma tag `Existing / Recompose existing / Needs backend / Future concept` (`CapTag`).
- Todos os dados em `src/lib/data.ts` são exemplos de protótipo (caso fictício REL-142, export failure).

## Estrutura

```
src/
  index.css                 tokens, presets de accent, motion, efeito ambiente
  theme/ThemeProvider.tsx   personalização persistida
  theme/Customizer.tsx      painel Appearance
  components/ui/index.tsx   Button (pending/outcome), Badge, Card, Input, Switch, Segmented, Tabs, …
  components/shell/Shell.tsx sidebar (3 variantes), topbar, drawer mobile, bottom nav
  components/work-bits.tsx  StateBadge, SourceBadge, CapTag, LastConfirmed
  pages/Work.tsx | Team.tsx | Knowledge.tsx | Usage.tsx | Settings.tsx | Setup.tsx
  lib/data.ts               dados de protótipo
```
