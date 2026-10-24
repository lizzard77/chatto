# 🎵 Erato — Musik-Bot für Chatto

Streamt eine lokale Audioquelle in den Anruf eines Chatto-Channels und kann zusätzlich ein Fenster
vom Desktop in den Call senden (z. B. den Browser mit der Karte). Läuft **lokal** (nicht auf
he1), weil Musik und Fenster vom eigenen Rechner kommen.

- Beim Start fragt Erato, in welchem Channel er aktiv wird (alle Channels, in denen der Bot Calls
  beitreten darf; `CHATTO_ROOM_ID` ist der Vorschlag für Enter). Direkt: `node erato.mjs <id|name>`.
  Ist der Bot im Channel noch kein Mitglied, tritt er bei.
- Pro PC und Channel läuft höchstens ein Erato; ein zweiter Start im selben Channel bricht ab.
  Mehrere Channels auf einem PC gehen (je ein eigenes Ausgabegerät „Erato (#channel)“).

- Tritt per `VoiceCallService/JoinCall` dem Call bei (startet ihn, wenn keiner läuft), holt mit
  `CreateCallToken` LiveKit-Token und E2EE-Key und verbindet sich mit `@livekit/rtc-node`.
- Ohne Datei legt Erato ein virtuelles Ausgabegerät **„Erato (#channel)“** an (PipeWire/Pulse, `pactl`).
  Musikplayer (z. B. in `pavucontrol`) auf „Erato“ stellen – alle im Call hören mit. Selbst hört
  man über den Call zu; der Chatto-Tab darf deshalb **nicht** auf „Erato“ ausgeben, sonst geht der
  Call-Ton zurück in den Call. `ERATO_MONITOR=1` legt zusätzlich einen lokalen Mithör-Loopback an.
  Beim Beenden wird das Gerät wieder entfernt.
- Mit Datei (`node erato.mjs <channel> musik.mp3`) wird diese in Schleife gestreamt.
- Gesendet wird als Mikrofon-Track, 48 kHz Stereo, Opus 128 kbit/s, ohne DTX.

## Einrichtung

1. Chatto: **Server Admin → Bots → Create Bot** (Username `erato`), API-Key kopieren.
2. Auf der Detailseite des Bots für die gewünschten Channels erlauben: `room.join`, `call.join`,
   `call.start`, `call.voice`, für die Fensterfreigabe `call.screenshare`. Danach in der
   **Joined**-Zeile die Channels anhaken (oder Erato tritt beim Start selbst bei).
   Für die Steuerung per DM zusätzlich in der Spalte **Direct messages** `message.read` und
   `message.post` erlauben.
3. `cp .env.example .env`, `CHATTO_API_KEY` eintragen.
4. `npm i`, dann `npm start` oder `node erato.mjs` (benötigt `ffmpeg` und `pactl`). Die `.env` neben
   `erato.mjs` wird immer geladen, auch aus einem anderen Verzeichnis; Shell-Variablen haben Vorrang. Beenden mit Ctrl+C.

## Fenster teilen

In der Konsole von Erato oder aus einem anderen Terminal:

```sh
share          # Fenster auswählen und in den Call senden
stop           # Freigabe beenden
status
snapshot       # zuletzt gesendetes Bild als PNG speichern (Standard: /tmp/erato-snapshot.png)
quit           # Erato beenden

node erato.mjs ctl share                     # dasselbe von außen (z. B. als KDE-Kurzbefehl)
node erato.mjs ctl -c "Game - London 1888" stop   # nötig, wenn mehrere Erato laufen
```

**Per Chatto-DM:** Mit `ERATO_DM_USERS=phil` (Logins, kommagetrennt) nimmt Erato dieselben Befehle
als Direktnachricht an (`share`, `stop`, `status`, `quit`, bei mehreren Erato auf dem PC mit
`-c <channel>` davor) und antwortet dort. Andere Absender werden ignoriert. Erato empfängt DMs in
Echtzeit über [`@chatto/client`](https://www.npmjs.com/package/@chatto/client) und führt nur
Nachrichten aus, die nach seinem Start kommen.

Das Fenster wird in `ERATO_VIDEO_SIZE` (Standard 1920×1080) eingepasst, schwarze Ränder bei anderem
Seitenverhältnis; Mauszeiger ist sichtbar. Erato sendet es als Bildschirmfreigabe (braucht
`call.screenshare`), sobald der erste Frame da ist – Chatto zeigt Freigaben vollständig mit schwarzen
Balken, Kamerabilder würde es in der großen Ansicht zuschneiden. `ERATO_VIDEO_AS=camera` sendet
trotzdem als Kamera (`call.camera`). Eine Stufe ohne Simulcast, bei Engpässen sinkt die Bildrate statt
der Auflösung; Codec mit `ERATO_VIDEO_CODEC` (vp8, vp9, av1, h264).

- **KDE Plasma / Wayland:** über das ScreenCast-Portal; KDE zeigt bei jedem `share` den
  Auswahldialog (Fenster oder Bildschirm). Beenden geht auch über das Freigabe-Symbol im Systemabschnitt
  der Kontrollleiste. Braucht GStreamer mit `pipewiresrc` (`gst-plugin-pipewire`) und `pw-dump`
  (PipeWire), kein Python. Ändert sich die Fenstergröße, startet die Aufnahme kurz neu.
- **X11:** ffmpeg `x11grab`; `share` wartet auf einen Klick ins Fenster (`xwininfo`), alternativ
  `share <fenster-id>`.
- **Windows:** ffmpeg `gdigrab`, `share <Fenstertitel>` (ohne Titel: ganzer Desktop). Ungetestet;
  Audio geht dort nur mit Datei, weil das virtuelle Gerät `pactl` braucht.
- **macOS:** ffmpeg `avfoundation`, nur ganzer Bildschirm (`share "Capture screen 0"`). Ungetestet.

**Mehrere GMs im selben Channel:** Jeder GM braucht einen **eigenen Bot** (eigener API-Key, z. B.
`erato-phil`, `erato-simon`). Chatto identifiziert Call-Teilnehmer über den Benutzer; zwei Erato mit
demselben Bot im selben Call werfen sich gegenseitig raus.

## Soundpads vom RØDECaster

`ERATO_SOURCES` mischt weitere Aufnahmequellen direkt in den Stream (nicht über das Erato-Gerät,
damit man sie nicht doppelt hört). Der RØDECaster Duo liefert im Pro-Audio-Profil zwei
Stereo-Eingänge (`…pro-input-0`, `…pro-input-1`), Namen per `pactl list short sources`.

Auf dem Gerät (bzw. in RØDE Central → Routing) einen USB-Ausgang so einstellen, dass er **nur die
Sound Pads** enthält – kein Mikrofon, sonst kommt die eigene Stimme doppelt in den Call, und nicht
den Ausgang, den Chatto als Mikrofon nutzt. Welcher Eingang welcher ist, zeigt `pavucontrol` →
Eingabegeräte beim Drücken eines Pads.

## Stolperfallen

- **Kein Ton im Call, obwohl Erato streamt:** Der Browser mit Chatto gibt auf „Erato“ aus.
  WirePlumber merkt sich das Ausgabegerät pro App – einmal in `pavucontrol` auf die normale
  Ausgabe stellen, danach bleibt es dort.
