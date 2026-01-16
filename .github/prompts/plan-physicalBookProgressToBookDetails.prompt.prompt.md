# Plan: Mover funcionalidades do PhysicalBookTracker para BookDetails

Trazer o card "Progresso de Leitura" e a funcionalidade "Editar livro" do PhysicalBookTracker para a página BookDetails, mantendo toda a lógica testada.

## Steps

1. **Atualizar imports** em [src/pages/BookDetails.tsx](src/pages/BookDetails.tsx#L1-L25): Adicionar `useRef`, `setProgress`, `setDailyBaseline`, `getDailyBaselineAsync`, `saveCoverBlob`, `refreshWidget`, `Plus`, `Pencil`, `Upload`, `DialogDescription`, e `Label`.

2. **Adicionar estados para progresso e edição** em [src/pages/BookDetails.tsx](src/pages/BookDetails.tsx#L38-L48): Criar estados `currentPageInput`, `isUserEditing` (ref), `persistenceTimeoutRef` (ref), `lastAppliedProgressVersionRef` (ref), e estados de edição (`isEditDialogOpen`, `editTitle`, `editAuthor`, `editTotalPages`, `editCoverFile`, `editCoverPreview`, `isSaving`, `coverVersion`).

3. **Implementar handlers de progresso** após linha ~275: Criar `handleUpdateProgress` (atualizar página manualmente) e `handleQuickAdd` (adicionar +1, +5, +10, +20 páginas) copiando a lógica de [PhysicalBookTracker.tsx](src/pages/PhysicalBookTracker.tsx#L168-L365).

4. **Implementar handlers de edição** após os handlers de progresso: Criar `handleOpenEditDialog`, `handleCoverFileChange`, e `handleSaveMetadata` copiando de [PhysicalBookTracker.tsx](src/pages/PhysicalBookTracker.tsx#L240-L314).

5. **Adicionar Card "Progresso de Leitura"** após o card "Progresso Atual" (linha ~460): Renderizar condicionalmente (`{isPhysical && ...}`) o card com input de página, botão "Atualizar", e botões quick-add (+1, +5, +10, +20).

6. **Adicionar botão Editar e Dialog "Editar Livro"**: Adicionar botão `<Pencil>` no header do livro e o Dialog completo com campos de título, autor, total de páginas e upload de capa.

## Further Considerations

1. **Remoção do botão "Continuar Leitura" para Physical Books?** O botão atualmente navega para `/physical/${bookId}`. Com a edição inline, pode ser removido ou substituído por apenas "Abrir".

2. **Subscrição reativa para sincronização?** O PhysicalBookTracker usa uma subscription RxDB para atualizar o `book` em tempo real. Considere adicionar isso ao BookDetails para Physical Books.

3. **Atualização do chart após edição de progresso?** Após `handleQuickAdd` ou `handleUpdateProgress`, o `refetchTrigger` deve ser incrementado para atualizar o gráfico de progresso.
