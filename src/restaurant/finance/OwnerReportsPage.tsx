import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, CalendarDays, Download, TrendingUp } from 'lucide-react';
import { RestaurantLayout } from '../RestaurantLayout';
import { apiFetch, getStoredToken } from '../../services/api';
import { formatFcfa } from '../../utils/format';

type DailyRow = { day: string; sales_xof?: number; orders_count?: number; collected_xof?: number; refunded_xof?: number };
type Report = {
  summary: { ordersCount:number; grossSalesXof:number; collectedXof:number; refundsXof:number;
    netCollectedXof:number; discountsXof:number; cancelledCount:number; cancelledXof:number;
    outstandingXof:number; averageTicketXof:number; expensesXof:number };
  dailySales: DailyRow[]; dailyPayments: DailyRow[]; dailyRefunds: DailyRow[];
  byMethod: Array<{method:string;amount_xof:number;count:number}>;
  topItems: Array<{name:string;quantity:number;sales_xof:number}>;
  employees: Array<{user_id:string|null;actor:string;orders_count:number;sales_xof:number;cancelled_count:number}>;
};
type AuditRow = {id:string;actorUserId:string|null;actorEmail:string;actorRole:string;action:string;
  targetType:string;targetId:string;details:string;createdAt:string};
type Mode = 'day'|'week'|'month';

const dateString = (date: Date) => date.toISOString().slice(0,10);
const money = (n: unknown) => formatFcfa(Number(n || 0));
const methodLabel: Record<string,string> = { CASH:'Espèces', WAVE:'Wave', ORANGE_MONEY:'Orange Money', MTN_MOMO:'MTN MoMo', CARD:'Carte' };

function rangeFor(date: string, mode: Mode) {
  const d = new Date(date + 'T00:00:00.000Z');
  if (mode === 'day') return {from:date,to:date};
  if (mode === 'week') {
    const day = (d.getUTCDay()+6)%7;
    const start = new Date(d); start.setUTCDate(d.getUTCDate()-day);
    const end = new Date(start); end.setUTCDate(start.getUTCDate()+6);
    return {from:dateString(start),to:dateString(end)};
  }
  const start = new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1));
  const end = new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0));
  return {from:dateString(start),to:dateString(end)};
}

function Stat({label,value,accent}:{label:string;value:string;accent?:string}) {
  return <div className="rounded-xl border border-[var(--rm-border)] bg-[var(--rm-surface)] p-4 min-w-0">
    <p className="text-xs text-[var(--rm-ink-muted)]">{label}</p>
    <p className={`mt-2 text-xl font-extrabold tabular-nums break-words ${accent||'text-[var(--rm-ink)]'}`}>{value}</p>
  </div>;
}

