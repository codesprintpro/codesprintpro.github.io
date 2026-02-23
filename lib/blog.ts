import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import remarkHtml from 'remark-html'
import readingTime from 'reading-time'

export type BlogCategory =
  | 'System Design'
  | 'Java'
  | 'Databases'
  | 'AI/ML'
  | 'AWS'
  | 'Messaging'
  | 'Data Engineering'

export interface BlogPostFrontmatter {
  title: string
  description: string
  date: string
  category: BlogCategory
  tags: string[]
  featured: boolean
  coverImage?: string
  affiliateSection?: string
}

export interface TocItem {
  id: string
  text: string
  level: 2 | 3
}

export interface BlogPostMeta extends BlogPostFrontmatter {
  slug: string
  readingTime: string
  excerpt: string
}

export interface BlogPost extends BlogPostMeta {
  contentHtml: string
  tableOfContents: TocItem[]
}

const BLOG_DIR = path.join(process.cwd(), 'content', 'blog')

function extractExcerpt(rawContent: string, maxLength = 220): string {
  const stripped = rawContent
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*|__|\*|_|~~|`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\n+/g, ' ')
    .trim()
  return stripped.length > maxLength ? stripped.slice(0, maxLength) + '…' : stripped
}

function extractTableOfContents(rawContent: string): TocItem[] {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm
  const toc: TocItem[] = []
  let match: RegExpExecArray | null
  while ((match = headingRegex.exec(rawContent)) !== null) {
    const level = match[1].length as 2 | 3
    const text = match[2].trim()
    const id = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    toc.push({ id, text, level })
  }
  return toc
}

async function markdownToHtml(content: string): Promise<string> {
  const result = await remark()
    .use(remarkGfm)
    .use(remarkHtml, { sanitize: false })
    .process(content)
  // Add language class to code blocks for Prism styling
  return result
    .toString()
    .replace(/<code class="language-(\w+)">/g, '<code class="language-$1">')
}

function getSlugs(): string[] {
  if (!fs.existsSync(BLOG_DIR)) return []
  return fs
    .readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith('.mdx') || f.endsWith('.md'))
    .map((f) => f.replace(/\.(mdx|md)$/, ''))
}

export function getAllPostSlugs(): Array<{ params: { slug: string } }> {
  return getSlugs().map((slug) => ({ params: { slug } }))
}

export function getAllPosts(): BlogPostMeta[] {
  const slugs = getSlugs()
  const posts = slugs.map((slug) => {
    const mdxPath = path.join(BLOG_DIR, `${slug}.mdx`)
    const mdPath = path.join(BLOG_DIR, `${slug}.md`)
    const fullPath = fs.existsSync(mdxPath) ? mdxPath : mdPath
    const fileContents = fs.readFileSync(fullPath, 'utf8')
    const { data, content } = matter(fileContents)
    const frontmatter = data as BlogPostFrontmatter
    const rt = readingTime(content)
    return {
      ...frontmatter,
      slug,
      readingTime: rt.text,
      excerpt: extractExcerpt(content),
    } as BlogPostMeta
  })
  return posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

export function getFeaturedPosts(limit = 5): BlogPostMeta[] {
  return getAllPosts()
    .filter((p) => p.featured)
    .slice(0, limit)
}

export function getPostsByCategory(category: BlogCategory): BlogPostMeta[] {
  return getAllPosts().filter((p) => p.category === category)
}

export async function getPostBySlug(slug: string): Promise<BlogPost> {
  const mdxPath = path.join(BLOG_DIR, `${slug}.mdx`)
  const mdPath = path.join(BLOG_DIR, `${slug}.md`)
  const fullPath = fs.existsSync(mdxPath) ? mdxPath : mdPath
  const fileContents = fs.readFileSync(fullPath, 'utf8')
  const { data, content } = matter(fileContents)
  const frontmatter = data as BlogPostFrontmatter
  const rt = readingTime(content)
  const contentHtml = await markdownToHtml(content)
  const toc = extractTableOfContents(content)
  return {
    ...frontmatter,
    slug,
    readingTime: rt.text,
    excerpt: extractExcerpt(content),
    contentHtml,
    tableOfContents: toc,
  }
}

export function getRelatedPosts(currentSlug: string, category: BlogCategory, limit = 3): BlogPostMeta[] {
  return getPostsByCategory(category)
    .filter((p) => p.slug !== currentSlug)
    .slice(0, limit)
}

export function getAllCategories(): Array<{ name: BlogCategory; count: number }> {
  const posts = getAllPosts()
  const counts = new Map<BlogCategory, number>()
  posts.forEach((p) => counts.set(p.category, (counts.get(p.category) ?? 0) + 1))
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}
