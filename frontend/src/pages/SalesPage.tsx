import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { subscribeInAppDataSync } from '../lib/sync';
import { usePagination } from '../lib/pagination';
import { roleBasePath } from '../config/rbac';
import { DateRangeFilter } from '../components/DateRangeFilter';
import { getDateRangeForPreset, type DateRangeValue } from '../lib/dateRange';
import { Pagination } from '../components/Pagination';
import { exportReceiptPdf } from '../lib/exportDocuments';
import clinicLogo from '../assets/Logo_Clinic_Dr.Alwani.png';
import PageHeader from '../components/common/PageHeader';

type SaleType = 'CONSULTATION' | 'APPOINTMENT' | 'MEDICAL_CHECKUP' | 'MEDICINE';

const SALE_TYPE_OPTIONS: Array<{ value: SaleType; label: string }> = [
  { value: 'CONSULTATION', label: 'Consultation Fee' },
  { value: 'APPOINTMENT', label: 'Appointment' },
  { value: 'MEDICAL_CHECKUP', label: 'Medical Checkup' },
  { value: 'MEDICINE', label: 'Walk-in Medicine' },
];

type WalkInSale = {
  paymentId: number;
  date: string;
  type: SaleType;
  status: 'PENDING_PAYMENT' | 'PAID' | 'PENDING_DISPENSE' | 'DISPENSED' | 'CANCELLED';
  paymentStatus?: 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED';
  dispenseStatus?: 'NOT_REQUIRED' | 'PENDING_DISPENSE' | 'DISPENSED';
  displayStatus?: string;
  paymentMethod: 'CASH' | 'CARD' | 'ONLINE_TRANSFER' | 'E_WALLET' | 'QR';
  amount: number | string;
  dispensedAt?: string | null;
  dispensedById?: number | null;
  dispensedByUsername?: string | null;
  patient?: {
    patientId: number;
    name: string;
    icOrPassport: string;
    phone: string;
  };
  medicineItems: Array<{
    itemId: number;
    qty: number;
    unitPrice?: number | string;
    subtotal: number | string;
    medicine?: {
      medicineId: number;
      name: string;
      batchNumber: string;
      packaging?: string | null;
      stockUnit?: string;
      quantity: number;
    };
  }>;
  receipt?: {
    receiptNo: string;
    totalAmount: number | string;
  } | null;
};

const formatMoney = (value: number | string) => {
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
};

const prettifyMethod = (method: WalkInSale['paymentMethod']) => {
  if (method === 'ONLINE_TRANSFER') return 'Online Transfer';
  if (method === 'E_WALLET') return 'E-Wallet';
  if (method === 'QR') return 'QR';
  return method.charAt(0) + method.slice(1).toLowerCase();
};

type PaymentWorkflowStatus = NonNullable<WalkInSale['paymentStatus']>;
type DispenseWorkflowStatus = NonNullable<WalkInSale['dispenseStatus']>;

const getPaymentStatus = (sale: WalkInSale): PaymentWorkflowStatus => {
  if (sale.paymentStatus) return sale.paymentStatus;
  if (sale.status === 'CANCELLED') return 'CANCELLED';
  if (sale.status === 'PAID' || sale.status === 'PENDING_DISPENSE' || sale.status === 'DISPENSED') return 'PAID';
  return 'PENDING_PAYMENT';
};

const getDispenseStatus = (sale: WalkInSale): DispenseWorkflowStatus => {
  if (sale.dispenseStatus) return sale.dispenseStatus;
  if (sale.type !== 'MEDICINE') return 'NOT_REQUIRED';
  if (sale.status === 'DISPENSED') return 'DISPENSED';
  if (sale.status === 'PENDING_DISPENSE') return 'PENDING_DISPENSE';
  return 'NOT_REQUIRED';
};

const paymentStatusLabel = (status: PaymentWorkflowStatus) => {
  if (status === 'PENDING_PAYMENT') return 'Pending Payment';
  if (status === 'CANCELLED') return 'Cancelled';
  return 'Paid';
};

const formatStockUnit = (unit: string | null | undefined, qty?: number) => {
  const normalized = unit || 'unit';
  return qty === 1 ? normalized : `${normalized}s`;
};