export function OwnerReportsPage() {
  const [month,setMonth] = useState(() => new Date().toISOString().slice(0,7));
  const [selectedDate,setSelectedDate] = useState(() => dateString(new Date()));
  const [mode,setMode] = useState<Mode>('month');
  const [tab,setTab] = useState<'reports'|'audit'>('reports');
  const [report,setReport] = useState<Report|null>(null);
  const [audit,setAudit] = useState<AuditRow[]>([]);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');

  const calendarRange = useMemo(() => {
    const [y,m] = month.split('-').map(Number);
    return {from:dateString(new Date(Date.UTC(y,m-1,1))),to:dateString(new Date(Date.UTC(y,m,0)))};
  },[month]);
  const activeRange = useMemo(()=>rangeFor(selectedDate,mode),[selectedDate,mode]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const q = (r:{from:string;to:string}) => `from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`;
      const [r,a] = await Promise.all([
        apiFetch<Report>(`/api/restaurant/owner/reports?${q(activeRange)}`),
        apiFetch<{logs:AuditRow[]}>(`/api/restaurant/owner/audit?${q(calendarRange)}&limit=300`),
      ]);
      setReport(r); setAudit(a.logs||[]);
    } catch(e) { setError(e instanceof Error ? e.message : 'Impossible de charger les rapports.'); }
    finally { setLoading(false); }
  },[activeRange,calendarRange]);
  useEffect(()=>{load();},[load]);

  const salesByDay = useMemo(()=>new Map((report?.dailySales||[]).map(r=>[r.day,Number(r.sales_xof||0)])),[report]);
  const cashByDay = useMemo(()=>new Map((report?.dailyPayments||[]).map(r=>[r.day,Number(r.collected_xof||0)])),[report]);
  const refundByDay = useMemo(()=>new Map((report?.dailyRefunds||[]).map(r=>[r.day,Number(r.refunded_xof||0)])),[report]);
  const [year,monthNo] = month.split('-').map(Number);
  const firstWeekday = (new Date(Date.UTC(year,monthNo-1,1)).getUTCDay()+6)%7;
  const daysInMonth = new Date(Date.UTC(year,monthNo,0)).getUTCDate();
  const calendarCells = [...Array(firstWeekday).fill(null),...Array.from({length:daysInMonth},(_,i)=>i+1)];
  while(calendarCells.length%7) calendarCells.push(null);
  const shiftMonth = (delta:number) => {
    const d=new Date(Date.UTC(year,monthNo-1+delta,1)); setMonth(dateString(d).slice(0,7));
  };
  const exportAudit = () => {
    const header=['Date','Auteur','Rôle','Action','Cible','Détails'];
    const rows=audit.map(x=>[x.createdAt,x.actorEmail,x.actorRole,x.action,x.targetType+':'+x.targetId,x.details]);
    const csv=[header,...rows].map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(';')).join('\n');
    const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='journal-activite-restomax.csv';a.click();URL.revokeObjectURL(url);
  };

  return <RestaurantLayout title="Contrôle propriétaire">
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-sm text-[var(--rm-ink-muted)]">Suivi financier détaillé et traçabilité des opérations de l’établissement</p></div>
        <div className="flex gap-2">
          <button onClick={()=>setTab('reports')} className={`px-4 py-2 rounded-lg text-sm font-semibold ${tab==='reports'?'bg-[#182333] text-white':'border border-[var(--rm-border)]'}`}>Recettes & rapports</button>
          <button onClick={()=>setTab('audit')} className={`px-4 py-2 rounded-lg text-sm font-semibold ${tab==='audit'?'bg-[#182333] text-white':'border border-[var(--rm-border)]'}`}>Journal d’activité</button>
        </div>
      </div>
      {error && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 text-red-800 p-3 text-sm">{error}</div>}
      {tab==='reports' ? <>
        <section className="rounded-xl border border-[var(--rm-border)] bg-[var(--rm-surface)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <button aria-label="Mois précédent" onClick={()=>shiftMonth(-1)} className="p-2 rounded-lg border border-[var(--rm-border)]"><ArrowLeft size={16}/></button>
              <strong className="capitalize">{new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(month+'-01T00:00:00Z'))}</strong>
              <button aria-label="Mois suivant" onClick={()=>shiftMonth(1)} className="p-2 rounded-lg border border-[var(--rm-border)]"><ArrowRight size={16}/></button>
            </div>
            <div className="flex gap-1 text-xs">
              {(['day','week','month'] as Mode[]).map(v=><button key={v} onClick={()=>setMode(v)} className={`px-3 py-2 rounded-lg ${mode===v?'bg-teal-700 text-white':'border border-[var(--rm-border)]'}`}>{v==='day'?'Jour':v==='week'?'Semaine':'Mois'}</button>)}
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-[var(--rm-ink-muted)] mb-2">{['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map(d=><div key={d} className="py-2">{d}</div>)}</div>
          <div className="grid grid-cols-7 gap-1">
            {calendarCells.map((day,i)=>{
              if(!day)return <div key={'blank'+i} className="min-h-[82px] rounded-lg bg-[var(--rm-surface-hover)] opacity-30"/>;
              const key=`${month}-${String(day).padStart(2,'0')}`;
              const sales=salesByDay.get(key)||0, cash=cashByDay.get(key)||0, refund=refundByDay.get(key)||0;
              return <button key={key} onClick={()=>{setSelectedDate(key);setMode('day');}} className={`min-h-[82px] p-2 rounded-lg border text-left ${selectedDate===key?'border-teal-600 ring-1 ring-teal-600':'border-[var(--rm-border)]'} ${sales||cash?'bg-teal-50/60 dark:bg-teal-950/20':'bg-[var(--rm-surface)]'}`}>
                <span className="text-xs font-bold">{day}</span>
                <span className="block mt-1 text-[10px] font-semibold text-[var(--rm-ink)] truncate">{sales?money(sales):'—'}</span>
                <span className="block text-[10px] text-teal-700 dark:text-teal-300 truncate">{cash?money(cash):'—'} encaissé</span>
                {refund>0&&<span className="block text-[9px] text-red-600 truncate">-{money(refund)}</span>}
              </button>;
            })}
          </div>
          <p className="mt-3 text-xs text-[var(--rm-ink-muted)]">Montant principal : ventes enregistrées à la date de commande. Ligne verte : encaissements réellement reçus ce jour. Les remboursements sont affichés séparément.</p>
        </section>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-sm font-semibold">Rapport :</span>
          <span className="text-sm text-[var(--rm-ink-muted)]">{activeRange.from} → {activeRange.to}</span>
          <button onClick={load} className="ml-auto px-3 py-2 rounded-lg border border-[var(--rm-border)] text-sm">Actualiser</button>
        </div>
        {loading&&!report ? <p className="p-8 text-center text-sm">Chargement des données…</p> : report && <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <Stat label="Ventes réalisées" value={money(report.summary.grossSalesXof)}/>
            <Stat label="Encaissements reçus" value={money(report.summary.collectedXof)} accent="text-teal-600"/>
            <Stat label="Remboursements" value={money(report.summary.refundsXof)} accent="text-red-600"/>
            <Stat label="Reste à encaisser" value={money(report.summary.outstandingXof)} accent="text-amber-600"/>
            <Stat label="Commandes valides" value={String(report.summary.ordersCount)}/>
            <Stat label="Panier moyen" value={money(report.summary.averageTicketXof)}/>
            <Stat label="Remises accordées" value={money(report.summary.discountsXof)}/>
            <Stat label="Dépenses enregistrées" value={money(report.summary.expensesXof)}/>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <section className="rounded-xl border border-[var(--rm-border)] bg-[var(--rm-surface)] p-4">
              <h3 className="font-bold mb-3 flex items-center gap-2"><TrendingUp size={17}/> Moyens d’encaissement</h3>
              {report.byMethod.length?report.byMethod.map(x=><div key={x.method} className="flex justify-between py-2 border-b border-[var(--rm-border)] text-sm"><span>{methodLabel[x.method]||x.method} <span className="text-[var(--rm-ink-muted)]">({x.count})</span></span><strong>{money(x.amount_xof)}</strong></div>):<p className="text-sm text-[var(--rm-ink-muted)]">Aucun encaissement sur cette période.</p>}
            </section>
            <section className="rounded-xl border border-[var(--rm-border)] bg-[var(--rm-surface)] p-4">
              <h3 className="font-bold mb-3">Articles les plus vendus</h3>
              {report.topItems.length?report.topItems.map(x=><div key={x.name} className="flex justify-between gap-3 py-2 border-b border-[var(--rm-border)] text-sm"><span>{x.name} <span className="text-[var(--rm-ink-muted)]">× {x.quantity}</span></span><strong>{money(x.sales_xof)}</strong></div>):<p className="text-sm text-[var(--rm-ink-muted)]">Aucune vente sur cette période.</p>}
            </section>
            <section className="rounded-xl border border-[var(--rm-border)] bg-[var(--rm-surface)] p-4">
              <h3 className="font-bold mb-3">Activité par employé</h3>
              {report.employees.length?report.employees.map((x,i)=><div key={x.user_id||i} className="flex justify-between gap-3 py-2 border-b border-[var(--rm-border)] text-sm"><span>{x.actor}<span className="block text-xs text-[var(--rm-ink-muted)]">{x.orders_count} commande(s) · {x.cancelled_count} annulation(s)</span></span><strong>{money(x.sales_xof)}</strong></div>):<p className="text-sm text-[var(--rm-ink-muted)]">Aucune activité.</p>}
            </section>
            <section className="rounded-xl border border-[var(--rm-border)] bg-[var(--rm-surface)] p-4">
              <h3 className="font-bold mb-3">Synthèse de contrôle</h3>
              <div className="flex justify-between py-2 text-sm"><span>Annulations</span><strong>{report.summary.cancelledCount} · {money(report.summary.cancelledXof)}</strong></div>
              <div className="flex justify-between py-2 text-sm"><span>Encaissement net (après remboursements)</span><strong>{money(report.summary.netCollectedXof)}</strong></div>
              <div className="flex justify-between py-2 text-sm"><span>Écart ventes / encaissements</span><strong>{money(report.summary.grossSalesXof-report.summary.collectedXof)}</strong></div>
            </section>
          </div>
        </>}
      </> : <section className="rounded-xl border border-[var(--rm-border)] bg-[var(--rm-surface)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div><h3 className="font-bold flex items-center gap-2"><Activity size={17}/> Journal d’activité</h3><p className="text-xs text-[var(--rm-ink-muted)] mt-1">Consultation uniquement · les événements ne peuvent pas être modifiés ou supprimés.</p></div>
          <button onClick={exportAudit} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--rm-border)] text-sm"><Download size={15}/> Exporter CSV</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead><tr className="text-left text-xs text-[var(--rm-ink-muted)] border-b border-[var(--rm-border)]"><th className="py-2 pr-3">Date / heure</th><th className="py-2 pr-3">Auteur</th><th className="py-2 pr-3">Rôle</th><th className="py-2 pr-3">Opération</th><th className="py-2">Détails</th></tr></thead>
            <tbody>{audit.map(row=><tr key={row.id} className="border-b border-[var(--rm-border)] align-top"><td className="py-3 pr-3 whitespace-nowrap">{new Date(row.createdAt).toLocaleString('fr-FR',{timeZone:'Africa/Abidjan'})}</td><td className="py-3 pr-3">{row.actorEmail}</td><td className="py-3 pr-3">{row.actorRole}</td><td className="py-3 pr-3"><span className="font-semibold">{row.action}</span><span className="block text-xs text-[var(--rm-ink-muted)]">{row.targetType} · {row.targetId}</span></td><td className="py-3">{row.details||'—'}</td></tr>)}
            {!audit.length&&<tr><td colSpan={5} className="py-8 text-center text-[var(--rm-ink-muted)]">Aucune activité enregistrée pour ce mois.</td></tr>}</tbody>
          </table>
        </div>
      </section>}
    </div>
  </RestaurantLayout>;
}
