# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start local dev server at http://localhost:3000
npm run build    # Static export to /out (required for GitHub Pages deploy)
npm run lint     # ESLint via next lint
```

There are no tests. The build (`npm run build`) is the primary validation step — it runs TypeScript type-checking and generates the static export.

## Architecture

This is a **Next.js 13 Pages Router** site deployed as a **fully static export** to GitHub Pages at `codesprintpro.com`. `output: 'export'` in `next.config.js` is a hard constraint — no server-side features (API routes, ISR, `next/image` optimization) are available.

### Data Flow

All blog content lives as Markdown files in `content/blog/*.md`. The data layer at `lib/blog.ts` reads these files at build time using Node.js `fs` inside `getStaticProps`/`getStaticPaths`. No database is used for content.

- `getAllPosts()` — reads all MD files, parses frontmatter via gray-matter, returns sorted `BlogPostMeta[]`
- `getPostBySlug(slug)` — additionally converts Markdown to HTML via remark pipeline
- `getFeaturedPosts()`, `getRelatedPosts()`, `getAllCategories()` — derived from `getAllPosts()`

### Pages

| Route | File | Data source |
|---|---|---|
| `/` | `pages/index.tsx` | `getFeaturedPosts()` + `getAllCategories()` via `getStaticProps` |
| `/blog` | `pages/blog/index.tsx` | `getAllPosts()` via `getStaticProps`; category filtering is client-side state only |
| `/blog/[slug]` | `pages/blog/[slug].tsx` | `getPostBySlug()` + `getRelatedPosts()` via `getStaticProps` |

### Blog Article Frontmatter

Every `.md` file in `content/blog/` requires this frontmatter shape (see `lib/blog.ts` for types):

```yaml
---
title: "..."
description: "..."
date: "YYYY-MM-DD"
category: "System Design" # | Java | Databases | AI/ML | AWS | Messaging | Data Engineering
tags: ["tag1", "tag2"]
featured: true
affiliateSection: "distributed-systems-books" # optional — key into AFFILIATE_PRESETS in AffiliateSection.tsx
coverImage: "/images/..." # optional
---
```

### Syntax Highlighting

Prism runs **client-side only** in `pages/blog/[slug].tsx` via a `loadPrism()` `useEffect`. The Prism CSS theme is imported in `pages/_app.tsx` (not `globals.css`) because PostCSS does not resolve `node_modules` `@import`. Do not move this import.

### ESM Packages

`remark`, `remark-gfm`, `remark-html`, and their dependencies are ESM-only packages. They are listed in `transpilePackages` in `next.config.js` so webpack can bundle them for `getStaticProps`. Adding new ESM packages used in `getStaticProps`/`getStaticPaths` requires adding them to this list.

### Monetization

- **Google AdSense**: Script tag in `pages/_document.tsx` — the publisher ID placeholder `ca-pub-XXXXXXXXXXXXXXXX` must be replaced with the real ID after AdSense approval.
- **Affiliate links**: Defined in `components/blog/AffiliateSection.tsx` as `AFFILIATE_PRESETS`. A post opts in by setting `affiliateSection: "<preset-key>"` in its frontmatter.

### Key Non-Obvious Patterns

- `ReadingProgress` is loaded via `next/dynamic` with `{ ssr: false }` in `_app.tsx` because it uses `window` scroll events. This is required for the static export.
- `CategoryFilter` on `/blog` uses React `useState` — no URL params — because query strings are not compatible with purely static export.
- Heading `id` attributes for the Table of Contents are added via a client-side `useEffect` in `[slug].tsx` (not in the remark pipeline), so ToC anchor IDs and the `extractTableOfContents()` slug logic in `lib/blog.ts` must use the same normalization: `lowercase → strip non-alphanumeric → replace spaces with hyphens`.
- `trailingSlash: true` in `next.config.js` means all internal `<Link>` hrefs should include trailing slashes (e.g., `/blog/`) to match canonical URLs.
