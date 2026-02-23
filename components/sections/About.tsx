import { motion } from 'framer-motion'
import React from 'react'

const skillGroups = [
  {
    label: 'Languages & Frameworks',
    skills: ['Java', 'Spring Boot', 'Spring Cloud', 'Spring Security'],
  },
  {
    label: 'Data & Messaging',
    skills: ['Kafka', 'Redis', 'MySQL', 'PostgreSQL', 'Elasticsearch', 'Presto'],
  },
  {
    label: 'Infrastructure & Observability',
    skills: ['AWS', 'Docker', 'Prometheus', 'Grafana', 'Datadog', 'New Relic'],
  },
  {
    label: 'Architecture',
    skills: ['Microservices', 'System Design', 'Distributed Systems', 'REST APIs'],
  },
]

export const About: React.FC<{ totalArticles?: number }> = ({ totalArticles }) => {
  const stats = [
    { value: '10+', label: 'Years of experience' },
    { value: '7', label: 'Companies across fintech, SaaS & startups' },
    { value: totalArticles ? `${totalArticles}+` : '60+', label: 'Technical articles published' },
  ]
  return (
    <section id="about" className="py-20 bg-white">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">About Me</h2>
          <div className="w-20 h-1 bg-blue-600 mx-auto mb-8" />
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-16">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            viewport={{ once: true }}
          >
            <h3 className="text-2xl font-bold text-gray-900 mb-4">Who I Am</h3>
            <p className="text-gray-600 mb-4">
              I'm a Technical Lead / Architect at{' '}
              <span className="font-semibold text-gray-800">Redwood Software</span>, with over 10
              years of backend engineering across fintech, enterprise SaaS, and early-stage startups.
            </p>
            <p className="text-gray-600 mb-4">
              I've worked at{' '}
              <span className="font-semibold text-gray-800">
                Paytm, ServiceNow, Threado AI, Paysafe, Accion Labs,
              </span>{' '}
              and <span className="font-semibold text-gray-800">TCS</span> — building systems that
              process payments at scale, integrating enterprise platforms, and leading teams through
              complex data migrations and architectural transitions.
            </p>
            <p className="text-gray-600">
              CodeSprintPro is where I share what I've learned from building production systems —
              the real patterns, the real trade-offs, and the decisions that only make sense once
              you've seen a system fail at 2am.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            viewport={{ once: true }}
          >
            <h3 className="text-2xl font-bold text-gray-900 mb-6">Technical Stack</h3>
            <div className="space-y-4">
              {skillGroups.map((group) => (
                <div key={group.label}>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                    {group.label}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {group.skills.map((skill) => (
                      <motion.span
                        key={skill}
                        className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-md font-medium text-sm"
                        whileHover={{ scale: 1.05 }}
                        initial={{ opacity: 0, y: 10 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                        viewport={{ once: true }}
                      >
                        {skill}
                      </motion.span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          viewport={{ once: true }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="text-center p-8 bg-gray-50 rounded-xl border border-gray-100"
            >
              <div className="text-4xl font-bold text-blue-600 mb-2">{stat.value}</div>
              <div className="text-gray-600 text-sm">{stat.label}</div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
