# Plan: BookDetails Page with Progress Chart

Criar uma página unificada de detalhes do livro (`BookDetails.tsx`) que exibe metadados e um gráfico de evolução de leitura ao longo do tempo, funcionando tanto para livros físicos (páginas) quanto EPUBs (percentual).

## Steps

1. **Adicionar método `getBaselinesForBook`** em `src/lib/DataLayer.ts` para buscar todos os baselines históricos de um livro, ordenados por data — atualmente só existe `getDailyBaseline` (single date)

2. **Criar página `BookDetails.tsx`** em `src/pages/` usando o wrapper `src/components/ui/chart.tsx` do recharts já existente com `LineChart` + `AreaChart` para mostrar progresso real vs esperado

3. **Adicionar rota `/book/:bookId`** em `src/App.tsx` antes do catch-all `*`, seguindo o padrão das rotas existentes

4. **Transformar dados de baseline para o gráfico**: mapear `date_iso` → eixo X, `page` (físicos) ou `percent` (EPUBs) → eixo Y, com linha tracejada para progresso esperado

5. **Redirecionar ações apropriadas**: para EPUBs, botão "Continuar Leitura" navega para `/epub/:id`; para físicos, exibir controles de atualização de página inline ou link para `/physical/:id`

6. **Atualizar navegação na Biblioteca**: ao clicar em um livro, ir para `/book/:bookId` ao invés de direto para o leitor/tracker

## Further Considerations

1. **Baselines podem ter lacunas** (dias sem leitura): interpolar valores ou mostrar gaps? 
Manter gaps para representar a realidade

2. **Performance com muitos baselines**: paginar ou limitar últimos N dias? 
Limitar a últimos 90 dias por padrão com opção "ver tudo"*

3. **Migração de UX**: manter `/physical/:bookId` funcionando ou redirecionar para `/book/:bookId`? Pode redirecionar, não está em produção ainda.
