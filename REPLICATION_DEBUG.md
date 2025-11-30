# Debug da Replicação de EPUBs do Usuário

## Problema
EPUBs adicionados no Browser A não aparecem no Browser B.

## Checklist de Diagnóstico

### 1. Verificar Logs no Browser A (onde o EPUB foi adicionado)
Após adicionar um EPUB, verificar no console:
- `[userEpubs] ✅ NEW EPUB UPLOADED:` - confirma que o EPUB foi salvo no RxDB local
- `[User EPUBs Replication] Pushed X document(s)` - confirma que foi enviado para o Supabase
- Se não aparecer o log de Push, verificar erros: `[User EPUBs Replication] Error:`

### 2. Verificar no Supabase Dashboard
- Acessar a tabela `user_epubs`
- Verificar se o registro foi criado com o `user_id` correto
- Verificar se os campos estão preenchidos corretamente

### 3. Verificar Logs no Browser B
Após alguns segundos (ou ao recarregar), verificar:
- `[User EPUBs Replication] Pulled X document(s)` - confirma que recebeu do Supabase
- `[Library] Updated books list: X` - confirma que a lista foi atualizada

### 4. Verificar Políticas RLS no Supabase
As políticas devem permitir:
- **SELECT**: `auth.uid() = user_id`
- **INSERT**: `auth.uid() = user_id`
- **UPDATE**: `auth.uid() = user_id`
- **DELETE**: `auth.uid() = user_id`

SQL para verificar:
```sql
-- Verificar políticas existentes
SELECT * FROM pg_policies WHERE tablename = 'user_epubs';
```

SQL para criar políticas corretas:
```sql
-- Enable RLS
ALTER TABLE public.user_epubs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view their own epubs" ON public.user_epubs;
DROP POLICY IF EXISTS "Users can insert their own epubs" ON public.user_epubs;
DROP POLICY IF EXISTS "Users can update their own epubs" ON public.user_epubs;
DROP POLICY IF EXISTS "Users can delete their own epubs" ON public.user_epubs;

-- Create new policies
CREATE POLICY "Users can view their own epubs"
ON public.user_epubs FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own epubs"
ON public.user_epubs FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own epubs"
ON public.user_epubs FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own epubs"
ON public.user_epubs FOR DELETE
USING (auth.uid() = user_id);
```

### 5. Testar Manualmente no Supabase
Executar no SQL Editor:
```sql
-- Inserir um registro de teste
INSERT INTO public.user_epubs (
  id, user_id, title, author, file_hash, file_size, added_date, _modified
) VALUES (
  'test-manual-' || extract(epoch from now())::text,
  auth.uid(),
  'Test Book',
  'Test Author',
  'test-hash-' || extract(epoch from now())::text,
  1000,
  extract(epoch from now() * 1000)::bigint,
  extract(epoch from now() * 1000)::bigint
);

-- Verificar se foi inserido
SELECT * FROM public.user_epubs WHERE user_id = auth.uid() ORDER BY _modified DESC LIMIT 5;
```

### 6. Forçar Replicação Manual (no Browser)
No console do navegador:
```javascript
// Verificar estado da replicação
const db = await window.dataLayer.getDatabase();
const epubs = await db.user_epubs.find().exec();
console.log('Local user_epubs:', epubs.map(e => ({ id: e.id, title: e.title, user_id: e.user_id })));

// Forçar rerun da replicação
await window.replicationManager.stopReplication();
await window.replicationManager.startReplication();
```

### 7. Verificar Subscription no RxDB
O problema pode estar na subscription não sendo ativada:
```javascript
// No console do browser B
const db = await window.dataLayer.getDatabase();
const sub = db.user_epubs.find({ selector: { _deleted: false }}).$.subscribe(docs => {
  console.log('[TEST SUBSCRIPTION] user_epubs changed:', docs.length);
});
// Para cancelar: sub.unsubscribe();
```

## Possíveis Causas e Soluções

### Causa 1: Políticas RLS bloqueando
**Sintoma**: Push funciona mas Pull não traz dados
**Solução**: Verificar e ajustar políticas RLS (ver item 4)

### Causa 2: Replicação não está em modo "live"
**Sintoma**: Precisa recarregar página para ver novos EPUBs
**Solução**: Já configurado com `live: true`, verificar logs de ativação

### Causa 3: user_id incorreto
**Sintoma**: EPUB salvo com user_id diferente do esperado
**Solução**: Verificar `getUserId()` no DataLayer e confirmar que retorna o UUID correto

### Causa 4: Campos faltando no schema do Supabase
**Sintoma**: Erro ao fazer push/pull
**Solução**: Verificar se todos os campos do schema RxDB existem no Supabase (incluindo `percentage` e `last_location_cfi`)

### Causa 5: Subscription da Library não está ativa
**Sintoma**: Replicação funciona mas UI não atualiza
**Solução**: Verificar logs `[Library] Updated books list:` e subscription do combineLatest
