import { motion } from 'framer-motion'
import React from 'react'

interface Skill {
  name: string
  category: string
}

const skills: Skill[] = [
  { name: 'Java', category: 'Languages' },
  { name: 'System Design', category: 'Architecture' },
  { name: 'MySQL', category: 'Databases' },
  { name: 'PostgreSQL', category: 'Databases' },
  { name: 'Spring Boot', category: 'Frameworks' },
  { name: 'Microservices', category: 'Architecture' },
  { name: 'Kafka', category: 'Messaging' },
  { name: 'Redis', category: 'Databases' },
  { name: 'Docker', category: 'Tools' },
  { name: 'Prometheus', category: 'Monitoring' },
  { name: 'Grafana', category: 'Monitoring' }
]

const SkillTag: React.FC<{ name: string }> = ({ name }) => (
  <motion.span
    className="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg font-medium text-sm inline-block m-1"
    whileHover={{ scale: 1.05 }}
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.3 }}
    viewport={{ once: true }}
  >
    {name}
  </motion.span>
)

export const About: React.FC = () => {
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
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            About Me
          </h2>
          <div className="w-20 h-1 bg-blue-600 mx-auto mb-8" />
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            viewport={{ once: true }}
          >
            <h3 className="text-2xl font-bold text-gray-900 mb-4">
              Professional Journey
            </h3>
            <p className="text-gray-600 mb-6">
              As an Engineering Manager with over a decade of experience, I've led teams 
              in developing scalable solutions for complex technical challenges. My expertise 
              spans across system design, database optimization, and technical leadership.
            </p>
            <p className="text-gray-600 mb-6">
              I've successfully delivered critical projects at Paytm and ServiceNow, 
              focusing on high-performance systems and seamless integrations. My approach 
              combines technical excellence with effective team leadership.
            </p>
            <p className="text-gray-600">
              I'm passionate about sharing knowledge through technical writing on Medium 
              and contributing to the developer community on StackOverflow.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            viewport={{ once: true }}
          >
            <h3 className="text-2xl font-bold text-gray-900 mb-6">
              Technical Expertise
            </h3>
            <div className="flex flex-wrap gap-2">
              {skills.map((skill) => (
                <SkillTag key={skill.name} name={skill.name} />
              ))}
            </div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.6 }}
          viewport={{ once: true }}
          className="mt-16 text-center"
        >
          <h3 className="text-2xl font-bold text-gray-900 mb-6">
            Key Achievements
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-6 bg-gray-50 rounded-lg">
              <h4 className="text-xl font-bold text-gray-900 mb-2">
                Technical Leadership
              </h4>
              <p className="text-gray-600">
                Led teams of 15+ engineers, delivering enterprise-scale solutions
              </p>
            </div>
            <div className="p-6 bg-gray-50 rounded-lg">
              <h4 className="text-xl font-bold text-gray-900 mb-2">
                System Architecture
              </h4>
              <p className="text-gray-600">
                Designed scalable architectures handling millions of transactions
              </p>
            </div>
            <div className="p-6 bg-gray-50 rounded-lg">
              <h4 className="text-xl font-bold text-gray-900 mb-2">
                Knowledge Sharing
              </h4>
              <p className="text-gray-600">
                25+ technical articles published with 100K+ views
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
} 