import { TocItem } from '@/lib/blog'

interface TableOfContentsProps {
  items: TocItem[]
  activeId?: string
  variant?: 'desktop' | 'mobile'
}

export const TableOfContents: React.FC<TableOfContentsProps> = ({
  items,
  activeId,
  variant = 'desktop',
}) => {
  if (items.length === 0) return null

  const list = (
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
  )

  if (variant === 'mobile') {
    return (
      <details className="lg:hidden rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer list-none text-sm font-semibold text-gray-900">
          <span className="flex items-center justify-between gap-3">
            On This Page
            <span className="text-xs font-medium text-blue-600">Open</span>
          </span>
        </summary>
        <div className="mt-4 border-t border-gray-100 pt-4">
          {list}
          <a
            href="#article-top"
            className="mt-3 inline-block text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            Back to top
          </a>
        </div>
      </details>
    )
  }

  return (
    <nav className="hidden lg:block sticky top-24">
      <h4 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
        On This Page
      </h4>
      {list}
      <a
        href="#article-top"
        className="mt-4 inline-block text-xs font-medium text-blue-600 hover:text-blue-700"
      >
        Back to top
      </a>
    </nav>
  )
}

export default TableOfContents
