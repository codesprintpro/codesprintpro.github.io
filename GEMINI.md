# GEMINI.md

This file provides project-specific instructions and context for Gemini CLI.

## Foundational Mandates
- **Static Export Constraint:** This project is a fully static Next.js export (`output: 'export'`). NEVER use server-side features like `getServerSideProps`, API routes, ISR, or `next/image` optimization.
- **Trailing Slashes:** `trailingSlash: true` is enabled. All internal links MUST include a trailing slash (e.g., `<Link href="/blog/">`).
- **Prism Styling:** Prism CSS is imported in `pages/_app.tsx`. Do NOT move it to `globals.css` as PostCSS will not resolve it.
- **ESM Transpilation:** New ESM packages used in `getStaticProps` or `getStaticPaths` MUST be added to `transpilePackages` in `next.config.js`.

## Development Workflow

### Commands
- **Dev:** `npm run dev`
- **Build & Validate:** `npm run build` (Runs type-checking and static export)
- **Type Check:** `npx tsc --noEmit`
- **Lint:** `npm run lint`

### Content Management
- **Blog Posts:** Add `.md` files to `content/blog/`.
- **Frontmatter Requirements:**
  ```yaml
  title: "..."
  description: "..."
  date: "YYYY-MM-DD"
  category: "System Design" # | Java | DSA | Databases | AI/ML | AWS | Messaging | Data Engineering
  tags: ["tag1", "tag2"]
  featured: true/false
  affiliateSection: "preset-key" # Optional (see AffiliateSection.tsx)
  coverImage: "/images/..." # Optional
  ```
- **Categories:** Allowed categories are defined in `lib/blog.ts` and `lib/blogCategories.ts`.

### Table of Contents (ToC)
- TOC IDs are generated using: `lowercase → strip non-alphanumeric → replace spaces with hyphens`. 
- Implementation is split: `lib/blog.ts` extracts titles for the UI, and a client-side `useEffect` in `[slug].tsx` injects IDs into the DOM.

## Architectural Notes
- **Data Layer:** `lib/blog.ts` is the source of truth for post metadata and content parsing.
- **Client-side Interactivity:** Features like `ReadingProgress` and `Prism` loading must handle the absence of `window` during SSR/Export (e.g., using `useEffect` or `next/dynamic` with `ssr: false`).
- **Affiliate Links:** Manage presets in `components/blog/AffiliateSection.tsx`.

## DSA Series Tracking
Goal: Build a comprehensive, interview-focused DSA series for Java engineers.

| Status | Topic | File |
|---|---|---|
| ✅ | Big-O Notation | `big-o-notation-java-interview-problem-solving.md` |
| ✅ | Two Pointers | `two-pointers-pattern-java.md` |
| ✅ | Sliding Window | `sliding-window-pattern-java.md` |
| ✅ | Binary Search (Templates) | `binary-search-templates-java.md` |
| ✅ | Fast & Slow Pointers | `fast-slow-pointers-java.md` |
| ✅ | Top K Elements (Heaps) | `top-k-elements-heaps-java.md` |
| ✅ | BFS/DFS Fundamentals | `bfs-dfs-java-fundamentals.md` |
| ✅ | Backtracking Patterns | `backtracking-patterns-java.md` |
| ✅ | Dynamic Programming Basics | `dynamic-programming-basics-java.md` |
| ✅ | Trie (Prefix Tree) | `trie-prefix-tree-java.md` |
| ✅ | Bit Manipulation Hacks | `bit-manipulation-java-hacks.md` |
| ✅ | Monotonic Stack/Queue | `monotonic-stack-queue-java.md` |
| ✅ | Topological Sort | `topological-sort-java.md` |
| ⏳ | Union Find (Disjoint Set Union) | `union-find-dsu-java.md` |

