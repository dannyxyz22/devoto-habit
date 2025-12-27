# Teste do Widget Refresh Automático

Este documento descreve como testar a funcionalidade de refresh automático do widget quando ele é renderizado.

## Como Funciona

Quando o widget é renderizado (`updateAppWidget`), ele verifica:
1. **Dados desatualizados**: Se os dados são de um dia diferente ou têm mais de 1 hora
2. **Throttling**: Se passou pelo menos 5 minutos desde a última tentativa de refresh
3. **Refresh**: Se necessário, inicia a MainActivity em modo headless para recalcular os dados

## Pré-requisitos

1. App instalado no dispositivo Android
2. Widget adicionado à tela inicial
3. Usuário logado com livro ativo e meta de leitura configurada

## Cenários de Teste

### Teste 1: Widget Renderizado com Dados Antigos

**Objetivo**: Verificar se o widget detecta dados antigos e inicia refresh

**Passos**:
1. Abra o app e certifique-se de que o widget está atualizado (deve mostrar progresso atual)
2. Feche o app completamente
3. Aguarde mais de 1 hora (ou simule alterando a data/hora do sistema)
4. Adicione o widget à tela inicial novamente OU force uma atualização do widget:
   ```bash
   adb shell am broadcast -a android.appwidget.action.APPWIDGET_UPDATE
   ```

**Resultado Esperado**:
- Widget mostra dados antigos (ou 0% se resetou)
- Logs mostram: `"Dados antigos detectados, solicitando refresh"`
- Logs mostram: `"Widget iniciou MainActivity para refresh de dados"`
- Após alguns segundos, widget deve ser atualizado com dados corretos

**Verificar Logs**:
```bash
adb logcat | grep -E "ProgressWidgetProvider|MainActivity|devotaDailyRefresh"
```

### Teste 2: Widget Renderizado com Dados de Dia Diferente

**Objetivo**: Verificar se o widget detecta mudança de dia

**Passos**:
1. Abra o app e certifique-se de que o widget está atualizado
2. Feche o app completamente
3. Simule mudança de data do sistema (avance 1 dia):
   ```bash
   # No dispositivo, vá em Configurações > Data e Hora > Desative "Usar data/hora da rede"
   # Avance a data manualmente em 1 dia
   ```
4. Force atualização do widget:
   ```bash
   adb shell am broadcast -a android.appwidget.action.APPWIDGET_UPDATE
   ```

**Resultado Esperado**:
- Logs mostram: `"Dados de dia diferente detectados"`
- Widget inicia refresh automaticamente
- Widget é atualizado com dados do novo dia (0% inicialmente)

### Teste 3: Throttling - Prevenir Múltiplas Tentativas

**Objetivo**: Verificar se o throttling previne múltiplas tentativas

**Passos**:
1. Abra o app e certifique-se de que o widget está atualizado
2. Feche o app completamente
3. Force atualização do widget duas vezes em sequência (dentro de 5 minutos):
   ```bash
   adb shell am broadcast -a android.appwidget.action.APPWIDGET_UPDATE
   sleep 2
   adb shell am broadcast -a android.appwidget.action.APPWIDGET_UPDATE
   ```

**Resultado Esperado**:
- Primeira atualização inicia o refresh
- Segunda atualização mostra: `"Refresh recente detectado, pulando nova tentativa"`
- Apenas uma tentativa de refresh é feita

### Teste 4: Widget Busca Dados Após Mudança via Realtime

**Objetivo**: Verificar se o widget busca dados atualizados quando o progresso muda via realtime (app fechado)

**Passos**:
1. Abra o app e certifique-se de que o widget está atualizado
2. Feche o app completamente
3. Em outro dispositivo/cliente, atualize o progresso do livro (isso vai para a cloud via Supabase)
4. Aguarde alguns minutos (para dados ficarem "antigos" - > 1 hora) OU altere manualmente o timestamp no SharedPreferences:
   ```bash
   # Primeiro, veja o SharedPreferences atual
   adb shell run-as app.ignisverbi cat /data/data/app.ignisverbi/shared_prefs/CapacitorStorage.xml | grep widget:dailyProgress
   
   # Para simular dados antigos, você pode usar um plugin Capacitor ou modificar diretamente
   # (Não recomendado em produção, apenas para teste)
   ```
5. Force atualização do widget:
   ```bash
   adb shell am broadcast -a android.appwidget.action.APPWIDGET_UPDATE
   ```

**Resultado Esperado**:
- Widget detecta dados antigos
- MainActivity é iniciada em background
- JavaScript recalcula o progresso baseado nos dados do RxDB/IndexedDB
- Widget é atualizado com os dados corretos do progresso atualizado

### Teste 5: Widget Sem Dados (Primeira Vez)

**Objetivo**: Verificar comportamento quando não há dados salvos

**Passos**:
1. Limpe os dados do SharedPreferences (ou desinstale e reinstale o app)
2. Adicione o widget à tela inicial

**Resultado Esperado**:
- Widget detecta ausência de dados
- MainActivity é iniciada para buscar dados
- Widget é atualizado assim que os dados são calculados

## Comandos Úteis para Debug

### Ver Logs do Widget
```bash
adb logcat | grep -E "ProgressWidgetProvider|WidgetUpdater|devotaDailyRefresh"
```

### Ver Estado do SharedPreferences
```bash
adb shell run-as app.ignisverbi cat /data/data/app.ignisverbi/shared_prefs/CapacitorStorage.xml | grep -A 5 "widget:dailyProgress"
```

### Forçar Atualização do Widget
```bash
adb shell am broadcast -a android.appwidget.action.APPWIDGET_UPDATE
```

### Ver Widget IDs
```bash
adb shell dumpsys activity | grep -A 10 "mAppWidgetIds"
```

### Limpar Dados do App (para teste)
```bash
adb shell pm clear app.ignisverbi
```

## Verificando se Funcionou

Após executar os testes, verifique:

1. **Logs**: Deve aparecer mensagens indicando detecção de dados antigos e início do refresh
2. **Widget**: Deve mostrar dados atualizados após alguns segundos
3. **MainActivity**: Pode aparecer brevemente em background (normal, é para executar o JavaScript)

## Problemas Conhecidos

1. **Widget pode não atualizar imediatamente**: O refresh pode levar alguns segundos porque precisa iniciar a Activity, carregar o JavaScript, e recalcular os dados
2. **Activity pode aparecer brevemente**: Quando iniciada para refresh, a Activity pode aparecer por um momento antes de fechar
3. **Throttling pode atrasar refresh**: Se você testar múltiplas vezes, pode precisar aguardar 5 minutos entre tentativas

## Melhorias Futuras

- Adicionar RemoteViewsService para atualização mais suave
- Usar WorkManager para refresh em background sem iniciar Activity
- Adicionar opção de configurar intervalo de refresh
