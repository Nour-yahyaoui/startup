# Style — Teamroom (landing)

ANCESTOR:         a control-room dispatch board — the wall of dense, always-updating
                  status panels a operations team watches. Teamroom's ancestor is not a
                  "team collaboration app", it's the board the team gathers around.
                  Palette, type and density follow from that object.

PALETTE:          panel  #0A0A0A  (near-black board surface)
                  ink    #EDEDED  (primary text on panel)
                  mute   #6E6E6E  (secondary text, labels)
                  rule   #242424  (hairlines — the only separator we use)
                  row    #111111  (zebra rows in dense tables)
                  accent #3DDC97  (signal green — see accent jobs)
                  sev-amber #A9701A · sev-red #C4340B (severity only, never decoration)

ACCENT JOBS:      signal green is used for: live/online dots, the measured-latency
                  number, primary CTA border+text, one rule under the active nav item.
                  Nothing else. Target ≤5% of painted surface.

TYPE:             display = ui-monospace stack, weight 500, -0.01em  (the board's type is
                  mono because a dispatch board's type is mono — data, not decoration)
                  body    = system-ui 17/1.65
                  label   = mono 11px, uppercase, letter-spacing 0.12em, color mute
SCALE:            40 / 24 / 17 / 14 / 11  (ratios ≥1.5 between levels; hierarchy must
                  survive greyscale — it does: size and position carry it, not colour)

LAYOUT:           Asymmetric two-column rail grid: narrow left rail (mono section numbers
                  + labels, right-aligned) + wide content column. Hairline rules between
                  sections. Body copy never centered. Max content width 1060px, left-
                  weighted (rail + content), ragged right.

RADIUS:           2px on interactive elements, 0 on structure. Nothing pill-shaped.

SHADOW:           none. Elevation is expressed with borders and hairlines. The only
                  exception: nothing floats on this page — so, no shadows at all.

SIGNATURE:        "The board measures itself" — a live latency probe that pings the real
                  API every 2s and prints the measured response time into a dense log
                  table (real numbers, updating in front of the visitor), beside the
                  numbered spec index of the product's actual limits (500 MB uploads,
                  <10 ms WS broadcast, 5 roles…). Only this product's landing page can
                  stream its own vitals.

BANNED:           gradients · glow shadows · emoji as icons · centered body copy ·
                  fake browser/terminal chrome with dots · eyebrow pills · identical
                  3-card feature grids · testimonial avatar cards · radius > 4px ·
                  accent on headings · more than one accent colour

REJECTED:         D2 Swiss Poster (white, #FF2D00, 100px grotesk, offset shadows) —
                  poster energy fits infrastructure/security brands; a daily-use
                  workspace should feel like a tool you watch, not a wall you pass.
                  D3 Operations Brief (cream #F5F3EE, ink serif 400, vermilion) —
                  closest to recipe R1 which the skill flags as the most common
                  fallback; Teamroom is realtime data, not editorial print.
