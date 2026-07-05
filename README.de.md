# xshot

<p align="center">
  <a href="./README.md">简体中文</a> |
  <a href="./README.en.md">English</a> |
  <a href="./README.zh-TW.md">繁體中文</a> |
  <a href="./README.ja.md">日本語</a> |
  <a href="./README.ko.md">한국어</a> |
  <a href="./README.es.md">Español</a> |
  <a href="./README.fr.md">Français</a> |
  <a href="./README.de.md">Deutsch</a> |
  <a href="./README.pt-BR.md">Português (Brasil)</a> |
  <a href="./README.ru.md">Русский</a>
</p>

<p align="center">
  <img src="./public/logo-full.png" alt="xshot" width="360" />
</p>

<p align="center">
  <strong>Ein leichtgewichtiges, dauerhaft verfügbares Desktop-Screenshot-Tool.</strong>
</p>

xshot ist ein Desktop-Screenshot-Tool für schnelle Aufnahmen, Fenster-/Bereichsauswahl, Annotationen, Scroll-Captures, Zuschneiden, Anheften auf dem Bildschirm, Kopieren und Speichern. Es ist für die Nutzung über die Taskleiste und ein globales Tastenkürzel ausgelegt.

## Mehrsprachige Dokumentation

Das README in vereinfachtem Chinesisch ist die maßgebliche Dokumentationsquelle. Wenn sich Funktionsbeschreibungen, Installationshinweise, Einschränkungen oder die Roadmap ändern, aktualisiere zuerst `README.md` und synchronisiere danach English, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português (Brasil) und Русский.

## Kernfunktionen

- ✅ Unterstützt Scroll-Captures.
- ✅ Unterstützt das Anheften von Screenshots als immer sichtbare Floating-Fenster.
- ✅ Unterstützt OCR-Texterkennung, QR-Code-Erkennung, Textübersetzung und Übersetzung als Overlay über dem Originaltext.
- ✅ Unterstützt Annotationstools: Nummernmarker, Pfeil, Rechteck, Linie, Text, Stift, Radierer und Bereichsmosaik.
- ✅ Unterstützt Fenstererkennung beim Hover: Bewege den Cursor über ein Kandidatenfenster und klicke, um es auszuwählen.

![screenshot/xshot.jpeg](./screenshot/xshot.jpeg)

## Nutzung

Nach dem Start läuft xshot in der Taskleiste. Eine Aufnahme startest du so:

- Drücke das voreingestellte globale Tastenkürzel `Option + X` / `Alt + X`.

## Plattformberechtigungen und Installation

- Wenn macOS meldet, dass der Entwickler nicht verifiziert werden kann, öffne `Systemeinstellungen` -> `Datenschutz & Sicherheit` und wähle `Trotzdem öffnen`.
- Falls die App weiterhin nicht geöffnet werden kann, führe `xattr -dr com.apple.quarantine /Applications/xshot.app` aus und versuche es erneut.
- Auf macOS kann die erste Aufnahme eine Bildschirmaufnahme-Berechtigung erfordern; nach dem Erteilen wird ein Neustart der App empfohlen.
- Auf macOS benötigt Scroll-Capture die Bedienungshilfen-Berechtigung, um Mausradereignisse zu überwachen/filtern und das Fenster unter der Auswahl scrollen zu lassen.
- OCR basiert auf macOS Vision; Übersetzung benötigt Netzwerkzugriff und verwendet standardmäßig Google Translate.
- Die Dock-Icon-Option gilt nur für macOS.
- Der aktuelle Hauptpfad für Aufnahmen verarbeitet nur das primäre Display. Multi-Monitor-Unterstützung wird weiter verbessert.
- Die Fenstererkennung beim Hover hängt von der System-Fensterauflistung ab, daher können einige Systemfenster, Overlays oder Vollbild-Apps anders reagieren.

## Einstellungen

- Tastenkürzel: Klicke auf Bearbeiten, gib eine neue Tastenkombination ein und speichere sie, damit sie sofort wirksam wird.
- Tastenkürzel zurücksetzen: stellt `Option + X` / `Alt + X` wieder her.
- Dock-Icon: steuert unter macOS, ob das App-Symbol im Dock angezeigt wird.
- Beim Login starten: startet xshot automatisch nach der Anmeldung.
- Standardspeicherort: heruntergeladene Screenshots werden bevorzugt im angegebenen Ordner gespeichert; ohne Einstellung wird Downloads verwendet.
- Oberflächensprache: unterstützt derzeit vereinfachtes Chinesisch und English.
- Berechtigungen: unter macOS kannst du den Status von Bildschirmaufnahme und Bedienungshilfen prüfen und die passenden Systemeinstellungen direkt öffnen.

## Aktueller Capture-Pipeline

