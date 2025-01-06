import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'

interface NavLinkProps {
  href: string
  children: React.ReactNode
  onClick?: () => void
}

const NavLink: React.FC<NavLinkProps> = ({ href, children, onClick }) => {
  const router = useRouter()
  const isContributionsPage = router.pathname === '/contributions'
  
  const handleClick = (e: React.MouseEvent) => {
    if (isContributionsPage && href.startsWith('#')) {
      e.preventDefault()
      router.push(`/${href}`)
    }
    onClick?.()
  }

  return (
    <Link 
      href={href}
      className="text-gray-600 hover:text-blue-600 transition-colors"
      onClick={handleClick}
    >
      {children}
    </Link>
  )
}

export const Navbar: React.FC = () => {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 0)
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false)
  }

  return (
    <motion.nav 
      className={`fixed w-full z-50 transition-colors duration-300 ${
        isScrolled ? 'bg-white shadow-md' : 'bg-transparent'
      }`}
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link 
            href="/" 
            className="text-2xl font-bold text-blue-600"
          >
            SS
          </Link>
          
          {/* Desktop Navigation */}
          <div className="hidden md:flex space-x-8">
            {router.pathname === '/contributions' ? (
              <>
                <Link href="/#about">About</Link>
                <Link href="/#portfolio">Portfolio</Link>
                <Link href="/contributions">Blog & Contributions</Link>
                <Link href="/#contact">Contact</Link>
              </>
            ) : (
              <>
                <NavLink href="#about">About</NavLink>
                <NavLink href="#portfolio">Portfolio</NavLink>
                <NavLink href="/contributions">Blog & Contributions</NavLink>
                <NavLink href="#contact">Contact</NavLink>
              </>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle mobile menu"
          >
            <svg
              className="w-6 h-6 text-gray-600"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              {isMobileMenuOpen ? (
                <path d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-white shadow-lg"
          >
            <div className="flex flex-col py-2">
              {router.pathname === '/contributions' ? (
                <>
                  <Link 
                    href="/#about" 
                    className="px-4 py-3 text-base font-medium text-gray-600 hover:text-blue-600 hover:bg-gray-50 transition-colors"
                    onClick={closeMobileMenu}
                  >
                    About
                  </Link>
                  <Link 
                    href="/#portfolio"
                    className="px-4 py-3 text-base font-medium text-gray-600 hover:text-blue-600 hover:bg-gray-50 transition-colors"
                    onClick={closeMobileMenu}
                  >
                    Portfolio
                  </Link>
                  <Link 
                    href="/contributions"
                    className="px-4 py-3 text-base font-medium text-gray-600 hover:text-blue-600 hover:bg-gray-50 transition-colors"
                    onClick={closeMobileMenu}
                  >
                    Blog & Contributions
                  </Link>
                  <Link 
                    href="/#contact"
                    className="px-4 py-3 text-base font-medium text-gray-600 hover:text-blue-600 hover:bg-gray-50 transition-colors"
                    onClick={closeMobileMenu}
                  >
                    Contact
                  </Link>
                </>
              ) : (
                <>
                  <Link 
                    href="#about"
                    className="px-4 py-3 text-base font-medium text-gray-600 hover:text-blue-600 hover:bg-gray-50 transition-colors"
                    onClick={closeMobileMenu}
                  >
                    About
                  </Link>
                  <Link 
                    href="#portfolio"
                    className="px-4 py-3 text-base font-medium text-gray-600 hover:text-blue-600 hover:bg-gray-50 transition-colors"
                    onClick={closeMobileMenu}
                  >
                    Portfolio
                  </Link>
                  <Link 
                    href="/contributions"
                    className="px-4 py-3 text-base font-medium text-gray-600 hover:text-blue-600 hover:bg-gray-50 transition-colors"
                    onClick={closeMobileMenu}
                  >
                    Blog & Contributions
                  </Link>
                  <Link 
                    href="#contact"
                    className="px-4 py-3 text-base font-medium text-gray-600 hover:text-blue-600 hover:bg-gray-50 transition-colors"
                    onClick={closeMobileMenu}
                  >
                    Contact
                  </Link>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  )
} 