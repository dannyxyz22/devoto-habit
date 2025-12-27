# Estrutura e Lógica do Plano de Leitura

Este documento detalha o funcionamento das metas de leitura e o papel dos campos técnicos no banco de dados, especialmente para diferentes tipos de livros.

## Campos Principais

No banco de dados (coleção `reading_plans`), os campos `target_part_index` e `target_chapter_index` definem o ponto de chegada de um plano. O campo `start_percent` define onde o usuário estava quando criou o plano.

---

## 1. Livros Estáticos (JSON Internos)
Para os clássicos católicos que já acompanham o aplicativo (como o *Tratado da Verdadeira Devoção*), o sistema utiliza uma estrutura de dados fixa dividida em partes e capítulos.

- **`target_part_index`**: Índice da "Parte" alvo (ex: 0 para Introdução, 1 para Parte I, etc).
- **`target_chapter_index`**: Índice do "Capítulo" dentro daquela parte.
- **Lógica de Cálculo**: 
  - O app utiliza uma função para somar o número de palavras desde o início do livro até o capítulo alvo.
  - A meta é atingida quando o usuário alcança o total de palavras calculado para essa posição.
  - Isso permite criar planos para ler apenas seções específicas de um livro.

## 2. EPUBs (Upload do Usuário)
Para livros carregados pelo usuário, o formato é dinâmico e o sistema utiliza porcentagens para simplificar a sincronização entre dispositivos com tamanhos de tela diferentes.

- **Comportamento**: Atualmente, as metas de EPUB são **baseadas em porcentagem** (`isPercentBased`).
- **`target_part_index` / `target_chapter_index`**: Embora existam no banco, para EPUBs o sistema assume que o objetivo final é **100% do livro**.
- **Lógica de Cálculo**:
  - O progresso da meta é calculado pela distância entre o `start_percent` (porcentagem no momento da criação da meta) e o progresso atual, em direção ao alvo de 100%.

## 3. Livros Físicos
Para o rastreamento de livros físicos, a unidade principal é a página.

- **Comportamento**: O foco é exclusivamente no número de páginas lidas vs. total de páginas.
- **Lógica de Cálculo**:
  - A meta diária e o progresso do plano são calculados convertendo a porcentagem alvo em número de páginas (arredondado para cima).

---

## Sincronização e Consistência
A sincronização desses campos é crítica porque:
1. **`target_date_iso`**: Define quantos dias restam. Se houver diferença entre dispositivos, a meta diária (páginas por dia) será calculada errada.
2. **`start_percent`**: Sem este campo sincronizado, um novo dispositivo poderia assumir que você começou a ler o livro do zero (0%) hoje, fazendo com que sua meta parecesse muito mais "atrasada" ou "adiantada" do que realmente está.
3. **`total_pages`**: Essencial para livros físicos para que "21/29 páginas" não se torne "21/48 páginas" em outro dispositivo.
