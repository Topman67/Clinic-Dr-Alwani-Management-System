import type { ReactNode } from 'react';

export type MedicineSelectorCategory = 'ALL' | 'MEDICINE' | 'CONTROLLED_MEDICINE' | 'VITAMIN' | 'SUPPLEMENT';

export type MedicineSelectorItem = {
  medicineId: number;
  name: string;
  category?: MedicineSelectorCategory;
  batchNumber?: string | null;
  packaging?: string | null;
  stockUnit?: string | null;
  quantity: number;
  expiryDate: string;
  price?: number | string | null;
  approvalStatus?: string;
};

type MedicineSelectorModalProps<T extends MedicineSelectorItem> = {
  title?: string;
  subtitle: string;
  helperText?: string;
  medicines: T[];
  selectedMedicineId?: number;
  selectedCategory: MedicineSelectorCategory;
  searchQuery: string;
  onCategoryChange: (category: MedicineSelectorCategory) => void;
  onSearchChange: (query: string) => void;
  onSelectMedicine: (medicine: T) => void;
  onClose: () => void;
  pagination?: ReactNode;
};

const CATEGORY_OPTIONS: Array<{ value: MedicineSelectorCategory; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'MEDICINE', label: 'Medicine' },
  { value: 'CONTROLLED_MEDICINE', label: 'Controlled' },
  { value: 'VITAMIN', label: 'Vitamin' },
  { value: 'SUPPLEMENT', label: 'Supplement' },
];

const formatMoney = (value: number | string | null | undefined) => {
  const amount = typeof value === 'string' ? Number(value) : value;
  return typeof amount === 'number' && Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
};

const formatStockUnit = (unit: string | null | undefined, qty?: number) => {
  const normalized = unit || 'unit';
  return qty === 1 ? normalized : `${normalized}s`;
};

const toDateInput = (value: string | null | undefined) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toISOString().slice(0, 10);
};

const getCategoryLabel = (category: MedicineSelectorItem['category']) => {
  if (category === 'CONTROLLED_MEDICINE') return 'Controlled';
  if (category === 'SUPPLEMENT') return 'Supplement';
  if (category === 'VITAMIN') return 'Vitamin';
  return 'Medicine';
};

const getExpiryStatus = (medicine: MedicineSelectorItem) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(medicine.expiryDate);
  expiry.setHours(0, 0, 0, 0);
  const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / 86_400_000);
  if (daysUntilExpiry < 0) return 'EXPIRED' as const;
  if (daysUntilExpiry <= 30) return 'NEAR_EXPIRY' as const;
  return 'OK' as const;
};

const getAvailabilityBadge = (medicine: MedicineSelectorItem) => {
  const expiryStatus = getExpiryStatus(medicine);
  if (expiryStatus === 'EXPIRED') return { label: 'Expired', className: 'medicine-selector-badge is-expired' };
  if (medicine.quantity <= 10) return { label: 'Low Stock', className: 'medicine-selector-badge is-low-stock' };
  if (expiryStatus === 'NEAR_EXPIRY') return { label: 'Near Expiry', className: 'medicine-selector-badge is-near-expiry' };
  return { label: 'Available', className: 'medicine-selector-badge is-available' };
};

export const MedicineSelectorModal = <T extends MedicineSelectorItem>({
  title = 'Select Medicine',
  subtitle,
  helperText = 'Showing approved, in-stock, non-expired items only.',
  medicines,
  selectedMedicineId,
  selectedCategory,
  searchQuery,
  onCategoryChange,
  onSearchChange,
  onSelectMedicine,
  onClose,
  pagination,
}: MedicineSelectorModalProps<T>) => (
  <div className="medicine-picker-modal-layer" role="presentation">
    <button type="button" className="medicine-picker-modal-backdrop" aria-label="Close medicine picker" onClick={onClose} />
    <section className="medicine-picker-modal prescription-select-modal shared-medicine-selector" role="dialog" aria-modal="true" aria-labelledby="medicine-selector-title">
      <div className="medicine-picker-modal-head">
        <div>
          <h3 id="medicine-selector-title">{title}</h3>
          <p className="muted">{subtitle}</p>
        </div>
        <button type="button" className="patient-drawer-close" onClick={onClose}>X</button>
      </div>

      <div className="walkin-picker-body prescription-picker-body">
        <aside className="walkin-picker-categories">
          {CATEGORY_OPTIONS.map((category) => (
            <button
              key={category.value}
              type="button"
              className={selectedCategory === category.value ? 'is-active' : undefined}
              onClick={() => onCategoryChange(category.value)}
            >
              {category.label}
            </button>
          ))}
        </aside>

        <div className="walkin-picker-results">
          <input
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search medicine, category, batch"
            autoFocus
          />
          <p className="medicine-picker-helper">{helperText}</p>

          <div className="walkin-medicine-list prescription-medicine-list">
            {medicines.map((medicine) => {
              const selected = medicine.medicineId === selectedMedicineId;
              const badge = getAvailabilityBadge(medicine);
              const categoryLabel = getCategoryLabel(medicine.category);
              return (
                <article key={medicine.medicineId} className={`prescription-picker-medicine-card medicine-selector-card ${selected ? 'is-selected' : ''}`}>
                  <div className="prescription-picker-medicine-main medicine-selector-main">
                    <div className="prescription-picker-medicine-title medicine-selector-title-row">
                      <strong title={medicine.name}>{medicine.name}</strong>
                      <span className="prescription-picker-category">{categoryLabel}</span>
                    </div>
                    <div className="medicine-selector-meta-row" title={`Available: ${medicine.quantity} ${formatStockUnit(medicine.stockUnit, medicine.quantity)} - Exp ${toDateInput(medicine.expiryDate)} - RM ${formatMoney(medicine.price)} per ${medicine.stockUnit || 'unit'}`}>
                      <span>Available: {medicine.quantity} {formatStockUnit(medicine.stockUnit, medicine.quantity)}</span>
                      <span>Exp {toDateInput(medicine.expiryDate)}</span>
                      <span>RM {formatMoney(medicine.price)} per {medicine.stockUnit || 'unit'}</span>
                    </div>
                    <small title={`${categoryLabel} - Batch ${medicine.batchNumber || '-'}`}>
                      {categoryLabel} - Batch {medicine.batchNumber || '-'}
                    </small>
                  </div>
                  <div className="medicine-selector-actions">
                    <span className={badge.className}>{badge.label}</span>
                    <button
                      type="button"
                      className={selected ? 'btn-secondary' : undefined}
                      onClick={() => onSelectMedicine(medicine)}
                    >
                      {selected ? 'Selected' : 'Add'}
                    </button>
                  </div>
                </article>
              );
            })}
            {medicines.length === 0 && <p className="walkin-empty">No medicine found.</p>}
          </div>
          {pagination}
        </div>
      </div>
    </section>
  </div>
);
