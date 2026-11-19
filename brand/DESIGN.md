# Brand app: design

For **a team that makes things** (posts, decks, drafts, graphics), Brand turns
**their website, or a logo and guide they upload,** into **a brand everything
the Lemma makes follows**, by **reading it with evidence, letting a person fix
what it got wrong, and checking every design against it before anyone sees
it.**

## Who and when

- The person setting up Brand kit, once: paste the site, watch it read, check
  what it found (onboarding).
- Anyone on the team, now and then: look up a colour or a logo file, ask for a
  graphic, review one the Lemma made, approve it.
- After a read again: whoever started it checks what changed (`needs_you`).

## Hero moment

The brand page in check mode: every colour with what it is for and the CSS
line it came from, the contrast measured between them (one pair flagged), the
faces set in themselves, the logos on the grounds they're for, the voice with
real quoted phrases, and a single "Looks right".

## Places

| Path | What | Resources |
| --- | --- | --- |
| (no brand yet) | Onboarding 1: website, or upload logo and guide, or a made-up brand; then the read, live | `brand_read`, `brand_sample_data`; reads `brand_job` (activity), `brand_evidence`, `brand_asset` |
| `/` | The brand. Onboarding 2 is this page with a check banner | `brand`, `brand_asset`, `brand_evidence`, `brand_job`; writes through `brand_fix` (colour, face, voice, asset, Looks right), `brand_read` (Read again) |
| `/designs` | Designs: Waiting for you, All, Approved, Put away | `brand_design`, `brand_version`; `brand_design_action` new |
| `/designs/<id>[/<version>]` | One design: the version drawn as itself, the brand check, versions, Approve, Ask for a change, "Wrong?" | `brand_design_action` change, approve, archive, restore; `brand_fix` version |

## The one rule that is this app's own

**The chrome never wears the customer's brand.** Brand colours appear only as
data: swatch chips, contrast chips, logo and asset grounds, and inside a
design's own frame. Everything else is the kit (`--c-*`), so a neon or near
black brand never makes the app look broken (from the Brand Design pod).

## Marks of its own (small)

- A swatch: the colour as a chip with its hex, then name, role, what it's for,
  and where it was found (a fixed colour says so, in the success colour).
- A contrast row: an "Aa" chip in the pair itself, the ratio, a worded pill.
- A design's check: the verdict pill, the sentence with the rule it broke, the
  off-brand colours as dots with their hex.
- Light ink on a light ground is detected (canvas average of opaque pixels) and
  shown on the brand's dark ink instead, so white illustrations don't vanish.

## States

- Loading: the record skeleton; a design without a version shows a spinner in
  its own aspect ratio.
- Reading: the five steps with the job's live activity line, elapsed time,
  screenshots and assets as they land. Re-read: a banner over the brand, which
  stands until the save.
- Failed read: the job's error on step 1 (first read) or over the brand.
- Empty: each section says what's absent and why ("It found no clean logo
  file, and never redraws one").
- Designs being made poll every 5 s (the change stream does the rest).
- Off brand: Approve is disabled with a reason; Ask for a change or "Wrong?".

## 375px

Header keeps the tabs and an icon-only New design; record head actions wrap
under the title; swatches, logos and assets in two columns, evidence in one;
the design page stacks the check under the design; no sideways scroll.
