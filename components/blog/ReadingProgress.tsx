import { useState, useEffect } from 'react'

export const ReadingProgress: React.FC = () => {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const handleScroll = () => {
      const totalHeight = document.documentElement.scrollHeight - window.innerHeight
      if (totalHeight <= 0) return
      setProgress(Math.min(100, (window.scrollY / totalHeight) * 100))
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <div
      style={{ width: `${progress}%` }}
      className="fixed top-0 left-0 h-[3px] bg-blue-600 z-[200] transition-all duration-75 ease-linear"
    />
  )
}

export default ReadingProgress
