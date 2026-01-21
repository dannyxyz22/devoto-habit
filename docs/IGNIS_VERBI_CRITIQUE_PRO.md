# Review Ignis Verbi

## 🚀 Veredito: Pronto para lançamento?
**Ainda não.** O app tem uma base técnica sólida (PWA, RxDB, Supabase), mas faltam itens críticos de **observabilidade** e **resiliência** que são obrigatórios para um lançamento profissional.

O core do produto (leitura e biblioteca) parece funcional, mas a experiência de "primeira vez" (First Time User Experience - FTUE) e a segurança contra falhas precisam de atenção.

---

## 🔍 Críticas Pontuais

### 1. O que precisa ficar mais claro?
*   **Proposta de Valor**: O Hero ("Leitura devocional diária...") é inspirador, mas vago. O usuário entra e vê "Clássicos católicos", mas não entende imediatamente a mecânica:
    *   "É um leitor de EPUB?"
    *   "É uma rede social?"
    *   "É apenas para livros que já estão lá?"
*   **Mecânica de "Streak" e "Metas"**: Estas funcionalidades são mencionadas, mas não fica claro como configurá-las ou o que conta como "leitura".

### 2. O usuário entende de cara?
*   **Não totalmente.** A página `Index` parece misturar o estado de "usuário novo" com "usuário recorrente".
*   **Sugestão de Intro**:
    *   Adicionar uma seção "Como funciona" logo abaixo do Hero (3 passos simples: Escolha um livro -> Defina uma meta -> Mantenha o hábito).
    *   Ou um "Onboarding Modal" na primeira visita, explicando a proposta.

### 3. Precisa de Cleanup?
**SIM.** Encontrei dívidas técnicas que "sujam" o projeto:
*   **`index.html` poluído**: O script de debug (`<script>... debugPanel ...</script>`) é enorme e está *hardcoded* no HTML principal. Isso é má prática. Deve ser movido para um componente React (ex: `DebugPanel.tsx`) que é importado condicionalmente.
*   **Globais poluídas**: `window.dataLayer`, `window.replicationManager` em `main.tsx`. Útil para dev, mas perigoso em prod se não for removido ou protegido.

---

## ⚠️ Principais Erros de Lançamento (para evitar)

Aqui estão os pontos críticos que impedem o lançamento seguro hoje:

### 1. Voando no Escuro (Sem Analytics) 🛑
Não encontrei scripts de analytics (Google Analytics, PostHog, Plausible, etc.).
*   **O erro**: Lançar sem saber quantos usuários entraram, onde clicaram ou onde desistiram.
*   **Solução**: Adicione uma ferramenta de analytics privacidade-friendly (ex: PostHog) para medir retenção e funil de cadastro.

### 2. Tela Branca da Morte (Sem Error Boundary) 🛑
Não há um `ErrorBoundary` envolvendo a aplicação em `main.tsx` ou `App.tsx`.
*   **O erro**: Se ocorrer um erro de renderização (ex: falha ao processar um EPUB corrompido), o app inteiro "quebra" e a tela fica branca, sem opção de recuperar.
*   **Solução**: Envolva o app com um Error Boundary (ex: `react-error-boundary`) e mostre uma tela amigável "Algo deu errado" com botão de recarregar.

### 3. SEO e Social Sharing (Incompleto)
O `index.html` tem meta tags básicas, mas a integração dinâmica (OpenGraph) precisa ser verificada página a página.
*   **Imagem de compartilhamento**: O `og:image` aponta para `https://lovable.dev/opengraph-image-p98pqg.png`, que parece um placeholder genérico da ferramenta que você usou.
*   **Solução**: Crie uma imagem de capa personalizada para o `og:image` (ex: o mesmo banner do Hero com o logo).

### 4. Performance (Bundle Size)
`Index.tsx` tem **1300+ linhas**. Isso sugere que a página inicial está carregando lógica demais (Sync, Upload, Leitura, Cálculos).
*   **Risco**: O carregamento inicial pode ser lento em conexões móveis.
*   **Solução**: Refatorar `Index.tsx` em componentes menores e usar `React.lazy` para rotas pesadas.

---

## 🎨 Layout e Design

*   **Ponto Forte**: O uso de `shadcn-ui` e fontes serifadas (`Cardo`) é excelente para o nicho "clássicos/leitura". Passa seriedade e elegância.
*   **Atenção**: O Widget de debug fixo no HTML pode vazar visualmente se a lógica de `localStorage` falhar.
*   **Mobile First**: O `StatusBarManager` mostra cuidado com mobile, o que é ótimo.

---

## ✅ Checklist Recomendado para o "Go Live"

1.  [ ] **Analytics**: Instalar PostHog ou GA4.
2.  [ ] **Error Boundary**: Implementar `react-error-boundary`.
3.  [ ] **Refactor Debug**: Mover script do `index.html` para `src/components/DebugPanel.tsx`.
4.  [ ] **OG Image**: Criar e hospedar imagem oficial do OpenGraph.
5.  [ ] **Onboarding**: Adicionar seção "Como Funciona" na Home.
6.  [ ] **Página 404**: Personalizar a página `NotFound.tsx` com links úteis para voltar.
