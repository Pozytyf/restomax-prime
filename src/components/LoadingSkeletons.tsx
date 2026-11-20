import { useTranslation } from 'react-i18next';

export const SKELETON_PRESET_DEFAULTS = {
  tableRows: 6,
  tableColumns: 6,
  kdsColumns: 3,
  kdsCardsPerColumn: 2,
  dashboardSummaryCards: 3,
} as const;

export function SkeletonBlock({
  className = '',
}: {
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-lg bg-[var(--rm-surface-muted)] animate-pulse ${className}`}
    />
  );
}

export function TableSkeleton({
  rows = SKELETON_PRESET_DEFAULTS.tableRows,
  columns = SKELETON_PRESET_DEFAULTS.tableColumns,
  showFilterPills = false,
  testId = 'loading-skeleton-table',
}: {
  rows?: number;
  columns?: number;
  showFilterPills?: boolean;
  testId?: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('common.loading')}
      data-testid={testId}
      className="space-y-5"
    >
      <span className="sr-only">{t('common.loading')}</span>

      {showFilterPills && (
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5, 6].map((pill) => (
            <SkeletonBlock key={pill} className="h-9 w-24 rounded-lg" />
          ))}
        </div>
      )}

      <div className="bg-[var(--rm-surface)] rounded-xl border border-[var(--rm-border)] overflow-hidden">
        <div className="bg-[var(--rm-surface-muted)] px-5 py-3.5 border-b border-[var(--rm-border)] grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }).map((_, idx) => (
            <SkeletonBlock
              key={idx}
              className="h-3.5 bg-[var(--rm-border)]/70 rounded"
            />
          ))}
        </div>

        <div className="divide-y divide-[var(--rm-border-subtle)]">
          {Array.from({ length: rows }).map((_, rIdx) => (
            <div
              key={rIdx}
              className="px-5 py-4 grid gap-4 items-center"
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              }}
            >
              {Array.from({ length: columns }).map((__, cIdx) => (
                <SkeletonBlock
                  key={cIdx}
                  className={cIdx === 0 ? 'h-4 w-4/5' : 'h-3.5 w-full'}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function KdsBoardSkeleton({
  columns = SKELETON_PRESET_DEFAULTS.kdsColumns,
  cardsPerColumn = SKELETON_PRESET_DEFAULTS.kdsCardsPerColumn,
  testId = 'loading-skeleton-kds',
}: {
  columns?: number;
  cardsPerColumn?: number;
  testId?: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('common.loading')}
      data-testid={testId}
      className="space-y-5"
    >
      <span className="sr-only">{t('common.loading')}</span>

      {/* Status filter bar skeleton */}
      <div className="bg-[var(--rm-surface)] rounded-xl border border-[var(--rm-border)] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {[1, 2, 3, 4].map((n) => (
            <SkeletonBlock key={n} className="h-8 w-24 rounded-lg" />
          ))}
        </div>
        <div className="flex items-center gap-4">
          {[1, 2, 3].map((n) => (
            <SkeletonBlock key={n} className="h-4 w-20" />
          ))}
        </div>
      </div>

      {/* 3-lane prep-time board skeleton */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
        {Array.from({ length: columns }).map((_, colIdx) => (
          <div
            key={colIdx}
            className="bg-[var(--rm-surface)] rounded-xl border border-[var(--rm-border)] overflow-hidden"
          >
            <SkeletonBlock className="h-1 w-full rounded-none" />
            <div className="px-4 py-3.5 border-b border-[var(--rm-border)] flex items-center justify-between">
              <div className="space-y-2 w-40">
                <SkeletonBlock className="h-4 w-32" />
                <SkeletonBlock className="h-3 w-24" />
              </div>
              <SkeletonBlock className="h-4 w-12" />
            </div>

            <div className="p-4 space-y-3.5">
              {Array.from({ length: cardsPerColumn }).map((__, cardIdx) => (
                <div
                  key={cardIdx}
                  className="bg-[var(--rm-surface-muted)] rounded-xl border border-[var(--rm-border)] p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-2">
                        <SkeletonBlock className="h-4 w-20 bg-[var(--rm-border)]/70" />
                        <SkeletonBlock className="h-5 w-24 bg-[var(--rm-border)]/70" />
                      </div>
                      <SkeletonBlock className="h-3 w-36 bg-[var(--rm-border)]/60" />
                    </div>
                    <SkeletonBlock className="h-4 w-12 bg-[var(--rm-border)]/70" />
                  </div>

                  <div className="space-y-2 pt-1">
                    <SkeletonBlock className="h-3.5 w-full bg-[var(--rm-border)]/60" />
                    <SkeletonBlock className="h-3.5 w-4/5 bg-[var(--rm-border)]/60" />
                  </div>

                  <div className="pt-2 border-t border-[var(--rm-border-subtle)] flex gap-2">
                    <SkeletonBlock className="h-8 w-9 bg-[var(--rm-border)]/70" />
                    <SkeletonBlock className="h-8 flex-1 bg-[var(--rm-border)]/70" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardsGridSkeleton({
  cards = 4,
  columnsClass = 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  cardHeightClass = 'h-28',
  testId = 'loading-skeleton-cards',
}: {
  cards?: number;
  columnsClass?: string;
  cardHeightClass?: string;
  testId?: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('common.loading')}
      data-testid={testId}
      className={`grid ${columnsClass} gap-4`}
    >
      <span className="sr-only">{t('common.loading')}</span>
      {Array.from({ length: cards }).map((_, idx) => (
        <div
          key={idx}
          className={`${cardHeightClass} rounded-xl bg-[var(--rm-surface)] border border-[var(--rm-border)] p-5 flex flex-col justify-between`}
        >
          <SkeletonBlock className="h-3.5 w-1/2" />
          <SkeletonBlock className="h-7 w-2/3" />
          <SkeletonBlock className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton({
  testId = 'loading-skeleton-dashboard',
}: {
  testId?: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('common.loading')}
      data-testid={testId}
      className="space-y-6"
    >
      <span className="sr-only">{t('common.loading')}</span>
      <CardsGridSkeleton
        cards={SKELETON_PRESET_DEFAULTS.dashboardSummaryCards}
        columnsClass="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
        cardHeightClass="h-40"
        testId={`${testId}-summary`}
      />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 h-72 rounded-xl bg-[var(--rm-surface)] border border-[var(--rm-border)] p-5 space-y-4">
          <SkeletonBlock className="h-4 w-44" />
          <SkeletonBlock className="h-52 w-full" />
        </div>
        <div className="lg:col-span-5 h-72 rounded-xl bg-[var(--rm-surface)] border border-[var(--rm-border)] p-5 space-y-3">
          <SkeletonBlock className="h-4 w-40" />
          {[1, 2, 3, 4].map((n) => (
            <SkeletonBlock key={n} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
