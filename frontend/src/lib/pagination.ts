import { useCallback, useMemo, useState } from 'react';
import type { SetStateAction } from 'react';

export const DEFAULT_PAGE_SIZE = 10;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const depsChanged = (previous: unknown[], next: unknown[]) =>
  previous.length !== next.length || previous.some((value, index) => !Object.is(value, next[index]));

export const usePagination = <T,>(items: T[], pageSize: number = DEFAULT_PAGE_SIZE, resetDeps: unknown[] = []) => {
  const [pageState, setPageState] = useState({ page: 1, resetDeps });

  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const requestedPage = depsChanged(pageState.resetDeps, resetDeps) ? 1 : pageState.page;
  const safePage = clamp(requestedPage, 1, totalPages);

  const setPage = useCallback((nextPage: SetStateAction<number>) => {
    setPageState((current) => {
      const currentPage = depsChanged(current.resetDeps, resetDeps) ? 1 : current.page;
      const page = typeof nextPage === 'function' ? nextPage(currentPage) : nextPage;
      return { page, resetDeps: [...resetDeps] };
    });
  }, [resetDeps]);

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
