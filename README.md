# High Sierra Luxury Epoxy & Coatings

Website for High Sierra Luxury Epoxy & Coatings (Reno, NV): metallic, flake and quartz epoxy floors with polyaspartic topcoats.

Static site with no build step and no dependencies. Deploy the repo root on Vercel as-is.

## What's inside
- `index.html`: the single-page site (hero, systems, 3D designer, work reel, process, estimate form)
- `js/garage-engine.js`: custom WebGL2 renderer for the garage (planar floor reflections, procedural flake / metallic / marble / concrete floors, three vehicles, hex LED ceiling)
- `js/visualizer.js`: designer controls, before/after slider, save/share links (`#design=...`), hand-off to the estimate form
- `js/main.js`: nav, lazy video reel, estimate form submission
- `assets/`: compressed client photos and videos

## Estimate form
Submissions post to FormSubmit (`formsubmit.co`), which relays them to **highsierraluxuryepoxycoatings@gmail.com**.
The **first** submission sends an activation email to that inbox. Click "Activate Form" once, and every request after that arrives normally.
If sending fails, the form offers a pre-filled email and a call link instead.
To change the inbox, edit `ESTIMATE_EMAIL` in `js/main.js`.

## Visualizer notes
- Devices without WebGL2 get a photo fallback; customers can still pick a design and send it.
- Saved designs live in the visitor's browser. Each save also copies a share link that reopens the exact design.
- Requests from the designer include the design summary and that share link.

Built by [Nexora Digital](https://www.nexoradigital.live).
