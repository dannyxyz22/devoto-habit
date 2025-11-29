export type BookMeta = {
  id: string;
  title: string;
  author: string;
  sourceUrl?: string;          // Optional for physical books
  description: string;
  coverImage?: string;
  type?: 'json' | 'epub' | 'physical';  // Add 'physical' type
  isUserUpload?: boolean;      // Flag for user-uploaded books
  isPhysical?: boolean;        // Flag for physical books
  totalPages?: number;         // For physical books
  currentPage?: number;        // For physical books
  addedDate?: number;          // Timestamp for sorting
  fileHash?: string;           // For EPUB deduplication
  hasLocalFile?: boolean;      // For cross-device EPUB sync
  percentage?: number;         // Reading progress percentage
};

// Import asset via Vite so the URL is correctly handled in build
// Note: keep using JPG that exists in src/assets. If you switch to PNG, ensure the file exists.
import filoteiaCover from "@/assets/book-cover-filoteia.jpg";

// Validate that no static book IDs start with reserved prefixes
const validateBookIds = (books: BookMeta[]): BookMeta[] => {
  books.forEach(book => {
    if (book.id.startsWith('user-')) {
      throw new Error(
        `Static book IDs cannot start with 'user-' (reserved for user uploads): ${book.id}`
      );
    }
    if (book.id.startsWith('physical-')) {
      throw new Error(
        `Static book IDs cannot start with 'physical-' (reserved for physical books): ${book.id}`
      );
    }
  });
  return books;
};

export const BOOKS: BookMeta[] = validateBookIds([
  {
    id: "filoteia",
    title: "Introdução à Vida Devota (Filotéia)",
    author: "São Francisco de Sales",
    sourceUrl:
      "https://raw.githubusercontent.com/dannyxyz22/introduction-devout-life/refs/heads/main/output/livro_pt-BR.json",
    description:
      "Clássico atemporal que ensina a viver a devoção no cotidiano, escrito por São Francisco de Sales.",
    coverImage: filoteiaCover,
    type: 'json',
  },
  {
    id: "imitacao-cristo",
    title: "Imitação de Cristo",
    author: "Tomás de Kempis",
    sourceUrl: "/epubs/imitacao-cristo.epub",
    description: "Um dos livros devocionais mais influentes do cristianismo.",
    type: 'epub',
  },
  {
    id: "confissoes-agostinho",
    title: "Confissões",
    author: "Santo Agostinho",
    sourceUrl: "/epubs/confissoes-agostinho.epub",
    description: "A jornada espiritual e intelectual de Santo Agostinho.",
    type: 'epub',
  },
  {
    id: "compendio-cic",
    title: "Compêndio do Catecismo da Igreja Católica",
    author: "Igreja Católica",
    sourceUrl: "/epubs/compendio-cic-pt20210324-114206.epub",
    description: "Síntese oficial da fé católica em formato de perguntas e respostas.",
    type: 'epub',
  },
  // Exemplo de EPUB externo (Gutenberg). Em desenvolvimento, passamos por /proxy para evitar CORS.
  // Em produção, prefira copiar o arquivo para /public/epubs e referenciar via path relativo.
  // {
  //   id: "gutenberg-1653",
  //   title: "Exemplo Gutenberg 1653",
  //   author: "Gutenberg",
  //   sourceUrl: "https://www.gutenberg.org/ebooks/1653.epub3.images",
  //   description: "Exemplo de EPUB servido externamente.",
  //   type: 'epub',
  // },
  {
    id: "imitacao-cristo-English",
    title: "Imitation of Christ",
    author: "Tomás de Kempis",
    sourceUrl: "https://www.gutenberg.org/ebooks/1653.epub3.images",
    description: "Um dos livros devocionais mais influentes do cristianismo.",
    type: 'epub',
  },



]);

export const getBookById = (id: string) => BOOKS.find((b) => b.id === id);
