import { useEffect, useMemo, useState } from 'react';

export const DEFAULT_PAGE_SIZE = 10;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const usePagination = <T,>(items: T[], pageSize: number = DEFAULT_PAGE_SIZE, resetDeps: unknown[] = []) => {
  const [page, setPage] = useState(1);

  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = clamp(page, 1, totalPages);

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage);
    }
  }, [page, safePage]);

  useEffect(() => {
    setPage(1);
  }, resetDeps);

  const paginated = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, pageSize, safePage]);

  return {
    page: safePage,
    setPage,
    totalPages,
    pageSize,
    totalItems,
    paginated,
  };
};
