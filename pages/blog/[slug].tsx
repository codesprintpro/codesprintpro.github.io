import { useState, useEffect } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { GetStaticProps, GetStaticPaths } from 'next'
import {
  getAllPostSlugs,
  getPostBySlug,
  getRelatedPosts,
  BlogPost,
  BlogPostMeta,
} from '@/lib/blog'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { BlogCard } from '@/components/blog/BlogCard'
import { TableOfContents } from '@/components/blog/TableOfContents'
import { AffiliateSection } from '@/components/blog/AffiliateSection'

// Load Prism language components for client-side syntax highlighting
const loadPrism = () => {
  if (typeof window === 'undefined') return
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Prism = require('prismjs')
    const langs = ['java', 'python', 'bash', 'yaml', 'json', 'sql', 'typescript', 'javascript']
    langs.forEach((lang) => {
      try { require(`prismjs/components/prism-${lang}`) } catch (_) {}
    })
    Prism.highlightAll()
  } catch (_) {
    // Prism is a progressive enhancement — silently fail
  }
}

interface ArticlePageProps {
  post: BlogPost
  relatedPosts: BlogPostMeta[]
}

export const getStaticPaths: GetStaticPaths = async () => {
  const paths = getAllPostSlugs()
  return { paths, fallback: false }
}

export const getStaticProps: GetStaticProps<ArticlePageProps> = async ({ params }) => {
  const slug = params!.slug as string
  const post = await getPostBySlug(slug)
  const relatedPosts = getRelatedPosts(slug, post.category)
  return { props: { post, relatedPosts } }
}

