import type { MetadataRoute } from "next";

/**
 * Installable-app metadata.
 *
 * `display: "standalone"` is the point of it — a registrar who installs this gets a window
 * with no address bar, which is both faster to reach and harder to navigate away from by
 * accident while encoding.
 *
 * No icons are declared. A manifest with a made-up icon is worse than one without: browsers
 * fall back to a screenshot of the page, which is honest, whereas an invented crest on a
 * government record system is a claim the school did not make. Add the real DepEd/school seal
 * here when someone supplies the artwork.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PNHS Records — Learner Permanent Records",
    short_name: "PNHS Records",
    description: "SF10 permanent record system for Pantao National High School",
    start_url: "/",
    display: "standalone",
    background_color: "#eceae4",
    theme_color: "#f8f7f4",
    orientation: "any",
  };
}
