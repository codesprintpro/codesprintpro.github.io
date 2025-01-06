import { NextPage } from 'next'
import { motion } from 'framer-motion'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import Head from 'next/head'

interface BlogPost {
  title: string
  description: string
  url: string
  category: string
}

interface StackOverflowAnswer {
  title: string
  description: string
  url: string
  votes?: number
}

const blogPosts: BlogPost[] = [
  {
    title: "Java 17: What's New and How It Will Change Your Coding",
    description: "Overview of new features in Java 17 and how they enhance development workflows.",
    url: "https://medium.com/codesprintpro/java-17-whats-new-and-how-it-will-change-your-coding-fad53c06a555",
    category: "Java"
  },
  {
    title: "Spring Boot with Jasypt 1:1",
    description: "Guide to securing sensitive data in Spring Boot using Jasypt.",
    url: "https://medium.com/javarevisited/spring-boot-with-jasypt-1-1-f8b943d57cb",
    category: "Spring Boot"
  },
  {
    title: "Database Isolation Level with PostgreSQL and Spring Boot",
    description: "Explains database isolation levels and their implementation in Spring Boot.",
    url: "https://medium.com/javarevisited/database-isolation-level-with-postgresql-and-spring-boot-c6c2f8fe3b46",
    category: "Database"
  },
  {
    title: "Getting Started with Cassandra and Spring Boot",
    description: "Beginner's guide to integrating Cassandra with Spring Boot.",
    url: "https://medium.com/@codesprintpro/getting-started-with-cassandra-and-spring-boot-fcb67485c1aa",
    category: "Database"
  },
  {
    title: "Getting Started with Spring Boot and Elasticsearch",
    description: "Step-by-step tutorial on using Elasticsearch with Spring Boot.",
    url: "https://medium.com/@codesprintpro/getting-started-with-spring-boot-and-elasticsearch-74981fd635be",
    category: "Spring Boot"
  },
  {
    title: "Learn SOLID Principles Solid Way",
    description: "In-depth exploration of SOLID principles using Java.",
    url: "https://medium.com/@codesprintpro/learn-solid-principles-solid-way-22ddd2e2c909",
    category: "Design Principles"
  },
  {
    title: "Getting Started with Spring Boot and Liquibase",
    description: "Guide to database versioning with Spring Boot and Liquibase.",
    url: "https://medium.com/javarevisited/getting-started-with-spring-boot-and-liquibase-f559d4e38498",
    category: "Spring Boot"
  },
  {
    title: "Must-Know Shortcuts for IntelliJ IDEA",
    description: "A collection of essential IntelliJ IDEA shortcuts for developers.",
    url: "https://medium.com/@codesprintpro/must-known-shortcuts-intellij-idea-71a84aadfd30",
    category: "Tools"
  },
  {
    title: "URL Shortener with Limit on Click Count",
    description: "How to build a URL shortener with usage restrictions.",
    url: "https://medium.com/javascript-in-plain-english/url-shortner-with-limit-onclick-count-256ff46bf9fa",
    category: "JavaScript"
  },
  {
    title: "REST API using SQLite3, Node.js, and Express.js",
    description: "Step-by-step creation of a REST API with SQLite and Node.js.",
    url: "https://medium.com/@codesprintpro/rest-api-using-sqlite3-nodejs-and-expressjs-f8c0c0847fe5",
    category: "Node.js"
  },
  {
    title: "Twitter Bot using Node.js",
    description: "Guide to creating a simple Twitter bot using Node.js.",
    url: "https://medium.com/@codesprintpro/twitter-bot-using-nodejs-c72a2a50628d",
    category: "Node.js"
  },
  {
    title: "Getting Started with SQLite3 in Node.js",
    description: "Introduction to SQLite3 database with Node.js.",
    url: "https://medium.com/@codesprintpro/getting-started-sqlite3-with-nodejs-8ef387ad31c4",
    category: "Database"
  }
]

