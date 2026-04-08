# Jorge Torres Website

Portfolio built with Astro (static) for Vercel.

## Routes

- `/` (Landing)
- `/visuals`
- `/my-history`
- `/contact`

## Media Files

Add the real images here (placeholders are currently used for gallery/profile):

- `public/media/landing.jpg`
- `public/media/contact.jpg`
- `public/media/profile.jpg`
- `public/media/visuals/*`

## Figma Reference Overlay (dev helper)

The Figma exports live in `public/ref/`.

Open a page with `?ref=<FileNameWithoutExtension>` to overlay the reference PNG.

Examples:

- `/?ref=Landing`
- `/visuals?ref=Visuals`
- `/my-history?ref=My History`
- `/contact?ref=Contact`

Keys:

- `v` toggle overlay
- `o` increase opacity
- `Shift+o` decrease opacity

## Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                       |
| :------------------------ | :------------------------------------------- |
| `npm install`             | Installs dependencies                        |
| `npm run dev`             | Starts local dev server at `localhost:4321`  |
| `npm run build`           | Build your production site to `./dist/`      |
| `npm run preview`         | Preview your build locally, before deploying |
| `npm run lint`            | Run ESLint                                   |
| `npm run format`          | Format with Prettier                         |
| `npm run format:check`    | Check formatting                             |
| `npm run astro ...`       | Run CLI commands                             |
| `npm run astro -- --help` | Get help using the Astro CLI                 |