const dispenseStatusLabel = (status: DispenseWorkflowStatus) => {
  if (status === 'PENDING_DISPENSE') return 'Pending Dispense';
  if (status === 'DISPENSED') return 'Dispensed';
  return 'Not Required';
};

const paymentStatusClass = (status: PaymentWorkflowStatus) => {
  if (status === 'PAID') return 'status-paid';
  if (status === 'CANCELLED') return 'status-critical';
  return 'status-warning';
};

const dispenseStatusClass = (status: DispenseWorkflowStatus) => {
  if (status === 'DISPENSED') return 'status-good';
  if (status === 'PENDING_DISPENSE') return 'status-pending-dispense';
  return 'status-neutral';
};

const getSaleQuantity = (sale: WalkInSale) => {
  return sale.medicineItems.reduce((sum, item) => sum + item.qty, 0);
};

const getSaleTotal = (sale: WalkInSale) => {
  return Number(sale.receipt?.totalAmount ?? sale.amount);
};

const getSaleDateParts = (value: string) => {
  const date = new Date(value);
  return {
    date: date.toLocaleDateString(),
    time: date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  };
};

const getSaleItemTitle = (sale: WalkInSale) => {
  const firstItem = sale.medicineItems[0];
  const firstName = firstItem?.medicine?.name ?? (sale.type === 'MEDICINE' ? 'Medicine sale' : SALE_TYPE_OPTIONS.find((option) => option.value === sale.type)?.label ?? 'Sale');
  const extraCount = Math.max(0, sale.medicineItems.length - 1);
  return extraCount > 0 ? `${firstName} + ${extraCount} more` : firstName;
};

const getApiErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === 'object' && error !== null) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    const message = response?.data?.message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  return fallback;
};