export default function ArticlePage({ post, relatedPosts }: ArticlePageProps) {
  const [activeHeadingId, setActiveHeadingId] = useState<string>('')
  const canonicalUrl = `https://codesprintpro.com/blog/${post.slug}/`
  const ogImage = post.coverImage
    ? `https://codesprintpro.com${post.coverImage}`
    : 'https://codesprintpro.com/images/og-default.jpg'

  const formattedDate = new Date(post.date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  // Track active heading for ToC
  useEffect(() => {
    const headings = document.querySelectorAll('h2[id], h3[id]')
    if (headings.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveHeadingId(entry.target.id)
          }
        })
      },
      { rootMargin: '0px 0px -75% 0px' }
    )
    headings.forEach((h) => observer.observe(h))
    return () => observer.disconnect()
  }, [post.slug])

  // Add id attrs to headings and apply Prism syntax highlighting
  useEffect(() => {
    const article = document.querySelector('article')
    if (!article) return
    article.querySelectorAll('h2, h3').forEach((el) => {
      if (!el.id) {
        const id = el.textContent!
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '')
        el.id = id
      }
    })
    loadPrism()
  }, [post.slug])

  return (
    <>
      <Head>
        <title>{post.title} | CodeSprintPro</title>
        <meta name="description" content={post.description} />
        <meta name="author" content="Sachin Sarawgi" />
        <link rel="canonical" href={canonicalUrl} />

        {/* Open Graph */}
        <meta property="og:type" content="article" />
        <meta property="og:title" content={post.title} />
        <meta property="og:description" content={post.description} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:site_name" content="CodeSprintPro" />
        <meta property="article:published_time" content={post.date} />
        <meta property="article:author" content="Sachin Sarawgi" />
        <meta property="article:section" content={post.category} />
        {post.tags.map((tag) => (
          <meta key={tag} property="article:tag" content={tag} />
        ))}

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={post.title} />
        <meta name="twitter:description" content={post.description} />
        <meta name="twitter:image" content={ogImage} />

        {/* JSON-LD */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'BlogPosting',
              headline: post.title,
              description: post.description,
              image: ogImage,
              datePublished: post.date,
              dateModified: post.date,
              author: {
                '@type': 'Person',
                name: 'Sachin Sarawgi',
                url: 'https://codesprintpro.com',
                sameAs: [
                  'https://www.linkedin.com/in/sachin-sarawgi/',
                  'https://github.com/codesprintpro',
                  'https://medium.com/@codesprintpro',
                ],
              },
              publisher: {
                '@type': 'Organization',
                name: 'CodeSprintPro',
                url: 'https://codesprintpro.com',
                logo: {
                  '@type': 'ImageObject',
                  url: 'https://codesprintpro.com/favicon/favicon-96x96.png',
                },
              },
              mainEntityOfPage: {
                '@type': 'WebPage',
                '@id': canonicalUrl,
              },
              keywords: post.tags.join(', '),
              articleSection: post.category,
            }),
          }}
        />
      </Head>

      <div className="min-h-screen bg-white">
        <Navbar />

        <div className="pt-20">
          {/* Article Header */}
          <div className="bg-gradient-to-br from-gray-900 to-blue-950 py-16">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl">
              {/* Breadcrumb */}
              <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6">
                <Link href="/" className="hover:text-white transition-colors">Home</Link>
                <span>/</span>
                <Link href="/blog" className="hover:text-white transition-colors">Blog</Link>
                <span>/</span>
                <span className="text-gray-300 truncate max-w-xs">{post.title}</span>
              </nav>

              <span className="inline-block text-xs font-semibold px-3 py-1 rounded-full bg-blue-100 text-blue-700 mb-4">
                {post.category}
              </span>
              <h1 className="text-3xl md:text-5xl font-bold text-white mb-4 leading-tight">
                {post.title}
              </h1>
              <p className="text-gray-300 text-lg mb-6 max-w-3xl">{post.description}</p>
              <div className="flex flex-wrap items-center gap-4 text-gray-400 text-sm">
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  Sachin Sarawgi
                </span>
                <span>·</span>
                <span>{formattedDate}</span>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {post.readingTime}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                {post.tags.map((tag) => (
                  <span key={tag} className="text-xs text-gray-400 bg-gray-800 px-2 py-1 rounded">
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Article Body */}
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl py-12">
            <div className="flex gap-12">
              {/* Main Content */}
              <div className="flex-1 min-w-0">
                <article
                  className="prose prose-lg max-w-none
                    prose-headings:text-gray-900 prose-headings:font-bold
                    prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4
                    prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-3
                    prose-p:text-gray-700 prose-p:leading-relaxed
                    prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline
                    prose-strong:text-gray-900
                    prose-blockquote:border-blue-600 prose-blockquote:text-gray-600
                    prose-code:text-blue-700 prose-code:bg-blue-50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none
                    prose-pre:rounded-xl
                    prose-img:rounded-xl prose-img:shadow-md
                    prose-table:text-sm
                    prose-th:bg-gray-100 prose-th:text-gray-700"
                  dangerouslySetInnerHTML={{ __html: post.contentHtml }}
                />

                {/* Affiliate Section */}
                {post.affiliateSection && (
                  <AffiliateSection variant={post.affiliateSection} />
                )}

                {/* Share */}
                <div className="mt-10 pt-8 border-t border-gray-100">
                  <p className="text-sm text-gray-500 mb-3">Found this useful? Share it:</p>
                  <div className="flex gap-3">
                    <a
                      href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(post.title)}&url=${encodeURIComponent(`https://codesprintpro.com/blog/${post.slug}/`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      Share on X/Twitter
                    </a>
                    <a
                      href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(`https://codesprintpro.com/blog/${post.slug}/`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Share on LinkedIn
                    </a>
                  </div>
                </div>
              </div>

              {/* Sidebar — ToC */}
              <aside className="hidden lg:block w-64 flex-shrink-0">
                <TableOfContents items={post.tableOfContents} activeId={activeHeadingId} />
              </aside>
            </div>

            {/* Related Posts */}
            {relatedPosts.length > 0 && (
              <div className="mt-16 pt-10 border-t border-gray-100">
                <h2 className="text-2xl font-bold text-gray-900 mb-6">Related Articles</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {relatedPosts.map((related) => (
                    <BlogCard key={related.slug} post={related} variant="default" />
                  ))}
                </div>
              </div>
            )}

            {/* Back to blog */}
            <div className="mt-12 text-center">
              <Link
                href="/blog"
                className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium transition-colors"
              >
                ← Back to all articles
              </Link>
            </div>
          </div>
        </div>

        <Footer />
      </div>
    </>
  )
}
