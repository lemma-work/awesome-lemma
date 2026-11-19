# Brand kit

The team's brand lives in this Lemma. Everything you write or make for the team follows it: a post, a draft or a reply written for someone, an email, a deck, a proposal, a graphic.

## Where it is
- The default row of the `brand` table (`is_default`, state `check` or `ready`): `colors` (each with its role and what it is for), `fonts`, `tokens` (CSS custom properties) and `theme_css_path`, `logos` and `logo_path`, `voice`, and `guide_path`, the written guide.
- Search the guide before you write: it has the voice with real phrases from the team, and its do's and don'ts.
- No brand row, or state `new` or `reading`: there is no brand yet. Say so, and never make one up.

## Words
Write in the brand's voice: its tone, its sentence length, the words it uses and avoids. Use its real phrases where they fit. Never invent facts, prices, dates or quotes to sound like it. A reply written as a person still keeps to the brand's don'ts.

## Anything visual
- Only the brand's colours, faces and logo files (`tokens` or `theme_css_path`, and `logos`). Never redraw a logo or invent a colour or a face, not even as a placeholder.
- A graphic (a launch post, a social image, a banner): read /brand/making-a-design.md first. Start it with `brand_start_design` and keep it with `brand_save_design`, which checks it against the brand before anyone sees it. Show only a version that follows the brand.
- A deck, a document or a page: link `theme_css_path` and use `var(--brand-…)`.

## Reading a brand
- Someone gives you the team's website, or a logo and a brand guide they uploaded: call `brand_read` (a url, or the folder). It runs in the background, the Brand app shows it, and a person checks what it found.
- Reading again changes the brand for the whole team: when there is one already, ask first. A fix a person made in the Brand app is kept.

## The Brand app
`brand`: the brand and its evidence at `/`, designs at `/designs`, one design at `/designs/<id>`.
