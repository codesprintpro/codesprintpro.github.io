import { useState } from 'react'

interface NewsletterCTAProps {
  source?: string
  compact?: boolean
}

type SubmitStatus = {
  type: 'success' | 'error' | null
  message: string
}

export const NewsletterCTA: React.FC<NewsletterCTAProps> = ({
  source = 'blog',
  compact = false,
}) => {
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>({ type: null, message: '' })
  const safeSourceId = source.replace(/[^a-zA-Z0-9_-]/g, '-')
  const headingId = `newsletter-heading-${safeSourceId}`
  const emailInputId = `newsletter-email-${safeSourceId}`

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()

    if (!normalizedEmail) {
      setSubmitStatus({ type: 'error', message: 'Enter an email address to join the list.' })
      return
    }

    setIsSubmitting(true)
    setSubmitStatus({ type: null, message: '' })

    try {
      const { supabase } = await import('@/lib/supabase')
      const { error } = await supabase
        .from('newsletter_subscribers')
        .insert([
          {
            email: normalizedEmail,
            source,
            created_at: new Date().toISOString(),
          },
        ])

      if (error) {
        if (error.code === '23505') {
          setSubmitStatus({
            type: 'success',
            message: 'You are already on the list. Good taste, honestly.',
          })
          setEmail('')
          return
        }
        throw error
      }

      setSubmitStatus({
        type: 'success',
        message: 'You are on the list. Expect practical backend and system design guides.',
      })
      setEmail('')
    } catch (error) {
      console.error('Error subscribing to newsletter:', error)
      setSubmitStatus({
        type: 'error',
        message: 'Could not subscribe right now. Please try again later.',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section
      className={`rounded-xl border border-blue-100 bg-blue-50 p-6 md:p-7 ${
        compact ? '' : 'mt-10'
      }`}
      aria-labelledby={headingId}
    >
      <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-600 mb-2">
            Practical engineering notes
          </p>
          <h2 id={headingId} className="text-2xl font-bold text-gray-900 mb-2">
            Get the next backend guide in your inbox
          </h2>
          <p className="text-sm text-gray-600 leading-relaxed max-w-2xl">
            One useful note when a new deep dive is published: system design tradeoffs, Java
            production lessons, Kafka debugging, database patterns, and AI infrastructure.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="w-full lg:w-96">
          <label htmlFor={emailInputId} className="sr-only">
            Email address
          </label>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              id={emailInputId}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
              disabled={isSubmitting}
              className="min-w-0 flex-1 rounded-lg border border-blue-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50"
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Joining...' : 'Join'}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            No spam. Just practical notes you can use at work.
          </p>
          {submitStatus.type && (
            <p
              className={`mt-3 text-sm ${
                submitStatus.type === 'success' ? 'text-green-700' : 'text-red-700'
              }`}
            >
              {submitStatus.message}
            </p>
          )}
        </form>
      </div>
    </section>
  )
}

export default NewsletterCTA
