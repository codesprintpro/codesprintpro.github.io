import Image from 'next/image'
import Link from 'next/link'
import { motion } from 'framer-motion'
import React from 'react'

const socialLinks = [
  { name: 'GitHub', url: 'https://github.com/codesprintpro', icon: 'github' },
  { name: 'LinkedIn', url: 'https://www.linkedin.com/in/sachin-sarawgi/', icon: 'linkedin' },
  { name: 'Medium', url: 'https://medium.com/@codesprintpro', icon: 'medium' },
]

const stats = [
  { value: '10+', label: 'Articles' },
  { value: '10+', label: 'Yrs Exp' },
  { value: '7', label: 'Topics' },
]

export const Hero: React.FC = () => {
  return (
    <section className="relative min-h-[85vh] flex items-center bg-gradient-to-br from-gray-900 via-blue-950 to-gray-900 py-24 overflow-hidden">
      {/* Background grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-12">
          {/* Left: Text */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="flex-1 text-center lg:text-left"
          >
            <span className="text-blue-400 text-sm font-mono uppercase tracking-widest block mb-3">
              // codesprintpro
            </span>
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-white mb-4 leading-tight">
              Tech Blog{' '}
              <span className="text-gradient bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-300">
                Hub
              </span>
            </h1>
            <p className="text-gray-300 text-lg md:text-xl mb-8 max-w-2xl mx-auto lg:mx-0 leading-relaxed">
              Deep-dive articles on System Design, Java, Kafka, Redis, AI/ML, and AWS —
              from an Engineering Manager with 10+ years building distributed systems at scale.
            </p>

            <div className="flex gap-4 justify-center lg:justify-start mb-10">
              <Link
                href="/blog"
                className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-500 transition-colors font-medium text-base"
              >
                Browse Articles
              </Link>
              <Link
                href="#about"
                className="border border-gray-600 text-gray-300 px-8 py-3 rounded-lg hover:border-gray-400 hover:text-white transition-colors font-medium text-base"
              >
                About the Author
              </Link>
            </div>

            {/* Stats */}
            <div className="flex gap-8 justify-center lg:justify-start">
              {stats.map((stat) => (
                <div key={stat.label} className="text-center lg:text-left">
                  <div className="text-3xl font-bold text-white">{stat.value}</div>
                  <div className="text-gray-400 text-sm mt-0.5">{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Social Links */}
            <div className="flex gap-5 justify-center lg:justify-start mt-8">
              {socialLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors"
                  aria-label={`Visit ${link.name} profile`}
                >
                  <i className={`fab fa-${link.icon} text-xl`} />
                </a>
              ))}
            </div>
          </motion.div>

          {/* Right: Profile image */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="flex-shrink-0"
          >
            <div className="relative w-48 h-48 md:w-56 md:h-56">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 blur-2xl opacity-30" />
              <Image
                src="/images/profile.jpg"
                alt="Sachin Sarawgi"
                fill
                className="rounded-full object-cover ring-4 ring-blue-800 relative z-10"
                priority
              />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
