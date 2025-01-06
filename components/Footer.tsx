import React from 'react'
import { motion } from 'framer-motion'

interface FooterLink {
  name: string
  href: string
}

const links: FooterLink[] = [
  { name: 'About', href: '#about' },
  { name: 'Portfolio', href: '#portfolio' },
  { name: 'Blog', href: '#blog' },
  { name: 'Contact', href: '#contact' }
]

const socialLinks = [
  {
    name: 'GitHub',
    url: 'https://github.com/codesprintpro',
    icon: 'github'
  },
  {
    name: 'LinkedIn',
    url: 'https://www.linkedin.com/in/sachin-sarawgi/',
    icon: 'linkedin'
  },
  {
    name: 'Medium',
    url: 'https://medium.com/@codesprintpro',
    icon: 'medium'
  }
]

export const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="bg-gray-900 text-white py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Brand Section */}
          <div className="col-span-1 md:col-span-2">
            <motion.a 
              href="#"
              className="text-2xl font-bold mb-4 block"
              whileHover={{ scale: 1.05 }}
            >
              Sachin Sarawgi
            </motion.a>
            <p className="text-gray-400 mb-4 max-w-md">
              Engineering Manager and Java Expert with a passion for building scalable systems 
              and sharing knowledge with the developer community.
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
            <h3 className="text-lg font-semibold mb-4">Quick Links</h3>
            <ul className="space-y-2">
              {links.map((link) => (
                <li key={link.name}>
                  <motion.a
                    href={link.href}
                    className="text-gray-400 hover:text-white transition-colors"
                    whileHover={{ x: 5 }}
                  >
                    {link.name}
                  </motion.a>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact Info */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Contact</h3>
            <ul className="space-y-2 text-gray-400">
              <li>
                <a 
                  href="mailto:sachinsarawgi201143@gmail.com"
                  className="hover:text-white transition-colors"
                >
                  <i className="fas fa-envelope mr-2" />
                  Email
                </a>
              </li>
              <li>
                <a 
                  href="https://www.linkedin.com/in/sachin-sarawgi/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  <i className="fab fa-linkedin mr-2" />
                  LinkedIn
                </a>
              </li>
              <li>
                <a 
                  href="https://github.com/codesprintpro"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  <i className="fab fa-github mr-2" />
                  GitHub
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Copyright */}
        <div className="border-t border-gray-800 pt-8">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <p className="text-gray-400 text-sm">
              © {currentYear} Sachin Sarawgi. All rights reserved.
            </p>
            <p className="text-gray-400 text-sm mt-2 md:mt-0">
              Built with Next.js and TailwindCSS
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
} 