export const SalesPage = () => {
  const { role } = useAuth();
  const isReceptionist = role === 'RECEPTIONIST';
  const isPharmacist = role === 'PHARMACIST';
  const navigate = useNavigate();

  const [sales, setSales] = useState<WalkInSale[]>([]);
  const [selectedSale, setSelectedSale] = useState<WalkInSale | null>(null);
  const [dispenseSale, setDispenseSale] = useState<WalkInSale | null>(null);
  const [dispensingId, setDispensingId] = useState<number | null>(null);
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => getDateRangeForPreset('today'));
  const [queryCustomerId, setQueryCustomerId] = useState('');
  const [queryType, setQueryType] = useState<SaleType | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openActionMenuId, setOpenActionMenuId] = useState<number | null>(null);

  const loadSales = useCallback(async (filters?: { dateFrom?: string; dateTo?: string; customerId?: string; type?: SaleType }) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/payments/sales', {
        params: {
          dateFrom: filters?.dateFrom || undefined,
          dateTo: filters?.dateTo || undefined,
          customerId: filters?.customerId || undefined,
          type: filters?.type || undefined,
        },
      });
      setSales(response.data as WalkInSale[]);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load sales data'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSales({
      dateFrom: dateRange.dateFrom || undefined,
      dateTo: dateRange.dateTo || undefined,
      customerId: queryCustomerId.trim() || undefined,
      type: queryType || undefined,
    });
  }, [dateRange.dateFrom, dateRange.dateTo, loadSales, queryCustomerId, queryType]);

  useEffect(() => {
    return subscribeInAppDataSync(() => {
      void loadSales({
        dateFrom: dateRange.dateFrom || undefined,
        dateTo: dateRange.dateTo || undefined,
        customerId: queryCustomerId.trim() || undefined,
        type: queryType || undefined,
      });
    });
  }, [dateRange.dateFrom, dateRange.dateTo, loadSales, queryCustomerId, queryType]);

  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.sales-action-menu')) return;
      setOpenActionMenuId(null);
    };

    document.addEventListener('mousedown', closeMenu);
    return () => document.removeEventListener('mousedown', closeMenu);
  }, []);

  const onSearch = async (e: FormEvent) => {
    e.preventDefault();
    await loadSales({
      dateFrom: dateRange.dateFrom || undefined,
      dateTo: dateRange.dateTo || undefined,
      customerId: queryCustomerId.trim() || undefined,
      type: queryType || undefined,
    });
  };

  const totalQuantity = useMemo(
    () => sales.reduce((sum, sale) => sum + getSaleQuantity(sale), 0),
    [sales],
  );

  const {
    page: listPage,
    setPage: setListPage,
    totalPages: listTotalPages,
    paginated: paginatedSales,
  } = usePagination(sales, 10, [dateRange.dateFrom, dateRange.dateTo, queryCustomerId, queryType]);

  const basePath = role ? roleBasePath[role] : '/';

  const onDispenseSale = async () => {
    if (!dispenseSale || !isPharmacist) return;
    setDispensingId(dispenseSale.paymentId);
    setError(null);
    try {
      const response = await api.post(`/payments/${dispenseSale.paymentId}/dispense`);
      const updated = response.data as WalkInSale;
      setSales((current) => current.map((sale) => (sale.paymentId === updated.paymentId ? updated : sale)));
      setSelectedSale((current) => (current?.paymentId === updated.paymentId ? updated : current));
      setDispenseSale(null);
      await loadSales({
        dateFrom: dateRange.dateFrom || undefined,
        dateTo: dateRange.dateTo || undefined,
        customerId: queryCustomerId.trim() || undefined,
        type: queryType || undefined,
      });
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to dispense sale'));
    } finally {
      setDispensingId(null);
    }
  };

  const exportSaleReceipt = (sale: WalkInSale) => {
    exportReceiptPdf({
      filename: `receipt-${sale.receipt?.receiptNo ?? sale.paymentId}`,
      logoUrl: clinicLogo,
      clinicName: 'Clinic Dr Alwani',
      receiptNo: sale.receipt?.receiptNo ?? '-',
      patientDetails: [
        { label: 'Patient / Customer', value: sale.patient?.name || 'Walk-in Customer' },
        { label: 'IC / Identity Card', value: sale.patient?.icOrPassport || '-' },
        { label: 'Phone Number', value: sale.patient?.phone || '-' },
      ],
      paymentDetails: [
        { label: 'Payment Date', value: new Date(sale.date).toLocaleString() },
        { label: 'Payment Method', value: prettifyMethod(sale.paymentMethod) },
        { label: 'Payment Type', value: SALE_TYPE_OPTIONS.find((option) => option.value === sale.type)?.label ?? sale.type },
        { label: 'Payment Status', value: paymentStatusLabel(getPaymentStatus(sale)) },
        ...(sale.type === 'MEDICINE' ? [{ label: 'Dispense Status', value: dispenseStatusLabel(getDispenseStatus(sale)) }] : []),
      ],
      medicineItems: sale.medicineItems.map((item) => ({
        Medicine: item.medicine?.name ?? `Medicine #${item.medicine?.medicineId ?? ''}`,
        Batch: item.medicine?.batchNumber ?? '-',
        Quantity: `${item.qty} ${formatStockUnit(item.medicine?.stockUnit, item.qty)}`,
        'Price Per Unit': `RM ${formatMoney(item.unitPrice ?? Number(item.subtotal) / Math.max(1, item.qty))}`,
        Subtotal: `RM ${formatMoney(item.subtotal)}`,
      })),
      breakdown: [
        { label: sale.type === 'CONSULTATION' ? 'Consultation Fee' : sale.type === 'APPOINTMENT' ? 'Appointment' : sale.type === 'MEDICAL_CHECKUP' ? 'Medical Checkup' : 'Medicine Total', value: `RM ${formatMoney(sale.receipt?.totalAmount ?? sale.amount)}` },
      ],
      grandTotal: formatMoney(sale.receipt?.totalAmount ?? sale.amount),
      paidStatus: paymentStatusLabel(getPaymentStatus(sale)),
      footerNote: 'Thank you for your payment. Please keep this receipt for your records.',
    });
  };

  const renderSaleActionMenu = (sale: WalkInSale) => {
    const isOpen = openActionMenuId === sale.paymentId;

    return (
      <div className={`action-menu sales-action-menu ${isOpen ? 'action-menu--open' : ''}`}>
        <button
          type="button"
          className="action-menu__trigger sales-action-trigger"
          aria-label={`Open actions for sale ${sale.paymentId}`}
          aria-expanded={isOpen}
          onClick={() => setOpenActionMenuId((current) => (current === sale.paymentId ? null : sale.paymentId))}
        >
          ...
        </button>
        {isOpen && (
          <div className="action-menu__panel sales-action-panel">
            <button
              type="button"
              className="action-menu__item"
              onClick={() => {
                setSelectedSale(sale);
                setOpenActionMenuId(null);
              }}
            >
              View Details
            </button>
            <button
              type="button"
              className="action-menu__item"
              onClick={() => {
                exportSaleReceipt(sale);
                setOpenActionMenuId(null);
              }}
            >
              Export PDF Receipt
            </button>
            {isPharmacist && sale.type === 'MEDICINE' && getDispenseStatus(sale) === 'PENDING_DISPENSE' && (
              <button
                type="button"
                className="action-menu__item"
                onClick={() => {
                  setDispenseSale(sale);
                  setOpenActionMenuId(null);
                }}
                disabled={dispensingId === sale.paymentId}
              >
                Dispense
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="sales-page">
      <PageHeader
        eyebrow="Sales Management"
        title="Sales"
        subtitle={
          isReceptionist
            ? 'Create sales, handle payment, and review all standard and walk-in sales.'
            : 'View walk-in medicine sales, paid transactions, and dispensing records.'
        }
      />

      <form onSubmit={onSearch} className="filter-card filters-grid">
        <input
          value={queryCustomerId}
          onChange={(e) => setQueryCustomerId(e.target.value)}
          placeholder="Search customer, receipt, medicine..."
        />
        <select value={queryType} onChange={(e) => setQueryType((e.target.value as SaleType) || '')}>
          <option value="">All Types</option>
          {SALE_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <DateRangeFilter value={dateRange} onChange={setDateRange} includeAll />
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => {
            const today = getDateRangeForPreset('today');
            setDateRange(today);
            setQueryCustomerId('');
            setQueryType('');
            void loadSales({ dateFrom: today.dateFrom, dateTo: today.dateTo });
          }}
        >
          Reset
        </button>
        <button type="submit" className="btn btn-secondary">Search</button>
      </form>

      <div className="stats-row" style={{ marginTop: 12 }}>
        <div className="stat-chip">Walk-in purchases: {sales.filter((sale) => sale.type === 'MEDICINE').length}</div>
        <div className="stat-chip">Standard payments: {sales.filter((sale) => sale.type !== 'MEDICINE').length}</div>
        <div className="stat-chip">Items sold (qty): {totalQuantity}</div>
      </div>

      {isReceptionist && (
        <div className="action-row" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-primary" onClick={() => navigate(`${basePath}/payments`)}>
            Create Sale & Handle Payment
          </button>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading...</p>}

      <div className="table-wrap table-card sales-table-wrap" style={{ marginTop: 12 }}>
        <table className="data-table sales-table">
          <colgroup>
            <col className="sales-col-date" />
            <col className="sales-col-customer" />
            <col className="sales-col-details" />
            <col className="sales-col-receipt" />
            <col className="sales-col-status" />
            <col className="sales-col-action" />
          </colgroup>
          <thead>
            <tr>
              <th>Date</th>
              <th>Customer</th>
              <th>Sale Details</th>
              <th>Receipt</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {paginatedSales.map((sale) => {
              const qty = getSaleQuantity(sale);
              const saleDate = getSaleDateParts(sale.date);

              return (
                <tr key={`sale-${sale.paymentId}`}>
                  <td className="sales-date-cell">
                    <span>{saleDate.date}</span>
                    <small>{saleDate.time}</small>
                  </td>
                  <td className="sales-customer-cell">
                    <strong>{sale.patient?.name || '-'}</strong>
                    <small>{sale.patient?.icOrPassport || sale.patient?.phone || '-'}</small>
                  </td>
                  <td className="sales-detail-cell">
                    <strong>{getSaleItemTitle(sale)}</strong>
                    <small>Qty: {qty || '-'} - RM {formatMoney(getSaleTotal(sale))} - {prettifyMethod(sale.paymentMethod)}</small>
                  </td>
                  <td className="sales-receipt-cell">{sale.receipt?.receiptNo || '-'}</td>
                  <td className="sales-status-cell">
                    <div>
                      <span>Payment:</span>
                      <span className={`status-badge ${paymentStatusClass(getPaymentStatus(sale))}`}>{paymentStatusLabel(getPaymentStatus(sale))}</span>
                    </div>
                    <div>
                      <span>Dispense:</span>
                      <span className={`status-badge ${dispenseStatusClass(getDispenseStatus(sale))}`}>{dispenseStatusLabel(getDispenseStatus(sale))}</span>
                    </div>
                  </td>
                  <td className="sales-action-cell">{renderSaleActionMenu(sale)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mobile-cards sales-mobile-cards">
        {paginatedSales.map((sale) => {
          const qty = getSaleQuantity(sale);
          const saleDate = getSaleDateParts(sale.date);

          return (
            <article key={`sale-card-${sale.paymentId}`} className="mobile-card sales-mobile-card">
              <div className="sales-mobile-card-head">
                <div>
                  <h4>{sale.patient?.name || '-'}</h4>
                  <p className="muted">{saleDate.date} - {saleDate.time}</p>
                </div>
                {renderSaleActionMenu(sale)}
              </div>
              <dl className="kv">
                <div><dt>IC / ID</dt><dd>{sale.patient?.icOrPassport || sale.patient?.phone || '-'}</dd></div>
                <div><dt>Sale</dt><dd>{getSaleItemTitle(sale)}</dd></div>
                <div><dt>Details</dt><dd>Qty: {qty || '-'} - RM {formatMoney(getSaleTotal(sale))} - {prettifyMethod(sale.paymentMethod)}</dd></div>
                <div><dt>Receipt</dt><dd className="sales-receipt-text">{sale.receipt?.receiptNo || '-'}</dd></div>
                <div><dt>Payment</dt><dd><span className={`status-badge ${paymentStatusClass(getPaymentStatus(sale))}`}>{paymentStatusLabel(getPaymentStatus(sale))}</span></dd></div>
                <div><dt>Dispense</dt><dd><span className={`status-badge ${dispenseStatusClass(getDispenseStatus(sale))}`}>{dispenseStatusLabel(getDispenseStatus(sale))}</span></dd></div>
                <div><dt>Dispensed</dt><dd>{sale.dispensedAt ? new Date(sale.dispensedAt).toLocaleString() : '-'}</dd></div>
              </dl>
            </article>
          );
        })}
      </div>

      <Pagination page={listPage} totalPages={listTotalPages} onPageChange={setListPage} />

      {!loading && sales.length === 0 && <p className="muted">No sales found for current filters.</p>}

      {selectedSale && (
        <section className="card sales-detail-panel">
          <div className="sales-detail-head">
            <div>
              <h3>Sale Details</h3>
              <p className="muted">Sale #{selectedSale.paymentId} processed successfully.</p>
            </div>
            <div className="action-row">
              <span className={`status-badge ${paymentStatusClass(getPaymentStatus(selectedSale))}`}>{paymentStatusLabel(getPaymentStatus(selectedSale))}</span>
              <span className={`status-badge ${dispenseStatusClass(getDispenseStatus(selectedSale))}`}>{dispenseStatusLabel(getDispenseStatus(selectedSale))}</span>
            </div>
          </div>

          <div className="sales-detail-grid">
            <section className="sales-detail-card sales-detail-wide">
              <div className="sales-summary-strip">
                <div><span>Receipt Number</span><strong>{selectedSale.receipt?.receiptNo || '-'}</strong></div>
                <div><span>Payment Date</span><strong>{new Date(selectedSale.date).toLocaleString()}</strong></div>
                <div><span>Total</span><strong>RM {formatMoney(selectedSale.receipt?.totalAmount ?? selectedSale.amount)}</strong></div>
              </div>
              <div className="sales-detail-actions">
                <button type="button" className="btn-secondary" onClick={() => exportSaleReceipt(selectedSale)}>Export PDF Receipt</button>
                <button type="button" className="btn-secondary" onClick={() => setSelectedSale(null)}>Close</button>
              </div>
            </section>

            <section className="sales-detail-card">
              <h4>Customer Information</h4>
              <dl className="sales-detail-kv">
                <div><dt>Customer Name</dt><dd>{selectedSale.patient?.name || '-'}</dd></div>
                <div><dt>Phone Number</dt><dd>{selectedSale.patient?.phone || 'Not provided'}</dd></div>
                <div><dt>IC / Identity Card</dt><dd>{selectedSale.patient?.icOrPassport || '-'}</dd></div>
                <div><dt>Payment Method</dt><dd>{prettifyMethod(selectedSale.paymentMethod)}</dd></div>
              </dl>
            </section>

            <section className="sales-detail-card">
              <h4>Dispense Information</h4>
              <dl className="sales-detail-kv">
                <div><dt>Payment Status</dt><dd><span className={`status-badge ${paymentStatusClass(getPaymentStatus(selectedSale))}`}>{paymentStatusLabel(getPaymentStatus(selectedSale))}</span></dd></div>
                <div><dt>Dispense Status</dt><dd><span className={`status-badge ${dispenseStatusClass(getDispenseStatus(selectedSale))}`}>{dispenseStatusLabel(getDispenseStatus(selectedSale))}</span></dd></div>
                <div><dt>Dispensed By</dt><dd>{selectedSale.dispensedByUsername || '-'}</dd></div>
                <div><dt>Dispensed At</dt><dd>{selectedSale.dispensedAt ? new Date(selectedSale.dispensedAt).toLocaleString() : '-'}</dd></div>
              </dl>
              {isPharmacist && selectedSale.type === 'MEDICINE' && getDispenseStatus(selectedSale) === 'PENDING_DISPENSE' && (
                <button type="button" onClick={() => setDispenseSale(selectedSale)} disabled={dispensingId === selectedSale.paymentId}>Dispense Medicine</button>
              )}
            </section>

            <section className="sales-detail-card sales-detail-wide">
              <h4>Medicine Items</h4>
              {selectedSale.medicineItems.length > 0 ? (
                <>
                  <div className="table-wrap sales-detail-table-wrap">
                    <table className="data-table sales-detail-table">
                      <thead>
                        <tr>
                          <th>Medicine Name</th>
                          <th>Batch</th>
                          <th>Quantity</th>
                          <th>Price Per Unit</th>
                          <th>Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSale.medicineItems.map((item) => (
                          <tr key={`sale-item-${item.itemId}`}>
                            <td>
                              <strong>{item.medicine?.name ?? `Medicine #${item.medicine?.medicineId ?? ''}`}</strong>
                              <small>{item.medicine?.packaging ? `Packaging: ${item.medicine.packaging}` : ''}</small>
                            </td>
                            <td>{item.medicine?.batchNumber ?? '-'}</td>
                            <td>{item.qty} {formatStockUnit(item.medicine?.stockUnit, item.qty)}</td>
                            <td>RM {formatMoney(item.unitPrice ?? Number(item.subtotal) / Math.max(1, item.qty))} / {item.medicine?.stockUnit ?? 'unit'}</td>
                            <td>RM {formatMoney(item.subtotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="sales-grand-total">
                    <span>Medicine Total</span>
                    <strong>RM {formatMoney(selectedSale.medicineItems.reduce((sum, item) => sum + Number(item.subtotal), 0))}</strong>
                  </div>
                </>
              ) : (
                <p className="muted">No medicine items for this payment.</p>
              )}
            </section>
          </div>
        </section>
      )}

      {dispenseSale && (
        <div className="inventory-modal-layer" role="presentation">
          <button type="button" className="inventory-modal-backdrop" aria-label="Cancel dispense" onClick={() => setDispenseSale(null)} disabled={Boolean(dispensingId)} />
          <section className="inventory-modal inventory-reject-modal" role="dialog" aria-modal="true" aria-labelledby="dispense-sale-title">
            <div className="inventory-modal-head">
              <div>
                <h3 id="dispense-sale-title">Dispense Sale #{dispenseSale.paymentId}</h3>
                <p className="muted">{dispenseSale.patient?.name || 'Walk-in Customer'} - {dispenseSale.receipt?.receiptNo || '-'}</p>
              </div>
              <button type="button" className="patient-drawer-close" onClick={() => setDispenseSale(null)} disabled={Boolean(dispensingId)}>X</button>
            </div>
            <div className="inventory-modal-body">
              <p className="muted">Confirm medicines have been checked and are ready to hand to the customer. Inventory stock will be deducted now.</p>
            </div>
            <div className="inventory-modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setDispenseSale(null)} disabled={Boolean(dispensingId)}>Cancel</button>
              <button type="button" onClick={() => void onDispenseSale()} disabled={Boolean(dispensingId)}>
                {dispensingId ? 'Dispensing...' : 'Confirm Dispense'}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
};
