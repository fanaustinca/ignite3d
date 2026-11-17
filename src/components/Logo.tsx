export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Ignite3D logo" role="img">
      <defs>
        <linearGradient id="ig-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff8a3d" />
          <stop offset="1" stopColor="#e5520a" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#ig-g)" />
      <g fill="#fff" fillOpacity="0.35">
        <circle cx="13" cy="13" r="3.2" />
        <circle cx="51" cy="13" r="3.2" />
        <circle cx="13" cy="51" r="3.2" />
        <circle cx="51" cy="51" r="3.2" />
      </g>
      <path
        fill="#fff"
        d="M33.5 8c1.6 7.4-3.2 10.6-6.6 15.2-3.4 4.6-6.4 8.6-6.4 15.2C20.5 46.6 26.1 54 32 54s11.5-6.4 11.5-14.8c0-5.4-2.3-9.1-4.6-12.2.2 3.6-1 6.2-3.2 7.3 1.4-8.6-1.2-17.6-2.2-26.3z"
      />
      <circle cx="32" cy="42" r="6" fill="#e5520a" />
      <circle cx="32" cy="42" r="2.6" fill="#fff" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="font-semibold tracking-tight text-[15px]">
      Ignite<span className="text-accent">3D</span>
    </span>
  );
}
