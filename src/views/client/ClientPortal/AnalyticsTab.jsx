import AnalyticsDashboard from 'views/admin/AnalyticsDashboard';

const PORTAL_ANALYTICS_TABS = ['overview', 'paid_ads', 'traffic', 'calls_leads'];

export default function AnalyticsTab() {
  return <AnalyticsDashboard scope="portal" allowedTabs={PORTAL_ANALYTICS_TABS} />;
}
