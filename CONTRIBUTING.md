# Guia de Contribuição - Ignis Verbi

Bem-vindo ao projeto **Ignis Verbi**! Este guia tem como objetivo ajudar novos desenvolvedores a configurar o ambiente, entender a estrutura do projeto e contribuir de forma eficaz.

## 🚀 Começando

### Pré-requisitos

-   **Node.js** (versão 18 ou superior recomendada)
-   **npm** (gerenciador de pacotes)
-   **Git**
-   **Android Studio** (apenas se for desenvolver/testar funcionalidades nativas Android)

### Configuração do Ambiente

1.  **Clone o repositório:**
    ```bash
    git clone <URL_DO_REPOSITORIO>
    cd devoto-habit
    ```

2.  **Instale as dependências:**
    ```bash
    npm install
    ```

3.  **Inicie o servidor de desenvolvimento:**
    ```bash
    npm run dev
    ```
    O aplicativo estará disponível em `http://localhost:8080`.

## 📂 Estrutura do Projeto

A estrutura de pastas segue um padrão organizado por funcionalidades e tipos de arquivos:

-   `src/components`: Componentes React reutilizáveis.
    -   `ui`: Componentes base (botões, inputs, dialogs) do shadcn/ui.
    -   `app`: Componentes específicos da aplicação (Hero, Menus, etc).
-   `src/pages`: Páginas principais (rotas) da aplicação.
-   `src/lib`: Utilitários, configurações e lógica de negócios (ex: `books.ts`, `storage.ts`).
-   `src/hooks`: Custom React Hooks.
-   `src/services`: Serviços de integração (ex: Supabase, RxDB).
-   `android`: Projeto nativo Android gerado pelo Capacitor.

## 📱 Desenvolvimento Mobile (Android)

Este projeto utiliza **Capacitor** para gerar o aplicativo Android.

1.  **Sincronizar alterações web com nativo:**
    Sempre que instalar uma nova dependência ou fizer build:
    ```bash
    npx cap sync
    ```

2.  **Abrir no Android Studio:**
    ```bash
    npx cap open android
    ```

3.  **Rodar no dispositivo/emulador:**
    Use o botão "Run" do Android Studio.

### Widget Android
O widget nativo está localizado em `android/app/src/main/java/com/devotohabit/app/ProgressWidgetProvider.java`. Ele lê dados salvos via `Capacitor Preferences`.

## 🛠️ Padrões de Código

-   **TypeScript:** Utilizamos TypeScript estrito. Evite `any` sempre que possível. Defina interfaces para suas props e dados.
-   **Estilização:** Utilizamos **Tailwind CSS**. Evite criar arquivos CSS separados; use as classes utilitárias.
-   **Componentes:** Prefira componentes funcionais com Hooks.
-   **Gerenciamento de Estado:**
    -   Estado local: `useState`
    -   Estado global simples: Context API (se necessário)

## 🐛 Debug Mode

Para facilitar o desenvolvimento, especialmente em dispositivos móveis, existe um **Modo Debug** oculto.

-   **Como ativar:** Na tela inicial, toque 7 vezes no texto "Clássicos católicos".
-   **Funcionalidades:** Permite ver o estado interno, limpar dados e forçar atualização do widget.
-   Consulte `README.md` para mais detalhes.

## workflow Git

1.  Crie uma branch para sua feature ou correção: `git checkout -b feature/minha-nova-feature`.
2.  Faça commits pequenos e descritivos.
3.  Abra um Pull Request (PR) descrevendo suas alterações.

## 📝 Documentação

-   Mantenha o `README.md` atualizado se adicionar novas funcionalidades principais.
-   Se criar uma decisão arquitetural complexa, documente o "porquê" em comentários ou em um arquivo de documentação específico.

Obrigado por contribuir! 🙏
