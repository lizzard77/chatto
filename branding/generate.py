#!/usr/bin/env python3
"""Erzeugt Server-Icon und Avatar (SVG) für den Chatto-Server „Rollenspiel“.
Aufruf: python3 branding/generate.py  →  branding/icon.svg, branding/avatar.svg"""
import math
from pathlib import Path

OUT = Path(__file__).parent

# Palette – gleiche Familie wie bots/pantheon/avatar.svg
NIGHT = '#0a1a30'      # Hintergrund, tiefstes Blau
DEEP = '#173c5c'       # Flächen, Linien auf Gold
TIDE = '#2e6f8e'       # Lichtschein im Hintergrund
GOLD = '#f2c14e'       # Hauptakzent
GOLD_LIGHT = '#ffe9a3' # Hoffnung, Glanzlichter
GOLD_DARK = '#c98a1b'  # Schattenseite Gold
FEAR = '#c79bf2'       # Furcht, Zweitakzent


def d20(cx, cy, R, line):
    """W20 in Frontalansicht: Sechseck, Mittelfläche mit „20“, neun Randflächen."""
    P = lambda r, a: (cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))
    HT, HUR, HLR, HB, HLL, HUL = (P(R, a) for a in (-90, -30, 30, 90, 150, 210))
    r = R * 0.56
    it, ir, il = P(r, -90), P(r, 30), P(r, 150)
    faces = [
        ([HT, HUR, it], '#ffe39a'), ([HUL, HT, it], '#ffd77a'),
        ([HUR, ir, it], '#f2c14e'), ([HUL, it, il], '#f5c95c'),
        ([HUR, HLR, ir], '#d9a032'), ([HLL, HUL, il], '#e4ad3e'),
        ([HLR, HB, ir], '#b97a17'), ([HB, HLL, il], '#c5861c'),
        ([HB, il, ir], '#a86c12'), ([it, ir, il], 'url(#face)'),
    ]
    pts = lambda ps: ' '.join(f'{x:.1f},{y:.1f}' for x, y in ps)
    out = [f'<polygon points="{pts(f)}" fill="{c}" stroke="{DEEP}" stroke-width="{line}" stroke-linejoin="round"/>'
           for f, c in faces]
    out.append(f'<polygon points="{pts([HT, HUR, HLR, HB, HLL, HUL])}" fill="none" stroke="{DEEP}" '
               f'stroke-width="{line * 1.6}" stroke-linejoin="round"/>')
    fs = R * 0.36
    out.append(f'<text x="{cx:.1f}" y="{cy + R * 0.07 + fs * 0.35:.1f}" font-family="Noto Serif, DejaVu Serif, Georgia, serif" '
               f'font-weight="700" font-size="{fs:.1f}" text-anchor="middle" fill="{DEEP}">20</text>')
    return '\n    '.join(out)


def spark(x, y, s, color, opacity=1):
    return (f'<path fill="{color}" opacity="{opacity}" d="M{x} {y - s} Q{x + s * .18} {y - s * .18} {x + s} {y} '
            f'Q{x + s * .18} {y + s * .18} {x} {y + s} Q{x - s * .18} {y + s * .18} {x - s} {y} '
            f'Q{x - s * .18} {y - s * .18} {x} {y - s} Z"/>')


DEFS = f'''<defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%">
      <stop offset="0" stop-color="{TIDE}"/><stop offset="0.6" stop-color="{DEEP}"/><stop offset="1" stop-color="{NIGHT}"/>
    </radialGradient>
    <linearGradient id="face" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{GOLD_LIGHT}"/><stop offset="1" stop-color="{GOLD}"/>
    </linearGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{GOLD_LIGHT}"/><stop offset="0.5" stop-color="{GOLD}"/><stop offset="1" stop-color="{GOLD_DARK}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="{GOLD_LIGHT}" stop-opacity="0.35"/><stop offset="1" stop-color="{GOLD_LIGHT}" stop-opacity="0"/>
    </radialGradient>
  </defs>'''

# Server-Icon: quadratisch, abgerundet, nur der Würfel – bleibt auch bei 32 px lesbar
icon = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  {DEFS}
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <circle cx="256" cy="262" r="210" fill="url(#glow)"/>
  <g>
    {d20(256, 262, 172, 7)}
  </g>
</svg>
'''

# Avatar: rund gedacht (Chatto beschneidet kreisförmig), mit Goldring und Funken von Hoffnung und Furcht
avatar = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  {DEFS}
  <circle cx="256" cy="256" r="256" fill="url(#bg)"/>
  <circle cx="256" cy="256" r="236" fill="none" stroke="url(#ring)" stroke-width="10"/>
  <circle cx="256" cy="256" r="218" fill="none" stroke="{GOLD}" stroke-opacity="0.35" stroke-width="2"/>
  <circle cx="256" cy="262" r="170" fill="url(#glow)"/>
  <g>
    {d20(256, 262, 150, 6)}
  </g>
  {spark(132, 140, 22, GOLD_LIGHT)}
  {spark(384, 128, 17, FEAR)}
  {spark(392, 368, 13, GOLD_LIGHT, 0.85)}
  {spark(118, 372, 15, FEAR, 0.9)}
</svg>
'''

(OUT / 'icon.svg').write_text(icon)
(OUT / 'avatar.svg').write_text(avatar)
print('icon.svg, avatar.svg geschrieben')
