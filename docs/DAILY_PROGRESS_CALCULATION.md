# Como o Valor "0% — 0/4 %" é Carregado

Este documento explica como o valor exibido na seção "Meta diária" da página inicial (`Index.tsx`) é calculado e carregado.

## Localização no Código

O valor é exibido na linha **888-889** de `src/pages/Index.tsx`:

```typescript
<p className="text-sm text-muted-foreground mt-2">
  {dailyProgressPercent}% — {achievedWordsToday}/{dailyTargetWords} {isPercentBased ? "%" : "palavras"}
</p>
```

## Formato do Valor

O formato é: `{dailyProgressPercent}% — {achievedWordsToday}/{dailyTargetWords} {unidade}`

No exemplo "0% — 0/4 %":
- `dailyProgressPercent` = `0`
- `achievedWordsToday` = `0`
- `dailyTargetWords` = `4`
- `isPercentBased` = `true` (por isso mostra "%" em vez de "palavras")

## Fluxo de Cálculo

### 1. Progresso Ativo (`activeBookProgress`)

O progresso do livro ativo é carregado reativamente do RxDB:

```typescript
// Linha 45-47: Estado inicial
const [activeBookProgress, setActiveBookProgress] = useState<{
  partIndex: number; 
  chapterIndex: number; 
  percent: number
}>({ partIndex: 0, chapterIndex: 0, percent: 0 });

// Linha 742: Usa o progresso reativo
const p = activeBookProgress;
```

**Fonte dos dados:**
- **RxDB Collection**: `books` ou `user_epubs`
- **Campos usados**: `percentage`, `part_index`, `chapter_index`
- **Atualização**: Reativa via subscription RxDB (linhas 57-198)

### 2. Tipo de Livro (`isPercentBased`)

Determina se o cálculo usa porcentagem (EPUB/Físico) ou palavras:

```typescript
// Linha 745
const isPercentBased = activeIsEpub || activeIsPhysical;
```

- **`true`**: Livros EPUB ou Físicos → usa `percentage`
- **`false`**: Livros com estrutura de partes/capítulos → usa contagem de palavras

### 3. Baseline do Dia (`baselineForToday`)

O baseline representa o estado inicial do livro no início do dia:

```typescript
// Linhas 768-776
const baselineForToday = useMemo(() => {
  if (!activeBookId) return isPercentBased ? (p.percent || 0) : wordsUpToCurrent;
  
  // 1. Tenta usar baseline reativo do RxDB
  if (activeBaseline) return isPercentBased ? activeBaseline.percent : activeBaseline.words;
  
  // 2. Fallback para localStorage
  const base = getDailyBaseline(activeBookId, todayISO);
  if (base) return isPercentBased ? base.percent : base.words;
  
  // 3. Fallback final: usa progresso atual
  return isPercentBased ? (p.percent || 0) : wordsUpToCurrent;
}, [activeBookId, isPercentBased, todayISO, wordsUpToCurrent, p.percent, activeBaseline]);
```

**Fontes (em ordem de prioridade):**
1. `activeBaseline` (RxDB subscription de `daily_baselines`)
2. `getDailyBaseline()` (localStorage)
3. Progresso atual (`p.percent` ou `wordsUpToCurrent`)

### 4. Meta Diária em Palavras/Percentual (`dailyTargetWords`)

Calcula quantas palavras ou percentual devem ser lidas hoje:

```typescript
// Linhas 803-808
const dailyTargetWords = useMemo(
  () => isPercentBased
    // Para EPUB/Físico: usa porcentagem
    ? (daysRemaining 
        ? Math.ceil(Math.max(0, 100 - (baselineForToday || 0)) / daysRemaining) 
        : null)
    // Para livros com estrutura: usa palavras
    : computeDailyTargetWords(targetWords, baselineForToday, daysRemaining),
  [isPercentBased, targetWords, baselineForToday, daysRemaining]
);
```

