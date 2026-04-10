import type { AppProps } from 'next/app'
import { Inter } from 'next/font/google'
import Script from 'next/script'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'
import { useEffect } from 'react'
import '@/styles/globals.css'
import 'prismjs/themes/prism-tomorrow.css'
import { GA_MEASUREMENT_ID, pageview } from '@/lib/gtag'

const inter = Inter({ subsets: ['latin'] })

const ReadingProgress = dynamic(
  () => import('@/components/blog/ReadingProgress').then((m) => m.ReadingProgress),
  { ssr: false }
)

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter()
  const isArticlePage = router.pathname === '/blog/[slug]'

  useEffect(() => {
    if (!GA_MEASUREMENT_ID) {
      return
    }

    const handleRouteChange = (url: string) => {
      pageview(url)
    }

    router.events.on('routeChangeComplete', handleRouteChange)

    return () => {
      router.events.off('routeChangeComplete', handleRouteChange)
    }
  }, [router.events])

  return (
    <>
      {GA_MEASUREMENT_ID && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
            strategy="afterInteractive"
          />
          <Script
            id="google-analytics"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                window.gtag = gtag;
                gtag('js', new Date());
                gtag('config', '${GA_MEASUREMENT_ID}', {
                  page_path: window.location.pathname + window.location.search,
                });
              `,
            }}
          />
        </>
      )}
      <main className={inter.className}>
        {isArticlePage && <ReadingProgress />}
        <Component {...pageProps} />
      </main>
    </>
  )
}
