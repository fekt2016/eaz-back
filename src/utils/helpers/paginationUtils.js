/**
 * Calculate pagination metadata including visible page numbers
 * @param {number} currentPage - Current page number (1-indexed)
 * @param {number} totalPages - Total number of pages
 * @param {number} delta - Number of pages to show around current page (default: 2)
 * @param {number} maxVisible - Maximum number of page buttons to show (default: 5)
 * @returns {Object} Pagination metadata
 */
function calculatePaginationMetadata(currentPage, totalPages, delta = 2, maxVisible = 5) {
  // Validate inputs
  const current = Math.max(1, Math.min(currentPage, totalPages));
  const total = Math.max(1, totalPages);

  // If only one page, return minimal metadata
  if (total <= 1) {
    return {
      currentPage: current,
      totalPages: total,
      hasNext: false,
      hasPrev: false,
      visiblePages: [],
      showEllipsisStart: false,
      showEllipsisEnd: false,
    };
  }

  // Calculate visible page numbers
  let visiblePages = [];

  if (total <= maxVisible) {
    // Show all pages if total is less than max visible
    visiblePages = Array.from({ length: total }, (_, i) => i + 1);
  } else {
    // Show pages around current page with ellipsis logic
    const start = Math.max(2, current - delta);
    const end = Math.min(total - 1, current + delta);

    // Always show first page
    visiblePages.push(1);

    // Add ellipsis if needed before range
    if (start > 2) {
      visiblePages.push('ellipsis-start');
    }

    // Add pages in range
    for (let i = start; i <= end; i++) {
      visiblePages.push(i);
    }

    // Add ellipsis if needed after range
    if (end < total - 1) {
      visiblePages.push('ellipsis-end');
    }

    // Always show last page
    visiblePages.push(total);
  }

  return {
    currentPage: current,
    totalPages: total,
    hasNext: current < total,
    hasPrev: current > 1,
    visiblePages,
    showEllipsisStart: visiblePages.includes('ellipsis-start'),
    showEllipsisEnd: visiblePages.includes('ellipsis-end'),
  };
}

/**
 * Calculate pagination metadata for API responses
 * @param {number} page - Current page number (1-indexed)
 * @param {number} limit - Items per page
 * @param {number} total - Total number of items
 * @param {Object} options - Additional options (delta, maxVisible)
 * @returns {Object} Complete pagination metadata
 */
function buildPaginationResponse(page, limit, total, options = {}) {
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.max(1, parseInt(limit) || 20);
  const totalNum = Math.max(0, parseInt(total) || 0);
  const totalPages = Math.ceil(totalNum / limitNum);

  const paginationMetadata = calculatePaginationMetadata(
    pageNum,
    totalPages,
    options.delta || 2,
    options.maxVisible || 5
  );

  return {
    page: pageNum,
    limit: limitNum,
    total: totalNum,
    totalPages,
    hasNext: paginationMetadata.hasNext,
    hasPrev: paginationMetadata.hasPrev,
    visiblePages: paginationMetadata.visiblePages,
    showEllipsisStart: paginationMetadata.showEllipsisStart,
    showEllipsisEnd: paginationMetadata.showEllipsisEnd,
  };
}

module.exports = {
  calculatePaginationMetadata,
  buildPaginationResponse,
};










