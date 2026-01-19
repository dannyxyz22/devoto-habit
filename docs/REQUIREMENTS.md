## Assistant

## Especificação de Requisitos - Leitura Devota

### 1. Visão Geral do Produto

**Leitura Devota** é uma aplicação web e mobile (PWA + Android nativo via Capacitor) focada em leitura e acompanhamento de hábitos devocionais, permitindo a leitura de livros digitais (EPUB), livros físicos e livros estruturados (JSON), com sincronização multi-dispositivo.

---

### 2. Requisitos Funcionais

#### 2.1 Gerenciamento de Biblioteca

##### RF-01: Livros Estáticos (Catálogo Pré-definido)
- O sistema deve incluir livros clássicos católicos pré-carregados
- Livros estáticos são definidos em `src/lib/books.ts`
- Suporta dois formatos: `json` (estruturado em partes/capítulos) e `epub`
- IDs de livros estáticos **NÃO podem** começar com `user-` ou `physical-`
- Validação automática impede IDs inválidos na inicialização

**Livros incluídos por padrão:**
- "Introdução à Vida Devota (Filotéia)" - São Francisco de Sales (JSON)
- "Imitação de Cristo" - Tomás de Kempis (EPUB)
- "Confissões" - Santo Agostinho (EPUB)
- "Compêndio do Catecismo da Igreja Católica" (EPUB)

##### RF-02: Upload de EPUBs pelo Usuário
- O usuário pode fazer upload de EPUBs pessoais
- Metadados (título, autor) são extraídos automaticamente via epubjs
- Capa do livro é extraída e armazenada como Data URL
- Arquivo EPUB armazenado no IndexedDB local
- IDs gerados automaticamente: `user-{timestamp}-{random}`
- Suporte a re-upload em novos dispositivos quando sincronizado da nuvem

##### RF-03: Rastreamento de Livros Físicos
- O usuário pode adicionar livros físicos manualmente
- Busca automática de metadados via Google Books API (primária) e Open Library API (fallback)
- Download automático de capas com bypass de CORS (proxy `images.weserv.nl`)
- Cache de resultados de busca por 24 horas
- Capas convertidas para Data URLs para acesso offline
- IDs gerados: `physical-{timestamp}-{random}`
- Campos obrigatórios: título, número total de páginas

##### RF-04: Exclusão de Livros
- Soft delete (flag `_deleted: true`)
- Sincronização da exclusão entre dispositivos

---

#### 2.2 Leitores

##### RF-05: Leitor JSON (Livros Estruturados)
- Navegação por partes e capítulos
- Contagem de palavras por capítulo
- Configurações de leitura: tema (claro/escuro/sistema), tamanho de fonte, espaçamento de linha, alinhamento de texto
- Barra de progresso por palavras lidas
- Persistência de posição (partIndex, chapterIndex)

##### RF-06: Leitor EPUB
- Baseado no react-reader (epubjs)
- Suporte a CFI (Canonical Fragment Identifier) para posição
- Cache LRU de "locations" para cálculo de porcentagem (limite: 5 livros)
- Restauração instantânea de progresso nas aberturas seguintes
- Salvamento debounced para evitar writes excessivos
- Suporte a EPUBs externos (Gutenberg) via proxy CORS

##### RF-07: Rastreador de Livro Físico
- Entrada de página atual via input numérico
- Cálculo automático de porcentagem: `(página_atual / total_páginas) * 100`
- Edição de metadados (título, autor, total de páginas, capa)
- Botões de incremento/decremento de página

---

#### 2.3 Metas e Planos de Leitura

##### RF-08: Plano de Leitura
- Usuário define data-alvo para conclusão
- Cálculo automático de meta diária baseado em:
  - **Livros JSON**: palavras por dia
  - **EPUBs**: porcentagem por dia
  - **Livros físicos**: páginas por dia
- Persistência do ponto inicial (`start_percent`, `start_words`, `start_part_index`, `start_chapter_index`)
- ID composto: `{user_id}:{book_id}`

##### RF-09: Meta Diária
- Cálculo: `(Progresso Final - Progresso Inicial do Dia) / Dias Restantes`
- Barra de progresso visual
- Mínimo de 1 dia restante para evitar divisão por zero

