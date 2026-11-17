export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Ignite3D logo" role="img">
      <path
        fill="#ff6a13"
        d="M35 3c2.2 9.8-3.9 14.4-8.5 20.2C21.9 29 17 34.7 17 43.4 17 53.1 23.9 61 32 61s15-6.9 15-16.3c0-6.8-2.9-11.4-5.9-15.3.3 4.6-1.3 7.9-4.1 9.3C38.8 27.7 36.5 14.6 35 3zM32 56.5c-4.3 0-7.5-3.5-7.5-8 0-4.3 2.5-6.9 5.2-10.1.3 3.9 2.1 5.9 4.2 6.6-.6-3.1.1-6 1.6-8.4 1.9 3.3 4 6.4 4 11.4 0 4.8-3.2 8.5-7.5 8.5z"
      />
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
