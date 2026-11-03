import { CSSProperties } from 'react';

export const TEASOO_URL = 'https://teasooconsulting.com';
const LOGO = `${import.meta.env.BASE_URL}brand/`;

/**
 * The Teasoo Consulting logo: dark lettering on light backgrounds, white lettering on dark ones. Both images are in the
 * page and CSS shows the one for the current theme (the system setting, or the portal's data-theme).
 */
export function TeasooLogo({ height = 36 }: { height?: number }) {
  const style = { '--logo-h': `${height}px` } as CSSProperties;
  return (
    <span className="teasoo-logo" style={style}>
      <img className="on-light" src={`${LOGO}teasoo-logo-on-light.png`} alt="Teasoo Consulting" width={Math.round((508 / 160) * height)} height={height} />
      <img className="on-dark" src={`${LOGO}teasoo-logo-on-dark.png`} alt="Teasoo Consulting" width={Math.round((497 / 160) * height)} height={height} />
    </span>
  );
}

/** "Teasoo Consulting", linking to the company's website in a new tab. */
export function TeasooLink() {
  return (
    <a className="teasoo-link" href={TEASOO_URL} target="_blank" rel="noopener noreferrer">
      Teasoo Consulting<span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  );
}
