PNHS Records — self-hosted typefaces
====================================

Three families, all under the SIL Open Font License 1.1. Each family's licence is beside the
files it covers, verbatim from the upstream project — the OFL requires the licence and the
copyright notice to travel with the font, and these are redistributed from a public URL.

  fraunces-var-latin.woff2      Fraunces (variable, wght 300-800 + optical size)
                                Copyright 2018 The Fraunces Project Authors
                                → OFL-Fraunces.txt

  atkinson-400-latin.woff2      Atkinson Hyperlegible
  atkinson-700-latin.woff2      Copyright 2020 Braille Institute of America, Inc.
                                → OFL-AtkinsonHyperlegible.txt

  plexmono-400-latin.woff2      IBM Plex Mono
  plexmono-500-latin.woff2      Copyright (c) 2017 IBM Corp. with Reserved Font Name "Plex"
  plexmono-600-latin.woff2      → OFL-IBMPlexMono.txt

All six are the Latin subset as served by Google Fonts, 156 KB in total.


Why these are self-hosted rather than linked
--------------------------------------------

The app has to render correctly with no network. That was true when it ran on the registrar's
own PC, and it is true again now that offline is a feature: a service worker precaches these
files (see public/sw.js) so a cached record page renders in the right faces rather than in a
fallback that makes it look broken.

A stylesheet link to a font CDN would defeat that, and would also put a third party on the
request path of a page showing a child's personal data.


Replacing or adding a face
--------------------------

1. Put the .woff2 here and add its @font-face block at the top of app/globals.css.
2. Add the filename to the precache list in public/sw.js, or it will not be there offline.
3. If it is needed for first paint, add it to PRELOAD_FONTS in app/layout.tsx — and only then.
   Preloading a face that is not used immediately delays the ones that are.
4. Ship its licence file here too.
