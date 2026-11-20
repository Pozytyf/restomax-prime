import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { haveResetKeysChanged } from '../components/ErrorBoundary.tsx';
import { SKELETON_PRESET_DEFAULTS } from '../components/LoadingSkeletons.tsx';

test('1. ErrorBoundary resetKeys comparison detects route changes accurately', () => {
  assert.equal(haveResetKeysChanged(undefined, undefined), false);
  assert.equal(haveResetKeysChanged(['/app/orders'], ['/app/orders']), false);
  assert.equal(haveResetKeysChanged(['/app/orders'], ['/app/kitchen']), true);
  assert.equal(haveResetKeysChanged(['/app'], ['/app', 'tab2']), true);
  assert.equal(haveResetKeysChanged(undefined, ['/app']), true);
});

test('2. LoadingSkeletons exposes global preset defaults matching data-rich pages', () => {
  assert.equal(SKELETON_PRESET_DEFAULTS.tableRows >= 5, true);
  assert.equal(SKELETON_PRESET_DEFAULTS.kdsColumns, 3);
  assert.equal(SKELETON_PRESET_DEFAULTS.dashboardSummaryCards, 3);
});

test('3. App.tsx wraps application & routes in ErrorBoundary and RouteErrorBoundary', () => {
  const appPath = path.resolve(process.cwd(), 'src/App.tsx');
  const appSrc = fs.readFileSync(appPath, 'utf8');
  assert.equal(appSrc.includes('<ErrorBoundary>'), true);
  assert.equal(appSrc.includes('<RouteErrorBoundary>'), true);
  assert.equal(appSrc.includes('</RouteErrorBoundary>'), true);
  assert.equal(appSrc.includes('</ErrorBoundary>'), true);
});

test('4. Data-rich pages integrate global loading skeletons on initial fetch', () => {
  const files = [
    {
      rel: 'src/restaurant/orders/OrdersPage.tsx',
      token: 'TableSkeleton',
    },
    {
      rel: 'src/restaurant/kitchen/KitchenKdsPage.tsx',
      token: 'KdsBoardSkeleton',
    },
    {
      rel: 'src/restaurant/dashboard/OwnerDashboardPage.tsx',
      token: 'DashboardSkeleton',
    },
    {
      rel: 'src/restaurant/stocks/StocksPage.tsx',
      token: 'TableSkeleton',
    },
    {
      rel: 'src/restaurant/finance/FinanceReportsPage.tsx',
      token: 'CardsGridSkeleton',
    },
  ];

  for (const item of files) {
    const content = fs.readFileSync(path.resolve(process.cwd(), item.rel), 'utf8');
    assert.equal(
      content.includes(item.token),
      true,
      `Expected ${item.token} in ${item.rel}`,
    );
  }
});