##### RF-10: Baselines Diárias
- Registro da posição de leitura no início de cada dia
- Criação proativa ao adicionar livro ou ao abrir livro sem baseline
- Campos: `words`, `percent`, `page`
- ID: `{userId}:{bookId}:{dateISO}`
- Abordagem client-side/on-demand (sem cron job)



### RF-10 (Detalhado): Sistema de Baselines Diárias

#### 10.1 Conceito

Uma **baseline** é um registro histórico que marca a posição de leitura do usuário no **início de cada dia**. É essencial para calcular o "Progresso de Hoje" de forma independente do progresso total do livro.

**Exemplo prático:**
- Ontem o usuário estava em 40% do livro
- Hoje leu até 55%
- Sem baseline: não sabemos quanto leu "hoje"
- Com baseline (40%): sabemos que leu 15% hoje

#### 10.2 Estrutura de Dados

```typescript
{
  id: string;           // "{userId}:{bookId}:{dateISO}" Ex: "abc123:imitacao:2025-01-04"
  user_id: string;      // ID do usuário
  book_id: string;      // ID do livro
  date_iso: string;     // Data ISO "YYYY-MM-DD"
  words: number;        // Palavras lidas até aquele ponto (livros JSON)
  percent: number;      // Porcentagem de progresso (universal)
  page?: number;        // Página exata (apenas livros físicos)
  _modified: number;    // Timestamp para sync
  _deleted: boolean;    // Soft delete
}
```

#### 10.3 Momentos de Criação (On-Demand)

A baseline é criada **sob demanda** em três momentos críticos:

##### 10.3.1 Ao Atualizar Progresso (Tracker)
Quando o usuário avança na leitura (ex: vira página), **antes** de salvar o novo progresso:

```typescript
// Em RxDBDataLayer.saveBookProgress()
const existingBaseline = await db.daily_baselines.findOne(baselineId).exec();

if (!existingBaseline) {
    // Cria baseline com progresso ANTERIOR (antes desta atualização)
    await this.saveDailyBaseline({
        book_id: bookId,
        date_iso: todayISO,
        words: 0,
        percent: oldPercentage,  // ← Progresso antes da atualização
        page: oldPage            // ← Página antes da atualização
    });
}

// Só depois atualiza o progresso
await book.incrementalPatch({ current_page: newPage, percentage: newPercentage });
```

**⚠️ Crítico:** A baseline deve usar o progresso **anterior**, não o atual. Se usarmos o atual, o "progresso de hoje" sempre começa zerado.

##### 10.3.2 Ao Adicionar Livro (Proativa)
Quando um livro é adicionado pela primeira vez (físico ou EPUB), cria-se uma baseline imediatamente:

```typescript
// Em saveBook() ou saveUserEpub() após inserir o livro
await this.saveDailyBaseline({
    book_id: newBook.id,
    date_iso: todayISO,
    words: 0,
    percent: 0,   // Livro novo = 0%
    page: 0       // Página 0
});
```

**Motivo:** Se o usuário adicionar um livro às 10h e ler até 20% às 18h, queremos que o dashboard mostre "20% lido hoje", não que falte uma baseline.

##### 10.3.3 Fallback no Dashboard (Index)
Ao abrir a página inicial, se o livro ativo tiver progresso mas não tiver baseline para hoje:

```typescript
// Em Index.tsx useEffect
if (activeBookId && activeBookProgress.percent > 0) {
    const existingBaseline = await getDailyBaselineAsync(activeBookId, todayISO);
    
    if (!existingBaseline && isReplicationComplete) {
        // Cria baseline com progresso atual (último recurso)
        setDailyBaseline(activeBookId, todayISO, { 
            words: wordsUpToCurrent, 
            percent: currentPercent,
            page: currentPage 
        });
    }
}
```

**Atenção:** Este fallback só executa **após a replicação completar**, para evitar criar baseline duplicada quando dados vêm do servidor.

#### 10.4 Normalização: Páginas vs Percentuais

Diferentes tipos de livro usam métricas distintas:

| Tipo de Livro | Métrica Principal | Campo Usado |
|---------------|-------------------|-------------|
| **Livro Físico** | Páginas | `page` (exato) + `percent` (calculado) |
| **EPUB** | Porcentagem | `percent` |
| **Livro JSON** | Palavras | `words` + `percent` (calculado) |