**Para livros baseados em porcentagem (EPUB/Físico):**
```typescript
// Fórmula: (100% - baseline%) / dias restantes
Math.ceil(Math.max(0, 100 - baselineForToday) / daysRemaining)
```

**Exemplo:**
- `baselineForToday` = 0%
- `daysRemaining` = 25 dias
- `dailyTargetWords` = `Math.ceil((100 - 0) / 25)` = `4%`

### 5. Palavras/Percentual Conquistadas Hoje (`achievedWordsToday`)

Calcula quanto foi lido desde o início do dia:

```typescript
// Linhas 809-812
const achievedWordsToday = useMemo(
  () => isPercentBased 
    // Para EPUB/Físico: diferença de porcentagem
    ? Math.max(0, (p.percent || 0) - (baselineForToday || 0))
    // Para livros com estrutura: diferença de palavras
    : computeAchievedWordsToday(wordsUpToCurrent, baselineForToday),
  [isPercentBased, p.percent, baselineForToday, wordsUpToCurrent]
);
```

**Para livros baseados em porcentagem:**
```typescript
Math.max(0, currentPercent - baselinePercent)
```

**Exemplo:**
- `p.percent` = 0%
- `baselineForToday` = 0%
- `achievedWordsToday` = `Math.max(0, 0 - 0)` = `0`

### 6. Porcentagem de Progresso Diário (`dailyProgressPercent`)

Calcula a porcentagem da meta diária alcançada:

```typescript
// Linhas 813-816
const dailyProgressPercent = useMemo(
  () => computeDailyProgressPercent(achievedWordsToday, dailyTargetWords),
  [achievedWordsToday, dailyTargetWords]
);
```

**Função `computeDailyProgressPercent`** (`src/lib/reading.ts:112-115`):
```typescript
export const computeDailyProgressPercent = (
  achievedWordsToday: number,
  dailyTargetWords: number | null
): number | null => 
  dailyTargetWords 
    ? Math.min(100, Math.round((achievedWordsToday / dailyTargetWords) * 100)) 
    : null;
```

**Fórmula:**
```typescript
Math.min(100, Math.round((achievedWordsToday / dailyTargetWords) * 100))
```

**Exemplo:**
- `achievedWordsToday` = 0
- `dailyTargetWords` = 4
- `dailyProgressPercent` = `Math.min(100, Math.round(0 / 4 * 100))` = `0%`

## Dependências e Ordem de Cálculo

```
1. activeBookId (do user_stats.last_book_id)
   ↓
2. activeBookProgress (do RxDB: books/user_epubs)
   ↓
3. activeBaseline (do RxDB: daily_baselines)
   ↓
4. baselineForToday (calculado)
   ↓
5. daysRemaining (do plan.targetDateISO)
   ↓
6. dailyTargetWords (calculado)
   ↓
7. achievedWordsToday (calculado)
   ↓
8. dailyProgressPercent (calculado)
```

## Condições para Exibição

O valor só é exibido se todas as condições forem verdadeiras (linha 885):

```typescript
{used && activeBookId && dailyProgressPercent != null ? (
  // Exibe o progresso
) : (
  // Exibe mensagem padrão
)}
```

- **`used`**: Indica que o usuário já usou a aplicação (tem dados)
- **`activeBookId`**: Há um livro ativo selecionado
- **`dailyProgressPercent != null`**: A meta diária foi calculada com sucesso

## Fontes de Dados

### RxDB Collections

1. **`books`** ou **`user_epubs`**
   - Campo: `percentage`
   - Atualização: Reativa via subscription

2. **`daily_baselines`**
   - Campos: `words`, `percent`
   - Chave: `{user_id}:{book_id}:{date_iso}`
   - Atualização: Reativa via subscription

3. **`reading_plans`**
   - Campo: `target_date_iso`
   - Usado para calcular `daysRemaining`

4. **`user_stats`**
   - Campo: `last_book_id`
   - Usado para determinar `activeBookId`