- Beim App-Start wird ein Screenshot-WebView erstellt und ausgeblendet; bei einer Aufnahme wird dieses Fenster wiederverwendet.
- Auf macOS nutzt die normale Aufnahme derzeit das Systemkommando `screencapture -x -R <screenshot-window-rect>`; das Ergebnis wird zuerst als temporäres PNG geschrieben und anschließend in die Frontend-Editierebene geladen.
- Auf Windows / Linux erfasst der aktuelle Pfad das Display über `xcap` und kodiert PNG auf der Rust-Seite.
- Auf macOS macht Scroll-Capture das Screenshot-Fenster mausdurchlässig und leitet nur nach unten gerichtete Mausradereignisse weiter. Jeder Frame nutzt bevorzugt CoreGraphics `CGWindowListCreateImage`, um den Auswahlbereich unterhalb des Screenshot-Fensters zu erfassen; bei Fehlern wird auf `screencapture -R` zurückgegriffen.
- Scroll-Capture fügt neue Zeilen anhand der tatsächlichen vertikalen Verschiebung zwischen zwei Frames an. Kleine Verschiebungen aktualisieren den vorherigen Frame nicht, damit wiederholte Texturen oder weiße Flächen nicht zu viel Inhalt auf einmal hinzufügen.
- Nach der Erstellung wechselt der lange Screenshot in die Zuschneiden-/Bearbeiten-Ansicht; Kopieren und Speichern exportieren den aktuellen Zuschnitt.
- Beim Anheften wird das aktuell exportierte PNG in ein temporäres Verzeichnis geschrieben. Anschließend zeigt ein unabhängiges, randloses, immer sichtbares und arbeitsbereichsübergreifendes Tauri-Fenster das Bild an.
- OCR erkennt Text über macOS Vision `VNRecognizeTextRequest`, bevorzugt accurate und fällt bei Fehlern auf fast zurück; QR-Erkennung nutzt `VNDetectBarcodesRequest`.
- Übersetzung wird vom Rust-Backend über Google Translate ausgeführt und unterstützt System-Proxys. Das Übersetzungs-Overlay erzeugt aus OCR block-Koordinaten editierbare und rückgängig machbare Textannotationen; ein erneuter Klick entfernt das erzeugte Overlay.
- Der Capture-Ablauf behält segmentierte Zeitlogs bei, um Verzögerungen bei Tastenkürzel-Auslösung, Aufnahme, Bilddekodierung und Fensteranzeige zu analysieren.
- ScreenCaptureKit wurde zuvor getestet, aber Qualität und Nutzen waren nicht ausreichend; daher bleibt der stabile fallback-Pfad der Standard.

## Entwicklung

Tauri-Voraussetzungen: <https://v2.tauri.app/start/prerequisites/>

Anforderungen:

- Node.js
- pnpm
- Rust
- Tauri v2 Systemabhängigkeiten

Nützliche Befehle:

```bash
pnpm install       # Abhängigkeiten installieren
pnpm dev           # Tauri-Entwicklungsumgebung starten
pnpm dev:web       # Nur Vite-Frontend starten
pnpm build:web     # Frontend bauen
pnpm build         # Desktop-App bauen
pnpm tsc           # TypeScript-Prüfung
pnpm format        # Prettier + cargo fmt
```

Projektstruktur:

```text
src/                    React-Frontend
src/windows/            Screenshot-Fenster
src/logic/              Einstellungen, Tastenkürzel, Cursor und weitere Frontend-Logik
src-tauri/              Tauri / Rust Backend
src-tauri/src/lib.rs    Capture, Tray, Zwischenablage, Registrierung von Fensterbefehlen
src-tauri/src/ocr.rs    macOS Vision OCR / QR-Erkennung
src-tauri/src/translation.rs  Übersetzungsdienst
public/                 App-Bildressourcen
```

## Aktuelle Einschränkungen

- Multi-Monitor-Unterstützung ist noch unvollständig.
- Scroll-Capture ist derzeit macOS-orientiert und hängt von Bildschirmaufnahme- und Bedienungshilfen-Berechtigungen ab; aktuell wird nur das Zusammenfügen nach unten unterstützt.
- OCR ist derzeit macOS-orientiert; Übersetzung hängt von Netzwerkzugriff und der Verfügbarkeit von Google Translate ab.
- Änderungen an Annotationseigenschaften werden sofort angewendet, aber noch nicht als eigene Aktionen im Undo-Stack geführt.
- Erweiterte Einstellungen wie Bildformatwahl, Startparameter und Toolbar-Anpassung sind noch nicht verfügbar.
- Fenster-Capture hängt von der Erkennung von Kandidatenfenstern ab; einige transparente Fenster, System-Overlays oder Vollbildbereiche werden möglicherweise nicht exakt getroffen.

## Roadmap

- Multi-Monitor-Capture und Koordinatenzuordnung vervollständigen.
- Einstellungen für Bildformat und Qualität hinzufügen.
- Änderungen an Annotationseigenschaften in einen vollständigeren Undo/Redo-Stack aufnehmen.
- Weitere Annotationsstile und Toolbar-Konfigurationen unterstützen.
- Installationspakete, Release-Ablauf und Plattformkompatibilitätsprüfungen verbessern.

## Tech Stack

- Tauri v2
- React 19
- TypeScript
- Vite
- Fabric.js
- lucide-react
- i18next / react-i18next
- xcap / image
- Tauri autostart / dialog / global-shortcut / clipboard-manager / opener plugins
- ai-ins Vite plugin