**Regras de gravação:**
```typescript
// Livro Físico
{ page: 50, percent: 16.67, words: 0 }

// EPUB
{ page: undefined, percent: 25.5, words: 0 }

// Livro JSON
{ page: undefined, percent: 32.1, words: 4500 }
```

**Regras de leitura (cálculo de progresso):**
```typescript
// Para livros físicos: usa página exata
const pagesReadToday = currentPage - (baseline.page ?? Math.round(baseline.percent * totalPages / 100));

// Para EPUBs: usa porcentagem
const percentReadToday = currentPercent - (baseline.percent ?? 0);
```

#### 10.5 Sincronização Multi-Dispositivo

##### 10.5.1 ID Composto com User ID
O ID inclui o `user_id` para permitir dados separados por usuário:
```
"{userId}:{bookId}:{dateISO}"
```

##### 10.5.2 Migração de `local-user` para Usuário Autenticado
Quando o usuário faz login, baselines criadas offline devem ser migradas:

```typescript
// Ordem correta: Replicação → Migração
await replicationManager.startReplication();  // 1. Puxa dados do servidor
await this.migrateLocalUserData(userId);      // 2. Depois migra local-user

// Na migração:
for (const baseline of localBaselines) {
    const newId = `${userId}:${baseline.book_id}:${baseline.date_iso}`;
    const existing = await db.daily_baselines.findOne(newId).exec();
    
    if (!existing) {
        await db.daily_baselines.insert({
            id: newId,
            user_id: userId,
            ...baselineData
        });
    }
    
    // Deleta a versão local-user
    await baseline.incrementalPatch({ _deleted: true });
}
```

##### 10.5.3 Prevenção de Duplicatas
Ao criar baseline como `local-user`, verifica se já existe uma de sessão autenticada anterior:

```typescript
if (!existingBaseline && userId === 'local-user') {
    // Busca baselines de QUALQUER usuário para este livro/data
    const baselines = await db.daily_baselines.find({
        selector: { book_id, date_iso, _deleted: false }
    }).exec();
    
    if (baselines.length > 0) {
        // Usa a existente em vez de criar duplicata
        return baselines[0].toJSON();
    }
}
```

#### 10.6 Diagrama de Fluxo de Criação

```
┌─────────────────────────────────────────────────────────────────┐
│                     CRIAÇÃO DE BASELINE                         │
└─────────────────────────────────────────────────────────────────┘

          ┌───────────────┐
          │ Evento        │
          │ (Atualização  │
          │  de Progresso)│
          └───────┬───────┘
                  │
                  ▼
      ┌───────────────────────┐
      │ Baseline existe para  │───── SIM ───▶ Não faz nada
      │ este livro/data?      │
      └───────────┬───────────┘
                  │ NÃO
                  ▼
      ┌───────────────────────┐
      │ É local-user?         │───── NÃO ───▶ Cria baseline com ID
      └───────────┬───────────┘               "{userId}:{bookId}:{date}"
                  │ SIM
                  ▼
      ┌───────────────────────┐
      │ Existe baseline de    │───── SIM ───▶ Usa baseline existente
      │ usuário autenticado?  │               (evita duplicata)
      └───────────┬───────────┘
                  │ NÃO
                  ▼
      ┌───────────────────────┐
      │ Cria baseline com ID  │
      │ "local-user:book:date"│
      └───────────────────────┘
```

#### 10.7 Considerações Arquiteturais

| Aspecto | Decisão | Justificativa |
|---------|---------|---------------|
| **Onde criar** | Client-side | Zero custo, funciona offline, respeita fuso horário local |
| **Quando criar** | On-demand | Evita baselines órfãs para livros nunca lidos |
| **O que registrar** | Progresso ANTERIOR | Garante cálculo correto de "lido hoje" |
| **Duplicatas** | Verificar antes de criar | Local-user pode ter dados de sessão anterior |
| **Ordem de migração** | Replicação ANTES | Evita sobrescrever dados do servidor |

#### 10.8 Estimativa de Armazenamento

- **Tamanho por registro:** ~126 bytes
- **Leitor ativo (3 livros/dia):** ~138 KB/ano
- **10.000 usuários:** ~1.38 GB/ano

