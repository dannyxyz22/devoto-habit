# Estratégia de Armazenamento de Baselines

Este documento descreve a arquitetura de armazenamento dos baselines diários, incluindo estimativas de crescimento, normalização de dados entre diferentes tipos de livros, e estratégias de retenção a longo prazo.

---

## 1. Estrutura dos Dados

Cada entrada na tabela `daily_baselines` contém:

| Campo | Tipo | Tamanho Estimado | Descrição |
|-------|------|------------------|-----------|
| `id` | UUID | 16 bytes | Identificador único |
| `user_id` | UUID | 16 bytes | ID do usuário |
| `book_id` | TEXT | ~20 bytes | ID do livro (string) |
| `date_iso` | TEXT | 10 bytes | Data no formato YYYY-MM-DD |
| `words` | INTEGER | 4 bytes | Palavras lidas (livros JSON nativos) |
| `percent` | FLOAT | 8 bytes | Porcentagem de progresso |
| `page` | INTEGER (nullable) | 4 bytes | Página inicial (livros físicos) |
| `_modified` | BIGINT | 8 bytes | Timestamp de modificação |
| **Overhead (índices + row metadata)** | — | ~40 bytes | Overhead do PostgreSQL |
| **Total por linha** | — | **~126 bytes** | Tamanho aproximado |

---

## 2. Estimativa de Crescimento

### Cenário Base: Leitor Ativo
- **3 livros simultâneos** lidos todos os dias
- **1.095 baselines/ano** (3 × 365 dias)
- **138 KB/ano/usuário** (1.095 × 126 bytes)

### Cenário Escalado: 10.000 Usuários
- **1,38 GB/ano** para 10.000 usuários ativos
- **6,9 GB em 5 anos** (sem agregação ou limpeza)

### Camada Gratuita do Supabase (500 MB)
- Comporta aproximadamente **3.600 usuários ativos** por 1 ano
- Ou **720 usuários ativos** por 5 anos (sem agregação)

**Conclusão:** O custo de armazenamento é baixo. Para aplicações pequenas/médias, os baselines históricos **não serão um problema** mesmo após anos de operação.

---

## 3. Normalização: Páginas vs. Percentuais

### Problema
Diferentes tipos de livros usam métricas distintas:
- **Livros Físicos:** Páginas (ex: Página 50 de 300)
- **EPUBs:** Percentuais (ex: 25,5%)
- **Livros JSON Nativos:** Palavras + Percentuais derivados

### Solução Implementada: Campo Dual

A tabela `daily_baselines` armazena **ambos** os campos:

```typescript
{
  percent: number;  // Sempre presente (normalizado)
  page?: number;    // Opcional (apenas livros físicos)
  words: number;    // 0 para EPUBs/Físicos, N para livros JSON
}
```

#### Regras de Gravação:
1. **Livros Físicos:**
   - `percent` = calculado a partir de `currentPage / totalPages * 100`
   - `page` = número exato da página inicial do dia
   - `words` = 0

2. **EPUBs:**
   - `percent` = porcentagem fornecida pelo `react-reader`
   - `page` = `undefined`
   - `words` = 0

3. **Livros JSON Nativos:**
   - `percent` = calculado a partir de `wordsRead / totalWords * 100`
   - `page` = `undefined`
   - `words` = contagem exata de palavras

#### Regras de Leitura:
Para calcular o **progresso do dia**, sempre usamos a **métrica nativa** do livro:

```typescript
// Em Index.tsx
const pagesReadToday = useMemo(() => {
  if (!activeIsPhysical) return null;
  
  // FÍSICA: usa página exata do baseline, se disponível
  const baselinePage = baselineEntryForToday?.page ?? 
    Math.round((baselineEntryForToday?.percent ?? 0) * totalPages / 100);
  
  return currentPage - baselinePage;
}, [activeIsPhysical, baselineEntryForToday, currentPage, totalPages]);

const percentReadToday = useMemo(() => {
  if (!isPercentBased) return null;
  
  // EPUB/JSON: usa porcentagem diretamente
  return Math.max(0, currentPercent - (baselineEntryForToday?.percent ?? 0));
}, [isPercentBased, currentPercent, baselineEntryForToday]);
```

### Vantagens desta Abordagem:
- ✅ **Precisão Máxima:** Livros físicos usam exatamente a página gravada, evitando erros de arredondamento.
- ✅ **Compatibilidade Universal:** EPUBs e livros JSON usam percentuais normalizados.
- ✅ **Retrocompatibilidade:** Se `page` for `null`, fallback para cálculo via `percent`.

---

## 4. Casos de Uso dos Baselines Históricos

### Atual (Implementado)
- Cálculo da **Meta Diária** (apenas baseline de hoje)
- Exibição do **"Marco inicial de hoje"** no dashboard

### Futuro (Potencial)
- **Gráfico de Progresso Semanal/Mensal**
  - Ex: "Você leu 150 páginas esta semana"
  - Ex: "Sua média diária em janeiro foi 20 páginas"

