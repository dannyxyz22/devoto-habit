# Arquitetura de Sincronização Multi-Dispositivo

> **Guia didático**: Como funciona a sincronização de dados entre dispositivos usando RxDB + Supabase

## 📚 Sumário

1. [Conceitos Fundamentais](#conceitos-fundamentais)
2. [Como Funciona a Revisão de Documentos](#como-funciona-a-revisão-de-documentos)
3. [Fluxo de Sincronização](#fluxo-de-sincronização)
4. [Conflitos e Como São Resolvidos](#conflitos-e-como-são-resolvidos)
5. [Métodos de Atualização](#métodos-de-atualização)
6. [Exemplo Prático: Leitura de EPUB](#exemplo-prático-leitura-de-epub)
7. [Boas Práticas](#boas-práticas)

---

## Conceitos Fundamentais

### O que é RxDB?

**RxDB** é um banco de dados local (IndexedDB no navegador) que funciona **offline-first** e tem sincronização automática com um backend (no nosso caso, Supabase).

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│ Dispositivo │         │  Supabase   │         │ Dispositivo │
│      A      │ ◄─────► │  (Servidor) │ ◄─────► │      B      │
│   (RxDB)    │         │  (Postgres) │         │   (RxDB)    │
└─────────────┘         └─────────────┘         └─────────────┘
```

### Por que precisamos de revisões (`_rev`)?

Imagine que dois dispositivos editam o mesmo documento **ao mesmo tempo**:

- **Dispositivo A**: muda `percentage` de `0` para `20`
- **Dispositivo B**: muda `percentage` de `0` para `40`

Se não tivermos controle de versão, qual mudança deve prevalecer? O sistema precisa **detectar** que houve edições concorrentes e decidir como resolvê-las.

---

## Como Funciona a Revisão de Documentos

### Estrutura de um documento no RxDB

Todo documento no RxDB contém metadados internos além dos seus campos de negócio:

```json
{
  "id": "user-1234567890-abc123",
  "user_id": "uuid-do-usuario",
  "title": "Rome Sweet Home",
  "percentage": 20,
  "last_location_cfi": "epubcfi(...)",
  
  // Metadados internos do RxDB:
  "_rev": "3-a7f8e2c1",        // ← Identificador de revisão
  "_modified": 1764504860315,  // ← Timestamp da última modificação
  "_deleted": false,           // ← Soft delete flag
  "_meta": {
    "lwt": 1764504860315.01    // ← Last Write Time (timestamp preciso)
  }
}
```

### Formato do `_rev`

```
_rev = "3-a7f8e2c1"
        │   │
        │   └─ Hash curto (identifica conteúdo único)
        └───── Altura da cadeia (número de vezes que foi editado)
```

- **Altura = 1**: Documento acabou de ser criado
- **Altura = 2**: Primeira edição
- **Altura = 3**: Segunda edição
- E assim por diante...

### Exemplo de evolução de revisões

```
Criação:       _rev = "1-abc123"   percentage = 0
1ª edição:     _rev = "2-def456"   percentage = 20
2ª edição:     _rev = "3-ghi789"   percentage = 40
```

Cada vez que o documento é salvo, o RxDB:
1. Incrementa a altura (`1 → 2 → 3`)
2. Calcula um novo hash (baseado no conteúdo + altura)
3. Cria o novo `_rev`

---

## Fluxo de Sincronização

### 1. Cenário: Um único dispositivo

```
┌──────────────────────────────────────────────────────────┐
│ Usuário abre EPUB e avança para 20%                     │
└──────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│ EpubReader.tsx chama dataLayer.saveUserEpub()           │
└──────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│ RxDBDataLayer.saveUserEpub():                           │
│ 1. Busca documento existente (findOne)                  │
│ 2. Aplica mudanças com incrementalPatch()               │
│ 3. Gera novo _rev = "2-xyz"                             │
└──────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│ Documento atualizado no IndexedDB local                 │
│ _rev = "2-xyz", percentage = 20                         │
└──────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│ Replicação (background) envia mudança ao Supabase       │
│ [User EPUBs Replication] Pushed 1 document(s)          │
└──────────────────────────────────────────────────────────┘
```

### 2. Cenário: Múltiplos dispositivos (caso ideal)

```
Dispositivo A                  Supabase                  Dispositivo B
─────────────                  ────────                  ─────────────

percentage = 0                percentage = 0             percentage = 0
_rev = "1-abc"                _rev = "1-abc"            _rev = "1-abc"

     │
     │ Avança para 20%
     │ incrementalPatch()
     ▼
percentage = 20
_rev = "2-xyz"

     │ PUSH
     ├─────────────────►
                           percentage = 20
                           _rev = "2-xyz"
                                  │ PULL
                                  ├──────────────────►
                                                      percentage = 20
                                                      _rev = "2-xyz"
                                                      
                                                           │
                                                           │ Avança para 40%
                                                           │ incrementalPatch()
                                                           ▼
                                                      percentage = 40
                                                      _rev = "3-pqr"
                                                      
                                  PUSH ◄──────────────┤
                           percentage = 40
                           _rev = "3-pqr"
     │ PULL
     ◄─────────────────┤
percentage = 40
_rev = "3-pqr"
```

**Resultado**: Ambos os dispositivos convergem para `percentage = 40`, sem conflitos!

---

## Conflitos e Como São Resolvidos

### O que é um CONFLICT?

Um **CONFLICT** acontece quando o cliente tenta salvar um documento baseado em uma revisão **antiga**, mas o banco já tem uma revisão **mais recente**.

### Exemplo: Conflito Clássico

```
Estado inicial (ambos os dispositivos):
_rev = "1-abc", percentage = 0

┌──────────────────────┬──────────────────────┐
│   Dispositivo A      │   Dispositivo B      │
├──────────────────────┼──────────────────────┤
│ Avança para 20%      │ (ainda em 0%)        │
│ _rev = "2-xyz"       │ _rev = "1-abc"       │
│                      │                      │
│ PUSH → Supabase      │                      │
└──────────────────────┴──────────────────────┘

Supabase agora tem: _rev = "2-xyz", percentage = 20

┌──────────────────────┬──────────────────────┐
│   Dispositivo A      │   Dispositivo B      │
├──────────────────────┼──────────────────────┤
│ (já em 20%)          │ Avança para 40%      │
│                      │ ❌ Tenta salvar:     │
│                      │   baseado em "1-abc" │
│                      │   novo _rev "2-???"  │
│                      │                      │
│                      │ 💥 CONFLICT!         │
│                      │ Supabase já tem      │
│                      │ _rev = "2-xyz"       │
└──────────────────────┴──────────────────────┘
```

**Por que acontece?**

O Dispositivo B ainda tem a versão `"1-abc"` localmente. Quando tenta salvar, o RxDB (ou Supabase) detecta:

> "Você está tentando salvar baseado na revisão 1, mas a última revisão conhecida é 2. Houve uma mudança concorrente!"

### Como `incrementalPatch()` resolve?

O método `incrementalPatch()` **recarrega automaticamente** a versão mais recente antes de aplicar a mudança:

```typescript
// ❌ ERRADO (patch não-incremental)
await existingEpub.patch({ percentage: 40 });
// → Lança CONFLICT porque usa a versão antiga em memória

// ✅ CORRETO (incrementalPatch)
await existingEpub.incrementalPatch({ percentage: 40 });
// → RxDB recarrega automaticamente a versão mais recente (rev "2-xyz")
// → Aplica a mudança sobre a versão correta
// → Gera novo _rev = "3-pqr"
```

**Fluxo interno do `incrementalPatch()`**:

```
1. incrementalPatch({ percentage: 40 })
        ↓
2. RxDB lê a última revisão do IndexedDB → _rev = "2-xyz", percentage = 20
        ↓
3. Aplica a mudança → percentage = 40
        ↓
4. Gera novo _rev = "3-pqr"
        ↓
5. Salva no IndexedDB
        ↓
6. Replicação envia ao Supabase
```

### Retry automático em caso de CONFLICT residual

Mesmo com `incrementalPatch()`, pode haver um conflito raro se a replicação trouxer uma mudança **exatamente no momento** entre o "reload" e o "save". Por isso, adicionamos retry:

```typescript
try {
  await existingEpub.incrementalPatch(updates);
} catch (err: any) {
  if (err?.code === 'CONFLICT' || err?.rxdb?.code === 'CONFLICT') {
    console.log('[DataLayer] CONFLICT detected, retrying...');
    
    // Recarrega a versão MAIS NOVA e tenta novamente
    const fresh = await db.user_epubs.findOne(epubData.id!).exec();
    if (fresh) {
      await fresh.incrementalPatch(updates);
    }
  } else {
    throw err; // Outro tipo de erro, deixa subir
  }
}
```

---

## Métodos de Atualização

### Comparação: `patch()` vs `incrementalPatch()`

| Método | Como funciona | Quando usar | Risco de CONFLICT |
|--------|---------------|-------------|-------------------|
| **`patch()`** | Aplica mudanças **diretamente** sobre o documento em memória, sem recarregar. | ❌ **Não recomendado** para dados sincronizados. Use apenas se tiver certeza de que não há concorrência. | 🔴 **ALTO** |
| **`incrementalPatch()`** | **Recarrega** a versão mais recente do banco antes de aplicar a mudança. | ✅ **Sempre** para dados que sincronizam entre dispositivos. | 🟢 **BAIXO** |
| **`incrementalUpdate()`** | Igual a `incrementalPatch()`, mas aceita uma função que recebe a versão mais recente. | ✅ Para lógica condicional (ex: `percentage = max(old, new)`). | 🟢 **BAIXO** |

### Exemplo: `incrementalUpdate()` com lógica customizada

```typescript
await existingEpub.incrementalUpdate((oldData) => {
  // oldData é SEMPRE a versão mais recente do banco
  return {
    ...oldData,
    // Mantém o maior progresso (útil se dois dispositivos editam ao mesmo tempo)
    percentage: Math.max(oldData.percentage || 0, newPercentage),
    last_location_cfi: newCfi,
    _modified: Date.now()
  };
});
```

---

## Exemplo Prático: Leitura de EPUB

### Fluxo completo com dois dispositivos

#### **Situação inicial**

| Dispositivo | Estado local | Servidor (Supabase) |
|-------------|-------------|---------------------|
| A | `_rev = "1-abc", percentage = 0` | `_rev = "1-abc", percentage = 0` |
| B | `_rev = "1-abc", percentage = 0` | `_rev = "1-abc", percentage = 0` |

---

#### **Passo 1: A avança para 20%**

1. Usuário lê no Dispositivo A → `percentage = 20`
2. `EpubReader.tsx` chama `dataLayer.saveUserEpub({ percentage: 20 })`
3. `incrementalPatch()`:
   - Recarrega: `_rev = "1-abc"`
   - Aplica mudança: `percentage = 20`
   - Gera: `_rev = "2-xyz"`
4. Replicação envia ao Supabase

| Dispositivo | Estado local | Servidor (Supabase) |
|-------------|-------------|---------------------|
| A | `_rev = "2-xyz", percentage = 20` | `_rev = "2-xyz", percentage = 20` |
| B | `_rev = "1-abc", percentage = 0` | `_rev = "2-xyz", percentage = 20` |

---

#### **Passo 2: B recebe a atualização (Pull)**

1. Replicação de B puxa mudanças do Supabase
2. RxDB local de B atualiza: `_rev = "2-xyz", percentage = 20`

| Dispositivo | Estado local | Servidor (Supabase) |
|-------------|-------------|---------------------|
| A | `_rev = "2-xyz", percentage = 20` | `_rev = "2-xyz", percentage = 20` |
| B | `_rev = "2-xyz", percentage = 20` | `_rev = "2-xyz", percentage = 20` |

---

#### **Passo 3: B avança para 40%**

1. Usuário lê no Dispositivo B → `percentage = 40`
2. `incrementalPatch()`:
   - Recarrega: `_rev = "2-xyz", percentage = 20` (versão atualizada!)
   - Aplica mudança: `percentage = 40`
   - Gera: `_rev = "3-pqr"`
3. Replicação envia ao Supabase

| Dispositivo | Estado local | Servidor (Supabase) |
|-------------|-------------|---------------------|
| A | `_rev = "2-xyz", percentage = 20` | `_rev = "3-pqr", percentage = 40` |
| B | `_rev = "3-pqr", percentage = 40` | `_rev = "3-pqr", percentage = 40` |

---

#### **Passo 4: A recebe a atualização (Pull)**

1. Replicação de A puxa mudanças do Supabase
2. RxDB local de A atualiza: `_rev = "3-pqr", percentage = 40`

| Dispositivo | Estado local | Servidor (Supabase) |
|-------------|-------------|---------------------|
| A | `_rev = "3-pqr", percentage = 40` | `_rev = "3-pqr", percentage = 40` |
| B | `_rev = "3-pqr", percentage = 40` | `_rev = "3-pqr", percentage = 40` |

**✅ Resultado**: Ambos convergem para `40%` sem conflitos!

---

## Boas Práticas

### 1. **Sempre use `incrementalPatch()` para dados sincronizados**

```typescript
// ❌ EVITE
await doc.patch({ percentage: newValue });

// ✅ PREFIRA
await doc.incrementalPatch({ percentage: newValue });
```

### 2. **Filtre campos `undefined` antes de atualizar**

```typescript
// ❌ ERRADO: pode remover campos não intencionalmente
await doc.incrementalPatch(epubData);

// ✅ CORRETO: só atualiza campos fornecidos
const updates: any = { _modified: Date.now() };
if (epubData.percentage !== undefined) updates.percentage = epubData.percentage;
if (epubData.last_location_cfi !== undefined) updates.last_location_cfi = epubData.last_location_cfi;
await doc.incrementalPatch(updates);
```

### 3. **Implemente retry para conflitos residuais**

```typescript
try {
  await doc.incrementalPatch(updates);
} catch (err: any) {
  if (err?.code === 'CONFLICT') {
    const fresh = await collection.findOne(id).exec();
    if (fresh) await fresh.incrementalPatch(updates);
  } else {
    throw err;
  }
}
```

### 4. **Use debounce para reduzir writes concorrentes**

```typescript
import debounce from 'lodash.debounce';

const persistProgress = debounce(
  (id, percentage, cfi) => {
    dataLayer.saveUserEpub({ id, percentage, last_location_cfi: cfi });
  },
  1000 // Aguarda 1s após última mudança antes de salvar
);
```

### 5. **Monitore logs de replicação**

```typescript
replicationState.error$.subscribe(err => {
  console.error('[Replication] Error:', err);
});

replicationState.active$.subscribe(active => {
  console.log('[Replication] Active:', active);
});
```

### 6. **Preserve campos importantes ao atualizar**

```typescript
// ✅ BOA PRÁTICA: preservar added_date ao atualizar
const updates = {
  percentage: newPercentage,
  _modified: Date.now()
  // added_date NÃO é incluído, então é preservado
};
await doc.incrementalPatch(updates);
```

---

## Referências

- [RxDB Official Docs](https://rxdb.info/)
- [RxDB Replication Protocol](https://rxdb.info/replication.html)
- [RxDB Conflict Handling](https://rxdb.info/conflict-handling.html)
- [Incremental vs Non-Incremental Methods (v14+)](https://rxdb.info/migration-rxdb-14.html)

---

## Troubleshooting Rápido

| Erro | Causa | Solução |
|------|-------|---------|
| `RxError (CONFLICT)` | Usando `.patch()` em vez de `.incrementalPatch()` | Migrar para `.incrementalPatch()` |
| `atomicPatch is not a function` | Método renomeado no RxDB v14+ | Usar `.incrementalPatch()` |
| Mudanças não aparecem em outro dispositivo | Replicação não está ativa | Verificar logs de replicação e políticas RLS |
| UI não atualiza após sincronização | Falta subscription reativa | Usar `collection.find().$.subscribe()` |
| Campos sobrescritos inesperadamente | Passar objeto completo com `undefined` | Filtrar campos antes de `.incrementalPatch()` |

---

**Documentado em**: 2025-11-30  
**Versão RxDB**: v16.20.0  
**Última atualização**: Migração de `atomicPatch()` para `incrementalPatch()`
