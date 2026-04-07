import Head from 'next/head'
import Link from 'next/link'
import { GetStaticPaths, GetStaticProps } from 'next'
import { motion } from 'framer-motion'
import { BlogCard } from '@/components/blog/BlogCard'
import { Footer } from '@/components/Footer'
import { Navbar } from '@/components/Navbar'
import { getAllCategories, getPostsByCategory } from '@/lib/blog'
import type { BlogCategory, BlogPostMeta } from '@/lib/blog'
import {
  BLOG_CATEGORIES,
  getCategoryHref,
  getCategoryMetaBySlug,
} from '@/lib/blogCategories'
import type { BlogCategoryMeta } from '@/lib/blogCategories'

interface BlogCategoryPageProps {
  category: BlogCategoryMeta
  posts: BlogPostMeta[]
  otherCategories: Array<{ meta: BlogCategoryMeta; count: number }>
}

export const getStaticPaths: GetStaticPaths = async () => {
  return {
    paths: BLOG_CATEGORIES.map((category) => ({ params: { slug: category.slug } })),
    fallback: false,
  }
}

export const getStaticProps: GetStaticProps<BlogCategoryPageProps> = async ({ params }) => {
  const slug = String(params?.slug ?? '')
  const category = getCategoryMetaBySlug(slug)

  if (!category) {
    return { notFound: true }
  }

  const posts = getPostsByCategory(category.name)
  const counts = new Map<BlogCategory, number>(
    getAllCategories().map(({ name, count }) => [name, count])
  )
  const otherCategories = BLOG_CATEGORIES
    .filter((item) => item.name !== category.name)
    .map((meta) => ({ meta, count: counts.get(meta.name) ?? 0 }))

  return { props: { category, posts, otherCategories } }
}

export default function BlogCategoryPage({
  category,
  posts,
  otherCategories,
}: BlogCategoryPageProps) {
  const canonicalUrl = `https://codesprintpro.com${getCategoryHref(category.name)}`
  const [featuredPost, ...restPosts] = posts

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: 'https://codesprintpro.com/',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Blog',
        item: 'https://codesprintpro.com/blog/',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: category.name,
        item: canonicalUrl,
      },
    ],
  }

  return (
    <>
      <Head>
        <title>{category.seoTitle}</title>
        <meta name="description" content={category.seoDescription} />
        <link rel="canonical" href={canonicalUrl} />

        <meta property="og:type" content="website" />
        <meta property="og:title" content={category.seoTitle} />
        <meta property="og:description" content={category.seoDescription} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content="https://codesprintpro.com/images/profile.jpg" />
        <meta property="og:site_name" content="CodeSprintPro" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={category.seoTitle} />
        <meta name="twitter:description" content={category.seoDescription} />
        <meta name="twitter:image" content="https://codesprintpro.com/images/profile.jpg" />

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
        />
      </Head>

      <div className="min-h-screen bg-gray-50">
        <Navbar />

        <section className="bg-gradient-to-br from-gray-900 to-blue-950 pt-32 pb-16">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <motion.nav
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="flex items-center gap-2 text-sm text-gray-400 mb-6"
            >
              <Link href="/" className="hover:text-white transition-colors">
                Home
              </Link>
              <span>/</span>
              <Link href="/blog/" className="hover:text-white transition-colors">
                Blog
              </Link>
              <span>/</span>
              <span className="text-gray-300">{category.name}</span>
            </motion.nav>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="max-w-3xl"
            >
              <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-semibold ${category.color} ${category.accent}`}>
                <span>{category.icon}</span>
                {category.name}
              </span>
              <h1 className="text-4xl md:text-5xl font-bold text-white mt-5 mb-4">
                {category.name} Articles
              </h1>
              <p className="text-gray-300 text-lg leading-relaxed">
                {category.description}
              </p>
              <div className="flex flex-wrap items-center gap-4 mt-6 text-gray-400 text-sm">
                <span>{posts.length} article{posts.length !== 1 ? 's' : ''}</span>
                <span>·</span>
                <Link href="/blog/" className="text-blue-300 hover:text-blue-200 transition-colors">
                  Browse all topics
                </Link>
              </div>
            </motion.div>
          </div>
        </section>

        <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {featuredPost && (
            <section className="mb-12">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Start Here</h2>
                  <p className="text-gray-500 text-sm mt-1">
                    The newest guide in this topic.
                  </p>
                </div>
              </div>
              <BlogCard post={featuredPost} variant="featured" />
            </section>
          )}

          {restPosts.length > 0 && (
            <section className="mb-16">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">
                More {category.name} Guides
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {restPosts.map((post, index) => (
                  <motion.div
                    key={post.slug}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.4, delay: index * 0.04 }}
                  >
                    <BlogCard post={post} variant="default" />
                  </motion.div>
                ))}
              </div>
            </section>
          )}

          {otherCategories.length > 0 && (
            <section className="bg-white rounded-xl border border-gray-200 p-6 md:p-8">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Explore More Topics</h2>
                  <p className="text-gray-500 text-sm mt-1">
                    Jump into another practical engineering track.
                  </p>
                </div>
                <Link href="/blog/" className="text-blue-600 hover:text-blue-700 font-medium text-sm">
                  All articles →
                </Link>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {otherCategories.map(({ meta, count }) => (
                  <Link
                    key={meta.name}
                    href={getCategoryHref(meta.name)}
                    className={`rounded-lg border ${meta.border} ${meta.color} p-4 hover:shadow-md transition-all`}
                  >
                    <div className="flex items-center gap-2 font-semibold text-gray-900">
                      <span>{meta.icon}</span>
                      {meta.name}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {count} article{count !== 1 ? 's' : ''}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </main>

        <Footer />
      </div>
    </>
  )
}
