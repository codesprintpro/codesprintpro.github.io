interface AffiliateLink {
  title: string
  description: string
  url: string
  cta: string
  badge?: string
}

const AFFILIATE_PRESETS: Record<string, AffiliateLink[]> = {
  'distributed-systems-books': [
    {
      title: 'Designing Data-Intensive Applications',
      description: 'The definitive guide to building scalable, reliable distributed systems by Martin Kleppmann.',
      url: 'https://amzn.to/3RyKzOA',
      cta: 'View on Amazon',
      badge: 'Best Seller',
    },
    {
      title: 'Kafka: The Definitive Guide',
      description: 'Real-time data and stream processing by Confluent engineers.',
      url: 'https://amzn.to/3TpGKsI',
      cta: 'View on Amazon',
      badge: "Editor's Pick",
    },
    {
      title: 'Apache Kafka Series on Udemy',
      description: 'Hands-on Kafka course covering producers, consumers, Kafka Streams, and Connect.',
      url: 'https://www.udemy.com/course/apache-kafka/',
      cta: 'View Course',
    },
  ],
  'java-courses': [
    {
      title: 'Java Masterclass — Udemy',
      description: 'Comprehensive Java course covering Java 17+, OOP, concurrency, and modern APIs.',
      url: 'https://www.udemy.com/course/java-the-complete-java-developer-course/',
      cta: 'View Course',
      badge: 'Best Seller',
    },
    {
      title: 'Effective Java, 3rd Edition',
      description: 'Joshua Bloch\'s classic guide to writing clear, correct, and efficient Java code.',
      url: 'https://amzn.to/3RxIpuB',
      cta: 'View on Amazon',
      badge: "Must Read",
    },
    {
      title: 'Java Concurrency in Practice',
      description: 'The authoritative book on writing thread-safe, concurrent Java programs.',
      url: 'https://amzn.to/3Rx3xM4',
      cta: 'View on Amazon',
    },
  ],
  'system-design-courses': [
    {
      title: 'System Design Interview — Alex Xu',
      description: 'Step-by-step guide to ace system design interviews with real-world examples.',
      url: 'https://amzn.to/3TqsPRp',
      cta: 'View on Amazon',
      badge: 'Best Seller',
    },
    {
      title: 'Grokking System Design on Educative',
      description: 'Interactive course teaching system design with visual diagrams and practice problems.',
      url: 'https://www.educative.io/courses/grokking-the-system-design-interview',
      cta: 'View Course',
    },
    {
      title: 'Designing Data-Intensive Applications',
      description: 'Martin Kleppmann\'s book is essential reading for any system design role.',
      url: 'https://amzn.to/3RyKzOA',
      cta: 'View on Amazon',
    },
  ],
  'ai-ml-books': [
    {
      title: 'Building LLM Apps with LangChain — Udemy',
      description: 'Build RAG systems, agents, and LLM-powered apps with Python and LangChain.',
      url: 'https://www.udemy.com/course/langchain/',
      cta: 'View Course',
      badge: 'Hot',
    },
    {
      title: 'Hands-On Large Language Models',
      description: 'Practical guide to training, fine-tuning, and deploying LLMs.',
      url: 'https://amzn.to/3Vpd8h5',
      cta: 'View on Amazon',
      badge: "New",
    },
    {
      title: 'AI Engineering by Chip Huyen',
      description: 'Building intelligent systems with foundation models — from retrieval to agents.',
      url: 'https://amzn.to/3Vrd1Rd',
      cta: 'View on Amazon',
    },
  ],
  'aws-resources': [
    {
      title: 'AWS Solutions Architect Associate — Udemy',
      description: 'Most popular AWS certification course by Stephane Maarek.',
      url: 'https://www.udemy.com/course/aws-certified-solutions-architect-associate-saa-c03/',
      cta: 'View Course',
      badge: 'Best Seller',
    },
    {
      title: 'AWS in Action, 3rd Edition',
      description: 'Hands-on guide to building cloud applications on AWS.',
      url: 'https://amzn.to/3Vmf49E',
      cta: 'View on Amazon',
    },
  ],
  'database-resources': [
    {
      title: 'Designing Data-Intensive Applications',
      description: 'The go-to book for understanding databases, consistency, and distributed data.',
      url: 'https://amzn.to/3RyKzOA',
      cta: 'View on Amazon',
      badge: 'Essential',
    },
    {
      title: 'MongoDB — The Complete Developer\'s Guide — Udemy',
      description: 'Comprehensive MongoDB course from basics to advanced aggregations.',
      url: 'https://www.udemy.com/course/mongodb-the-complete-developers-guide/',
      cta: 'View Course',
    },
  ],
  'data-engineering-resources': [
    {
      title: 'Fundamentals of Data Engineering',
      description: 'Joe Reis\'s book on data pipelines, architectures, and the modern data stack.',
      url: 'https://amzn.to/3Vmf5sX',
      cta: 'View on Amazon',
      badge: 'New',
    },
    {
      title: 'Apache Kafka for Data Engineers — Udemy',
      description: 'Learn Kafka Connect, Kafka Streams, and CDC with Debezium for data pipelines.',
      url: 'https://www.udemy.com/course/kafka-streams-real-time-stream-processing-master-class/',
      cta: 'View Course',
    },
  ],
}

interface AffiliateSectionProps {
  variant: string
}

export const AffiliateSection: React.FC<AffiliateSectionProps> = ({ variant }) => {
  const links = AFFILIATE_PRESETS[variant]
  if (!links || links.length === 0) return null

  return (
    <div className="my-10 rounded-xl border border-yellow-200 bg-yellow-50 p-6">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">📚</span>
        <h3 className="text-base font-bold text-gray-900">Recommended Resources</h3>
      </div>
      <div className="space-y-4">
        {links.map((link) => (
          <div key={link.title} className="flex items-start gap-3 bg-white rounded-lg p-4 border border-yellow-100">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="font-semibold text-gray-900 text-sm">{link.title}</span>
                {link.badge && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                    {link.badge}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-600">{link.description}</p>
            </div>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 text-xs bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium whitespace-nowrap"
            >
              {link.cta} →
            </a>
          </div>
        ))}
      </div>
    </div>
  )
}

export default AffiliateSection
