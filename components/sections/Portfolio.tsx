import { motion } from 'framer-motion'
import React from 'react'

interface Project {
  title: string
  description: string
  technologies: string[]
  link?: string
}

const projects: Project[] = [
  {
    title: "Paytm Device Binding Migration",
    description: "Led the migration of device binding system, improving security and reducing unauthorized access by 99%. Implemented robust authentication mechanisms and handled migration of millions of user records.",
    technologies: ["Java", "Spring Boot", "MySQL", "Redis", "Kafka"],
  },
  {
    title: "ServiceNow ITBM & DevOps Integration",
    description: "Architected and implemented integration between IT Business Management and DevOps tools, streamlining project delivery and reducing deployment time by 40%.",
    technologies: ["Java", "ServiceNow", "REST APIs", "Jenkins", "Docker"],
  },
  {
    title: "Fintech Architecture Design",
    description: "Designed scalable microservices architecture for financial transactions, handling 1M+ daily transactions with 99.99% uptime. Implemented fault tolerance and data consistency patterns.",
    technologies: ["Microservices", "Spring Cloud", "PostgreSQL", "RabbitMQ"],
  }
]

interface Contribution {
  platform: string
  title: string
  description: string
  link: string
}

const contributions: Contribution[] = [
  {
    platform: "Medium",
    title: "Technical Blog",
    description: "25+ articles on Java, System Design, and Software Architecture with 100K+ views",
    link: "https://medium.com/@codesprintpro"
  },
  {
    platform: "StackOverflow",
    title: "Community Contributions",
    description: "Active contributor with focus on Java, Spring Boot, and Database optimization",
    link: "https://stackoverflow.com/users/2663579/sachinsarawgi"
  }
]

const ProjectCard: React.FC<Project> = ({ title, description, technologies, link }) => (
  <motion.div 
    className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow"
    whileHover={{ y: -5 }}
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true }}
  >
    <h3 className="text-xl font-bold text-gray-900 mb-3">{title}</h3>
    <p className="text-gray-600 mb-4">{description}</p>
    <div className="flex flex-wrap gap-2 mb-4">
      {technologies.map((tech) => (
        <span 
          key={tech}
          className="bg-blue-100 text-blue-600 px-3 py-1 rounded-full text-sm"
        >
          {tech}
        </span>
      ))}
    </div>
    {link && (
      <a 
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 hover:text-blue-700 font-medium"
        aria-label={`View ${title} project`}
      >
        View Project →
      </a>
    )}
  </motion.div>
)

const ContributionCard: React.FC<Contribution> = ({ platform, title, description, link }) => (
  <motion.a
    href={link}
    target="_blank"
    rel="noopener noreferrer"
    className="block bg-gray-50 rounded-lg p-6 hover:bg-gray-100 transition-colors"
    whileHover={{ scale: 1.02 }}
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true }}
  >
    <h3 className="text-xl font-bold text-gray-900 mb-2">{platform}</h3>
    <h4 className="text-lg font-medium text-blue-600 mb-2">{title}</h4>
    <p className="text-gray-600">{description}</p>
  </motion.a>
)

export const Portfolio: React.FC = () => {
  return (
    <section id="portfolio" className="py-20 bg-gray-50">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Featured Projects
          </h2>
          <div className="w-20 h-1 bg-blue-600 mx-auto mb-8" />
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-16">
          {projects.map((project) => (
            <ProjectCard key={project.title} {...project} />
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Community Contributions
          </h2>
          <div className="w-20 h-1 bg-blue-600 mx-auto mb-8" />
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {contributions.map((contribution) => (
            <ContributionCard key={contribution.platform} {...contribution} />
          ))}
        </div>
      </div>
    </section>
  )
} 