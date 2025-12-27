# Widget Refresh Automático - Guia Rápido

## O que foi implementado?

O widget agora **busca dados atualizados automaticamente** quando é renderizado, mesmo quando o app está fechado.

## Como Testar (Método Simples)

### Pré-requisitos
- App instalado no dispositivo Android
- Widget adicionado à tela inicial
- ADB instalado e dispositivo conectado

### Teste Rápido

1. **Ver logs em tempo real**:
   ```bash
   adb logcat | grep -E "ProgressWidgetProvider|MainActivity|devotaDailyRefresh"
   ```

2. **Forçar atualização do widget**:
   ```bash
   adb shell am broadcast -a android.appwidget.action.APPWIDGET_UPDATE
   ```

3. **Ver estado atual do widget**:
   ```bash
   adb shell run-as app.ignisverbi cat /data/data/app.ignisverbi/shared_prefs/CapacitorStorage.xml | grep widget:dailyProgress
   ```

### Teste Completo (Simular Dados Antigos)

1. Abra o app e certifique-se que o widget está atualizado
2. Feche o app completamente
3. Aguarde mais de 1 hora (ou altere a data do sistema)
4. Force atualização do widget (comando acima)
5. Observe nos logs:
   - `"Dados antigos detectados, solicitando refresh"`
   - `"Widget iniciou MainActivity para refresh de dados"`
   - Após alguns segundos, widget deve atualizar

### Script de Teste Automatizado

Use o script `scripts/test-widget-refresh.sh` (Linux/Mac) ou Git Bash (Windows):

```bash
./scripts/test-widget-refresh.sh
```

## O que esperar?

✅ **Quando funciona**:
- Widget detecta dados antigos nos logs
- MainActivity é iniciada brevemente (pode aparecer na tela por ~1-2 segundos)
- Widget é atualizado após alguns segundos
- Logs mostram execução do `devotaDailyRefresh`

❌ **Se não funcionar**:
- Verifique logs para erros
- Certifique-se que o app tem livro ativo e meta configurada
- Verifique se passou tempo suficiente (> 1 hora ou dia diferente)
- Throttling pode estar ativo (aguarde 5 minutos entre tentativas)

## Documentação Completa

- **Implementação**: `docs/WIDGET_REFRESH_IMPLEMENTATION.md`
- **Testes Detalhados**: `docs/WIDGET_REFRESH_TEST.md`