- **Retrospectiva Anual (Estilo Spotify Wrapped)**
  - Ex: "Em 2025 você leu 5.000 páginas em 12 livros diferentes"
  - Ex: "Seu dia mais produtivo foi 10 de março com 80 páginas"

- **Streaks e Gamificação**
  - Ex: "Você atingiu sua meta por 30 dias consecutivos 🔥"
  - Ex: Badge desbloqueado: "Maratonista" (100+ páginas em um dia)

- **Exportação de Dados**
  - Download de CSV/JSON com todo o histórico de leitura

---

## 5. Estratégias de Retenção a Longo Prazo

Se o volume de dados se tornar um problema futuramente, considere:

### 5.1. Agregação Mensal
No final de cada mês, consolidar os 30 baselines diários em um único registro mensal:

```sql
INSERT INTO monthly_reading_summary (user_id, book_id, month_iso, pages_read, percent_progress)
SELECT 
  user_id,
  book_id,
  DATE_TRUNC('month', date_iso) as month_iso,
  SUM(COALESCE(page, 0)) as pages_read,
  MAX(percent) - MIN(percent) as percent_progress
FROM daily_baselines
WHERE date_iso < DATE_TRUNC('month', CURRENT_DATE) -- Mês anterior
GROUP BY user_id, book_id, month_iso;

-- Deletar baselines mensais após agregação
DELETE FROM daily_baselines 
WHERE date_iso < DATE_TRUNC('month', CURRENT_DATE);
```

**Economia:** Reduz ~30 linhas para 1 linha por livro/mês (96% de redução).

### 5.2. Cold Storage
Mover baselines com mais de 1 ano para outra tabela ou serviço de arquivamento (ex: S3 + Parquet).

### 5.3. TTL (Time-to-Live) Configurável
Permitir que usuários configurem quanto tempo desejam manter o histórico:
- **Padrão:** 1 ano
- **Premium:** Ilimitado
- **Minimalista:** 30 dias

---

## 6. Equalização para Gráficos: Páginas vs. Percentuais

### Problema
Como exibir em um **único gráfico** o progresso de leitura quando:
- Usuário leu **50 páginas** de um livro físico de 300 páginas (16,7%)
- Usuário leu **8,5%** de um EPUB (sem contagem de páginas)

### Soluções Disponíveis

#### **Opção 1: Normalizar Tudo para Percentual do Livro**
Converter páginas lidas para percentual do livro total.

```typescript
// Exemplo de cálculo
const dailyProgress = baselines.map(baseline => {
  const book = getBook(baseline.book_id);
  
  if (book.type === 'physical' && baseline.page !== undefined) {
    const pagesRead = /* próxima página */ - baseline.page;
    return {
      date: baseline.date_iso,
      progress: (pagesRead / book.total_pages) * 100, // Normalizado em %
      label: `${pagesRead} páginas (${progress.toFixed(1)}%)`
    };
  } else {
    const percentRead = /* próximo % */ - baseline.percent;
    return {
      date: baseline.date_iso,
      progress: percentRead, // Já está em %
      label: `${percentRead.toFixed(1)}%`
    };
  }
});
```

**Gráfico exibido:**
```
Dia 10/01: ███████░░░░░░░░ 15,2% (Imitação de Cristo)
Dia 11/01: ████████████░░░ 22,5% (Confissões - EPUB)
Dia 12/01: ██████░░░░░░░░░ 12,8% (Suma Teológica)
```

✅ **Prós:**
- Unidades consistentes (sempre em %)
- Fácil de comparar: "leu mais no dia 11"
- Implementação simples

❌ **Contras:**
- **Perde o contexto de volume absoluto**: 10% de um livro de 100 páginas (10 páginas) parece igual a 10% de um livro de 1000 páginas (100 páginas).
- Não transmite a "quantidade de trabalho" real.

---

#### **Opção 2: Estimar Páginas Equivalentes para EPUBs**
Converter percentual de EPUB para páginas estimadas baseado em metadados do livro.

```typescript
// Adicionar campo "estimated_pages" à tabela user_epubs (obtido via metadata do EPUB)
const dailyProgress = baselines.map(baseline => {
  const book = getBook(baseline.book_id);
  
  if (book.type === 'physical') {
    return {
      date: baseline.date_iso,
      pages: /* próxima página */ - baseline.page,
      label: `50 págs`
    };
  } else {
    const percentRead = /* próximo % */ - baseline.percent;
    const estimatedPages = (book.estimated_pages || 200) * (percentRead / 100);
    return {
      date: baseline.date_iso,
      pages: Math.round(estimatedPages),
      label: `~${Math.round(estimatedPages)} págs equiv.`
    };
  }
});
```

**Gráfico exibido:**
```
Dia 10/01: ██████████░░░░░░ 50 págs (Imitação de Cristo)
Dia 11/01: ████████████████ 85 págs equiv. (Confissões - EPUB)
Dia 12/01: ████░░░░░░░░░░░░ 30 págs (Suma Teológica)
```

