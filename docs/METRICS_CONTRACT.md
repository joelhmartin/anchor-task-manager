# Analytics Metric Contract

Canonical definitions enforced across the analytics dashboard.

## Metrics

| Metric | Definition | Source |
|--------|-----------|--------|
| Qualified Lead | Call or form with CTM score >= 3 | CTM (source of truth) |
| Total Calls | Inbound phone calls only | CTM API /calls |
| Total Forms | Form submissions via form reactors | Local `call_logs` where activity_type='form' |
| Missed Call | Inbound call with duration=0 or status=no-answer | CTM |
| Ad Spend | Sum of platform spend | Meta + Google Ads (platforms only, not CTM) |
| Cost per Qualified Lead | Ad Spend / Qualified Leads (recomputed from totals) | Aggregated |
| Sessions | GA4 sessions | GA4 Data API |
| Conversion Rate | Qualified Leads / Sessions (recomputed) | Aggregated |
| CTR | Clicks / Impressions (recomputed) | Platform |
| CPC | Spend / Clicks (recomputed) | Platform |
| Bounce Rate | Sessions-weighted average (recomputed) | GA4 |

## Rules

- **Never average percentages** — all rates recomputed from raw numerators
- **Ad platform conversions != Qualified Leads** — shown separately in Paid Ads tab
- **Mixed currencies across clients** — flagged in coverage, Meta spend uses 'MIXED' label
- **Outbound calls** — excluded from intake analytics
- **Form submissions** — live in local `call_logs` (not in CTM /calls API), hybrid fetched

## Group Mode Merge Rules

- Sum raw totals (leads, spend, clicks, impressions, sessions, conversions)
- Recompute rates from totals
- Weight bounce rate, avg session duration, avg call duration by appropriate denominator
- Merge sources/pages by key across clients
- Never merge campaigns by name across clients (campaign name collisions)
