import type { ReactNode } from 'react';
import './PageHeader.css';

type PageHeaderProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  notice?: ReactNode;
  children?: ReactNode;
};

export default function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  meta,
  notice,
  children,
}: PageHeaderProps) {
  return (
    <section className="page-header-card">
      <div className="page-header-top">
        <div className="page-header-copy">
          {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>

        {(actions || meta) && (
          <div className="page-header-side">
            {meta && <span className="page-meta">{meta}</span>}
            {actions && <div className="page-actions">{actions}</div>}
          </div>
        )}
      </div>

      {notice && <div className="page-notice">{notice}</div>}

      {children}
    </section>
  );
}
