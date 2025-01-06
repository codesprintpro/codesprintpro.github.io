import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'

interface NavLinkProps {
  href: string
  children: React.ReactNode
}

const NavLink: React.FC<NavLinkProps> = ({ href, children }) => {
  const router = useRouter()
  const isContributionsPage = router.pathname === '/contributions'
  
  // If we're on the contributions page and the href is a hash link,
  // redirect to home page with the hash
  const handleClick = (e: React.MouseEvent) => {
    if (isContributionsPage && href.startsWith('#')) {
      e.preventDefault()
      router.push(`/${href}`)
    }
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
  const router = useRouter()

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 0)
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

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
          
          <div className="hidden md:flex space-x-8">
            {router.pathname === '/contributions' ? (
              // Links for contributions page
              <>
                <Link href="/#about">About</Link>
                <Link href="/#portfolio">Portfolio</Link>
                <Link href="/contributions">Blog & Contributions</Link>
                <Link href="/#contact">Contact</Link>
              </>
            ) : (
              // Links for home page
              <>
                <NavLink href="#about">About</NavLink>
                <NavLink href="#portfolio">Portfolio</NavLink>
                <NavLink href="/contributions">Blog & Contributions</NavLink>
                <NavLink href="#contact">Contact</NavLink>
              </>
            )}
          </div>
        </div>
      </div>
    </motion.nav>
  )
} 