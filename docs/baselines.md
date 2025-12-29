# Arquitetura de Baselines (Marcos Iniciais)

Este documento descreve como o sistema gerencia as baselines para o cálculo de progresso diário.

## O que é uma Baseline?

Uma baseline é um registro histórico que marca a posição de leitura de um usuário no início de um dia específico. Ela é essencial para calcular o "Progresso de Hoje" de forma independente do progresso total do livro.

- **Localização:** Tabela `daily_baselines` no Supabase / Coleção `daily_baselines` no RxDB.
- **Identificador Único:** `{userId}:{bookId}:{dateISO}`.

## Quando as Baselines são Criadas?

Para garantir a precisão sem depender de um servidor centralizado, o app utiliza uma abordagem *on-demand* em três momentos:

### 1. Reação ao Progresso (Tracker)
Sempre que o progresso é atualizado (ex: virada de página), o `RxDBDataLayer` verifica se existe uma baseline para hoje.
- Se ausente, cria uma nova baseline usando o progresso **anterior** à atualização.
- **Arquivo:** `src/services/data/RxDBDataLayer.ts` -> `saveBookProgress`.

### 2. Inicialização de Livro
Ao adicionar um livro físico ou fazer upload de um EPUB.
- Cria uma baseline proativa na posição atual para ancorar o início da leitura.
- **Arquivo:** `src/services/data/RxDBDataLayer.ts` -> `saveBook` / `saveUserEpub`.

### 3. Sincronização e Fallback (Index)
Ao abrir a página inicial, um efeito monitora o livro ativo.
- Se o livro já tem progresso mas não tem baseline para hoje, o app a cria após a conclusão da replicação inicial.
- **Arquivo:** `src/pages/Index.tsx` -> `useEffect` (Baseline persistence).

## Considerações Arquiteturais: Client vs Server

Optamos por uma abordagem **Client-side / On-demand** em vez de um **Cron Job no Servidor** pelos seguintes motivos:

| Critério | Abordagem Atual (Client) | Cron Job (Server) |
| :--- | :--- | :--- |
| **Custo** | Zero (Processamento distribuído) | Requer Edge Functions pagas |
| **Offline** | Funciona sem internet (RxDB) | Não funciona sem sync |
| **Fuso Horário** | Naturalmente segue o dispositivo | Requer gestão complexa de TZ por usuário |
| **Escalabilidade** | Alta (Escala com o número de users) | Onerosa (Script roda para toda a base) |
| **Simplicidade** | Complexidade no Frontend (Guards) | Frontend mais simples (Dada garante existência) |

### Conclusão

A abordagem local é mais resiliente para uma aplicação de leitura offline e evita custos desnecessários de infraestrutura, mantendo a responsividade do cálculo de progresso independente da latência do servidor.
