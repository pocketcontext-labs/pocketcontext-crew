import mark from "./assets/brand/favicon.svg?no-inline";
import "./brand.css";

/**
 * The Crew app mark (concept C, the same master as the home-screen icon and
 * favicon) beside the locally bundled IBM Plex "PocketContext" family wordmark.
 */
export default function Brand({ href }: { href?: string }) {
  const content = <><img className="crew-mark" src={mark} width="34" height="34" alt="Crew" /><span>PocketContext</span></>;
  return href ? <a className="product-brand" href={href}>{content}</a> : <div className="product-brand">{content}</div>;
}
