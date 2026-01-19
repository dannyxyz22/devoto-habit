# Sistema de Logs de Erro - Guia do Administrador

Este documento descreve como configurar e acessar o sistema de logs de erro do Ignis Verbi.

## 1. Visão Geral

O sistema captura erros críticos do cliente (React e Global) e os envia para a tabela `error_logs` no Supabase. Para visualizar esses logs, existe uma interface administrativa protegida.

- **URL de Acesso**: `/admin/logs`
- **Tabela**: `public.error_logs`
- **Segurança**: Row Level Security (RLS)

## 2. Configuração de Acesso (RLS)

Por padrão, **ninguém** tem acesso de leitura aos logs (para proteger dados sensíveis). O acesso é liberado individualmente por UUID.

### Passo 1: Descobrir seu UUID
1. Acesse `/admin/logs` no navegador.
2. Se você não tiver permissão, verá um erro ou uma lista vazia.
3. No topo da página, copie o código exibido em "Seu UUID".

### Passo 2: Aplicar Permissão no Supabase
Execute o seguinte comando SQL no [SQL Editor do Supabase](https://supabase.com/dashboard/project/_/sql):

```sql
-- Substitua 'SEU_UUID_AQUI' pelo UUID copiado
create policy "Admin can view error logs"
    on public.error_logs
    for select
    using (auth.uid() = 'SEU_UUID_AQUI');

-- Opcional: Permitir deletar logs
create policy "Admin can delete error logs"
    on public.error_logs
    for delete
    using (auth.uid() = 'SEU_UUID_AQUI');
```

> **Nota**: Se você tiver múltiplos administradores, pode criar múltiplas políticas ou usar uma tabela de `roles` (não implementado nesta versão simples).

## 3. Manutenção

### Retenção de Logs
Um trigger automático (`cleanup_old_error_logs`) remove logs com mais de **60 dias**.
- A limpeza roda com 5% de probabilidade a cada novo log inserido.
- Não é necessária manutenção manual.

### Limpeza Manual
Se precisar limpar todos os logs (ex: após corrigir um bug massivo):
1. Acesse o painel do Supabase -> Table Editor -> `error_logs`.
2. Selecione tudo e delete.
3. Ou via SQL: `TRUNCATE TABLE public.error_logs;`

## 4. Troubleshooting da Tela de Logs
- **Erro "Failed to fetch"**: Verifique sua conexão.
- **Lista Vazia**:
    - Você configurou o RLS corretamente?
    - Existem logs criados? (Teste rodando `logger.logError('Teste')` no console).
    - Você está logado com a conta correta?
