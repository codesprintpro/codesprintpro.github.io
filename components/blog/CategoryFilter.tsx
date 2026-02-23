import { BlogCategory } from '@/lib/blog'

interface CategoryFilterProps {
  categories: Array<{ name: BlogCategory; count: number }>
  activeCategory: BlogCategory | null
  onCategoryChange: (category: BlogCategory | null) => void
  totalCount: number
}

const CATEGORY_ICONS: Record<string, string> = {
  'System Design': '🏗',
  'Java': '☕',
  'Databases': '🗄️',
  'AI/ML': '🤖',
  'AWS': '☁️',
  'Messaging': '📨',
  'Data Engineering': '⚡',
}

export const CategoryFilter: React.FC<CategoryFilterProps> = ({
  categories,
  activeCategory,
  onCategoryChange,
  totalCount,
}) => {
  return (
    <div className="flex flex-wrap gap-2 mb-8">
      <button
        onClick={() => onCategoryChange(null)}
        className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${
          activeCategory === null
            ? 'bg-blue-600 text-white shadow-md'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}
      >
        All <span className="text-xs opacity-75">({totalCount})</span>
      </button>
      {categories.map(({ name, count }) => (
        <button
          key={name}
          onClick={() => onCategoryChange(name)}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${
            activeCategory === name
              ? 'bg-blue-600 text-white shadow-md'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <span>{CATEGORY_ICONS[name]}</span>
          {name} <span className="text-xs opacity-75">({count})</span>
        </button>
      ))}
    </div>
  )
}

export default CategoryFilter
