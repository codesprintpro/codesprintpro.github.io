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
        
        {/* Favicon */}
        <link rel="apple-touch-icon" sizes="180x180" href="/favicon/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon/favicon-96x96.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon/favicon-96x96.png" />
        <link rel="manifest" href="/favicon/site.webmanifest" />
        <link rel="mask-icon" href="/favicon/safari-pinned-tab.svg" color="#5bbad5" />
        
        {/* Android specific */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="Sachin Sarawgi" />
        <link rel="icon" sizes="192x192" href="/favicon/android-chrome-192x192.png" />
        <link rel="icon" sizes="512x512" href="/favicon/android-chrome-512x512.png" />
        
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