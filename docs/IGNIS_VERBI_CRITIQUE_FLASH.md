# Crítica: www.ignisverbi.app

## 🚀 Status de Lançamento: **Quase Pronto (90%)**

O app está funcional, tem um nicho muito bem definido e uma estética moderna. A base técnica (RxDB + Supabase) é sólida para o que se propõe. No entanto, para um lançamento "Premium" ou "Oficial", alguns pontos de fricção precisam ser resolvidos.

---

## 🧐 O que não fica claro de cara?

1.  **Híbrido E-reader vs. Tracker:** O app faz as duas coisas (lê EPUB e rastreia livros físicos). Para um novo usuário, pode não ser óbvio que ele pode adicionar o livro que tem na estante física dele.
2.  **Sincronização de EPUBs:** O app avisa (no Login) que os EPUBs ficam no dispositivo. Mas se o usuário troca de celular e vê o livro na biblioteca com um ícone de erro/alerta, ele pode achar que o app quebrou, a menos que o aviso de "Re-upload necessário" seja extremamente amigável.
3.  **Meta de Leitura (Reading Plan):** O conceito de "Meta" é central para criar o hábito, mas o usuário só entende isso depois de entrar em um livro. Falta uma explicação de como o cálculo é feito (ex: "X páginas por dia para terminar em DD/MM").

---

## 💡 Precisa de página introdutória/explicação?

**Sim, mas não necessariamente uma página separada.**

-   **Onboarding Simples:** Um carrossel de 3 slides (ou um modal "Bem-vindo") no primeiro acesso:
    1.  "Leia seus clássicos favoritos ou acompanhe seus livros físicos."
    2.  "Crie metas diárias e mantenha sua constância (Streaks)."
    3.  "Privacidade total: seus arquivos ficam com você, seu progresso conosco."
-   **Empty States:** No primeiro acesso à biblioteca, em vez de apenas o botão de upload, poderia haver um card explicativo: "Ainda não tem livros? Escolha um dos nossos clássicos abaixo ou suba o seu."

---

## 🧹 Clean up & Detalhes Técnicos

-   **Secret Debug:** O gatilho de clique no texto "Clássicos católicos" no `Hero.tsx` para abrir o modo debug deve ser removido ou escondido sob uma flag de ambiente difícil de acessar por acidente.
-   **Traduções:** Verifiquei strings como "Uploaded by user" e "Synced from cloud". Para um público brasileiro (foco em português), garantir que 100% da interface esteja em PT-BR é crucial para a percepção de qualidade.
-   **Sync Manual:** O botão "🔄 Atualizar" na biblioteca é útil, mas o ideal seria que a sincronia fosse tão transparente que o usuário nem soubesse que existe um botão de manual sync (ou que ele ficasse escondido em "Configurações").

---

## 🎨 Layout e Design

-   **Pontos Positivos:** Uso de shadcn/ui dá um ar profissional. O gradiente no card de progresso e o Hero principal são visualmente atraentes.
-   **Sugestão de "Warmth":** O design atual é muito "SaaS moderno". Para o nicho de "Ignis Verbi", talvez elementos visuais mais orgânicos, fontes serifadas clássicas (ex: para os títulos) e uma paleta levemente mais voltada para tons de papel/pergaminho ou madeira poderiam criar uma conexão emocional maior com o tema sagrado.
-   **Resiliência de Capas:** O loader de capas de EPUB é complexo. Se uma capa falhar, o fallback (ícone de livro) é funcional, mas pode parecer "vazio". Ter uma geração de capas "genéricas" bonitas com o título do livro ficaria mais premium.

---

## ⚠️ Principais Erros de Lançamento a Evitar

1.  **Fricção no Primeiro Sucesso:** O usuário deve ter um "sucesso" em menos de 1 minuto (ex: começar a ler um livro ou definir uma meta).
2.  **Dependência Única de Social Login:** Se o usuário não gosta do Google, ele não entra. Considerar Email/Senha no futuro.
3.  **Falta de Feedback de Offline:** Como é um PWA, o usuário pode tentar usar sem net. Garantir que o app avise "Você está offline, salvaremos seu progresso localmente" aumenta a confiança.
4.  **Bugs de Escala nas Métricas:** Erros de arredondamento em porcentagens ou streaks que quebram por causa de fuso horário são os motivos #1 de reclamação em apps de hábito.

---

## ✅ Checklist de Preparação para Lançamento

- [x] Remover gatilhos de debug da UI principal.
- [x] Revisão final de todas as strings em Inglês para Português.
- [x] Adicionar um pequeno tutorial/onboarding para novos usuários.
- [ ] Testar o fluxo de "Re-upload" de EPUB em dois dispositivos diferentes para garantir que a mensagem é clara.
- [ ] Validar a visualização em dispositivos móveis muito pequenos (ex: iPhone SE).

---

## 🛠️ Implementações Realizadas (Pós-Crítica)

1. **Fluxo de Onboarding**: Adicionado carrossel de 4 slides explicando os pilares do app (Boas-vindas, Hábitos, Biblioteca Digital e Widget Android).
2. **Estado Vazio da Biblioteca**: Criado card receptivo com CTAs claros para usuários que ainda não adicionaram livros pessoais.
3. **Remoção de Debug**: Removido gatilho de 7 cliques no Hero para maior segurança em produção.
4. **UX Mobile**: Ajustado modal de onboarding para garantir rolagem e bordas arredondadas em qualquer dispositivo.
