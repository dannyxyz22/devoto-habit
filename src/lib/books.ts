export type BookMeta = {
  id: string;
  title: string;
  author: string;
  sourceUrl: string;
  description: string;
  coverImage?: string;
  type?: 'json' | 'epub';
  isUserUpload?: boolean;  // Flag for user-uploaded books
  addedDate?: number;      // Timestamp for sorting
};

// Import asset via Vite so the URL is correctly handled in build
// Note: keep using JPG that exists in src/assets. If you switch to PNG, ensure the file exists.
import filoteiaCover from "@/assets/book-cover-filoteia.jpg";

export const BOOKS: BookMeta[] = [
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



];

export const getBookById = (id: string) => BOOKS.find((b) => b.id === id);
