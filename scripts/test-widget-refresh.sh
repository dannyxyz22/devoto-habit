#!/bin/bash

# Script para testar o refresh automático do widget
# Uso: ./scripts/test-widget-refresh.sh

echo "=== Teste de Refresh Automático do Widget ==="
echo ""

# Verifica se adb está disponível
if ! command -v adb &> /dev/null; then
    echo "❌ Erro: adb não encontrado. Instale Android SDK Platform Tools."
    exit 1
fi

# Verifica se dispositivo está conectado
if ! adb devices | grep -q "device$"; then
    echo "❌ Erro: Nenhum dispositivo Android conectado."
    echo "Conecte um dispositivo via USB e habilite USB Debugging."
    exit 1
fi

echo "✅ Dispositivo conectado"
echo ""

PACKAGE_NAME="app.ignisverbi"

# Função para mostrar logs do widget
show_widget_logs() {
    echo "📋 Logs do Widget (Ctrl+C para parar):"
    echo "---"
    adb logcat -c  # Limpa logs anteriores
    adb logcat | grep -E "ProgressWidgetProvider|MainActivity|devotaDailyRefresh|WidgetUpdater" --line-buffered
}

# Função para verificar estado do SharedPreferences
check_widget_state() {
    echo ""
    echo "📊 Estado atual do widget:"
    adb shell run-as $PACKAGE_NAME cat /data/data/$PACKAGE_NAME/shared_prefs/CapacitorStorage.xml 2>/dev/null | grep -A 3 "widget:dailyProgress" || echo "Dados não encontrados"
    echo ""
}

# Função para forçar atualização do widget
force_widget_update() {
    echo "🔄 Forçando atualização do widget..."
    adb shell am broadcast -a android.appwidget.action.APPWIDGET_UPDATE
    sleep 1
    echo "✅ Broadcast enviado"
    echo ""
}

# Função para simular dados antigos (modificando timestamp)
simulate_stale_data() {
    echo "⏰ Simulando dados antigos (modificando timestamp)..."
    # Nota: Esta é uma simulação - em produção, os dados ficam antigos naturalmente
    echo "⚠️  Para simular dados antigos, aguarde mais de 1 hora ou altere a data do sistema"
    echo ""
}

# Menu principal
show_menu() {
    echo "Escolha uma opção:"
    echo "1) Ver logs do widget em tempo real"
    echo "2) Verificar estado atual do widget"
    echo "3) Forçar atualização do widget"
    echo "4) Simular dados antigos (instruções)"
    echo "5) Teste completo (força update + logs)"
    echo "6) Limpar dados do app (reset completo)"
    echo "0) Sair"
    echo ""
    read -p "Opção: " choice
    
    case $choice in
        1)
            show_widget_logs
            ;;
        2)
            check_widget_state
            show_menu
            ;;
        3)
            force_widget_update
            check_widget_state
            show_menu
            ;;
        4)
            simulate_stale_data
            show_menu
            ;;
        5)
            echo "🧪 Executando teste completo..."
            check_widget_state
            force_widget_update
            echo "Aguardando 3 segundos..."
            sleep 3
            check_widget_state
            echo ""
            echo "Para ver logs, execute opção 1"
            show_menu
            ;;
        6)
            read -p "⚠️  Tem certeza que deseja limpar todos os dados do app? (s/N): " confirm
            if [[ $confirm == [sS] ]]; then
                echo "🗑️  Limpando dados..."
                adb shell pm clear $PACKAGE_NAME
                echo "✅ Dados limpos. Reinicie o app e configure novamente."
            fi
            show_menu
            ;;
        0)
            echo "👋 Até logo!"
            exit 0
            ;;
        *)
            echo "❌ Opção inválida"
            show_menu
            ;;
    esac
}

# Verifica se app está instalado
if ! adb shell pm list packages | grep -q $PACKAGE_NAME; then
    echo "❌ Erro: App $PACKAGE_NAME não está instalado."
    exit 1
fi

echo "✅ App encontrado: $PACKAGE_NAME"
echo ""

# Mostra estado inicial
check_widget_state

# Inicia menu
show_menu
