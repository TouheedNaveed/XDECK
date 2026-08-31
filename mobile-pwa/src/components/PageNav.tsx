import { useRef, useCallback } from 'react';
import type { Page } from '@shared/protocol';

interface PageNavProps {
  pages: Page[];
  currentPageIndex: number;
  onPageChange: (index: number) => void;
  onAddPage: () => void;
  onDeletePage: () => void;
  canDeletePages: boolean;
}

export function PageNav({ pages, currentPageIndex, onPageChange, onAddPage, onDeletePage, canDeletePages }: PageNavProps) {
  const touchStartX = useRef(0);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const diff = touchStartX.current - e.touches[0].clientX;
    if (Math.abs(diff) > 50) {
      if (diff > 0 && currentPageIndex < pages.length - 1) {
        onPageChange(currentPageIndex + 1);
      } else if (diff < 0 && currentPageIndex > 0) {
        onPageChange(currentPageIndex - 1);
      }
      touchStartX.current = e.touches[0].clientX;
    }
  }, [currentPageIndex, pages.length, onPageChange]);

  const goPrev = useCallback(() => {
    if (currentPageIndex > 0) onPageChange(currentPageIndex - 1);
  }, [currentPageIndex, onPageChange]);

  const goNext = useCallback(() => {
    if (currentPageIndex < pages.length - 1) onPageChange(currentPageIndex + 1);
  }, [currentPageIndex, pages.length, onPageChange]);

  return (
    <div
      className="flex flex-col items-center gap-2 px-4"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
    >
      {/* Page name + controls */}
      <div className="flex items-center gap-3">
        {canDeletePages && (
          <button
            onClick={onDeletePage}
            className="w-7 h-7 rounded-lg bg-red-500/20 flex items-center justify-center opacity-50 hover:opacity-100 transition-opacity"
          >
            <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}

        <span 
          className="text-xs font-medium min-w-[60px] text-center"
          style={pages[currentPageIndex]?.textColor ? { color: pages[currentPageIndex].textColor } : { color: 'rgba(255,255,255,0.4)' }}
        >
          {pages[currentPageIndex]?.name || 'Untitled'}
        </span>

        <button
          onClick={onAddPage}
          className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center opacity-50 hover:opacity-100 transition-opacity"
        >
          <svg className="w-3.5 h-3.5 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-3">
        {/* Left chevron */}
        <button
          onClick={goPrev}
          disabled={currentPageIndex === 0}
          className="nav-chevron disabled:opacity-20"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Page dots */}
        <div className="flex items-center gap-1.5">
          {pages.map((_, i) => (
            <button
              key={i}
              onClick={() => onPageChange(i)}
              className={`page-dot ${i === currentPageIndex ? 'active' : ''}`}
            />
          ))}
        </div>

        {/* Right chevron */}
        <button
          onClick={goNext}
          disabled={currentPageIndex === pages.length - 1}
          className="nav-chevron disabled:opacity-20"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
