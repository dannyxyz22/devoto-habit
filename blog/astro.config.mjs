// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  	site: 'https://www.ignisverbi.app',

  // gera o resultado direto para o dist do site principal
 	outDir: '../dist/blog',  // 👈 gera os arquivos no dist geral do site
	integrations: [mdx(), sitemap()],
});
