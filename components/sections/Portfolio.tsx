import { motion } from 'framer-motion'
import React from 'react'

interface Achievement {
  company: string
  role: string
  period: string
  headline: string
  bullets: string[]
  tags: string[]
}

const achievements: Achievement[] = [
  {
    company: 'Paytm',
    role: 'Staff Software Engineer / Senior Technical Lead',
    period: '2023 – 2025',
    headline: 'PSP Device Binding Migration & Merchant Invoicing',
    bullets: [
      'Led migration of 20 GB+ of user PSP binding data with zero downtime — served millions of active Paytm users',
      'Built and shipped new device binding APIs for the mobile platform, improving security and reducing unauthorized access',
      'Replaced heavy code-based merchant file processing with Presto-powered SQL pipelines, cutting invoicing turnaround and eliminating per-config code changes',
      'Led deployment team through critical production rollouts; used shell scripting to resolve live device binding incidents',
    ],
    tags: ['Java', 'Spring Boot', 'Kafka', 'Redis', 'MySQL', 'Presto', 'Prometheus', 'Grafana'],
  },
  {
    company: 'ServiceNow',
    role: 'Independent Contributor II & III',
    period: '2019 – 2022',
    headline: 'Azure, Jira & DevOps Integrations — Marketplace Apps',
    bullets: [
      'Architected and shipped Azure and Jira integration apps now available in the ServiceNow Store',
      'Contributed to the ServiceNow Agile Development 2.0 family plugin, used by enterprise customers globally',
      'Led security remediation across the product using Fortify static analysis — identified and resolved critical vulnerabilities',
    ],
    tags: ['Java', 'ServiceNow', 'Azure', 'Jira', 'REST APIs', 'Fortify', 'Jenkins', 'Docker'],
  },
  {
    company: 'Paysafe Group',
    role: 'Platform Engineer',
    period: '2018 – 2019',
    headline: 'Real-Time Transaction Analytics Platform',
    bullets: [
      'Built a merchant analytics platform that processed payment transactions in parallel using MapR Stream',
      'Enriched raw transaction data and surfaced insights into merchant dashboards via Elasticsearch and Druid',
      'Designed Spring Boot / Spring Cloud REST APIs powering the analytics front-end',
    ],
    tags: ['Spring Boot', 'Spring Cloud', 'MapR Stream', 'Elasticsearch', 'Druid'],
  },
]

const writing = [
  {
    platform: 'CodeSprintPro',
    description: '30+ in-depth articles on Kafka, Redis, System Design, Java 21, AWS, and distributed systems — the site you\'re reading right now.',
    href: '/blog',
    internal: true,
  },
  {
    platform: 'Medium',
    description: 'Earlier writing on Java, Spring Boot, and system architecture. 100K+ views across published articles.',
    href: 'https://medium.com/@codesprintpro',
    internal: false,
  },
  {
    platform: 'StackOverflow',
    description: 'Active contributor with answers focused on Java, Spring Boot, and database optimization.',
    href: 'https://stackoverflow.com/users/2663579/sachinsarawgi',
    internal: false,
  },
]

export const Portfolio: React.FC = () => {
  return (
    <section id="portfolio" className="py-20 bg-gray-50">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">

        {/* Work Highlights */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Work Highlights</h2>
          <div className="w-20 h-1 bg-blue-600 mx-auto mb-4" />
          <p className="text-gray-500 max-w-xl mx-auto">
            Selected projects from 10 years of building backend systems across payments, enterprise SaaS, and startups.
          </p>
        </motion.div>

        <div className="space-y-6 mb-20">
          {achievements.map((item, i) => (
            <motion.div
              key={item.company}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              viewport={{ once: true }}
              className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 md:p-8"
            >
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2 mb-4">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-lg font-bold text-gray-900">{item.company}</span>
                    <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                      {item.period}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">{item.role}</p>
                </div>
              </div>

              <h3 className="text-base font-semibold text-gray-800 mb-3">{item.headline}</h3>

              <ul className="space-y-2 mb-4">
                {item.bullets.map((bullet) => (
                  <li key={bullet} className="flex gap-2 text-sm text-gray-600">
                    <span className="text-blue-500 mt-1 flex-shrink-0">→</span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-50">
                {item.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-md"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Writing & Community */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Writing & Community</h2>
          <div className="w-20 h-1 bg-blue-600 mx-auto" />
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {writing.map((item, i) => {
            const inner = (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                viewport={{ once: true }}
                className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 hover:shadow-md hover:border-blue-200 transition-all h-full"
              >
                <h3 className="text-lg font-bold text-gray-900 mb-2">{item.platform}</h3>
                <p className="text-sm text-gray-600">{item.description}</p>
                <p className="text-blue-600 text-sm font-medium mt-4">Read more →</p>
              </motion.div>
            )

            return item.internal ? (
              <a key={item.platform} href={item.href}>{inner}</a>
            ) : (
              <a
                key={item.platform}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {inner}
              </a>
            )
          })}
        </div>

      </div>
    </section>
  )
}
