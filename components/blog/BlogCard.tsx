import Link from 'next/link'
import { motion } from 'framer-motion'
import { BlogPostMeta } from '@/lib/blog'

const CATEGORY_COLORS: Record<string, string> = {
  'System Design': 'bg-blue-100 text-blue-700',
  'Java': 'bg-orange-100 text-orange-700',
  'Databases': 'bg-green-100 text-green-700',
  'AI/ML': 'bg-purple-100 text-purple-700',
  'AWS': 'bg-yellow-100 text-yellow-700',
  'Messaging': 'bg-red-100 text-red-700',
  'Data Engineering': 'bg-teal-100 text-teal-700',
}

interface BlogCardProps {
  post: BlogPostMeta
  variant?: 'default' | 'featured' | 'compact'
}

export const BlogCard: React.FC<BlogCardProps> = ({ post, variant = 'default' }) => {
  const badgeColor = CATEGORY_COLORS[post.category] ?? 'bg-gray-100 text-gray-700'
  const formattedDate = new Date(post.date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  if (variant === 'compact') {
    return (
      <Link href={`/blog/${post.slug}`}>
        <motion.div
          whileHover={{ x: 4 }}
          className="flex gap-3 py-3 border-b border-gray-100 last:border-0 cursor-pointer group"
        >
          <div className="flex-1 min-w-0">
            <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full mb-1 ${badgeColor}`}>
              {post.category}
            </span>
            <h4 className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors line-clamp-2">
              {post.title}
            </h4>
            <p className="text-xs text-gray-500 mt-1">{post.readingTime}</p>
          </div>
        </motion.div>
      </Link>
    )
  }

  if (variant === 'featured') {
    return (
      <Link href={`/blog/${post.slug}`}>
        <motion.article
          whileHover={{ y: -4 }}
          transition={{ duration: 0.2 }}
          className="group relative bg-gradient-to-br from-gray-900 to-blue-950 rounded-2xl p-8 h-full cursor-pointer overflow-hidden"
        >
          <div className="absolute inset-0 bg-blue-600 opacity-0 group-hover:opacity-5 transition-opacity" />
          <span className={`inline-block text-xs font-semibold px-3 py-1 rounded-full mb-4 ${badgeColor}`}>
            {post.category}
          </span>
          <h2 className="text-2xl font-bold text-white mb-3 group-hover:text-blue-300 transition-colors leading-tight">
            {post.title}
          </h2>
          <p className="text-gray-300 text-base mb-6 line-clamp-3">{post.excerpt}</p>
          <div className="flex items-center gap-4 text-gray-400 text-sm">
            <span>{formattedDate}</span>
            <span>·</span>
            <span>{post.readingTime}</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {post.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-xs text-gray-400 bg-gray-800 px-2 py-1 rounded">
                #{tag}
              </span>
            ))}
          </div>
          <div className="mt-6 flex items-center text-blue-400 text-sm font-medium group-hover:gap-2 transition-all">
            Read Article <span className="ml-1 group-hover:ml-2 transition-all">→</span>
          </div>
        </motion.article>
      </Link>
    )
  }

  // default variant
  return (
    <Link href={`/blog/${post.slug}`}>
      <motion.article
        whileHover={{ y: -5 }}
        transition={{ duration: 0.2 }}
        className="group bg-white rounded-xl border border-gray-200 p-6 h-full cursor-pointer hover:border-blue-300 hover:shadow-lg transition-all"
      >
        <span className={`inline-block text-xs font-semibold px-3 py-1 rounded-full mb-3 ${badgeColor}`}>
          {post.category}
        </span>
        <h3 className="text-lg font-bold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors leading-snug">
          {post.title}
        </h3>
        <p className="text-gray-600 text-sm mb-4 line-clamp-3">{post.excerpt}</p>
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>{formattedDate}</span>
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {post.readingTime}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {post.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="text-xs text-gray-500 bg-gray-50 px-2 py-0.5 rounded border border-gray-100">
              #{tag}
            </span>
          ))}
        </div>
      </motion.article>
    </Link>
  )
}

export default BlogCard
