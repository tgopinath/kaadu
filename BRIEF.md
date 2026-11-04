# Kaadu (காடு) — brief

**Pitch:** a field guide to every kind of plant, grouped the way people actually see plants — trees, shrubs, vines, herbs, grasses, ferns, succulents, water plants, mosses, palms, conifers, flowering plants — with real photos, in English and Tamil.

## Problem
Plant apps are built for identification (point the camera, get a name) or for botanists (taxonomy trees). Neither answers the curious question "what kinds of plants are there, and what is that one by the temple tank?" People in Tamil Nadu also know plants by Tamil names (vembu, arasamaram, vetrilai) that English apps don't show.

## User
Curious adults, students and families in India, especially Tamil Nadu; teachers who want a quick, trustworthy reference with real photos.

## Jobs to be done
- Browse plants by the form they recognise (a climber, a palm, a water plant) rather than by family.
- Look up a plant by English, Tamil or scientific name and see what it is, how big it grows, where it grows and what it is used for.
- Move through a set of plants quickly (swipe) the way you flip a field guide.
- Trust where the information came from.

## v1 screens
1. **Discover** — plant of the day, suggested searches, growth-form chips with plant photos, the curated library (filtered by chip), and a live infinite list of the most-recorded plants from iNaturalist (In India / Worldwide).
2. **Plant types** — every growth form with a photo, a one-line definition and its library count.
3. **Group** — the same list page, filtered to one growth form.
4. **Plant page** — photo gallery with credits, English / Tamil / scientific name, growth-form links, fact tiles (family, height, habitat, native range, uses, iNaturalist record count), hand-written description, Wikipedia (or Tamil Wikipedia) summary, sources; previous/next by swipe or arrow keys.
5. **Search** (text only) and **Saved**.

## Data sources (all keyless)
- iNaturalist API: photos, species lists (`/observations/species_counts`, place 6681 = India), taxon details, search.
- Wikipedia REST summaries (English and Tamil), langlinks to find the Tamil article.
- Wikidata SPARQL (P3151 = iNaturalist taxon ID) for Tamil names of live species.
- Curated library: 70 plants written by hand in `data.js`, Tamil names in `data-ta.js`.

## Design
Kolam design system (Lato, 8-point grid, WCAG AA, light/dark/contrast), primary family overridden to forest green. Editorial field-guide look like Zoorassic Park; line icons including a growth-form icon set; no emoji chrome.
Patterns taken (structure only) from AI element libraries: prompt suggestions (prompt-kit / assistant-ui welcome suggestions) as the "Try" chips; sources / inline citations (AI Elements) as the plant page's numbered Sources list; shimmer loaders (AI Elements) as skeleton cards.

## Success criteria
- Every growth-form chip shows its library plants and a live list that scrolls without a "Load more" button.
- Search finds library plants by English, Tamil, scientific or family name, plus live iNaturalist results.
- The whole interface switches to Tamil; plant names switch where a Tamil name exists.
- Works at 375 px, in dark mode, by keyboard and with a screen reader; no console errors.

## Out of scope (v1)
Photo identification, voice search, sign-in, maps, care guides, Tamil translations of the long descriptions (Tamil Wikipedia is used instead), APK/iOS shells (later, via build-remote.sh).
