import Image from 'next/image'
import { motion } from 'framer-motion'
import React from 'react'

interface SocialLink {
  name: string
  url: string
  icon: string
}

const socialLinks: SocialLink[] = [
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

export const Hero: React.FC = () => {
  return (
    <section className="relative min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-white py-20">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-12">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex-1 text-center md:text-left"
          >
            <h1 className="text-4xl md:text-6xl font-bold text-gray-900 mb-4">
              Hi, I'm Sachin Sarawgi
            </h1>
            <h2 className="text-xl md:text-2xl text-blue-600 mb-6">
              Engineering Manager | Java Expert | System Designer
            </h2>
            <p className="text-gray-600 text-lg mb-8 max-w-2xl">
              With over 10 years of experience in building scalable systems 
              and leading high-performance engineering teams. Specialized in 
              Java, MySQL, PostgreSQL, and System Architecture.
            </p>
            
            <div className="flex gap-6 justify-center md:justify-start mb-8">
              {socialLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-600 hover:text-blue-600 transition-colors"
                  aria-label={`Visit ${link.name} profile`}
                >
                  <i className={`fab fa-${link.icon} text-2xl`} />
                </a>
              ))}
            </div>

            <div className="flex gap-4 justify-center md:justify-start">
              <motion.a 
                href="#contact"
                className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 transition-colors"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                aria-label="Contact me"
              >
                Get in Touch
              </motion.a>
              <motion.a 
                href="#portfolio"
                className="border border-blue-600 text-blue-600 px-8 py-3 rounded-lg hover:bg-blue-50 transition-colors"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                aria-label="View my work"
              >
                View My Work
              </motion.a>
            </div>
          </motion.div>
          
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="flex-1 relative"
          >
            <div className="relative w-64 h-64 md:w-96 md:h-96 mx-auto">
              <Image
                src="/images/profile.jpg"
                alt="Sachin Sarawgi"
                fill
                className="rounded-full object-cover shadow-lg"
                priority
              />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
} 