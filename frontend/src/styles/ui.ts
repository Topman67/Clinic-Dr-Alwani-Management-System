export const cn = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

export const ui = {
  card: 'bg-app-surface border border-app-border rounded-app-lg shadow-app p-6',
  sectionHead: 'mb-5',
  sectionTitle: 'm-0 text-[1.65rem] font-[760] leading-[1.18] tracking-normal max-[640px]:text-[1.38rem]',
  sectionSubtitle: 'mt-[7px] max-w-[780px] text-[0.94rem] text-app-muted max-[640px]:text-[0.9rem]',
  muted: 'text-app-muted',
  error: 'text-app-danger',
  linkCta:
    'inline-flex items-center justify-center rounded-full bg-app-primary px-4 py-2.5 font-semibold text-white transition-[transform,box-shadow,background-color] duration-[170ms] hover:-translate-y-px hover:bg-app-primary-strong hover:shadow-[0_10px_22px_rgba(37,99,235,0.24)]',
  login: {
    wrap:
      'grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top_left,rgba(125,211,252,0.42),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(96,165,250,0.2),transparent_30%),linear-gradient(160deg,#f3fbff_0%,#eef7ff_45%,#ffffff_100%)] p-7 max-[640px]:p-4',
    card:
      'grid w-full max-w-[460px] gap-[18px] rounded-app-lg border border-[rgba(191,219,254,0.85)] bg-[rgba(255,255,255,0.9)] px-[30px] pb-[30px] pt-[34px] shadow-[0_24px_60px_rgba(37,99,235,0.12),0_10px_24px_rgba(15,23,42,0.08)] backdrop-blur-2xl max-[640px]:gap-4 max-[640px]:rounded-[20px] max-[640px]:px-[18px] max-[640px]:pb-5 max-[640px]:pt-[26px]',
    head: 'mb-0.5 grid justify-items-center gap-2.5 text-center',
    title:
      'm-0 -mt-3 text-[clamp(1.25rem,3.5vw,1.5rem)] font-[760] leading-[1.18] tracking-normal max-[640px]:text-[1.6rem]',
    subtitle: 'mt-0 text-base text-app-muted',
    logo: 'h-auto w-[min(100%,235px)] max-w-[235px] object-contain max-[640px]:max-w-[195px]',
    label: 'text-[0.94rem] font-semibold text-[#1e3a5f]',
    input:
      'min-h-12 rounded-[14px] border-[#cbd5e1] bg-[rgba(255,255,255,0.96)] focus:border-[#60a5fa] focus:shadow-[0_0_0_4px_rgba(96,165,250,0.2),0_8px_18px_rgba(59,130,246,0.08)]',
    error: '-mt-1 mb-0 text-[0.92rem] text-app-danger',
    button:
      'mt-1 min-h-[50px] rounded-[14px] bg-[linear-gradient(135deg,#38bdf8_0%,#2563eb_100%)] shadow-[0_14px_26px_rgba(37,99,235,0.2)] enabled:hover:bg-[linear-gradient(135deg,#0ea5e9_0%,#1d4ed8_100%)] enabled:hover:shadow-[0_18px_34px_rgba(37,99,235,0.28)]',
  },
  button: {
    base:
      'inline-flex min-h-[38px] cursor-pointer items-center justify-center rounded-[10px] border border-transparent px-3.5 py-2 text-[0.9rem] font-semibold text-white transition-[transform,box-shadow,background-color,opacity,border-color] duration-[170ms] disabled:cursor-not-allowed disabled:opacity-65 enabled:hover:-translate-y-px enabled:active:translate-y-0',
    primary: 'bg-app-primary enabled:hover:bg-app-primary-strong enabled:hover:shadow-[0_10px_20px_rgba(37,99,235,0.2)]',
    secondary:
      'border-app-border bg-app-surface-soft text-app-text enabled:hover:bg-[color-mix(in_srgb,var(--primary)_8%,var(--surface-soft))] enabled:hover:shadow-app-soft',
    danger: 'bg-app-danger enabled:hover:bg-app-danger-strong enabled:hover:shadow-[0_10px_20px_rgba(220,38,38,0.2)]',
  },
  formControl:
    'min-h-11 w-full rounded-app border border-app-border bg-app-surface-raised px-3 py-[9px] text-app-text transition-[background-color,border-color,box-shadow] duration-[170ms] placeholder:text-[color-mix(in_srgb,var(--muted)_78%,transparent)] focus:border-app-primary focus:outline-none focus:shadow-[0_0_0_4px_var(--ring)]',
  field: 'grid gap-1.5',
  fieldLabel: 'text-[0.78rem] font-[750] text-app-text',
  badge:
    'inline-flex min-w-[68px] items-center justify-center rounded-full border border-transparent px-[9px] py-[3px] text-[0.74rem] font-bold tracking-normal',
  badgeTone: {
    good: 'border-[rgba(4,120,87,0.2)] bg-[#ecfdf3] text-app-success',
    warning: 'border-[rgba(180,83,9,0.22)] bg-[#fff8eb] text-app-warning',
    critical: 'border-[rgba(185,28,28,0.2)] bg-[#fef2f2] text-app-danger-strong',
    neutral: 'border-[rgba(71,85,105,0.16)] bg-[#f8fafc] text-[#475569]',
  },
  tableWrap: 'mt-[18px] overflow-x-auto rounded-app-lg border border-app-border bg-app-surface shadow-app-soft',
  table: 'w-full min-w-[640px] border-separate border-spacing-0',
  tableHead: 'bg-app-surface-soft',
  tableHeaderCell: 'border-b border-app-border px-3.5 py-[11px] text-left align-middle text-[0.73rem] font-[750] uppercase text-app-muted',
  tableCell: 'border-b border-app-border px-3.5 py-[11px] text-left align-middle text-[0.91rem]',
  subCard: 'bg-app-surface-soft shadow-app-soft',
  actionRow: 'flex flex-wrap items-center gap-2.5',
  mobileCards: 'hidden mt-3.5 gap-3 max-[640px]:grid max-[640px]:gap-2.5',
  mobileCard: 'bg-app-surface border border-app-border rounded-app-lg p-3.5 shadow-app-soft',
  mobileCardTitle: 'm-0 mb-2 text-[1rem] font-[750]',
  mobileCardActions: 'mt-3 flex justify-end',
  kv: 'm-0 grid gap-1.5',
  kvRow: 'grid grid-cols-[100px_1fr] gap-2 max-[640px]:grid-cols-[82px_1fr]',
  kvTerm: 'text-app-muted',
  drawerLayer: 'fixed inset-0 z-[80] flex justify-end',
  drawerPanel:
    'relative z-[1] grid h-full w-[min(600px,100vw)] grid-rows-[auto_minmax(0,1fr)] border-l border-app-border bg-[color-mix(in_srgb,var(--surface)_94%,var(--surface-soft))] shadow-[-24px_0_60px_rgba(15,23,42,0.22)]',
  drawerBody: 'min-h-0 overflow-y-auto px-5 pb-[22px] pt-[18px]',
  drawerFooter:
    'sticky bottom-0 flex justify-end gap-2.5 border-t border-app-border bg-[color-mix(in_srgb,var(--surface)_94%,transparent)] px-5 py-3.5 shadow-[0_-12px_28px_rgba(15,23,42,0.06)]',
  modalLayer: 'fixed inset-0 z-[80] grid place-items-center bg-[rgba(15,23,42,0.42)] p-4 backdrop-blur-[3px]',
  modalPanel: 'w-full max-w-xl rounded-app-lg border border-app-border bg-app-surface p-6 shadow-app',
  filterBar: 'grid items-center gap-2.5',
  sidebarItem:
    'relative inline-flex min-h-[38px] items-center gap-[9px] rounded-[10px] border border-transparent bg-transparent px-2.5 py-2 text-[0.91rem] font-semibold text-app-muted transition-[background-color,color,transform,border-color] duration-180 hover:translate-x-px hover:border-[color-mix(in_srgb,var(--primary)_16%,var(--border))] hover:bg-[color-mix(in_srgb,var(--primary)_8%,var(--surface-soft))] hover:text-app-text',
};
