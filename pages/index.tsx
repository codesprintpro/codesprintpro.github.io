import Head from 'next/head'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { GetStaticProps } from 'next'
import { Hero } from '@/components/sections/Hero'
import { About } from '@/components/sections/About'
import { Portfolio } from '@/components/sections/Portfolio'
import { Contact } from '@/components/sections/Contact'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { BlogCard } from '@/components/blog/BlogCard'
import { getFeaturedPosts, getAllCategories, BlogPostMeta, BlogCategory } from '@/lib/blog'

interface HomeProps {
  featuredPosts: BlogPostMeta[]
  categories: Array<{ name: BlogCategory; count: number }>
}

export const getStaticProps: GetStaticProps<HomeProps> = async () => {
  const featuredPosts = getFeaturedPosts(5)
  const categories = getAllCategories()
  return { props: { featuredPosts, categories } }
}

const CATEGORY_CONFIG: Record<string, { icon: string; color: string; border: string }> = {
  'System Design':    { icon: '🏗', color: 'bg-blue-50',   border: 'border-blue-200' },
  'Java':             { icon: '☕', color: 'bg-orange-50', border: 'border-orange-200' },
  'Databases':        { icon: '🗄️', color: 'bg-green-50',  border: 'border-green-200' },
  'AI/ML':            { icon: '🤖', color: 'bg-purple-50', border: 'border-purple-200' },
  'AWS':              { icon: '☁️', color: 'bg-yellow-50', border: 'border-yellow-200' },
  'Messaging':        { icon: '📨', color: 'bg-red-50',    border: 'border-red-200' },
  'Data Engineering': { icon: '⚡', color: 'bg-teal-50',   border: 'border-teal-200' },
}

export default function Home({ featuredPosts, categories }: HomeProps) {
  const [mainFeatured, ...restFeatured] = featuredPosts

  return (
    <>
      <Head>
        <title>CodeSprintPro — Tech Blog Hub | System Design, Java, Distributed Systems</title>
        <meta
          name="description"
          content="Deep-dive technical articles on Kafka, Redis, System Design, Java 21, AI/ML, and AWS architecture by Sachin Sarawgi — Engineering Manager with 10+ years at scale."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="canonical" href="https://codesprintpro.com/" />

        {/* Favicon */}
        <link rel="apple-touch-icon" sizes="180x180" href="/favicon/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon/favicon-96x96.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon/favicon-96x96.png" />
        <link rel="manifest" href="/favicon/site.webmanifest" />
        <link rel="mask-icon" href="/favicon/safari-pinned-tab.svg" color="#5bbad5" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="CodeSprintPro" />
        <link rel="icon" sizes="192x192" href="/favicon/android-chrome-192x192.png" />
        <link rel="icon" sizes="512x512" href="/favicon/android-chrome-512x512.png" />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content="CodeSprintPro — Tech Blog Hub" />
        <meta
          property="og:description"
          content="Deep-dive articles on System Design, Java, Kafka, Redis, AI/ML and AWS by Sachin Sarawgi."
        />
        <meta property="og:url" content="https://codesprintpro.com/" />
        <meta property="og:site_name" content="CodeSprintPro" />

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebSite',
              name: 'CodeSprintPro',
              url: 'https://codesprintpro.com',
              author: {
                '@type': 'Person',
                name: 'Sachin Sarawgi',
                jobTitle: 'Engineering Manager',
              },
            }),
          }}
        />
      </Head>

      <div className="min-h-screen bg-gray-50">
        <Navbar />

        <main>
          {/* 1. Hero */}
          <Hero />

          {/* 2. Category Grid */}
          {categories.length > 0 && (
            <section className="py-16 bg-white">
              <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5 }}
                  className="text-center mb-10"
                >
                  <h2 className="text-3xl font-bold text-gray-900 mb-3">Browse by Topic</h2>
                  <p className="text-gray-500">Pick a category to find articles matching your interests</p>
                </motion.div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {categories.map(({ name, count }, i) => {
                    const cfg = CATEGORY_CONFIG[name] ?? { icon: '📄', color: 'bg-gray-50', border: 'border-gray-200' }
                    return (
                      <motion.div
                        key={name}
                        initial={{ opacity: 0, y: 16 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.4, delay: i * 0.06 }}
                        whileHover={{ y: -4 }}
                      >
                        <Link
                          href="/blog"
                          className={`flex flex-col items-center p-5 rounded-xl border ${cfg.color} ${cfg.border} hover:shadow-md transition-all text-center`}
                        >
                          <span className="text-3xl mb-2">{cfg.icon}</span>
                          <span className="font-semibold text-gray-800 text-sm">{name}</span>
                          <span className="text-xs text-gray-400 mt-1">{count} article{count !== 1 ? 's' : ''}</span>
                        </Link>
                      </motion.div>
                    )
                  })}
                </div>
              </div>
            </section>
          )}

          {/* 3. Featured Posts */}
          {featuredPosts.length > 0 && (
            <section className="py-16 bg-gray-50">
              <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5 }}
                  className="flex items-center justify-between mb-10"
                >
                  <div>
                    <h2 className="text-3xl font-bold text-gray-900 mb-1">Featured Articles</h2>
                    <p className="text-gray-500">In-depth guides and deep dives worth your time</p>
                  </div>
                  <Link
                    href="/blog"
                    className="hidden md:flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium transition-colors text-sm"
                  >
                    All Articles →
                  </Link>
                </motion.div>

                {/* Featured layout: 1 large + 2 standard, then remaining standard */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                  {mainFeatured && (
                    <div className="lg:col-span-2">
                      <BlogCard post={mainFeatured} variant="featured" />
                    </div>
                  )}
                  {restFeatured.slice(0, 2).map((post) => (
                    <BlogCard key={post.slug} post={post} variant="default" />
                  ))}
                </div>

                {restFeatured.length > 2 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {restFeatured.slice(2).map((post) => (
                      <BlogCard key={post.slug} post={post} variant="default" />
                    ))}
                  </div>
                )}

                <div className="text-center mt-10">
                  <Link
                    href="/blog"
                    className="inline-flex items-center gap-2 bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  >
                    Explore All Articles →
                  </Link>
                </div>
              </div>
            </section>
          )}

          {/* 4. About */}
          <About />

          {/* 5. Portfolio */}
          <Portfolio />

          {/* 6. Contact */}
          <Contact />
        </main>

        <Footer />
      </div>
    </>
  )
}
