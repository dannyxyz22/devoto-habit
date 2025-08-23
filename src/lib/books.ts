export type BookMeta = {
  id: string;
  title: string;
  author: string;
  sourceUrl: string;
  description: string;
  coverImage?: string;
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
  },
];

export const getBookById = (id: string) => BOOKS.find((b) => b.id === id);
