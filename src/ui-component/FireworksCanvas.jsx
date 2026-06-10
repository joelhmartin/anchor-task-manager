import { useEffect, useRef } from 'react';

/**
 * Lightweight "particle fireworks" canvas.
 * No external deps; intended for celebratory overlays.
 */
export default function FireworksCanvas({ active = true, style }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const lastBurstRef = useRef(0);
  const particlesRef = useRef([]);

  useEffect(() => {
    if (!active) return undefined;

    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');

    const resize = () => {
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    const rand = (min, max) => Math.random() * (max - min) + min;
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const colors = ['#ff4d6d', '#ffd166', '#06d6a0', '#4dabf7', '#b197fc', '#ff922b'];

    const burst = (x, y) => {
      const count = Math.floor(rand(55, 90));
      const color = pick(colors);
      for (let i = 0; i < count; i++) {
        const a = rand(0, Math.PI * 2);
        const sp = rand(1.5, 5.5);
        particlesRef.current.push({
          x,
          y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: rand(650, 1100),
          born: performance.now(),
          r: rand(1.2, 2.6),
          color
        });
      }
    };

    const step = (t) => {
      // fade previous frame slightly for trails
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

      // periodic bursts
      if (t - lastBurstRef.current > 550) {
        lastBurstRef.current = t;
        burst(rand(window.innerWidth * 0.2, window.innerWidth * 0.8), rand(window.innerHeight * 0.15, window.innerHeight * 0.55));
      }

      const gravity = 0.06;
      const friction = 0.985;
      const next = [];

      for (const p of particlesRef.current) {
        const age = t - p.born;
        if (age > p.life) continue;

        p.vx *= friction;
        p.vy = p.vy * friction + gravity;
        p.x += p.vx;
        p.y += p.vy;

        const alpha = Math.max(0, 1 - age / p.life);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        next.push(p);
      }

      ctx.globalAlpha = 1;
      particlesRef.current = next;
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      particlesRef.current = [];
    };
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        ...style
      }}
    />
  );
}


