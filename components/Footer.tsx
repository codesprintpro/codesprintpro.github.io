import React from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'

const quickLinks = [
  { name: 'Blog', href: '/blog' },
  { name: 'About', href: '/#about' },
  { name: 'Portfolio', href: '/#portfolio' },
  { name: 'Contact', href: '/#contact' },
]

const categoryLinks = [
  { name: 'System Design', href: '/blog' },
  { name: 'Java', href: '/blog' },
  { name: 'Databases', href: '/blog' },
  { name: 'AI/ML', href: '/blog' },
  { name: 'AWS', href: '/blog' },
  { name: 'Messaging', href: '/blog' },
]

const socialLinks = [
  { name: 'GitHub',   url: 'https://github.com/codesprintpro',          icon: 'github' },
  { name: 'LinkedIn', url: 'https://www.linkedin.com/in/sachin-sarawgi/', icon: 'linkedin' },
  { name: 'Medium',   url: 'https://medium.com/@codesprintpro',           icon: 'medium' },
]

export const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="bg-gray-900 text-white py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Brand */}
          <div className="col-span-1 md:col-span-1">
            <motion.div whileHover={{ scale: 1.02 }}>
              <Link href="/" className="text-xl font-bold block mb-3 text-white hover:text-blue-400 transition-colors">
                CodeSprintPro
              </Link>
            </motion.div>
            <p className="text-gray-400 text-sm mb-4 leading-relaxed">
              Deep-dive technical content on System Design, Java, Databases, AI/ML, and AWS — by Sachin Sarawgi.
            </p>
            <div className="flex space-x-4">
              {socialLinks.map((link) => (
                <motion.a
                  key={link.name}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors"
                  whileHover={{ scale: 1.2 }}
                  aria-label={`Visit ${link.name} profile`}
                >
                  <i className={`fab fa-${link.icon} text-xl`} />
                </motion.a>
              ))}
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-400 mb-4">Quick Links</h3>
            <ul className="space-y-2">
              {quickLinks.map((link) => (
                <li key={link.name}>
                  <motion.div whileHover={{ x: 4 }}>
                    <Link href={link.href} className="text-gray-400 hover:text-white transition-colors text-sm">
                      {link.name}
                    </Link>
                  </motion.div>
                </li>
              ))}
            </ul>
          </div>

          {/* Categories */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-400 mb-4">Categories</h3>
            <ul className="space-y-2">
              {categoryLinks.map((link) => (
                <li key={link.name}>
                  <motion.div whileHover={{ x: 4 }}>
                    <Link href={link.href} className="text-gray-400 hover:text-white transition-colors text-sm">
                      {link.name}
                    </Link>
                  </motion.div>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact Info */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-400 mb-4">Contact</h3>
            <ul className="space-y-2 text-gray-400 text-sm">
              <li>
                <a href="mailto:sachinsarawgi201143@gmail.com" className="hover:text-white transition-colors flex items-center gap-2">
                  <i className="fas fa-envelope" /> Email
                </a>
              </li>
              <li>
                <a href="https://www.linkedin.com/in/sachin-sarawgi/" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors flex items-center gap-2">
                  <i className="fab fa-linkedin" /> LinkedIn
                </a>
              </li>
              <li>
                <a href="https://github.com/codesprintpro" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors flex items-center gap-2">
                  <i className="fab fa-github" /> GitHub
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-800 pt-6 flex flex-col md:flex-row justify-between items-center gap-2">
          <p className="text-gray-500 text-sm">
            © {currentYear} CodeSprintPro · Sachin Sarawgi. All rights reserved.
          </p>
          <p className="text-gray-600 text-xs">
            Built with Next.js · TailwindCSS · Deployed on GitHub Pages
          </p>
        </div>
      </div>
    </footer>
  )
}
