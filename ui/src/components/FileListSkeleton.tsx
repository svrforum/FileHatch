import './FileListSkeleton.css'

function FileListSkeleton() {
  return (
    <div className="file-list-skeleton">
      {/* Header skeleton */}
      <div className="skeleton-header">
        <div className="skeleton-breadcrumb">
          <div className="skeleton-text skeleton-animate" style={{ width: '120px' }} />
        </div>
        <div className="skeleton-actions">
          <div className="skeleton-button skeleton-animate" />
          <div className="skeleton-button skeleton-animate" />
        </div>
      </div>

      {/* Table header skeleton */}
      <div className="skeleton-table-header">
        <div className="skeleton-text skeleton-animate" style={{ width: '60px' }} />
        <div className="skeleton-text skeleton-animate" style={{ width: '80px' }} />
        <div className="skeleton-text skeleton-animate" style={{ width: '100px' }} />
      </div>

      {/* File rows skeleton */}
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="skeleton-row" style={{ animationDelay: `${index * 0.05}s` }}>
          <div className="skeleton-icon skeleton-animate" />
          <div className="skeleton-cell" style={{ flex: 1 }}>
            <div className="skeleton-text skeleton-animate" style={{ width: `${60 + Math.random() * 30}%` }} />
          </div>
          <div className="skeleton-cell">
            <div className="skeleton-text skeleton-animate" style={{ width: '60px' }} />
          </div>
          <div className="skeleton-cell">
            <div className="skeleton-text skeleton-animate" style={{ width: '100px' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export default FileListSkeleton
