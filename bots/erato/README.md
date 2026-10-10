# 🎵 Erato — Musik-Bot für Chatto

Streamt eine lokale Audioquelle in den Anruf eines Chatto-Raums. Läuft **lokal** (nicht auf he1),
weil die Musik vom eigenen Rechner kommt.

- Tritt per `VoiceCallService/JoinCall` dem Call bei (startet ihn, wenn keiner läuft), holt mit
  `CreateCallToken` LiveKit-Token und E2EE-Key und verbindet sich mit `@livekit/rtc-node`.
- Ohne Datei legt Erato ein virtuelles Ausgabegerät **„Erato“** an (PipeWire/Pulse, `pactl`).
  Musikplayer (z. B. in `pavucontrol`) auf „Erato“ stellen – alle im Call hören mit. Selbst hört
  man über den Call zu; der Chatto-Tab darf deshalb **nicht** auf „Erato“ ausgeben, sonst geht der
  Call-Ton zurück in den Call. `ERATO_MONITOR=1` legt zusätzlich einen lokalen Mithör-Loopback an.
  Beim Beenden wird das Gerät wieder entfernt.
- Mit Datei (`node --env-file=.env erato.mjs <room-id> musik.mp3`) wird diese in Schleife gestreamt.
- Gesendet wird als Mikrofon-Track, 48 kHz Stereo, Opus 128 kbit/s, ohne DTX.

## Einrichtung

1. Chatto: **Server Admin → Bots → Create Bot** (Username `erato`), API-Key kopieren.
2. Auf der Detailseite des Bots für die gewünschten Räume erlauben: `room.join`, `call.join`,
   `call.start`, `call.voice`. Danach in der **Joined**-Zeile die Räume anhaken.
3. `cp .env.example .env`, `CHATTO_API_KEY` eintragen.
4. `npm i`, dann `npm start` (benötigt `ffmpeg` und `pactl`). Beenden mit Ctrl+C.

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
