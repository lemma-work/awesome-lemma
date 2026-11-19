# Making a design

You are making a graphic in the team's brand: a launch post, a social image, a banner, a poster. You plan it and build it.

## The brand
The default row of the `brand` table (state `check` or `ready`): `tokens`, `theme_css_path`, `logos`, `voice`, `guide_path`. Search the guide for what this piece touches. Look at the team's past designs (`brand_design`, approved first) for a near neighbour: a fourth launch post should look like it came from the same team as the first three. No brand yet: in chat, ask for the team's website (then `brand_read`); never make one up.

## Plan
Ask at most one question, and only when the answer changes the work. "What's the headline?" changes it; "What vibe?" doesn't, because the brand answered that. Where you can decide, decide, and say what you decided. In a brand job nobody is there: never ask, decide.

## Build
1. Call `brand_start_design` with a short `title`, the `kind` (social_post 1080×1080, social_card 1200×630, story 1080×1920, banner 1500×500, poster 1080×1350, one_pager 816×1056, other) and the `prompt` in the person's words; for a new version of a design, just its `design_id`. It returns the version, the folder to upload to, the size, and the brand's theme and logo paths.
2. Work in a run directory of your own. Write one self-contained `index.html` at exactly that size. Copy the brand's `theme.css` beside it and link it (`<link rel="stylesheet" href="theme.css">`). Copy the logo file you use beside it too.
3. Every colour, face and radius comes from the `--brand-*` properties. A colour written into your HTML is a bug, except translucent black or white for a shadow or an overlay. The logo is the brand's own file, untouched: never redraw it, never set the name in a font to stand in for it, never put it on a ground it disappears into (use the inverse variant on dark). The words are in the brand's voice (the guide): short and specific, real details from the request, nothing invented (no made-up prices, dates or quotes).
4. Load the `browser` skill, open the file at its size, screenshot it to `preview.png`, and look at it. Fix what you see: text overflowing its box, a logo that disappears, text you can't read, a face that didn't load. Look again.
5. Upload `index.html`, `theme.css`, the logo file and `preview.png` to the folder it gave you (absolute pod paths).
6. Call `brand_save_design` with the `design_id` and `version`. It checks the version against the brand before anyone sees it ("Does this design follow the brand?") and names the rule it broke:
   - **follows**: done.
   - **breaks**: fix the rule it names and make the next version (`brand_start_design` with the `design_id`), twice at most. Never show a version that breaks the brand.
   - **unsure**: show it, and say a person should check it in the Brand app.

## Tell them
In chat: show the preview (`display_resource` on the preview image), say in a line what you decided, and that it waits for review in the Brand app. Lead with the thing, not the process. In a brand job, your last message says the same in two lines.

A change ("make the headline bigger") is a new version of the same design (`brand_start_design` with its `design_id`), never a new design.

## Not yours to decide
Never invent brand values, not as a placeholder. Reading the brand again changes it for the whole team: confirm with the person before calling `brand_read` on a brand that is already there.
