# Kaadu · காடு

A field guide to every kind of plant — trees, shrubs, vines and climbers, herbs and small plants, grasses and bamboo, ferns, cacti and succulents, water plants, mosses, palms, conifers and flowering plants — with real photos, in English and Tamil.

- **Library:** 70 well-known plants (many from India and Tamil Nadu) written by hand in `data.js`, each tagged with every growth form it fits. Tamil names in `data-ta.js`.
- **Live data:** iNaturalist (photos, most-recorded species lists with infinite scroll, search, taxon details), Wikipedia and Tamil Wikipedia summaries, Wikidata for Tamil names of other species. No keys needed.
- **Interface text:** `i18n.js` (English and Tamil).
- **Design:** the Kolam design system (`kolam/`), with only the primary colour overridden to forest green.

Plain HTML/CSS/JS, no build step. Run locally:

```
python3 -m http.server 5300
```

and open http://localhost:5300 (or use the `kaadu` launch config).

`tools/resolve-ids.py` looks up the iNaturalist taxon ID for every scientific and group name in `data.js` and writes `ids.js`. Run it after adding plants or groups.
