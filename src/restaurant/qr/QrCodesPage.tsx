import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Copy, ExternalLink, Printer, RefreshCw } from 'lucide-react';
import { RestaurantLayout } from '../RestaurantLayout';
import { apiFetch } from '../../services/api';
import { useToast } from '../../components/Toast';
import type { DiningTable } from '../../types';
function printQrCards(tableId?: string) {
  const body = document.body;
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.qr-print-card'));
  const cleanup = () => { delete body.dataset.qrPrintMode; delete body.dataset.qrPrintTable; cards.forEach((card) => card.classList.remove('qr-print-selected')); };
  body.dataset.qrPrintMode = tableId ? 'single' : 'all';
  if (tableId) body.dataset.qrPrintTable = tableId;
  else delete body.dataset.qrPrintTable;
  cards.forEach((card) => card.classList.toggle('qr-print-selected', Boolean(tableId) && card.dataset.qrTableId === tableId));
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
  window.setTimeout(cleanup, 60000);
}


export function QrCodesPage() {
  const { t } = useTranslation();
  const { notify } = useToast();
  const [tables, setTables] = useState<DiningTable[]>([]);

  const load = useCallback(() => {
    apiFetch<{ tables: DiningTable[] }>('/api/restaurant/tables')
      .then((res) => setTables(res.tables))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const regenerate = async (table: DiningTable) => {
    try {
      const res = await apiFetch<{ token: string; version: number }>(
        `/api/restaurant/tables/${table.id}/qr-regenerate`,
        { method: 'POST' },
      );
      notify(
        t('qr.regeneratedToast', { label: table.label, version: res.version }),
        'success',
      );
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : t('menu.errorGeneric'), 'error');
    }
  };

  const copyLink = async (table: DiningTable) => {
    if (!table.qrToken) return;
    const url = `${window.location.origin}/q/${encodeURIComponent(table.qrToken)}`;
    try {
      await navigator.clipboard.writeText(url);
      notify(t('qr.copiedToast', { label: table.label }), 'success');
    } catch {
      notify(url, 'info');
    }
  };

  return (
    <RestaurantLayout
      title={t('pages.qrTitle')}
      onRealtimeEvent={load}
      actions={
        <button
          type="button"
          onClick={() => printQrCards()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#182333] dark:bg-[#223044] hover:bg-[#223044] dark:hover:bg-[#2D4059] dark:border dark:border-[var(--rm-border)] text-white text-xs font-semibold cursor-pointer no-print"
        >
          <Printer className="w-4 h-4" />
          <span>Imprimer tous les chevalets</span>
        </button>
      }
    >
      <div className="space-y-6">
        <div className="bg-[var(--rm-surface)] rounded-xl border border-[var(--rm-border)] p-5 text-sm text-[var(--rm-ink-muted)] no-print">
          {t('qr.introBanner')}
        </div>

        {tables.length === 0 ? (
          <div className="bg-[var(--rm-surface)] rounded-xl border border-[var(--rm-border)] p-10 text-center space-y-3">
            <p className="text-sm font-semibold text-[var(--rm-ink)]">
              {t('qr.emptyTitle')}
            </p>
            <p className="text-xs text-[var(--rm-ink-muted)]">
              {t('qr.emptyDesc')}
            </p>
            <Link
              to="/app/floor"
              className="inline-flex items-center px-4 py-2 rounded-lg bg-[#FF8738] text-white text-xs font-semibold"
            >
              {t('qr.configureTablesBtn')}
            </Link>
          </div>
        ) : (
          <div className="qr-print-scope grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {tables.map((tbl) => (
              <div
                key={tbl.id}
                data-qr-table-id={tbl.id}
                className="qr-print-card bg-[var(--rm-surface)] rounded-xl border border-[var(--rm-border)] p-6 flex flex-col items-center text-center"
              >
                <div className="qr-screen-content flex flex-col items-center w-full">
                <p className="text-xs text-[var(--rm-ink-muted)]">{tbl.zone}</p>
                <h3 className="text-lg font-bold text-[var(--rm-ink)] mt-0.5">
                  {tbl.label}
                </h3>
                <p className="text-[11px] font-mono text-[var(--rm-ink-muted)] mt-1">
                  {t('qr.versionActive', { version: tbl.qrVersion || 1 })}
                </p>

                {tbl.qrToken && (
                  <div className="my-5 p-3 rounded-xl border border-slate-200 bg-white">
                    <img
                      src={`/api/public/qr-image/${encodeURIComponent(tbl.qrToken)}`}
                      alt={`QR Code ${tbl.label}`}
                      className="w-64 h-64"
                    />
                    <p className="mt-2 text-[10px] font-mono text-[#64748B] break-all max-w-[260px]">
                      /q/{tbl.qrToken}
                    </p>
                  </div>
                )}

                </div>
                {tbl.qrToken && (
                  <div className="qr-tent-print" aria-hidden="true">
                    <section className="qr-tent-panel">
                      <p className="qr-tent-brand">RESTO’MAX · MENU</p>
                      <h2>{tbl.label}</h2>
                      <p className="qr-tent-zone">{tbl.zone}</p>
                      <img src={'/api/public/qr-image/' + encodeURIComponent(tbl.qrToken)} alt="" />
                      <p className="qr-tent-instruction">Scannez pour consulter le menu et commander</p>
                    </section>
                    <div className="qr-tent-fold">PLIER ICI</div>
                    <section className="qr-tent-panel qr-tent-panel-back">
                      <p className="qr-tent-brand">RESTO’MAX · MENU</p>
                      <h2>{tbl.label}</h2>
                      <p className="qr-tent-zone">{tbl.zone}</p>
                      <img src={'/api/public/qr-image/' + encodeURIComponent(tbl.qrToken)} alt="" />
                      <p className="qr-tent-instruction">Scannez pour consulter le menu et commander</p>
                    </section>
                  </div>
                )}
                {tbl.qrToken && (
                  <button type="button" onClick={() => printQrCards(tbl.id)}
                    className="no-print w-full mb-2 py-2.5 rounded-lg bg-[#182333] dark:bg-[#223044] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer">
                    <Printer className="w-3.5 h-3.5" />
                    <span>Imprimer ce chevalet uniquement</span>
                  </button>
                )}
                <div className="w-full flex flex-col gap-2 no-print">
                  {tbl.qrToken && (
                    <>
                      <Link
                        to={`/q/${encodeURIComponent(tbl.qrToken)}`}
                        target="_blank"
                        className="w-full py-2 rounded-lg bg-[#FF8738] hover:bg-[#F07322] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>{t('qr.testCustomerFlowBtn')}</span>
                      </Link>
                      <button
                        type="button"
                        onClick={() => copyLink(tbl)}
                        className="w-full py-2 rounded-lg border border-[var(--rm-border)] hover:border-[#FF8738] text-[var(--rm-ink)] hover:bg-[var(--rm-surface-hover)] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>{t('qr.copyMenuLinkBtn')}</span>
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => regenerate(tbl)}
                    className="w-full py-2 rounded-lg border border-[var(--rm-border)] hover:border-[var(--rm-border-input)] text-[var(--rm-ink-muted)] hover:text-[var(--rm-ink)] hover:bg-[var(--rm-surface-hover)] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>{t('qr.regenerateBtn')}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </RestaurantLayout>
  );
}
