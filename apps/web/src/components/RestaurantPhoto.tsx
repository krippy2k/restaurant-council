import { useEffect, useState } from "react";
import { CARD_PHOTO_MAX_WIDTH, photoAlt } from "../restaurant-display";

export function RestaurantPhoto({
  src,
  name,
  className = "",
  sizes,
  width = 800
}: {
  src?: string;
  name: string;
  className?: string;
  sizes?: string;
  width?: number;
}) {
  const [failed, setFailed] = useState(false);
  const [activeSrc, setActiveSrc] = useState(src);

  useEffect(() => {
    setFailed(false);
    setActiveSrc(src);
  }, [src]);

  if (!activeSrc || failed) {
    return (
      <div className={`resto-photo fallback ${className}`}>
        <span>No photo available</span>
      </div>
    );
  }
  return (
    <div className={`resto-photo ${className}`}>
      <img
        src={activeSrc}
        alt={photoAlt(name)}
        loading="lazy"
        decoding="async"
        width={width}
        height={Math.round(width * 0.625)}
        sizes={sizes}
        onError={() => {
          if (src && width > CARD_PHOTO_MAX_WIDTH && activeSrc === src) {
            setActiveSrc(src.replace(/([?&])w=\d+/, `$1w=${CARD_PHOTO_MAX_WIDTH}`));
            return;
          }
          setFailed(true);
        }}
      />
    </div>
  );
}