✅ **Prós:**
- Unidades mais "tangíveis" para o usuário (páginas)
- Reflete melhor o volume absoluto de leitura

❌ **Contras:**
- **Estimativa pode ser imprecisa**: EPUBs não têm paginação fixa.
- Depende de metadados do EPUB (nem sempre disponíveis).

**Como obter `estimated_pages` do EPUB:**
```typescript
// Durante o upload do EPUB em saveUserEpub
const book = ePub(arrayBuffer);
await book.ready;

// MÉTODO 1: Usar metadata (se disponível)
const pageCount = book.packaging?.metadata?.page_count;

// MÉTODO 2: Estimar baseado em caracteres
const spine = await book.loaded.spine;
let totalChars = 0;
for (const item of spine.items) {
  const doc = await item.load(book.load.bind(book));
  totalChars += doc.textContent?.length || 0;
}
const estimatedPages = Math.ceil(totalChars / 1800); // ~1800 chars por página
```

---

#### **Opção 3: Usar Tempo de Leitura como Métrica Universal**
Registrar **minutos lidos** em vez de páginas ou percentuais.

```typescript
// Armazenar em daily_baselines ou em tabela separada
{
  date_iso: '2025-01-10',
  book_id: 'imitacao-cristo',
  minutes_read: 25
}
```

**Gráfico exibido:**
```
Dia 10/01: ██████████░░░░░░ 25 min (Imitação de Cristo)
Dia 11/01: ████████████████ 45 min (Confissões - EPUB)
Dia 12/01: ████░░░░░░░░░░░░ 18 min (Suma Teológica)
```

✅ **Prós:**
- **Métrica universal**: Funciona para qualquer tipo de livro
- Focado no esforço (tempo dedicado), não na velocidade
- Já existe infraestrutura (`user_stats.minutes_by_date`)

❌ **Contras:**
- Requer tracking ativo de tempo (já implementado no app)
- "25 minutos" não diz quanto progresso foi feito

---

#### **Opção 4: Gráficos Separados por Tipo de Livro**
Aceitar que são métricas diferentes e renderizar gráficos distintos.

**Gráfico 1: Livros Físicos (Páginas)**
```
Dia 10/01: ████████ 50 págs (Imitação de Cristo)
Dia 12/01: ██████ 30 págs (Suma Teológica)
```

**Gráfico 2: EPUBs (Percentual)**
```
Dia 11/01: ████████████ 22,5% (Confissões)
```

✅ **Prós:**
- **Correto tecnicamente**: Cada métrica no seu contexto
- Sem estimativas ou conversões imprecisas

❌ **Contras:**
- UX mais complexa: usuário precisa olhar 2 gráficos
- Perde comparação direta entre dias com tipos de livros diferentes

---

### Recomendação de Implementação

Para um **gráfico de médias de leitura por dia**, sugiro **Opção 1 (Percentual Normalizado)** + **Tooltip com Detalhe**:

```typescript
// No gráfico, sempre mostrar em %
<BarChart data={dailyProgress}>
  <Bar dataKey="progress" fill="#8884d8" />
  <Tooltip content={(props) => {
    const { payload } = props;
    if (!payload?.[0]) return null;
    
    const item = payload[0].payload;
    return (
      <div className="bg-white p-2 border rounded shadow">
        <p className="font-bold">{item.date}</p>
        <p>{item.bookTitle}</p>
        <p className="text-primary">{item.progress.toFixed(1)}% do livro</p>
        {item.type === 'physical' && (
          <p className="text-muted-foreground">{item.pagesRead} páginas</p>
        )}
      </div>
    );
  }} />
</BarChart>
```

**Resultado Visual:**
- Barra mostra **% do livro lido** (normalizado)
- Hover/Tooltip revela o **número de páginas** se for livro físico
- Usuário sabe que "15% hoje" significa progresso proporcional, mas pode ver o absoluto se quiser.

**Alternativa para KPI agregado (estatísticas)**:
Se o objetivo for mostrar "Total de páginas lidas no mês", use **Opção 2** com estimativa de páginas para EPUBs, mas deixe claro na UI que EPUBs são estimativas:

```tsx
<Card>
  <CardTitle>Janeiro 2025</CardTitle>
  <p className="text-3xl font-bold">1.250 páginas</p>
  <p className="text-xs text-muted-foreground">
    * EPUBs convertidos usando média de 200 palavras/página
  </p>
</Card>
```

---

## 7. Política de Privacidade

Os baselines contêm dados comportamentais do usuário (quando e quanto leu). Garantir:
- ✅ Deletar todos os baselines quando o usuário excluir a conta (GDPR compliance)
- ✅ Oferecer exportação de dados (direito à portabilidade)
- ✅ Criptografar dados em trânsito (HTTPS) e em repouso (Supabase RLS + pgcrypto se aplicável)

---

## 7. Recomendação Final

**NÃO remover baselines antigos por enquanto.** O custo é desprezível e o potencial para features de engajamento é enorme.

Quando o app atingir **>5.000 usuários ativos** ou **>100 GB de dados**, revisite este documento e implemente agregação mensal.
