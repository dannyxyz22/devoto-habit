# Recomendação: Estratégia de Entrega de EPubs

Você está diante de um dilema comum em apps de conteúdo: **"Batteries Included"** (Tudo incluso) vs. **"Curated Repository"** (Repositório Externo). Ambas têm méritos, mas para o **Ignis Verbi**, uma abordagem híbrida parece ser a vencedora.

---

## 🏗️ Opção 1: "Batteries Included" (Bundled)
*O app já vem com 5-10 EPubs pré-instalados.*

### ✅ Prós
-   **Sucesso Instantâneo:** O usuário abre o app e já começa a ler. Zero barreiras.
-   **Offline Total:** Funciona no metrô, na igreja (sem sinal) ou em viagens desde o segundo zero.
-   **Curadoria Forte:** Reforça a identidade do app como "O lugar dos clássicos essenciais".

### ❌ Contras
-   **Tamanho do Bundle:** Cada EPub adiciona ~1-5MB. Com 50 livros, o app fica pesado para baixar.
-   **Atualizações:** Se você corrigir um erro de digitação no EPub, precisa lançar uma nova versão do app nas lojas.
-   **Direitos Autorais:** Bundlar conteúdo pode, em alguns casos, ser interpretado de forma mais rígida pelas lojas de apps (Apple/Google).

---

## 🌐 Opção 2: Curated Repository (Webapp/API Separada)
*O app é um leitor vazio; o conteúdo está em um "catálogo" online.*

### ✅ Prós
-   **Leveza:** O app inicial é minúsculo.
-   **Escalabilidade:** Você pode adicionar 1.000 livros no servidor sem afetar o app.
-   **Independência:** O repositório de EPubs pode ser um projeto paralelo que serve outros apps ou a web.

### ❌ Contras
-   **Fricção:** O usuário precisa de internet e paciência para "procurar e baixar" antes de ver o valor do app.
-   **Complexidade:** Requer um backend para hospedar os arquivos e uma API de catálogo.

---

## 🏆 Minha Recomendação: O Modelo Híbrido ("The Gateway Strategy")

Em vez de escolher um, use os dois de forma estratégica:

### 1. "Os Pilares" (Bundled)
Mantenha os **5-7 livros mais fundamentais** (ex: *Filoteia*, *Imitação de Cristo*, *Confissões*) embutidos no app. Isso garante que o app nunca pareça "vazio" e que o valor principal seja entregue imediatamente.

### 2. "A Biblioteca de Alexandria" (Remote Catalog)
Crie uma aba "Explorar" ou "Baixar Clássicos" que se conecta ao seu repositório externo.
-   O usuário clica em "Baixar" e o EPub é salvo no **IndexedDB** do navegador (ou sistema de arquivos do celular via Capacitor).
-   Isso usa a infraestrutura que você já criou para o "User Upload", mas automatiza a fonte.

### 3. "O Repositório Curado" como um Webapp Independente
Isso é uma excelente ideia de negócio/ecossistema.
-   O seu repositório pode ser um site onde as pessoas baixam EPubs revisados.
-   Dentro do **Ignis Verbi**, você teria um botão: "Importar do Repositório Ignis".

---

## 🎯 Por que isso é melhor?
1.  **UX Imbatível:** O usuário lê o primeiro capítulo de *Filoteia* em 10 segundos após instalar.
2.  **SEO & Tráfego:** O webapp de repositório atrai tráfego do Google (pessoas procurando "EPUB Imitação de Cristo"). Lá, você promove o app: "Para ler com metas e hábitos, use o Ignis Verbi".
3.  **Flexibilidade Técnica:** Se o app for removido da loja por algum motivo, o seu repositório de conteúdo continua vivo.

---

## 🛠️ Próximos Passos Sugeridos
1.  **Limpar o `BOOKS.ts`:** Deixe apenas os "Top 5".
2.  **Criar uma API simples (JSON):** Um arquivo `catalog.json` hospedado no GitHub Pages ou Supabase com links para os outros EPubs.
3.  **Implementar o "Cloud Download":** No Componente `Library`, adicione uma seção "Sugestões para Baixar".
