# Cálculo dos Parâmetros da Meta Diária

Este documento descreve como é feito o cálculo dinâmico da **Meta Diária** no componente `Index.tsx`. O cálculo baseia-se no progresso restante dividido pelos dias que faltam para atingir o objetivo definido no plano de leitura.

---

## Componentes do Cálculo

### 1. Baseline do Dia (`baselineForToday`)
O sistema identifica onde o usuário começou a leitura no dia atual para medir o progresso específico de "hoje".
- **Lógica**: Utiliza o valor persistido no RxDB ou `localStorage` correspondente à data atual (ISO).
- **Criação Proativa**: O baseline é criado **imediatamente** quando um livro é adicionado à biblioteca (ou migrado de offline para online), gravando o progresso inicial naquele momento. Isso evita que o esforço feito no dia da adição seja "zerado" ao abrir o dashboard.
- **Precisão Física**: Para livros físicos, o campo `page` armazena o número exato da página inicial do dia, evitando erros de arredondamento em porcentagem.
- **Implementação**: Localizado na função `useMemo` de `baselineForToday` no `Index.tsx`.

### 2. Dias Restantes (`daysRemaining`)
- **Lógica**: Calcula a diferença em dias entre a data alvo (`targetDateISO`) e a data atual.
- **Garantia**: O valor mínimo retornado é sempre 1 para evitar divisões por zero ou valores negativos.

### 3. Alvo Diário (`dailyTargetWords`)
Este é o valor que o usuário deve ler hoje para cumprir o plano.
- **Fórmula Geral**: `(Total Final de Leitura - Progresso Inicial do Dia) / Dias Restantes`.
- **EPUB/Físico**: `(100 - baselineForToday.percent) / daysRemaining`.
- **Livros Nativos**: `(Palavras até o Alvo - Palavras no Início do Dia) / Dias Restantes`.

### 4. Realizado Hoje (`achievedWordsToday`)
Representa o avanço em tempo real do usuário desde o início do dia.
- **Fórmula**: `Progresso Atual - Progresso no Baseline`.

### 5. Porcentagem de Conclusão da Meta (`dailyProgressPercent`)
A barra de progresso visual que indica quão perto o usuário está de bater a meta de hoje.
- **Cálculo**: `(Realizado Hoje / Alvo Diário) * 100`.

---

## Particularidades por Tipo de Livro

| Tipo | Unidade de Medida | Detalhe do Cálculo |
| :--- | :--- | :--- |
| **Livro Físico** | Páginas | O cálculo usa a página atual e total. A porcentagem da meta é derivada da diferença de páginas em relação ao baseline de páginas do dia. |
| **EPUB / Upload** | Porcentagem (%) | O alvo final é fixado em 100%. A meta diária é a porcentagem restante dividida pelos dias. |
| **Livros Nativos** | Palavras | Usa a contagem real de palavras de cada capítulo extraída do JSON do livro para maior precisão. |

## Fluxo de Atualização Reativa
Os valores são atualizados automaticamente no `Index.tsx` através de subscriptions do RxDB:
1. **Progresso**: Reage a mudanças em `books` ou `user_epubs`.
2. **Plano**: Reage a mudanças na `reading_plans`.
3. **Baseline**: Reage a mudanças ou sincronizações na `daily_baselines`.
