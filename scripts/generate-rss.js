const fs = require('fs')
const path = require('path')
const matter = require('gray-matter')

const SITE_URL = 'https://codesprintpro.com'
const BLOG_DIR = path.join(process.cwd(), 'content', 'blog')
const OUT_DIR = path.join(process.cwd(), 'out')
const FEED_PATH = path.join(OUT_DIR, 'feed.xml')

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function stripMarkdown(content) {
  return content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*|__|\*|_|~~/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function getPosts() {
  if (!fs.existsSync(BLOG_DIR)) return []

  return fs
    .readdirSync(BLOG_DIR)
    .filter((file) => file.endsWith('.md') || file.endsWith('.mdx'))
    .map((file) => {
      const fullPath = path.join(BLOG_DIR, file)
      const slug = file.replace(/\.(md|mdx)$/, '')
      const fileContents = fs.readFileSync(fullPath, 'utf8')
      const { data, content } = matter(fileContents)
      const excerpt = stripMarkdown(content).slice(0, 280)

      return {
        title: data.title,
        description: data.description || excerpt,
        date: data.date,
        category: data.category,
        slug,
        tags: data.tags || [],
      }
    })
    .filter((post) => post.title && post.date)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

function buildFeed(posts) {
  const latestDate = posts[0]?.date ? new Date(posts[0].date).toUTCString() : new Date().toUTCString()
  const items = posts
    .slice(0, 50)
    .map((post) => {
      const url = `${SITE_URL}/blog/${post.slug}/`
      const categories = [post.category, ...post.tags]
        .filter(Boolean)
        .map((tag) => `<category>${escapeXml(tag)}</category>`)
        .join('')

      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <description>${escapeXml(post.description)}</description>
      <pubDate>${new Date(post.date).toUTCString()}</pubDate>
      ${categories}
    </item>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>CodeSprintPro Tech Blog</title>
    <link>${SITE_URL}/blog/</link>
    <description>Practical backend engineering, system design, Java, databases, AWS, messaging, and AI infrastructure guides.</description>
    <language>en-us</language>
    <lastBuildDate>${latestDate}</lastBuildDate>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`
}

const posts = getPosts()
fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(FEED_PATH, buildFeed(posts), 'utf8')
console.log(`Generated RSS feed with ${Math.min(posts.length, 50)} posts at ${FEED_PATH}`)
