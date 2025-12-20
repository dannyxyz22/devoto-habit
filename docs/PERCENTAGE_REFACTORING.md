# Refatoração de Cálculos de Percentuais - DRY

Este documento descreve a refatoração realizada para seguir o princípio DRY (Don't Repeat Yourself) nos cálculos de percentuais em todo o projeto.

## Problema Identificado

Havia múltiplas ocorrências de cálculos de percentuais duplicados em diferentes arquivos:

- `Math.round((current_page / total_pages) * 100)` - Para livros físicos
- `Math.min(100, Math.round((wordsUpToCurrent / totalWords) * 100))` - Para livros baseados em palavras
- `Math.round((num / denom) * 100)` - Cálculos genéricos de percentual
- `Math.ceil((percent / 100) * totalPages)` - Conversão de percentual para páginas

## Solução Implementada

Foi criado um arquivo utilitário centralizado: `src/lib/percentageUtils.ts` com funções reutilizáveis.

### Funções Criadas

#### 1. `calculatePercent(part, total, options?)`
Função genérica para calcular percentual de uma razão.

```typescript
calculatePercent(33, 38) // Retorna: 87
calculatePercent(0.5, 1) // Retorna: 50 (para valores decimais 0-1)
```

**Parâmetros:**
- `part`: Valor da parte
- `total`: Valor total
- `options`: Opções opcionais (`min`, `max`, `round`)

#### 2. `calculatePagePercent(currentPage, totalPages)`
Específica para livros físicos (páginas).

```typescript
calculatePagePercent(33, 38) // Retorna: 87
```

#### 3. `calculateWordPercent(wordsUpToCurrent, totalWords)`
Específica para livros baseados em palavras.

```typescript
calculateWordPercent(1000, 5000) // Retorna: 20
```

#### 4. `percentToPages(percent, totalPages, round?)`
Converte percentual para número de páginas.

```typescript
percentToPages(50, 100) // Retorna: 50
percentToPages(50, 100, false) // Retorna: 50.0 (sem arredondar)
```

#### 5. `percentToPagesCeil(percent, totalPages)`
Converte percentual para páginas (sempre arredonda para cima).

```typescript
percentToPagesCeil(4, 38) // Retorna: 2 (Math.ceil(1.52))
```

#### 6. `pagesToPercent(pages, totalPages)`
Converte páginas para percentual (alias de `calculatePagePercent`).

#### 7. `calculateProgressPercent(achieved, target)`
Calcula percentual de progresso (alcançado / meta).

```typescript
calculateProgressPercent(1, 4) // Retorna: 25
calculateProgressPercent(1, null) // Retorna: null
```

#### 8. `calculateRatioPercent(numerator, denominator)`
Calcula percentual de uma razão com denominador mínimo de 1.

```typescript
calculateRatioPercent(10, 20) // Retorna: 50
```

## Arquivos Refatorados

### 1. `src/lib/reading.ts`
- ✅ `computePlanProgressPercent`: Usa `calculateRatioPercent`
- ✅ `computeDailyProgressPercent`: Usa `calculateProgressPercent`

### 2. `src/pages/Index.tsx`
- ✅ Cálculo de percentual de páginas físicas: `calculatePagePercent`
- ✅ Cálculo de percentual de palavras: `calculateWordPercent`
- ✅ Conversão de percentual para páginas: `percentToPages` e `percentToPagesCeil`
- ✅ Cálculo de progresso diário: `calculateProgressPercent`
- ✅ Cálculo de progresso do plano: `calculateRatioPercent`

### 3. `src/pages/PhysicalBookTracker.tsx`
- ✅ Todos os cálculos de percentual de páginas: `calculatePagePercent`

### 4. `src/pages/Reader.tsx`
- ✅ Cálculo de percentual de palavras: `calculateWordPercent`
- ✅ Cálculo de percentual de capítulos: `calculateRatioPercent`

### 5. `src/pages/Library.tsx`
- ✅ Cálculo de percentual de capítulos: `calculateRatioPercent`
- ✅ Cálculo de percentual de páginas: `calculatePagePercent`

### 6. `src/pages/EpubReaderV3.tsx`
- ✅ Conversão de percentual decimal (0-1) para percentual (0-100): `calculatePercent(p, 1)`

### 7. `src/services/data/RxDBDataLayer.ts`
- ✅ Cálculo de percentual ao salvar progresso: `calculatePagePercent`

### 8. `src/lib/dailyRefresh.ts`
- ✅ Cálculo de percentual de palavras: `calculateWordPercent`

## Benefícios da Refatoração

1. **Consistência**: Todos os cálculos de percentual usam a mesma lógica
2. **Manutenibilidade**: Mudanças na lógica de cálculo precisam ser feitas em um único lugar
3. **Testabilidade**: Funções isoladas são mais fáceis de testar
4. **Legibilidade**: Código mais limpo e expressivo
5. **Precisão**: Lógica centralizada garante que todos os cálculos seguem as mesmas regras

## Exemplos de Uso

### Antes (Código Duplicado)
```typescript
// Em Index.tsx
const dbPercent = Math.round((data.current_page || 0) / data.total_pages * 100);

// Em PhysicalBookTracker.tsx
const percent = Math.round((physicalBook.currentPage / physicalBook.totalPages) * 100);

// Em Library.tsx
const percent = Math.round(((book.currentPage || 0) / book.totalPages) * 100);
```

### Depois (Código DRY)
```typescript
// Em todos os arquivos
import { calculatePagePercent } from "@/lib/percentageUtils";

const dbPercent = calculatePagePercent(data.current_page || 0, data.total_pages);
const percent = calculatePagePercent(physicalBook.currentPage, physicalBook.totalPages);
const percent = calculatePagePercent(book.currentPage || 0, book.totalPages);
```

## Validação

Após a refatoração, foi verificado que:
- ✅ Não há mais ocorrências de `Math.round(... * 100)` para cálculos de percentual
- ✅ Todos os arquivos importam e usam as funções utilitárias
- ✅ Não há erros de lint
- ✅ A funcionalidade permanece a mesma

## Manutenção Futura

Ao adicionar novos cálculos de percentual:

1. **Use as funções utilitárias** em vez de calcular manualmente
2. **Se precisar de uma nova função**, adicione em `percentageUtils.ts` seguindo o padrão existente
3. **Documente** a função com JSDoc explicando seu propósito e parâmetros

## Referências

- **Arquivo utilitário**: `src/lib/percentageUtils.ts`
- **Funções de leitura**: `src/lib/reading.ts`
- **Documentação DRY**: https://en.wikipedia.org/wiki/Don%27t_repeat_yourself