**Recomendação:** Não deletar baselines antigas - custo baixo e potencial para features de estatísticas.




---

#### 2.4 Estatísticas e Gamificação

##### RF-11: Streak de Leitura
- Contador de dias consecutivos de leitura
- Recorde de maior streak
- Possibilidade de "congelamento" de streak (1 disponível)
- Atualizado ao completar leitura diária

##### RF-12: Minutos de Leitura
- Contabilização de tempo de leitura por dia
- Histórico em `minutes_by_date` (JSON string)
- Total acumulado de minutos

##### RF-13: Página de Estatísticas
- Exibição de streak atual e recorde
- Total de minutos lidos

---

#### 2.5 Widget Android

##### RF-14: Widget Nativo de Progresso
- Widget de tela inicial para Android
- Exibe porcentagem da meta diária
- Comunicação via Capacitor Preferences
- Atualização automática ao alterar progresso
- Customização de background e layout

---

#### 2.6 Autenticação

##### RF-15: Login
- Login via Magic Link (email OTP)
- Login via OAuth com Google
- Suporte a deep linking para app nativo (`ignisverbi://auth/callback`)
- Modo offline com `user_id: 'local-user'`
- Migração automática de dados locais ao fazer login

---

#### 2.7 Sincronização Multi-Dispositivo

##### RF-16: Sincronização RxDB + Supabase
- Banco local: RxDB (IndexedDB via Dexie.js)
- Backend: Supabase (PostgreSQL)
- Replicação bidirecional em tempo real
- Sistema de revisões (`_rev`) para controle de conflitos
- Uso obrigatório de `incrementalPatch()` para atualizações
- Retry automático em caso de conflito

##### RF-17: Reconciliação de Dados
- Upsert de livros locais ao servidor
- Alinhamento de IDs de EPUBs por `file_hash`
- Resolução de conflitos em `minutes_by_date`

---

#### 2.8 Modo Debug

##### RF-18: Modo Debug Oculto
- Ativação: 7 toques em "Clássicos católicos" na tela inicial
- Funcionalidades:
  - Ver estado interno do app
  - Limpar dados de debug
  - Forçar atualização do widget
  - Recarregar dados
- Persistência no `localStorage` (`showDebugButton`)
- Gate: 7 cliques rápidos no título "Clássicos católicos" do Hero

##### RF-19: Onboarding de Usuário
- Exibição automática de um carrossel de boas-vindas na primeira visita
- Conteúdo: 4 slides cobrindo Introdução, Hábitos/Streaks, Biblioteca Digital e Widget Android
- Persistência do estado "visto" no `localStorage` (`hasSeenOnboarding_v1`)
- Interface responsiva com suporte a scroll em dispositivos pequenos e bordas arredondadas (estilo iOS/Premium)

---

### 3. Requisitos Não-Funcionais

#### 3.1 Plataformas
- **RNF-01**: PWA (Progressive Web App) funcional em navegadores modernos
- **RNF-02**: App Android nativo via Capacitor 7.x
- **RNF-03**: Responsivo para mobile e desktop

#### 3.2 Performance
- **RNF-04**: Funcionamento offline-first (RxDB)
- **RNF-05**: Cache LRU de locations EPUB (máx. 5 livros, ~100-250KB)
- **RNF-06**: Debounce de 1s para saves de progresso
- **RNF-07**: Cache de metadados de livros por 24h

#### 3.3 Segurança
- **RNF-08**: RLS (Row Level Security) no Supabase
- **RNF-09**: Não armazenar base64 em campos `cover_url` do banco sincronizado

#### 3.4 Tecnologias
- **RNF-10**: React 18, TypeScript, Vite
- **RNF-11**: Tailwind CSS, shadcn/ui
- **RNF-12**: RxDB v17, Supabase JS v2
- **RNF-13**: epubjs, react-reader
- **RNF-14**: Recharts para gráficos
- **RNF-15**: date-fns para manipulação de datas

---

### 4. Modelos de Dados

