const PhoneIcon: React.FC = () => (
  <svg
    className="landscape-overlay__icon"
    viewBox="0 0 64 64"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="18" y="8" width="28" height="48" rx="4" />
    <line x1="32" y1="48" x2="32" y2="48.01" strokeWidth="3" />
  </svg>
);

export const LandscapeOverlay: React.FC = () => (
  <div className="landscape-overlay">
    <PhoneIcon />
    <h2 className="landscape-overlay__title">Rotate Your Device</h2>
    <p className="landscape-overlay__text">
      Imposter Kings is designed for landscape orientation.
      Please rotate your device to continue playing.
    </p>
  </div>
);
