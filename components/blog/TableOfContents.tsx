import { TocItem } from '@/lib/blog'

interface TableOfContentsProps {
  items: TocItem[]
  activeId?: string
}

export const TableOfContents: React.FC<TableOfContentsProps> = ({ items, activeId }) => {
  if (items.length === 0) return null

  return (
    <nav className="hidden lg:block sticky top-24">
      <h4 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
        On This Page
      </h4>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id} className={item.level === 3 ? 'ml-4' : ''}>
            <a
              href={`#${item.id}`}
              className={`block text-sm py-1 border-l-2 pl-3 transition-all ${
                activeId === item.id
                  ? 'border-blue-600 text-blue-600 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300'
              } ${item.level === 3 ? 'text-xs' : ''}`}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export default TableOfContents