const stackOverflowAnswers: StackOverflowAnswer[] = [
  {
    title: "Android: Calculate days between two dates",
    description: "Explanation of how to calculate the number of days between two dates in Android.",
    url: "https://stackoverflow.com/questions/42553017/android-calculate-days-between-two-dates/42553096#42553096"
  },
  {
    title: "How to send date in REST API POST method",
    description: "Guidelines on sending date formats correctly in REST API POST requests.",
    url: "https://stackoverflow.com/questions/45668936/how-to-send-date-in-rest-api-in-post-method/45669214#45669214"
  },
  {
    title: "Configuring Hibernate for uppercase and lowercase column names",
    description: "Solution to configuring Hibernate for handling column name cases.",
    url: "https://stackoverflow.com/questions/46052297/how-to-configure-hibernate-to-make-table-column-name-with-uppercase-and-lowercas/46052672#46052672"
  },
  {
    title: "MySQL Error 1064",
    description: "Troubleshooting steps for resolving MySQL error 1064.",
    url: "https://stackoverflow.com/questions/40938386/mysql-error-1064/40938387#40938387"
  },
  {
    title: "Finding the index of the first and last character in a string",
    description: "Explanation of how to retrieve the index of characters in a string in Java.",
    url: "https://stackoverflow.com/questions/41121218/how-can-i-get-the-index-of-the-first-and-last-char-in-string/41121314#41121314"
  },
  {
    title: "Difficulty splitting a string at a delimiter while keeping it",
    description: "Solution for splitting strings at a delimiter while preserving the delimiter.",
    url: "https://stackoverflow.com/questions/41129181/difficulty-splitting-string-at-delimiter-and-keeping-it/41129324#41129324"
  },
  {
    title: "Spring DriverManagerDataSource stack overflow during driver loading",
    description: "Fix for resolving stack overflow errors when using DriverManagerDataSource in Spring.",
    url: "https://stackoverflow.com/questions/41022092/spring-drivermanagerdatasource-stack-overflow-during-driver-loading/41022181#41022181"
  }
]

const ContributionsPage: NextPage = () => {
  return (
    <>
      <Head>
        <title>Blog & Contributions - Sachin Sarawgi</title>
        <meta 
          name="description" 
          content="Technical blogs and StackOverflow contributions by Sachin Sarawgi" 
        />
      </Head>

      <Navbar />
      
      <main className="pt-16 min-h-screen bg-gray-50">
        {/* Hero Section */}
        <section className="py-20 bg-white">
          <div className="container mx-auto px-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="text-center"
            >
              <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
                Blog & Contributions
              </h1>
              <p className="text-xl text-gray-600 max-w-2xl mx-auto">
                Sharing knowledge through technical writing and helping developers on StackOverflow
              </p>
            </motion.div>
          </div>
        </section>

        {/* Blog Posts Section */}
        <section className="py-20">
          <div className="container mx-auto px-4">
            <h2 className="text-3xl font-bold text-gray-900 mb-12">Technical Blog Posts</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {blogPosts.map((post, index) => (
                <motion.a
                  key={post.title}
                  href={post.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                >
                  <div className="p-6">
                    <span className="text-sm text-blue-600 font-medium">
                      {post.category}
                    </span>
                    <h3 className="text-xl font-bold text-gray-900 mt-2 mb-3">
                      {post.title}
                    </h3>
                    <p className="text-gray-600 mb-4">
                      {post.description}
                    </p>
                    <div className="flex items-center text-blue-600">
                      Read Article
                      <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                    </div>
                  </div>
                </motion.a>
              ))}
            </div>
          </div>
        </section>

        {/* StackOverflow Section */}
        <section className="py-20 bg-white">
          <div className="container mx-auto px-4">
            <h2 className="text-3xl font-bold text-gray-900 mb-12">StackOverflow Contributions</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {stackOverflowAnswers.map((answer, index) => (
                <motion.a
                  key={answer.title}
                  href={answer.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-gray-50 rounded-lg p-6 hover:bg-gray-100 transition-colors"
                  initial={{ opacity: 0, x: index % 2 === 0 ? -20 : 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                >
                  <h3 className="text-xl font-bold text-gray-900 mb-3">
                    {answer.title}
                  </h3>
                  <p className="text-gray-600 mb-4">
                    {answer.description}
                  </p>
                  <div className="flex items-center text-blue-600">
                    View Answer
                    <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </div>
                </motion.a>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  )
}

export default ContributionsPage 