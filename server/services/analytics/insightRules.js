/**
 * Rule-based insight engine.
 * Each rule receives { current, comparison } analytics data and returns
 * { severity: 'info'|'warning'|'error', title, description, recommendation } or null.
 */

const rules = [
  // CPC increased significantly
  function cpcSpike({ current, comparison }) {
    if (!comparison) return null;
    const currCpc = (current.byPlatform?.metaAds?.cpc || 0) + (current.byPlatform?.googleAds?.cpc || 0);
    const prevCpc = (comparison.byPlatform?.metaAds?.cpc || 0) + (comparison.byPlatform?.googleAds?.cpc || 0);
    if (prevCpc === 0 || currCpc === 0) return null;
    const change = ((currCpc - prevCpc) / prevCpc) * 100;
    if (change <= 30) return null;
    return {
      severity: 'warning',
      title: `CPC increased ${Math.round(change)}%`,
      description: `Average cost per click rose from $${prevCpc.toFixed(2)} to $${currCpc.toFixed(2)}.`,
      recommendation: 'Review ad targeting and quality scores. Consider pausing low-performing ads or adjusting bids.'
    };
  },

  // High missed call rate
  function missedCalls({ current }) {
    const ctm = current.byPlatform?.ctm;
    if (!ctm || ctm.totalCalls < 5) return null;
    const missedRate = ctm.missedCalls / ctm.totalCalls;
    if (missedRate <= 0.2) return null;
    return {
      severity: 'error',
      title: `${Math.round(missedRate * 100)}% of calls are being missed`,
      description: `${ctm.missedCalls} out of ${ctm.totalCalls} calls went unanswered.`,
      recommendation: 'Check office hours and call routing. Consider adding an answering service or adjusting ad scheduling.'
    };
  },

  // Campaign spending with zero conversions
  function zeroConversionCampaigns({ current }) {
    const zeroConv = [];
    for (const camp of current.byPlatform?.metaAds?.campaigns || []) {
      if (camp.spend > 50 && (camp.conversions || 0) === 0) zeroConv.push({ name: camp.name, spend: camp.spend, platform: 'Meta' });
    }
    for (const camp of current.byPlatform?.googleAds?.campaigns || []) {
      if (camp.spend > 50 && (camp.conversions || 0) === 0) zeroConv.push({ name: camp.name, spend: camp.spend, platform: 'Google' });
    }
    if (zeroConv.length === 0) return null;
    const total = zeroConv.reduce((s, c) => s + c.spend, 0);
    return {
      severity: 'error',
      title: `${zeroConv.length} campaign${zeroConv.length > 1 ? 's' : ''} with $${total.toFixed(0)} spend and 0 conversions`,
      description: zeroConv.map(c => `${c.platform}: ${c.name} ($${c.spend.toFixed(0)})`).join('; '),
      recommendation: 'Evaluate these campaigns — consider pausing, adjusting targeting, or reviewing landing pages.'
    };
  },

  // Conversion rate dropped
  function conversionDrop({ current, comparison }) {
    if (!comparison) return null;
    const curr = current.kpis?.conversionRate || 0;
    const prev = comparison.kpis?.conversionRate || 0;
    if (prev === 0 || curr === 0) return null;
    const change = ((curr - prev) / prev) * 100;
    if (change >= -25) return null;
    return {
      severity: 'warning',
      title: `Conversion rate dropped ${Math.abs(Math.round(change))}%`,
      description: `Rate went from ${prev.toFixed(2)}% to ${curr.toFixed(2)}%.`,
      recommendation: 'Check landing page performance, ad relevance, and whether traffic quality changed.'
    };
  },

  // Lead source dried up
  function leadSourceDriedUp({ current, comparison }) {
    if (!comparison) return null;
    const currSources = new Map((current.byPlatform?.ctm?.topSources || []).map(s => [s.source, s.count]));
    const prevSources = comparison.byPlatform?.ctm?.topSources || [];
    const driedUp = prevSources.filter(s => s.count >= 3 && (currSources.get(s.source) || 0) === 0);
    if (driedUp.length === 0) return null;
    return {
      severity: 'info',
      title: `${driedUp.length} lead source${driedUp.length > 1 ? 's' : ''} stopped producing`,
      description: driedUp.map(s => `"${s.source}" had ${s.count} leads, now 0`).join('; '),
      recommendation: 'Investigate whether these channels were paused intentionally or if there is a tracking issue.'
    };
  },

  // High Meta spend with zero platform conversions
  function highSpendLowReturn({ current }) {
    const meta = current.byPlatform?.metaAds;
    if (!meta) return null;
    const totalConv = meta.conversions || 0;
    if (meta.spend > 100 && totalConv === 0) {
      return {
        severity: 'error',
        title: `$${meta.spend.toFixed(0)} Meta spend with 0 platform conversions`,
        description: 'The Meta ad account is spending but not tracking any conversions.',
        recommendation: 'Verify conversion tracking is set up correctly. Check pixel and CAPI configuration.'
      };
    }
    return null;
  },

  // High bounce rate on top landing pages
  function highBounceRate({ current }) {
    const pages = current.byPlatform?.ga4?.topPages || [];
    const highBounce = pages.filter(p => p.sessions >= 20 && p.bounceRate > 0.7);
    if (highBounce.length === 0) return null;
    return {
      severity: 'warning',
      title: `${highBounce.length} landing page${highBounce.length > 1 ? 's' : ''} with >70% bounce rate`,
      description: highBounce.slice(0, 3).map(p => `${p.page} (${(p.bounceRate * 100).toFixed(0)}% bounce, ${p.sessions} sessions)`).join('; '),
      recommendation: 'Review page load speed, mobile experience, and message match with ad copy.'
    };
  },

  // Sessions dropped significantly while spend held steady
  function sessionDrop({ current, comparison }) {
    if (!comparison) return null;
    const currSessions = current.kpis?.totalSessions || 0;
    const prevSessions = comparison.kpis?.totalSessions || 0;
    if (prevSessions < 50) return null;
    const sessionChange = ((currSessions - prevSessions) / prevSessions) * 100;
    const currSpend = current.kpis?.totalSpend || 0;
    const prevSpend = comparison.kpis?.totalSpend || 0;
    const spendChange = prevSpend > 0 ? ((currSpend - prevSpend) / prevSpend) * 100 : 0;
    // Sessions dropped significantly but spend didn't
    if (sessionChange < -30 && spendChange > -10) {
      return {
        severity: 'warning',
        title: `Sessions dropped ${Math.abs(Math.round(sessionChange))}% while spend held steady`,
        description: `Sessions went from ${prevSessions} to ${currSessions}, but ad spend only changed ${spendChange.toFixed(0)}%.`,
        recommendation: 'Check for tracking issues, website downtime, or organic traffic loss. Verify GA4 tag is firing correctly.'
      };
    }
    return null;
  }
];

export function evaluateRules(current, comparison = null) {
  return rules
    .map(rule => {
      try { return rule({ current, comparison }); }
      catch { return null; }
    })
    .filter(Boolean);
}
