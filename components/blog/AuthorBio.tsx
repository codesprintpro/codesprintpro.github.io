import Image from 'next/image'
import Link from 'next/link'

const socialLinks = [
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/sachin-sarawgi/' },
  { label: 'GitHub', href: 'https://github.com/codesprintpro' },
  { label: 'Medium', href: 'https://medium.com/@codesprintpro' },
]

export const AuthorBio: React.FC = () => {
  return (
    <section className="mt-10 rounded-xl border border-gray-200 bg-gray-50 p-6 md:p-7">
      <div className="flex flex-col sm:flex-row gap-5">
        <div className="relative w-20 h-20 flex-shrink-0">
          <Image
            src="/images/profile.jpg"
            alt="Sachin Sarawgi"
            fill
            className="rounded-full object-cover ring-2 ring-white"
          />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-600 mb-2">
            Written by
          </p>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Sachin Sarawgi</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            Engineering Manager and backend engineer with 10+ years building distributed systems
            across fintech, enterprise SaaS, and startups. CodeSprintPro is where I write practical
            guides on system design, Java, Kafka, databases, AI infrastructure, and production
            reliability.
          </p>
          <div className="flex flex-wrap gap-3 mt-4">
            {socialLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                {link.label}
              </a>
            ))}
            <Link href="/blog/" className="text-sm font-medium text-blue-600 hover:text-blue-700">
              More articles
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

export default AuthorBio
