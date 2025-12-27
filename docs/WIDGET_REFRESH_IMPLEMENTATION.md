# Implementação: Widget Busca Dados Quando Renderizado

## Resumo

Implementamos uma solução onde o widget Android busca dados atualizados diretamente do IndexedDB/RxDB quando é renderizado, garantindo que mesmo quando o app está fechado e o progresso é atualizado via realtime do Supabase, o widget será atualizado na próxima renderização.

## Arquivos Modificados

### 1. `android/app/src/main/java/app/ignisverbi/ProgressWidgetProvider.java`

**Mudanças**:
- Adicionadas constantes para controle de refresh:
  - `LAST_REFRESH_ATTEMPT_KEY`: Rastreia última tentativa de refresh
  - `MIN_REFRESH_INTERVAL_MS`: Mínimo de 5 minutos entre tentativas (throttling)
  - `DATA_STALE_THRESHOLD_MS`: Dados com mais de 1 hora são considerados antigos

- Lógica de detecção de dados antigos:
  - Verifica se os dados são de um dia diferente
  - Verifica se os dados têm mais de 1 hora de idade
  - Aplica throttling para evitar múltiplas tentativas

- Inicia MainActivity para refresh:
  - Quando detecta dados antigos E passou tempo suficiente desde última tentativa
  - Usa flag `devota_force_refresh` para executar JavaScript de refresh
  - Activity fecha automaticamente após executar o refresh

### 2. `android/app/src/main/java/app/ignisverbi/MainActivity.java`

**Mudanças**:
- Melhorado tratamento de refresh silencioso:
  - Adicionado log quando iniciado para refresh
  - Activity fecha automaticamente após 2 segundos (tempo para JavaScript executar)
  - Melhor tratamento de erros

## Como Funciona

### Fluxo Normal (App Aberto)

1. Progresso é atualizado → RxDB atualizado
2. Subscription RxDB detecta mudança
3. `dailyProgressPercent` é recalculado
4. `useEffect` detecta mudança
5. `updateDailyProgressWidget` atualiza SharedPreferences
6. Widget é atualizado

### Fluxo com App Fechado (Nova Funcionalidade)

1. Widget é renderizado (`updateAppWidget` chamado)
2. Verifica dados no SharedPreferences:
   - Se dados são de hoje E têm menos de 1 hora → Usa dados existentes
   - Se dados são antigos OU de dia diferente → Precisa refresh
3. Se precisa refresh E passou 5+ minutos desde última tentativa:
   - Marca timestamp da tentativa
   - Inicia MainActivity com `devota_force_refresh=true`
4. MainActivity:
   - Carrega WebView
   - Executa `window.devotaDailyRefresh()`
   - Esta função recalcula o progresso do RxDB/IndexedDB
   - Atualiza SharedPreferences via `updateDailyProgressWidget`
   - Activity fecha após 2 segundos
5. Próxima renderização do widget:
   - Widget detecta dados atualizados
   - Mostra progresso correto

## Benefícios

1. ✅ **Funciona mesmo com app fechado**: Widget busca dados quando renderizado
2. ✅ **Throttling inteligente**: Evita múltiplas tentativas desnecessárias
3. ✅ **Fallback seguro**: Se refresh falhar, usa dados antigos ao invés de crashar
4. ✅ **Bateria eficiente**: Só inicia Activity quando realmente necessário
5. ✅ **Atualização automática**: Quando usuário vê o widget, ele está atualizado

## Limitações

1. ⚠️ **Não é tempo real**: Widget só atualiza quando renderizado (ex: usuário olha para tela)
2. ⚠️ **Activity aparece brevemente**: Quando iniciada para refresh, pode aparecer por ~1-2 segundos
3. ⚠️ **Depende de JavaScript**: Requer que WebView seja inicializado (pode falhar se sistema está muito ocupado)

## Melhorias Futuras

- [ ] Usar RemoteViewsService para atualização mais suave
- [ ] Implementar WorkManager para refresh em background sem iniciar Activity
- [ ] Adicionar opção de configurar intervalo de refresh
- [ ] Cache mais inteligente de dados para reduzir necessidade de refresh

## Testes

Veja `docs/WIDGET_REFRESH_TEST.md` para instruções detalhadas de teste.

Script de teste disponível em `scripts/test-widget-refresh.sh`.
