import { useEffect, useRef } from 'react';

/**
 * Hook that returns a ref + sx to wrap any ApexCharts component so it fills
 * its container. Solves two problems:
 *
 * 1. ApexCharts measures its container width at mount time. If the container
 *    hasn't resolved to its final flex/grid width yet, the chart renders at
 *    the wrong size and never updates. A ResizeObserver dispatches window
 *    resize events when the container size changes; react-apexcharts listens
 *    for those and re-layouts the chart.
 *
 * 2. Even after re-layout, ApexCharts sometimes writes an explicit pixel
 *    width to `.apexcharts-canvas` that's smaller than the container. A CSS
 *    override forces the SVG to fill the container regardless.
 *
 * Usage:
 *   const { ref, sx } = useChartContainer();
 *   return <Box ref={ref} sx={sx}><Chart ... width="100%" /></Box>;
 */
export default function useChartContainer() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Initial nudge once layout settles
    const initial = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });

    let timer;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 50);
    });
    observer.observe(el);

    return () => {
      cancelAnimationFrame(initial);
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  return {
    ref,
    sx: {
      width: '100%',
      minWidth: 0,
      '& .apexcharts-canvas': { width: '100% !important', maxWidth: '100% !important' },
      '& .apexcharts-canvas svg': { width: '100% !important' }
    }
  };
}
