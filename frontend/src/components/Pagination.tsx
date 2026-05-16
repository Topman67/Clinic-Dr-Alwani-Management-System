import { Button } from './ui';
import { cn, ui } from '../styles/ui';

type PaginationProps = {
  page: number;
  totalPages: number;
  onPageChange: (nextPage: number) => void;
  className?: string;
};

export const Pagination = ({ page, totalPages, onPageChange, className }: PaginationProps) => {
  if (totalPages <= 1) return null;

  const safePage = Math.min(Math.max(page, 1), totalPages);
  const canPrev = safePage > 1;
  const canNext = safePage < totalPages;

  return (
    <div className={cn('mt-3 flex items-center justify-end gap-2.5', className)}>
      <Button variant="secondary" onClick={() => onPageChange(safePage - 1)} disabled={!canPrev}>
        Prev
      </Button>
      <span className={cn(ui.muted, 'text-[0.84rem] font-semibold')}>
        Page {safePage} / {totalPages}
      </span>
      <Button variant="secondary" onClick={() => onPageChange(safePage + 1)} disabled={!canNext}>
        Next
      </Button>
    </div>
  );
};
