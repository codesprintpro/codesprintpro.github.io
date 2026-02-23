import { useState } from 'react'
import Head from 'next/head'
import { GetStaticProps } from 'next'
import { motion } from 'framer-motion'
import { getAllPosts, getAllCategories, BlogPostMeta, BlogCategory } from '@/lib/blog'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { BlogCard } from '@/components/blog/BlogCard'
import { CategoryFilter } from '@/components/blog/CategoryFilter'

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

  const filteredPosts = activeCategory
    ? posts.filter((p) => p.category === activeCategory)
    : posts

  return (
    <>
      <Head>
        <title>Tech Blog — System Design, Java & Distributed Systems | CodeSprintPro</title>
        <meta
          name="description"
          content="Deep-dive technical articles on Kafka, Redis, System Design, Java 21 Virtual Threads, RAG systems, AWS architecture, and more — by Sachin Sarawgi."
        />
        <link rel="canonical" href="https://codesprintpro.com/blog/" />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Tech Blog — CodeSprintPro" />
        <meta
          property="og:description"
          content="Deep-dive articles on System Design, Java, Databases, AI/ML, and distributed systems."
        />
        <meta property="og:url" content="https://codesprintpro.com/blog/" />
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
          {/* Category Filter */}
          <CategoryFilter
            categories={categories}
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
            totalCount={posts.length}
          />

          {/* Posts Grid */}
          {filteredPosts.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              No articles in this category yet. Check back soon.
            </div>
          ) : (
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
          )}
        </main>

        <Footer />
      </div>
    </>
  )
}
