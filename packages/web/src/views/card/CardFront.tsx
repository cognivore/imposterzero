import type { CardTier, CardArtwork } from "./types.js";

interface Props {
  readonly value: number;
  readonly name: string;
  readonly tier: CardTier;
  readonly shortText: string;
  readonly artwork: CardArtwork;
  readonly showContent: boolean;
  readonly alt?: string;
}

export const CardFront: React.FC<Props> = ({
  value,
  name,
  tier,
  shortText,
  artwork,
  showContent,
  alt,
}) => (
  <div className="card-face card-face--front" role="img" aria-label={alt ?? `${name}, value ${value}`}>
    {showContent && artwork.thumb !== null && (
      <img
        className="card-artwork-thumb"
        src={artwork.thumb}
        alt={name}
        loading="lazy"
      />
    )}
    <span className={`card-value card-value--${tier}`}>{value}</span>
    <span className="card-name">{name}</span>
    {showContent && (
      <>
        <div className="card-divider" />
        <span className="card-short-text">{shortText}</span>
      </>
    )}
  </div>
);
