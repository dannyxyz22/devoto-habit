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

## Gerenciamento de Livros

### Livros Estáticos vs. Livros do Usuário

O aplicativo suporta dois tipos de livros:

1. **Livros Estáticos**: Livros que já vêm carregados no aplicativo, pré-configurados e disponíveis para todos os usuários. Definidos em `src/lib/books.ts`
2. **Livros do Usuário**: EPUBs enviados pelos próprios usuários através da funcionalidade de upload, armazenados localmente no IndexedDB do navegador

### Convenção de IDs

Para evitar conflitos de nomenclatura entre livros estáticos e livros enviados por usuários, o sistema usa a seguinte convenção:

- **Livros do Usuário**: IDs sempre começam com o prefixo `user-`, seguido de timestamp e string aleatória
  - Exemplo: `user-1763730720458-96xpv7cbz`
  - Gerado automaticamente em `src/lib/userEpubs.ts`

- **Livros Estáticos**: IDs **não podem** começar com `user-`
  - Validação automática em `src/lib/books.ts` impede IDs inválidos
  - Se um livro estático for adicionado com ID começando em `user-`, o app falhará ao iniciar com mensagem de erro clara

### Como Adicionar Livros Estáticos

Para adicionar um novo livro estático ao catálogo:

1. Edite `src/lib/books.ts`
2. Adicione um novo objeto ao array `BOOKS`:
   ```typescript
   {
     id: "meu-livro",  // NÃO use prefixo "user-"
     title: "Título do Livro",
     author: "Nome do Autor",
     sourceUrl: "/epubs/meu-livro.epub",
     description: "Descrição do livro",
     type: 'epub',  // ou 'json' para livros estruturados
   }
   ```
3. Se for EPUB, coloque o arquivo em `public/epubs/`

### Sistema de Upload de EPUBs

Os usuários podem fazer upload de seus próprios EPUBs através da página Biblioteca:

**Armazenamento**:
- EPUBs são armazenados no IndexedDB do navegador
- Metadados (título, autor) são extraídos automaticamente
- Capa do livro é extraída e armazenada como Data URL

**Funcionalidades**:
- Upload via botão "Upload EPUB" na biblioteca
- Extração automática de metadados usando epubjs
- Suporte a capas de livro
- Exclusão de livros enviados
- Progresso de leitura persistido

**Implementação**:
- `src/lib/userEpubs.ts`: Funções de gerenciamento (salvar, listar, deletar)
- `src/pages/Library.tsx`: Interface de upload e listagem
- `src/pages/EpubReader.tsx`: Leitura de EPUBs do usuário

### Detecção de Tipo de Livro

O sistema detecta se um livro é do usuário através de:

1. **Prefixo do ID**: Verifica se `bookId.startsWith('user-')`
2. **Flag `isUserUpload`**: Presente no objeto `BookMeta` para livros do usuário
3. **Validação em Tempo de Execução**: Garante que livros estáticos não usem o prefixo reservado

Essa detecção é usada em:
- Roteamento (Hero.tsx): `/epub/` vs `/leitor/`
- Carregamento de dados (EpubReader.tsx): IndexedDB vs arquivo estático
- Atualizações de widget (dailyRefresh.ts): Lógica de progresso baseada em porcentagem

## Otimizações de Performance

### Cache LRU de Locations (EPUBs)

Para melhorar a performance do leitor de EPUBs, o sistema implementa um cache LRU (Least Recently Used) para as "locations" geradas pelo epub.js.

**O que são locations?**
- Marcadores de posição no conteúdo do EPUB
- Necessários para calcular porcentagens de progresso precisas
- Geração leva alguns segundos (processamento do livro inteiro)
- Independentes do layout de renderização (fonte, tema, tamanho de tela)

**Como funciona o cache:**
1. **Primeira abertura**: Gera locations (demora alguns segundos) e salva no cache
2. **Aberturas seguintes**: Restaura instantaneamente do cache
3. **Limite**: Mantém apenas os 5 livros mais recentemente acessados
4. **Limpeza automática**: Remove livros mais antigos quando o limite é atingido
5. **Tratamento de quota**: Se o localStorage estiver cheio, remove automaticamente o livro mais antigo

**Implementação:**
- Arquivo: `src/lib/locationsCache.ts`
- Funções principais:
  - `loadLocationsFromCache(bookId)`: Carrega do cache
  - `saveLocationsToCache(bookId, data)`: Salva no cache com cleanup automático
  - `getCacheStats()`: Retorna estatísticas do cache (útil para debug)

**Benefícios:**
- ✅ Progresso calculado instantaneamente na segunda abertura
- ✅ Redução de uso de CPU (não regenera toda vez)
- ✅ Uso controlado de localStorage (~100-250KB para 5 livros)
- ✅ Melhor experiência do usuário

**Por que LRU?**
- Usuários geralmente leem poucos livros simultaneamente
- Mantém em cache apenas os livros ativamente lidos
- Evita sobrecarga do localStorage com livros antigos


