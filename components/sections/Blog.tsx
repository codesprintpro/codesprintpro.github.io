import { motion } from 'framer-motion'
import React from 'react'

interface BlogPost {
  title: string
  description: string
  link: string
  date: string
  readTime: string
}

const blogPosts: BlogPost[] = [
  {
    title: "Java 17: What's New and How It Will Change Your Coding",
    description: "Overview of new features in Java 17 and how they enhance development workflows.",
    link: "https://medium.com/codesprintpro/java-17-whats-new-and-how-it-will-change-your-coding-fad53c06a555",
    date: "2023",
    readTime: "8 min read"
  },
  {
    title: "Spring Boot with Jasypt 1:1",
    description: "Guide to securing sensitive data in Spring Boot using Jasypt.",
    link: "https://medium.com/javarevisited/spring-boot-with-jasypt-1-1-f8b943d57cb",
    date: "2023",
    readTime: "6 min read"
  },
  {
    title: "Database Isolation Level with PostgreSQL and Spring Boot",
    description: "Explains database isolation levels and their implementation in Spring Boot.",
    link: "https://medium.com/javarevisited/database-isolation-level-with-postgresql-and-spring-boot-c6c2f8fe3b46",
    date: "2023",
    readTime: "7 min read"
  },
  {
    title: "Getting Started with Cassandra and Spring Boot",
    description: "Beginner's guide to integrating Cassandra with Spring Boot.",
    link: "https://medium.com/@codesprintpro/getting-started-with-cassandra-and-spring-boot-fcb67485c1aa",
    date: "2023",
    readTime: "10 min read"
  }
]

const BlogCard: React.FC<BlogPost> = ({ title, description, link, date, readTime }) => (
  <motion.a
    href={link}
    target="_blank"
    rel="noopener noreferrer"
    className="block bg-white rounded-lg shadow-lg overflow-hidden hover:shadow-xl transition-shadow"
    whileHover={{ y: -5 }}
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true }}
  >
    <div className="p-6">
      <div className="flex items-center justify-between text-sm text-gray-600 mb-3">
        <span>{date}</span>
        <span>{readTime}</span>
      </div>
      <h3 className="text-xl font-bold text-gray-900 mb-2">
        {title}
      </h3>
      <p className="text-gray-600 mb-4">
        {description}
      </p>
      <div className="flex items-center text-blue-600 font-medium">
        Read Article
        <svg 
          className="w-4 h-4 ml-2" 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M14 5l7 7m0 0l-7 7m7-7H3" 
          />
        </svg>
      </div>
    </div>
  </motion.a>
)

export const Blog: React.FC = () => {
  return (
    <section id="blog" className="py-20 bg-white">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Latest Blog Posts
          </h2>
          <div className="w-20 h-1 bg-blue-600 mx-auto mb-8" />
          <p className="text-gray-600 max-w-2xl mx-auto">
            I regularly write about Java, System Design, and Software Architecture. 
            Check out my latest articles on Medium.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {blogPosts.map((post) => (
            <BlogCard key={post.title} {...post} />
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          viewport={{ once: true }}
          className="text-center mt-12"
        >
          <a
            href="https://medium.com/@codesprintpro"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-blue-600 hover:text-blue-700 font-medium"
            aria-label="View all blog posts on Medium"
          >
            View All Posts on Medium
            <svg 
              className="w-4 h-4 ml-2" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M14 5l7 7m0 0l-7 7m7-7H3" 
              />
            </svg>
          </a>
        </motion.div>
      </div>
    </section>
  )
} 