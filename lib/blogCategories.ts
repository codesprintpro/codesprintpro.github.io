import type { BlogCategory } from '@/lib/blog'

export interface BlogCategoryMeta {
  name: BlogCategory
  slug: string
  icon: string
  color: string
  border: string
  accent: string
  description: string
  seoTitle: string
  seoDescription: string
}

export const BLOG_CATEGORIES: BlogCategoryMeta[] = [
  {
    name: 'System Design',
    slug: 'system-design',
    icon: '🏗',
    color: 'bg-blue-50',
    border: 'border-blue-200',
    accent: 'text-blue-700',
    description:
      'Architecture deep dives, scaling trade-offs, reliability patterns, and system design walkthroughs for backend engineers.',
    seoTitle: 'System Design Articles | CodeSprintPro',
    seoDescription:
      'Practical system design articles on distributed systems, reliability, scalability, rate limiting, audit logs, multi-region architecture, and backend architecture trade-offs.',
  },
  {
    name: 'Java',
    slug: 'java',
    icon: '☕',
    color: 'bg-orange-50',
    border: 'border-orange-200',
    accent: 'text-orange-700',
    description:
      'Production Java and Spring Boot guides covering performance, concurrency, JVM behavior, APIs, and operational readiness.',
    seoTitle: 'Java and Spring Boot Articles | CodeSprintPro',
    seoDescription:
      'Practical Java and Spring Boot articles on JVM tuning, virtual threads, performance, production readiness, connection pools, and backend engineering.',
  },
  {
    name: 'Databases',
    slug: 'databases',
    icon: '🗄️',
    color: 'bg-green-50',
    border: 'border-green-200',
    accent: 'text-green-700',
    description:
      'Database engineering guides for PostgreSQL, Redis, Elasticsearch, DynamoDB, indexing, caching, and production data access patterns.',
    seoTitle: 'Database Engineering Articles | CodeSprintPro',
    seoDescription:
      'Database articles on PostgreSQL, Redis, Elasticsearch, DynamoDB, indexing, cache invalidation, performance tuning, and data modeling.',
  },
  {
    name: 'AI/ML',
    slug: 'ai-ml',
    icon: '🤖',
    color: 'bg-purple-50',
    border: 'border-purple-200',
    accent: 'text-purple-700',
    description:
      'Practical AI engineering content on RAG, embeddings, LLM applications, model operations, agents, and real-time ML infrastructure.',
    seoTitle: 'AI and Machine Learning Engineering Articles | CodeSprintPro',
    seoDescription:
      'AI engineering articles on RAG systems, embeddings, LLM applications, AI agents, feature stores, evaluation, and production ML infrastructure.',
  },
  {
    name: 'AWS',
    slug: 'aws',
    icon: '☁️',
    color: 'bg-yellow-50',
    border: 'border-yellow-200',
    accent: 'text-yellow-700',
    description:
      'AWS architecture and cloud engineering guides for serverless, containers, high-traffic systems, reliability, and cost optimization.',
    seoTitle: 'AWS Architecture Articles | CodeSprintPro',
    seoDescription:
      'AWS architecture articles on Lambda, ECS, EKS, high-traffic systems, cost optimization, serverless patterns, and cloud reliability.',
  },
  {
    name: 'Messaging',
    slug: 'messaging',
    icon: '📨',
    color: 'bg-red-50',
    border: 'border-red-200',
    accent: 'text-red-700',
    description:
      'Messaging and streaming guides for Kafka, SQS, EventBridge, consumer lag, exactly-once semantics, and event-driven systems.',
    seoTitle: 'Kafka and Messaging Articles | CodeSprintPro',
    seoDescription:
      'Messaging articles on Kafka, consumer lag, exactly-once semantics, SQS, EventBridge, streaming systems, and event-driven architecture.',
  },
  {
    name: 'Data Engineering',
    slug: 'data-engineering',
    icon: '⚡',
    color: 'bg-teal-50',
    border: 'border-teal-200',
    accent: 'text-teal-700',
    description:
      'Data engineering patterns for CDC, streaming pipelines, synchronization, observability data, and production data movement.',
    seoTitle: 'Data Engineering Articles | CodeSprintPro',
    seoDescription:
      'Data engineering articles on change data capture, Debezium, streaming pipelines, synchronization, and production data movement patterns.',
  },
]

export const BLOG_CATEGORY_BY_NAME = BLOG_CATEGORIES.reduce(
  (acc, category) => {
    acc[category.name] = category
    return acc
  },
  {} as Record<BlogCategory, BlogCategoryMeta>
)

export const BLOG_CATEGORY_BY_SLUG = BLOG_CATEGORIES.reduce(
  (acc, category) => {
    acc[category.slug] = category
    return acc
  },
  {} as Record<string, BlogCategoryMeta>
)

export function getCategoryHref(category: BlogCategory): string {
  return `/blog/category/${BLOG_CATEGORY_BY_NAME[category].slug}/`
}

export function getCategoryMetaBySlug(slug: string): BlogCategoryMeta | undefined {
  return BLOG_CATEGORY_BY_SLUG[slug]
}
