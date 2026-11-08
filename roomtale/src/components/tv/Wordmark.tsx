export function Wordmark({ size = 48 }: { size?: number }) {
  return (
    <div className="flex items-center gap-4 text-shadow-tv" style={{ fontSize: size }}>
      <svg viewBox="0 0 48 48" style={{ width: size * 1.1, height: size * 1.1 }} aria-hidden>
        <defs>
          <linearGradient id="rt-book" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#22d3ee" />
            <stop offset="1" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <path d="M6 10c6-3 12-3 18 1v29c-6-4-12-4-18-1z" fill="url(#rt-book)" />
        <path d="M42 10c-6-3-12-3-18 1v29c6-4 12-4 18-1z" fill="url(#rt-book)" opacity="0.75" />
        <circle cx="35" cy="8" r="3" fill="#fbbf24" />
      </svg>
      <span className="font-black tracking-tight">
        Room<span className="text-glow">Tale</span>
      </span>
    </div>
  );
}