### localStorage

- **`planStart:{bookId}`**: Posição inicial do plano de leitura
- **`dailyBaseline:{bookId}:{dateISO}`**: Fallback para baseline (se RxDB não disponível)

## Exemplo Completo: "0% — 0/4 %"

### Estado Inicial

```typescript
activeBookId = "book-123"  // Do user_stats.last_book_id
activeBookProgress = { partIndex: 0, chapterIndex: 0, percent: 0 }
activeBaseline = null  // Não existe baseline para hoje ainda
isPercentBased = true  // É um livro EPUB
todayISO = "2024-12-15"
```

### Cálculo Passo a Passo

1. **`baselineForToday`**:
   - `activeBaseline` = `null` → tenta localStorage
   - `getDailyBaseline("book-123", "2024-12-15")` = `null`
   - Fallback: `p.percent || 0` = `0`

2. **`daysRemaining`**:
   - `plan.targetDateISO` = `"2024-12-31"`
   - `computeDaysRemaining("2024-12-31")` = `16` dias

3. **`dailyTargetWords`**:
   - `isPercentBased` = `true`
   - `Math.ceil((100 - 0) / 16)` = `7%` (mas no exemplo mostra 4%, então `daysRemaining` deve ser 25)

4. **`achievedWordsToday`**:
   - `Math.max(0, 0 - 0)` = `0`

5. **`dailyProgressPercent`**:
   - `Math.min(100, Math.round(0 / 4 * 100))` = `0%`

### Resultado Final

```
0% — 0/4 %
```

Onde:
- `0%` = `dailyProgressPercent` (0% da meta diária alcançada)
- `0` = `achievedWordsToday` (0% lido hoje)
- `4` = `dailyTargetWords` (meta: 4% por dia)
- `%` = unidade (porque `isPercentBased = true`)

## Atualizações Reativas

Todos os valores são atualizados automaticamente quando:

1. **Progresso do livro muda** → Subscription RxDB em `books`/`user_epubs`
2. **Baseline muda** → Subscription RxDB em `daily_baselines`
3. **Plano de leitura muda** → Subscription RxDB em `reading_plans`
4. **Livro ativo muda** → Subscription RxDB em `user_stats`

As subscriptions são configuradas nas linhas:
- **Progresso**: 57-198
- **Baseline**: 400-450 (aproximadamente)
- **Plano**: 342-399
- **User Stats**: 219-339

## Troubleshooting

### Valor sempre mostra "0% — 0/4 %"

**Possíveis causas:**

1. **Sem baseline para hoje**:
   - Verifique se `daily_baselines` tem entrada para `{user_id}:{book_id}:{todayISO}`
   - O baseline é criado automaticamente quando há progresso (linha 797)

2. **Sem plano de leitura**:
   - Verifique se `reading_plans` tem entrada com `target_date_iso`
   - Sem plano, `daysRemaining` = `null` → `dailyTargetWords` = `null`

3. **Progresso não está sendo atualizado**:
   - Verifique subscription RxDB em `books`/`user_epubs`
   - Verifique se `percentage` está sendo salvo corretamente

4. **Livro não é do tipo correto**:
   - Verifique se `activeIsEpub` ou `activeIsPhysical` está correto
   - Isso afeta se usa porcentagem ou palavras

### Como debugar

Adicione logs temporários:

```typescript
console.log('[Daily Progress Debug]', {
  activeBookId,
  isPercentBased,
  p: p.percent,
  baselineForToday,
  daysRemaining,
  dailyTargetWords,
  achievedWordsToday,
  dailyProgressPercent
});
```

## Referências

- **Código principal**: `src/pages/Index.tsx` (linhas 803-816)
- **Funções de cálculo**: `src/lib/reading.ts`
- **RxDB schemas**: `src/lib/database/schema.ts`
- **DataLayer**: `src/services/data/RxDBDataLayer.ts`
