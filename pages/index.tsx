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
import { getAllCategories, getAllPosts, BlogPostMeta, BlogCategory } from '@/lib/blog'
import { BLOG_CATEGORY_BY_NAME, getCategoryHref } from '@/lib/blogCategories'

interface HomeProps {
  latestPosts: BlogPostMeta[]
  categories: Array<{ name: BlogCategory; count: number }>
  totalArticles: number
}

const LEARNING_PATHS = [
  {
    title: 'Backend Systems',
    description: 'Architecture trade-offs, reliability, scale, and incident response for production services.',
    href: getCategoryHref('System Design'),
    links: [
      { label: 'System Design', href: getCategoryHref('System Design') },
      { label: 'Incident Playbooks', href: '/blog/production-incident-playbooks/' },
      { label: 'Idempotency Keys', href: '/blog/api-idempotency-keys/' },
    ],
  },
  {
    title: 'Java Production',
    description: 'Spring Boot readiness, JVM behavior, connection pools, and performance tuning.',
    href: getCategoryHref('Java'),
    links: [
      { label: 'Java Guides', href: getCategoryHref('Java') },
      { label: 'Spring Boot Checklist', href: '/blog/spring-boot-production-readiness-checklist/' },
      { label: 'Connection Pools', href: '/blog/database-connection-pool-tuning/' },
    ],
  },
  {
    title: 'Data & Caching',
    description: 'Database performance, cache invalidation, indexing, and production data access patterns.',
    href: getCategoryHref('Databases'),
    links: [
      { label: 'Database Guides', href: getCategoryHref('Databases') },
      { label: 'Cache Invalidation', href: '/blog/cache-invalidation-patterns/' },
      { label: 'PostgreSQL Tuning', href: '/blog/postgresql-performance-tuning/' },
    ],
  },
  {
    title: 'Kafka & Events',
    description: 'Consumer lag, reliable publishing, exactly-once trade-offs, and event-driven systems.',
    href: getCategoryHref('Messaging'),
    links: [
      { label: 'Messaging Guides', href: getCategoryHref('Messaging') },
      { label: 'Kafka Lag Playbook', href: '/blog/kafka-consumer-lag-playbook/' },
      { label: 'Transactional Outbox', href: '/blog/transactional-outbox-pattern/' },
    ],
  },
  {
    title: 'AI Engineering',
    description: 'RAG, embeddings, feature stores, agents, and production AI infrastructure.',
    href: getCategoryHref('AI/ML'),
    links: [
      { label: 'AI/ML Guides', href: getCategoryHref('AI/ML') },
      { label: 'Feature Store Design', href: '/blog/system-design-real-time-feature-store/' },
      { label: 'Production RAG', href: '/blog/building-rag-system-langchain/' },
    ],
  },
]

export const getStaticProps: GetStaticProps<HomeProps> = async () => {
  const allPosts = getAllPosts()
  const latestPosts = allPosts.slice(0, 5)
  const categories = getAllCategories()
  const totalArticles = allPosts.length
  return { props: { latestPosts, categories, totalArticles } }
}

export default function Home({ latestPosts, categories, totalArticles }: HomeProps) {
  const [mainLatestPost, ...restLatestPosts] = latestPosts

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
        <link
          rel="alternate"
          type="application/rss+xml"
          title="CodeSprintPro Tech Blog RSS Feed"
          href="https://codesprintpro.com/feed.xml"
        />

        {/* Favicon */}
        <link rel="apple-touch-icon" sizes="180x180" href="/favicon/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon/favicon-96x96.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon/favicon-96x96.png" />
        <link rel="manifest" href="/favicon/site.webmanifest" />
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
        <meta property="og:image" content="https://codesprintpro.com/images/profile.jpg" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:site_name" content="CodeSprintPro" />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="CodeSprintPro — Tech Blog Hub" />
        <meta
          name="twitter:description"
          content="Deep-dive articles on System Design, Java, Kafka, Redis, AI/ML and AWS by Sachin Sarawgi."
        />
        <meta name="twitter:image" content="https://codesprintpro.com/images/profile.jpg" />

        {/* Keywords */}
        <meta
          name="keywords"
          content="system design, java, kafka, redis, distributed systems, aws, backend engineering, engineering manager, microservices"
        />

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
          <Hero totalArticles={totalArticles} />

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
                    const cfg = BLOG_CATEGORY_BY_NAME[name]
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
                          href={getCategoryHref(name)}
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

          {/* 3. Learning Paths */}
          <section className="py-16 bg-gray-50">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
                className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10"
              >
                <div>
                  <h2 className="text-3xl font-bold text-gray-900 mb-3">Start Here</h2>
                  <p className="text-gray-500 max-w-2xl">
                    Follow a practical track and build momentum from fundamentals to production trade-offs.
                  </p>
                </div>
                <Link
                  href="/blog/"
                  className="text-blue-600 hover:text-blue-700 font-medium transition-colors text-sm"
                >
                  Browse everything →
                </Link>
              </motion.div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-5">
                {LEARNING_PATHS.map((path, index) => (
                  <motion.article
                    key={path.title}
                    initial={{ opacity: 0, y: 18 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.4, delay: index * 0.05 }}
                    className="bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 hover:shadow-lg transition-all"
                  >
                    <h3 className="text-lg font-bold text-gray-900 mb-2">
                      <Link href={path.href} className="hover:text-blue-600 transition-colors">
                        {path.title}
                      </Link>
                    </h3>
                    <p className="text-sm text-gray-600 leading-relaxed mb-5">{path.description}</p>
                    <div className="space-y-2">
                      {path.links.map((link) => (
                        <Link
                          key={link.href}
                          href={link.href}
                          className="block text-sm font-medium text-blue-600 hover:text-blue-700"
                        >
                          {link.label} →
                        </Link>
                      ))}
                    </div>
                  </motion.article>
                ))}
              </div>
            </div>
          </section>

          {/* 4. Latest Posts */}
          {latestPosts.length > 0 && (
            <section className="py-16 bg-white">
              <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5 }}
                  className="flex items-center justify-between mb-10"
                >
                  <div>
                    <h2 className="text-3xl font-bold text-gray-900 mb-1">Latest Articles</h2>
                    <p className="text-gray-500">Fresh practical guides and deep dives worth your time</p>
                  </div>
                  <Link
                    href="/blog/"
                    className="hidden md:flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium transition-colors text-sm"
                  >
                    All Articles →
                  </Link>
                </motion.div>

                {/* Latest layout: 1 large + 2 standard, then remaining standard */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                  {mainLatestPost && (
                    <div className="lg:col-span-2">
                      <BlogCard post={mainLatestPost} variant="featured" />
                    </div>
                  )}
                  {restLatestPosts.slice(0, 2).map((post) => (
                    <BlogCard key={post.slug} post={post} variant="default" />
                  ))}
                </div>

                {restLatestPosts.length > 2 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {restLatestPosts.slice(2).map((post) => (
                      <BlogCard key={post.slug} post={post} variant="default" />
                    ))}
                  </div>
                )}

                <div className="text-center mt-10">
                  <Link
                    href="/blog/"
                    className="inline-flex items-center gap-2 bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  >
                    Explore All Articles →
                  </Link>
                </div>
              </div>
            </section>
          )}

          {/* 5. About */}
          <About totalArticles={totalArticles} />

          {/* 6. Portfolio */}
          <Portfolio totalArticles={totalArticles} />

          {/* 7. Contact */}
          <Contact />
        </main>

        <Footer />
      </div>
    </>
  )
}
