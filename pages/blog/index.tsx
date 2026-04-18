import { useMemo, useState } from 'react'
import Head from 'next/head'
import { GetStaticProps } from 'next'
import { motion } from 'framer-motion'
import { getAllPosts, getAllCategories, BlogPostMeta, BlogCategory } from '@/lib/blog'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { BlogCard } from '@/components/blog/BlogCard'
import { CategoryFilter } from '@/components/blog/CategoryFilter'
import { NewsletterCTA } from '@/components/blog/NewsletterCTA'

interface BlogIndexProps {
  posts: BlogPostMeta[]
  categories: Array<{ name: BlogCategory; count: number }>
}

export const getStaticProps: GetStaticProps<BlogIndexProps> = async () => {
  const posts = getAllPosts()
  const categories = getAllCategories()
  return { props: { posts, categories } }
}

export default function BlogIndex({ posts, categories }: BlogIndexProps) {
  const [activeCategory, setActiveCategory] = useState<BlogCategory | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const filteredPosts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return posts.filter((post) => {
      const matchesCategory = activeCategory ? post.category === activeCategory : true
      if (!matchesCategory) return false

      if (!query) return true

      const searchableText = [
        post.title,
        post.description,
        post.excerpt,
        post.category,
        post.readingTime,
        ...post.tags,
      ]
        .join(' ')
        .toLowerCase()

      return searchableText.includes(query)
    })
  }, [activeCategory, posts, searchQuery])

  return (
    <>
      <Head>
        <title>Tech Blog — System Design, DSA, Java & Distributed Systems | CodeSprintPro</title>
        <meta
          name="description"
          content="Deep-dive technical articles on DSA, Kafka, Redis, System Design, Java 21, RAG systems, AWS architecture, and more — by Sachin Sarawgi."
        />
        <link rel="canonical" href="https://codesprintpro.com/blog/" />
        <link
          rel="alternate"
          type="application/rss+xml"
          title="CodeSprintPro Tech Blog RSS Feed"
          href="https://codesprintpro.com/feed.xml"
        />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Tech Blog — CodeSprintPro" />
        <meta
          property="og:description"
          content="Deep-dive articles on DSA, System Design, Java, Databases, AI/ML, and distributed systems."
        />
        <meta property="og:url" content="https://codesprintpro.com/blog/" />
        <meta property="og:image" content="https://codesprintpro.com/images/profile.jpg" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:site_name" content="CodeSprintPro" />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Tech Blog — CodeSprintPro" />
        <meta
          name="twitter:description"
          content="Deep-dive articles on DSA, System Design, Java, Databases, AI/ML, and distributed systems."
        />
        <meta name="twitter:image" content="https://codesprintpro.com/images/profile.jpg" />

        {/* Keywords */}
        <meta
          name="keywords"
          content="dsa, data structures and algorithms, java, system design, kafka, redis, postgresql, aws, backend engineering, microservices, data engineering"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Blog',
              name: 'CodeSprintPro Tech Blog',
              url: 'https://codesprintpro.com/blog/',
              author: { '@type': 'Person', name: 'Sachin Sarawgi' },
            }),
          }}
        />
      </Head>

      <div className="min-h-screen bg-gray-50">
        <Navbar />

        {/* Hero */}
        <section className="bg-gradient-to-br from-gray-900 to-blue-950 pt-32 pb-16">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <span className="text-blue-400 text-sm font-mono uppercase tracking-widest">
                // codesprintpro
              </span>
              <h1 className="text-4xl md:text-5xl font-bold text-white mt-2 mb-4">
                Tech Blog
              </h1>
              <p className="text-gray-300 text-lg max-w-2xl">
                Deep-dive articles on System Design, Java, Databases, AI/ML, and distributed systems.
                Written by an Engineering Manager who has built systems at scale.
              </p>
              <div className="flex items-center gap-6 mt-6 text-gray-400 text-sm">
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  {posts.length} articles
                </span>
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                  {categories.length} categories
                </span>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Content */}
        <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {/* Search */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-5 mb-6 shadow-sm">
            <label htmlFor="blog-search" className="block text-sm font-semibold text-gray-900 mb-2">
              Search articles
            </label>
            <div className="relative">
              <input
                id="blog-search"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Try Kafka, Spring Boot, Redis, system design..."
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 pr-12 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-400 hover:text-gray-700"
                  aria-label="Clear search"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Search by title, tag, category, topic, or short summary.
            </p>
          </div>

          {/* Category Filter */}
          <CategoryFilter
            categories={categories}
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
            totalCount={posts.length}
          />

          <div className="mb-8">
            <NewsletterCTA source="blog-index" compact />
          </div>

          {/* Posts Grid */}
          {filteredPosts.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              No articles matched your filters. Try another keyword or category.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-6">
                <p className="text-sm text-gray-500">
                  Showing {filteredPosts.length} of {posts.length} article{posts.length !== 1 ? 's' : ''}
                </p>
                {(activeCategory || searchQuery) && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveCategory(null)
                      setSearchQuery('')
                    }}
                    className="text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    Reset filters
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredPosts.map((post, index) => (
                  <motion.div
                    key={post.slug}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: index * 0.05 }}
                  >
                    <BlogCard post={post} variant="default" />
                  </motion.div>
                ))}
              </div>
            </>
          )}
        </main>

        <Footer />
      </div>
    </>
  )
}
