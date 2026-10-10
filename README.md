# build.wyspa.tech

Instant budgetary quotes for composite parts (flat panels, drone rotors, molded parts), followed by Wyspa engineering review and fabrication by partner builders. Static site served by GitHub Pages, styled to match gov.wyspa.tech.

- `index.html`: the page and quote logic
- `pricing.js`: every rate, fee, quantity break and lead time. **Edit this file to change prices.** Method: labor hours × $169/hr + materials × 2, with conservative hour and material estimates. Volume discounts apply to labor only.

Quote requests go out by email (mailto to casey@wyspa.tech) with a reference ID like `WB-261010-AB12`. There is no backend.

## File uploads

Geometry uploads (rotor, molded part, assembly) post to a Google Apps Script web app (`upload-script/Code.gs`) that runs as ai@wyspa.tech, saves files to Drive `Wyspa Tech/Share/AI/6 - Build quote requests` and emails casey@wyspa.tech. Set its `/exec` URL as `uploadUrl` in `pricing.js`. While `uploadUrl` is empty, the page falls back to a pre-filled email.
