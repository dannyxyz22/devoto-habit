# Documentação do RxDB - Devoto Habit

Esta documentação descreve como o **RxDB** (Reactive Database) funciona no projeto Devoto Habit, incluindo a estrutura de dados, persistência local e sincronização com Supabase.

## Índice

1. [Visão Geral](#visão-geral)
2. [Configuração do Banco de Dados](#configuração-do-banco-de-dados)
3. [Coleções e Schemas](#coleções-e-schemas)
4. [Operações de Dados](#operações-de-dados)
5. [Replicação e Sincronização](#replicação-e-sincronização)
6. [Migração de Dados](#migração-de-dados)

---
 
## Visão Geral

O RxDB é um banco de dados NoSQL reativo para JavaScript que funciona no navegador. No Devoto Habit, ele é usado para:

- **Persistência local**: Armazenar dados offline no navegador usando Dexie.js (IndexedDB)
- **Sincronização**: Replicar dados bidirecionalmente com Supabase (PostgreSQL)
- **Reatividade**: Fornecer observáveis para atualizações em tempo real
- **Offline-first**: Permitir uso completo da aplicação sem conexão

### Arquitetura

```
┌─────────────────┐
│   Aplicação     │
│   (React)       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   DataLayer     │  ← Interface abstrata
│  (RxDBDataLayer)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐      ┌──────────────┐
│     RxDB        │◄────►│   Supabase   │
│  (IndexedDB)    │      │  (PostgreSQL)│
└─────────────────┘      └──────────────┘
```

---

## Configuração do Banco de Dados

### Inicialização

O banco de dados é criado em `src/lib/database/db.ts`:

```typescript
const db = await createRxDatabase<DevotoDatabaseCollections>({
    name: 'devotodb_v6',           // Nome do banco IndexedDB
    storage: getRxStorageDexie(),  // Storage engine (IndexedDB via Dexie)
    hashFunction: (input: string) => { /* ... */ }
});
```

**Características:**
- **Nome**: `devotodb_v6` (versão do banco)
- **Storage**: Dexie.js (wrapper sobre IndexedDB)
- **Plugins**: Migration Schema, Update Plugin

### Plugins Utilizados

1. **RxDBMigrationSchemaPlugin**: Gerencia migrações de schema
2. **RxDBUpdatePlugin**: Permite operações de atualização incremental

---

## Coleções e Schemas

O banco possui **6 coleções principais**, cada uma com seu schema JSON Schema:

### 1. Books (Livros)

**Schema**: `bookSchema`  
**Primary Key**: `id`  
**Tabela Supabase**: `books`

#### Campos

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string | Identificador único do livro |
| `user_id` | string | ID do usuário proprietário |
| `title` | string | Título do livro |
| `author` | string | Autor (opcional) |
| `type` | 'physical' \| 'epub' | Tipo de livro |
| `total_pages` | number | Total de páginas (livros físicos) |
| `current_page` | number | Página atual |
| `percentage` | number (0-100) | Porcentagem de progresso |
| `part_index` | number | Índice da parte atual |
| `chapter_index` | number | Índice do capítulo atual |
| `last_location_cfi` | string | Última localização CFI (EPUB) |
| `cover_url` | string | URL da capa (apenas URLs externas) |
| `file_hash` | string | Hash do arquivo EPUB |
| `added_date` | number | Timestamp de adição |
| `published_date` | string | Data de publicação |
| `progress_version` | number | Versão do progresso (controle de conflitos) |
| `_modified` | number | Timestamp da última modificação |
| `_deleted` | boolean | Soft delete flag |

#### Campos Obrigatórios
- `id`
- `title`
- `_modified`
- `progress_version`

#### Uso

Armazena tanto livros físicos quanto EPUBs. Para EPUBs, também existe a coleção `user_epubs` (veja abaixo).

**Exemplo de uso:**
```typescript
// Salvar progresso
await dataLayer.saveBook({
    id: 'book-123',
    current_page: 50,
    percentage: 25,
    progress_version: 2
});

// Buscar livro
const book = await dataLayer.getBook('book-123');
```

---

### 2. User EPUBs (EPUBs do Usuário)

**Schema**: `userEpubSchema`  
**Primary Key**: `id`  
**Tabela Supabase**: `user_epubs`

#### Campos

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string | Identificador único |
| `user_id` | string | ID do usuário |
| `title` | string | Título |
| `author` | string | Autor (opcional) |
| `file_hash` | string | Hash SHA-256 do arquivo EPUB |
| `file_size` | number | Tamanho do arquivo em bytes |
| `cover_url` | string | URL da capa (apenas URLs externas) |
| `percentage` | number (0-100) | Progresso de leitura |
| `last_location_cfi` | string | Última localização CFI no EPUB |
| `added_date` | number | Timestamp de adição |
| `_modified` | number | Timestamp da última modificação |
| `_deleted` | boolean | Soft delete flag |

#### Campos Obrigatórios
- `id`
- `title`
- `file_hash`
- `added_date`
- `_modified`

#### Uso

Armazena metadados de EPUBs enviados pelo usuário. O arquivo EPUB em si é armazenado no Supabase Storage, não no RxDB.

**Diferença entre `books` e `user_epubs`:**
- `books`: Livros estáticos (pré-definidos) e livros físicos
- `user_epubs`: EPUBs enviados pelo usuário

**Exemplo:**
```typescript
// Salvar progresso de leitura
await dataLayer.saveUserEpub({
    id: 'epub-456',
    percentage: 60,
    last_location_cfi: 'epubcfi(/6/4[chap01ref]!/4/2/2)'
});
```

---

### 3. Settings (Configurações)

**Schema**: `settingsSchema`  
**Primary Key**: `user_id`  
**Tabela Supabase**: `user_settings`

#### Campos

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `user_id` | string | ID do usuário (PK) |
| `theme` | string | Tema da aplicação |
| `font_size` | number | Tamanho da fonte |
| `text_align` | string | Alinhamento do texto |
| `line_spacing` | string | Espaçamento entre linhas |
| `last_active_book_id` | string | ID do último livro ativo |
| `daily_goal_minutes` | number | Meta diária de leitura (minutos) |
| `_modified` | number | Timestamp da última modificação |

#### Campos Obrigatórios
- `user_id`
- `_modified`

#### Uso

Armazena preferências do usuário. Como a PK é `user_id`, existe apenas um documento por usuário.

**Exemplo:**
```typescript
// Salvar configurações
await dataLayer.saveSettings({
    theme: 'dark',
    daily_goal_minutes: 30
});
```

---

### 4. Reading Plans (Planos de Leitura)

**Schema**: `readingPlanSchema`  
**Primary Key**: `id`  
**Tabela Supabase**: `reading_plans`

#### Campos

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string | ID composto: `{user_id}:{book_id}` |
| `user_id` | string | ID do usuário |
| `book_id` | string | ID do livro |
| `target_date_iso` | string | Data alvo (ISO) |
| `target_part_index` | number | Parte alvo |
| `target_chapter_index` | number | Capítulo alvo |
| `start_part_index` | number | Parte inicial |
| `start_chapter_index` | number | Capítulo inicial |
| `start_words` | number | Palavras no início |
| `start_percent` | number | Porcentagem inicial |
| `_modified` | number | Timestamp da última modificação |
| `_deleted` | boolean | Soft delete flag |

#### Campos Obrigatórios
- `id`
- `book_id`
- `_modified`

#### Uso

Armazena planos de leitura para livros específicos. Um usuário pode ter um plano por livro.

**Exemplo:**
```typescript
// Criar plano de leitura
await dataLayer.saveReadingPlan({
    id: 'user-123:book-456',
    book_id: 'book-456',
    target_date_iso: '2024-12-31',
    target_chapter_index: 20
});
```

---

### 5. Daily Baselines (Baselines Diários)

**Schema**: `dailyBaselineSchema`  
**Primary Key**: `id`  
**Tabela Supabase**: `daily_baselines`

#### Campos

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string | ID composto: `{user_id}:{book_id}:{date_iso}` |
| `user_id` | string | ID do usuário |
| `book_id` | string | ID do livro |
| `date_iso` | string | Data no formato ISO (YYYY-MM-DD) |
| `words` | number | Número de palavras lidas no dia |
| `percent` | number | Porcentagem no início do dia |
| `_modified` | number | Timestamp da última modificação |
| `_deleted` | boolean | Soft delete flag |

#### Campos Obrigatórios
- `id`
- `book_id`
- `date_iso`
- `_modified`

#### Uso

Armazena o estado inicial (baseline) de um livro em cada dia. Usado para calcular progresso diário.

**Exemplo:**
```typescript
// Salvar baseline diário
await dataLayer.saveDailyBaseline({
    id: 'user-123:book-456:2024-12-15',
    book_id: 'book-456',
    date_iso: '2024-12-15',
    words: 1000,
    percent: 25
});
```

---

### 6. User Stats (Estatísticas do Usuário)

**Schema**: `userStatsSchema`  
**Primary Key**: `id`  
**Tabela Supabase**: `user_stats`

#### Campos

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string | Identificador único (UUID) |
| `user_id` | string | ID do usuário |
| `streak_current` | number | Sequência atual de dias |
| `streak_longest` | number | Maior sequência já alcançada |
| `last_read_iso` | string | Última data de leitura (ISO) |
| `freeze_available` | boolean | Se o "freeze" de streak está disponível |
| `total_minutes` | number | Total de minutos lidos |
| `last_book_id` | string | ID do último livro lido |
| `minutes_by_date` | string | JSON string com minutos por data: `{"2024-12-15": 30, ...}` |
| `_modified` | number | Timestamp da última modificação |
| `_deleted` | boolean | Soft delete flag |

#### Campos Obrigatórios
- `id`
- `user_id`
- `_modified`

#### Uso

Armazena estatísticas agregadas do usuário, incluindo streaks e tempo de leitura.

**Nota Importante**: `minutes_by_date` é armazenado como **string JSON**, não como objeto. Isso é necessário para compatibilidade com Supabase (TEXT).

**Exemplo:**
```typescript
// Salvar estatísticas
await dataLayer.saveUserStats({
    streak_current: 5,
    total_minutes: 120,
    minutes_by_date: '{"2024-12-15": 30, "2024-12-16": 25}'
});
```

---

## Operações de Dados

### DataLayer Interface

Todas as operações passam pela interface `DataLayer`, implementada por `RxDBDataLayerImpl`:

```typescript
// src/services/data/DataLayer.ts
export interface DataLayer {
    getBooks(): Promise<RxBookDocumentType[]>;
    getBook(id: string): Promise<RxBookDocumentType | null>;
    saveBook(book: Partial<RxBookDocumentType>): Promise<RxBookDocumentType>;
    deleteBook(id: string): Promise<void>;
    // ... outras operações
}
```

### Operações CRUD

#### Create (Inserir)

```typescript
// Inserir novo livro
const book = await dataLayer.saveBook({
    id: 'book-123',
    title: 'Meu Livro',
    type: 'physical',
    user_id: 'user-123',
    added_date: Date.now()
});
```

**Comportamento:**
- Se o documento não existe, cria um novo
- Se existe, atualiza (upsert)
- Define automaticamente `_modified` e `_deleted: false`

#### Read (Ler)

```typescript
// Buscar todos os livros do usuário
const books = await dataLayer.getBooks();

// Buscar livro específico
const book = await dataLayer.getBook('book-123');
```

**Filtros:**
- Apenas documentos com `_deleted: false` são retornados
- Quando logado, filtra por `user_id`
- Quando offline, retorna todos os livros locais

#### Update (Atualizar)

```typescript
// Atualizar progresso
await dataLayer.saveBook({
    id: 'book-123',
    current_page: 100,
    percentage: 50
});
```

**Métodos de atualização:**

1. **`incrementalPatch()`**: Atualização incremental (recomendado)
   - Evita conflitos de concorrência
   - Atualiza apenas campos fornecidos
   - Garante timestamp monotônico

2. **`update()`**: Atualização completa
   - Substitui o documento inteiro
   - Pode causar conflitos se outro processo atualizou

**Exemplo de incrementalPatch:**
```typescript
const book = await db.books.findOne('book-123').exec();
await book.incrementalPatch({
    current_page: 100,
    _modified: Math.max(Date.now(), (book.get('_modified') || 0) + 1)
});
```

#### Delete (Deletar)

```typescript
// Soft delete
await dataLayer.deleteBook('book-123');
```

**Comportamento:**
- **Soft delete**: Define `_deleted: true` em vez de remover
- O documento permanece no banco para sincronização
- Queries filtram automaticamente documentos deletados

---

## Replicação e Sincronização

### ReplicationManager

O `ReplicationManager` gerencia a sincronização bidirecional entre RxDB e Supabase:

```typescript
// src/lib/database/replication.ts
export class ReplicationManager {
    async startReplication() { /* ... */ }
    async stopReplication() { /* ... */ }
}
```

### Fluxo de Sincronização

```
┌─────────────┐         ┌─────────────┐
│    RxDB     │◄──────►│   Supabase  │
│  (Local)    │         │  (Remoto)   │
└─────────────┘         └─────────────┘
      │                       │
      │ PUSH                  │ PULL
      │ (Local → Remoto)      │ (Remoto → Local)
      │                       │
      ▼                       ▼
┌─────────────┐         ┌─────────────┐
│ Modificações│         │ Modificações│
│   Locais    │         │  do Servidor│
└─────────────┘         └─────────────┘
```

### Configuração de Replicação

Cada coleção tem sua própria replicação:

```typescript
const booksReplication = await replicateSupabase<RxBookDocumentType>({
    tableName: 'books',
    client: supabase,
    collection: db.books,
    replicationIdentifier: 'books-replication',
    live: true,  // Sincronização em tempo real
    pull: {
        batchSize: 50,
        modifier: (doc) => { /* transformações */ }
    },
    push: {
        batchSize: 50,
        modifier: (doc) => { /* transformações */ }
    }
});
```

### Modificadores (Modifiers)

Os modificadores transformam dados durante a sincronização:

#### Pull Modifier (Remoto → Local)
```typescript
pull: {
    modifier: (doc) => {
        // Remove campos nulos
        if (!doc.author) delete doc.author;
        return doc;
    }
}
```

#### Push Modifier (Local → Remoto)
```typescript
push: {
    modifier: (doc) => {
        // Remove campos internos do Supabase
        const { created_at, updated_at, ...rest } = doc;
        // Bloqueia dados de 'local-user'
        if (rest.user_id === 'local-user') return null;
        return rest;
    }
}
```

### Realtime (Tempo Real)

O Supabase Realtime notifica mudanças do servidor:

```typescript
const realtimeChannel = supabase.channel('db-changes')
    .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'books' },
        (payload) => {
            // Dispara reSync quando há mudanças no servidor
            booksReplication.reSync();
        }
    );
```

### Reconciliação (Reconciliation)

Antes de iniciar a replicação, o sistema reconcilia dados locais com o servidor:

1. **Reconcile Books**: Upsert de livros locais que não existem no servidor
2. **Reconcile User EPUBs**: Alinha IDs baseados em `file_hash`
3. **Reconcile User Stats**: Resolve conflitos de `minutes_by_date`
4. **Reconcile Reading Plans**: Sincroniza planos de leitura
5. **Reconcile Daily Baselines**: Sincroniza baselines diários

**Exemplo de reconciliação:**
```typescript
public async reconcileBooks() {
    // 1. Busca livros locais
    const localDocs = await db.books.find({ selector: { _deleted: false } }).exec();
    
    // 2. Verifica quais já existem no servidor
    const { data: serverBooks } = await supabase
        .from('books')
        .select('id')
        .eq('user_id', userId);
    
    // 3. Upsert apenas os novos
    const newDocs = localDocs.filter(local => !serverIds.has(local.id));
    await supabase.from('books').upsert(newDocs);
}
```

---

## Migração de Dados

### Migração de Schema

O RxDB suporta migrações quando o schema muda:

```typescript
books: {
    schema: bookSchema,
    migrationStrategies: {
        1: function (oldDoc: any) {
            // Migração de v0 para v1
            return {
                ...oldDoc,
                added_date: oldDoc._modified || Date.now()
            };
        }
    }
}
```

### Migração de Usuário Local

Quando um usuário faz login, dados criados offline (`user_id: 'local-user'`) são migrados:

```typescript
private async migrateLocalUserData(userId: string): Promise<void> {
    // 1. Busca documentos com user_id='local-user'
    const localBooks = await db.books.find({
        selector: { user_id: 'local-user', _deleted: false }
    }).exec();
    
    // 2. Atualiza user_id para o usuário autenticado
    for (const book of localBooks) {
        await book.update({
            $set: {
                user_id: userId,
                _modified: Date.now()
            }
        });
    }
}
```

**Fluxo de migração:**
1. Usuário cria dados offline → `user_id: 'local-user'`
2. Usuário faz login → `migrateLocalUserData()` é chamado
3. Todos os documentos são atualizados para o `user_id` real
4. Replicação inicia e sincroniza com Supabase

---

## Campos Especiais

### Campos de Controle

Todos os documentos têm campos de controle para sincronização:

- **`_modified`**: Timestamp da última modificação (usado para resolução de conflitos)
- **`_deleted`**: Flag de soft delete (não remove fisicamente)

### Progress Version

Para livros, existe `progress_version` para controle de conflitos:

```typescript
const currentVersion = book.get('progress_version') ?? 0;
await book.incrementalPatch({
    current_page: newPage,
    progress_version: currentVersion + 1,
    _modified: Math.max(Date.now(), (book.get('_modified') || 0) + 1)
});
```

### Timestamps Monotônicos

Para evitar rejeição de sincronização por relógio desatualizado:

```typescript
_modified: Math.max(Date.now(), (existingDoc.get('_modified') || 0) + 1)
```

Isso garante que `_modified` sempre aumenta, mesmo se o relógio local estiver atrasado.

---

## Boas Práticas

### 1. Sempre use `incrementalPatch` para atualizações

```typescript
// ✅ Correto
await book.incrementalPatch({ current_page: 100 });

// ❌ Evitar
await book.update({ ...book.toJSON(), current_page: 100 });
```

### 2. Filtre por `_deleted: false` em queries

```typescript
// ✅ Correto
const books = await db.books.find({
    selector: { _deleted: { $eq: false } }
}).exec();
```

### 3. Não salve base64 em `cover_url`

```typescript
// ✅ Correto - apenas URLs externas
cover_url: 'https://example.com/cover.jpg'

// ❌ Evitar - base64 é muito grande
cover_url: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...'
```

### 4. Use `minutes_by_date` como string JSON

```typescript
// ✅ Correto
minutes_by_date: JSON.stringify({ "2024-12-15": 30 })

// ❌ Evitar
minutes_by_date: { "2024-12-15": 30 }
```

### 5. Trate conflitos de concorrência

```typescript
try {
    await book.incrementalPatch(updates);
} catch (err: any) {
    if (err?.code === 'CONFLICT') {
        // Retry com documento atualizado
        const fresh = await db.books.findOne(id).exec();
        await fresh.incrementalPatch(updates);
    }
}
```

---

## Troubleshooting

### Problema: Dados não sincronizam

**Solução:**
1. Verifique se a replicação está ativa: `replicationManager.startReplication()`
2. Verifique logs do console para erros de replicação
3. Use `replicationManager.forceFullResync()` para forçar re-sincronização

### Problema: Conflitos RC_PUSH

**Solução:**
1. Execute reconciliação antes de iniciar replicação
2. Use `incrementalPatch` em vez de `update`
3. Verifique se `_modified` está aumentando monotonicamente

### Problema: Dados duplicados

**Solução:**
1. Verifique se IDs são únicos
2. Use reconciliação para alinhar IDs baseados em `file_hash` (para EPUBs)
3. Limpe dados de `local-user` após migração

---

## Referências

- **RxDB Docs**: https://rxdb.info/
- **Supabase Replication**: https://rxdb.info/replication-supabase.html
- **Schema Definition**: `src/lib/database/schema.ts`
- **DataLayer Implementation**: `src/services/data/RxDBDataLayer.ts`
- **Replication Manager**: `src/lib/database/replication.ts`
