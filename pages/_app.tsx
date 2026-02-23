import type { AppProps } from 'next/app'
import { Inter } from 'next/font/google'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'
import '@/styles/globals.css'
import 'prismjs/themes/prism-tomorrow.css'

const inter = Inter({ subsets: ['latin'] })

const ReadingProgress = dynamic(
  () => import('@/components/blog/ReadingProgress').then((m) => m.ReadingProgress),
  { ssr: false }
)

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter()
  const isArticlePage = router.pathname === '/blog/[slug]'

  return (
    <main className={inter.className}>
      {isArticlePage && <ReadingProgress />}
      <Component {...pageProps} />
    </main>
  )
}
