## Deploy no GitHub Pages

Este projeto usa Vite + React e está configurado para publicar em GitHub Pages no caminho `/devoto-habit/` do repositório `dannyxyz22/devoto-habit`.

- `vite.config.ts` define `base: "/devoto-habit/"`.
- `BrowserRouter` usa `basename={import.meta.env.BASE_URL}`.
- `manifest.json` e `sw.js` usam caminhos relativos.
- `public/404.html` faz fallback para SPA.
- Workflow `.github/workflows/deploy.yml` compila e publica `dist/`.

Publicar: faça push na branch `main` e ative Pages em Settings → Pages → Source: GitHub Actions.

# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/0e007a58-dfb2-4de5-bd81-2ab2191f83ce

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/0e007a58-dfb2-4de5-bd81-2ab2191f83ce) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/0e007a58-dfb2-4de5-bd81-2ab2191f83ce) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/tips-tricks/custom-domain#step-by-step-guide)

### App Name Single Source of Truth

O nome do aplicativo (web/PWA/Capacitor) agora é centralizado em `src/config/appMeta.ts`.

Edite:
```
export const APP_NAME = 'Leitura Devota';
export const APP_SHORT_NAME = 'Devota';
```

Depois rode para propagar para `public/manifest.json`, `capacitor.config.ts` e `package.json` (displayName):
```
npm run sync:app-name
```

Isso atualiza:
- Manifest PWA (`name`, `short_name`)
- Capacitor (`appName`)
- `package.json` (`displayName` campo auxiliar)

O componente `SEO` usa `APP_NAME` como fallback de título caso não seja passado.

Caso publique sob outro domínio, ajuste também `APP_CANONICAL_HOST` em `appMeta.ts`.