#### 4.1 Books (Livros)
| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| id | string | ✅ | ID único (max 100 chars) |
| user_id | string | | ID do usuário |
| title | string | ✅ | Título |
| author | string | | Autor |
| type | 'physical' \| 'epub' | | Tipo |
| total_pages | number | | Total de páginas (físico) |
| current_page | number | | Página atual |
| percentage | number (0-100) | | Progresso |
| part_index | number | | Índice da parte atual |
| chapter_index | number | | Índice do capítulo |
| last_location_cfi | string | | CFI do EPUB |
| cover_url | string | | URL da capa |
| file_hash | string | | Hash do arquivo |
| added_date | number | | Timestamp de adição |
| progress_version | number | ✅ | Controle de conflitos |
| _modified | number | ✅ | Última modificação |
| _deleted | boolean | | Soft delete |

#### 4.2 User EPUBs
| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| id | string | ✅ | ID único |
| user_id | string | | ID do usuário |
| title | string | ✅ | Título |
| author | string | | Autor |
| file_hash | string | ✅ | SHA-256 do arquivo |
| file_size | number | | Tamanho em bytes |
| cover_url | string | | URL da capa |
| percentage | number | | Progresso (0-100) |
| last_location_cfi | string | | Última posição CFI |
| added_date | number | ✅ | Timestamp |
| _modified | number | ✅ | Última modificação |
| _deleted | boolean | | Soft delete |

#### 4.3 Reading Plans
| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| id | string | ✅ | `{user_id}:{book_id}` |
| user_id | string | | ID do usuário |
| book_id | string | ✅ | ID do livro |
| target_date_iso | string | | Data alvo (YYYY-MM-DD) |
| target_part_index | number | | Parte alvo |
| target_chapter_index | number | | Capítulo alvo |
| start_percent | number | | % inicial |
| start_words | number | | Palavras iniciais |
| _modified | number | ✅ | Última modificação |

#### 4.4 Daily Baselines
| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| id | string | ✅ | `{userId}:{bookId}:{dateISO}` |
| user_id | string | | ID do usuário |
| book_id | string | ✅ | ID do livro |
| date_iso | string | ✅ | Data (YYYY-MM-DD) |
| words | number | | Palavras no início |
| percent | number | | % no início |
| page | number | | Página no início |
| _modified | number | ✅ | Última modificação |

#### 4.5 User Stats
| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| id | string | ✅ | ID único |
| user_id | string | ✅ | ID do usuário |
| streak_current | number | | Streak atual |
| streak_longest | number | | Maior streak |
| last_read_iso | string | | Última leitura |
| freeze_available | boolean | | Congelamento disponível |
| total_minutes | number | | Total de minutos |
| last_book_id | string | | Último livro |
| minutes_by_date | string | | JSON de minutos/dia |
| _modified | number | ✅ | Última modificação |

#### 4.6 Settings
| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| user_id | string | ✅ | PK |
| theme | string | | Tema |
| font_size | number | | Tamanho fonte |
| text_align | string | | Alinhamento |
| line_spacing | string | | Espaçamento |
| last_active_book_id | string | | Último livro ativo |
| daily_goal_minutes | number | | Meta diária (min) |
| _modified | number | ✅ | Última modificação |

---

### 5. Rotas da Aplicação

| Rota | Página | Descrição |
|------|--------|-----------|
| `/` | Index | Dashboard principal |
| `/login` | Login | Autenticação |
| `/biblioteca` | Library | Gerenciamento de livros |
| `/leitor/:bookId` | Reader | Leitor JSON |
| `/epub/:epubId` | EpubReaderV3 | Leitor EPUB |
| `/physical/:bookId` | PhysicalBookTracker | Rastreador físico |
| `/estatisticas` | Stats | Estatísticas |

---

### 6. Integrações Externas

| Serviço | Uso | Notas |
|---------|-----|-------|
| **Supabase** | Auth + DB | PostgreSQL, RLS, OAuth |
| **Google Books API** | Metadados de livros | Busca primária |
| **Open Library API** | Metadados de livros | Fallback |
| **images.weserv.nl** | Proxy CORS | Para capas externas |
| **GitHub Pages** | Deploy web | Base path: `/devoto-habit/` |

---

### 7. Configuração do Ambiente

- Node.js 18+
- npm ou pnpm
- Android Studio (para builds nativos)
- Variáveis de ambiente Supabase (`.env`)
- Arquivo `src/config/appMeta.ts` para nome do app

---
