# Branding „Rollenspiel“

Server-Icon, Avatar und Farben für den Chatto-Server auf `chat.he1.lizzard77.dev`.
Gleiche Farbfamilie wie Pantheon (`bots/pantheon/avatar.svg`): Nachtblau und Gold,
dazu Violett für die Furcht aus Daggerheart.

| Datei | Zweck |
|---|---|
| `icon.svg` / `icon.png` | Server-Logo (Server Admin → Logo), quadratisch, auch bei 32 px lesbar |
| `avatar.svg` / `avatar.png` | Runder Avatar mit Goldring, z. B. für Admin- oder Bot-Profile |
| `generate.py` | Erzeugt beide SVGs; PNGs mit `rsvg-convert -w 512 -h 512 icon.svg -o icon.png` |

## Farben

| Name | Hex | Verwendung |
|---|---|---|
| Nacht | `#0a1a30` | Hintergrund, Ränder |
| Tiefe | `#173c5c` | Flächen, Linien auf Gold, Schrift auf Gold |
| Flut | `#2e6f8e` | Lichtschein, Hover, sekundäre Flächen |
| Gold | `#f2c14e` | Hauptakzent, Buttons, Hervorhebungen |
| Hoffnung | `#ffe9a3` | Glanzlichter, helle Akzente |
| Bernstein | `#c98a1b` | Schattenseite Gold, Rahmen |
| Furcht | `#c79bf2` | Zweitakzent, sparsam einsetzen |

Kontrast: Gold, Hoffnung und Furcht sind auf Nacht und Tiefe gut lesbar; auf Gold
nur Tiefe oder Nacht als Schrift verwenden.
