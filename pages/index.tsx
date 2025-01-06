import Head from 'next/head'
import { Hero } from '@/components/sections/Hero'
import { About } from '@/components/sections/About'
import { Portfolio } from '@/components/sections/Portfolio'
import { Blog } from '@/components/sections/Blog'
import { Contact } from '@/components/sections/Contact'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'

export default function Home() {
  return (
    <>
      <Head>
        <title>Sachin Sarawgi - Engineering Manager & Java Expert</title>
        <meta name="description" content="Senior Software Developer specializing in Java, System Design, and Technical Leadership" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main>
          <Hero />
          <About />
          <Portfolio />
          <Blog />
          <Contact />
        </main>
        <Footer />
      </div>
    </>
  )
} 