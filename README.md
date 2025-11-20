# Leitura Devota

Leitura Devota é uma aplicação web e mobile focada em leitura e acompanhamento de hábitos devocionais. O projeto permite a leitura de livros digitais (EPUB), gerenciamento de biblioteca pessoal e visualização de estatísticas de leitura.

## Funcionalidades

- **Leitor EPUB**: Leitura fluida de livros digitais com suporte a marcação de progresso.
- **Biblioteca**: Gerenciamento de livros adicionados.
- **Estatísticas**: Acompanhamento visual do hábito de leitura e progresso.
- **PWA & Mobile**: Otimizado para funcionar como Progressive Web App e aplicativo nativo Android (via Capacitor).
- **Widget Android**: Widget nativo para acompanhamento de meta diária de leitura diretamente na tela inicial do celular.

## Tecnologias Utilizadas

Este projeto foi construído com as seguintes tecnologias principais:

- **Core**: [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vitejs.dev/)
- **UI/Estilo**: [Tailwind CSS](https://tailwindcss.com/), [shadcn-ui](https://ui.shadcn.com/), [Lucide React](https://lucide.dev/)
- **Mobile**: [Capacitor](https://capacitorjs.com/)
- **Leitura**: [epubjs](https://github.com/futurepress/epub.js)
- **Gráficos**: [Recharts](https://recharts.org/)
- **Gerenciamento de Estado/Dados**: [TanStack Query](https://tanstack.com/query/latest)

## Configuração e Instalação

### Pré-requisitos

- Node.js & npm instalados.

### Instalação

1. Clone o repositório:
   ```bash
   git clone <SEU_GIT_URL>
   cd devoto-habit
   ```

2. Instale as dependências:
   ```bash
   npm install
   ```

3. Inicie o servidor de desenvolvimento:
   ```bash
   npm run dev
   ```

## Desenvolvimento Mobile (Android)

Para gerar a versão nativa Android:

1. Compile o projeto web:
   ```bash
   npm run build:native
   ```

2. Sincronize com o projeto nativo:
   ```bash
   npx cap sync
   ```

3. Abra no Android Studio:
   ```bash
   npx cap open android
   ```

### Widget Android

O projeto inclui um Widget nativo para Android que exibe o progresso da meta diária.
- **Código Nativo**: Localizado em `android/app/src/main/java/com/devotohabit/app/ProgressWidgetProvider.java`.
- **Atualização**: O app web comunica o progresso via Capacitor Preferences, que é lido pelo Widget.
- **Customização**: Consulte `android/README_WIDGET.md` para detalhes sobre customização de background e layout.

## Configuração do Projeto

### Nome do Aplicativo

O nome do aplicativo é centralizado em `src/config/appMeta.ts`. Para alterar:

1. Edite o arquivo `src/config/appMeta.ts`:
   ```typescript
   export const APP_NAME = 'Leitura Devota';
   export const APP_SHORT_NAME = 'Devota';
   ```

2. Propague as alterações para os arquivos de configuração (Manifest, Capacitor, package.json):
   ```bash
   npm run sync:app-name
   ```

## Deploy (GitHub Pages)

Este projeto está configurado para publicar no GitHub Pages no caminho `/devoto-habit/`.

- **Configuração**:
  - `vite.config.ts` define `base: "/devoto-habit/"`.
  - Workflow `.github/workflows/deploy.yml` automatiza o deploy da pasta `dist/`.

- **Como Publicar**:
  1. Faça push na branch `main`.
  2. No GitHub, vá em **Settings** → **Pages**.
  3. Em **Source**, selecione **GitHub Actions**.

## Estrutura de Pastas

- `src/components`: Componentes reutilizáveis (UI e específicos).
- `src/pages`: Páginas principais da aplicação (Leitor, Biblioteca, Stats).
- `src/lib`: Utilitários e configurações de bibliotecas.
- `src/hooks`: Custom hooks.
- `android`: Projeto nativo Android gerado pelo Capacitor.
