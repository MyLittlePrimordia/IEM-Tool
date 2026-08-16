# 🎧 IEM Tool

A Complete Offline Workstation for In-Ear Monitors (IEMs)

Built for audio enthusiasts, reviewers, and tuners who want an all-in-one offline tool for reviewing, tuning, testing, comparing, and discovering IEMs.

---

## ✨ Key Features in V2

* 🔍 **Smart Recommendation Engine (Find):** Match IEMs based on custom sound preferences, target curves, or spec constraints.
* ❤️ **Taste Matcher:** Average your favorite IEMs into a custom acoustic fingerprint to find matching sound signatures.
* 🗡️ **Giant-Killer Clone Hunter:** Discover budget IEMs ($15–$200) that replicate $500+ flagship sound profiles.
* 🚀 **Upgrade Pathway Engine:** Generate step-up acoustic ladders (*Starter*, *Leap*, *Endgame*) based on your owned gear and goals.
* ✏️ **Target Sculptor & Freehand Draw:** Draw or sculpt custom target curves directly on the interactive frequency response graph.
* 🎚️ **Parametric EQ & AutoEQ Solver:** 1-Click AutoEQ solver supporting 10 to 50 band resolutions with Anti-Clip Limiter and Auto-Gain Matching.
* 🌌 **3D Soundstage & Spatial Simulator:** Interactive 3D spatial pad with HRTF positioning and room acoustic simulations.
* 🎯 **Live Genre Match & Genre-Target AutoEQ:** The FR graph overlay shows real-time Music and Game genre matches based on your current EQ curve, with a one-click stepper to cycle genre families and AutoEQ solve directly to that genre's target shape.
* 🔬 **Acoustic Test Lab:** Ear Canal Resonance Peak locking, Channel Imbalance detector, Burn-In Station, and 10 Diagnostic Sweeps.
* 🎮 **Blind A/B & ABX Test Station:** Conduct blind listening tests with crossfading and statistical confidence scoring ($P$-value).
* 📝 **Review Profile Suite:** Rate IEMs with radar spider charts, sound characteristic sliders, photo attachment background removal, and DAC power/driveability calculations.
* 📊 **Real-time Audio Visualizers:** 6 switchable render modes — Neon Stars, Liquid Fiber Wave, Cosmic Vortex, Spectrum Bars, EQ Grid, and Aurora Ribbons.
* 🎨 **Custom 8-Bit Retro Themes & Fonts:** 9 retro skins (Slate, Parchment, Ember, Circuit, Byte, Cartridge, Arcade, Blush, Bit) with auto-scaled retro fonts.
* 🚫 **100% Offline & Private:** Runs completely local as a self-contained desktop app (Electron) with no server connections required.

---

## 📸 Workspaces Overview

### 1. 🔍 Find (Recommendations & Clone Engine)
*The default landing workspace in V2.*
* **Tuning Search:** Adjust bass, warmth, vocals, treble, and smoothness sliders to generate custom target curves and find matching IEMs.
* **Spec Filters:** Filter database models by Price Range ($0–$3000), Release Year (1995–2026), Driver Tech (DD, BA, Planar, EST, PZT, BC, MEMS), Connectors, and Tags.
* **Taste Matcher:** Select up to 3 favorite IEMs to synthesize a custom acoustic profile.
* **Giant-Killer Hunter:** Pick a $500+ flagship IEM to find budget-friendly alternatives under your chosen price ceiling.
* **Upgrade Pathway:** Select an IEM you own to build a 3-tier upgrade ladder (*Starter*, *Leap*, *Endgame*).

<p align="center">
  <img src="screenshots/FIND.png" width="900" alt="Find Workspace">
</p>

---

### 2. 🎚️ EQ (Parametric Equalizer)
* **Interactive FR Graph:** Drag EQ nodes or trace custom targets directly on the viewport.
* **AutoEQ Engine:** Solves parametric EQ filters automatically across 10, 15, 20, 30, 40, or 50 band resolutions.
* **Presets & Acoustics:** Standard & Advanced cards, Speaker Crossfeed, Stereo Expander, Loudness Compensation, De-Esser, and Reverb simulator.
* **Preset Exporters:** Export active filters directly to **Peace**, **Wavelet**, **Poweramp**, **Qudelix**, and **FxSound**.
* **Genre Match Overlay:** Top-left graph overlay live-matches your current curve to the closest Music and Game genre profiles. Use the 🎯 button next to each match to open a stepper, pick a different genre family, and apply AutoEQ straight to that genre's target — with or without a Base curve loaded.

<p align="center">
  <img src="screenshots/EQ.png" width="900" alt="EQ Workspace">
</p>

---

### 3. 🔬 Test (Acoustic Test Lab)
* **Ear Resonance Peak:** Sweep 6.4kHz–9.6kHz to locate and lock your ear canal resonance peak, applying an automatic notch filter.
* **Channel Imbalance & Swap:** Test L/R balance with real-time RMS meter readouts and 1-click L/R channel swapping.
* **Burn-In Station:** Timed white/pink/brown noise generator with customizable timers (1H, 4H, 8H, 24H, Infinite) and rest cycles.
* **3D Soundstage Pad:** Move test audio sources freely across a 3D acoustic grid.
* **Blind A/B & ABX Test:** Compare two tracks side-by-side with synchronized playback and statistical confidence tracking.
* **Hearing Test & Isolation:** Generate corrective EQ profiles based on your frequency threshold limits.

<p align="center">
  <img src="screenshots/TEST.png" width="900" alt="Test Lab Workspace">
</p>

---

### 4. 📝 Review (IEM Evaluation Suite)
* **Specs & Drivers:** Configure driver layouts (DD, BA, Planar, EST, PZT, BC, MEMS), crossovers, and way counts.
* **Driveability & DAC Power:** Calculate voltage/power draw ($V_{rms}$ / $mW$) and damping factor compatibility for Phone, Laptop, Dongle, and Desktop setups.
* **Radar Chart:** View 9-axis sound breakdown (Bass, Mids, Treble, Detail, Soundstage, Imaging, Dynamics, Tonality, Technicalities).
* **Photo Attachment:** Upload photos with built-in background removal and zoom/pan controls.
* **Inventory Library:** Save, search, export, and compare up to 4 IEM review profiles side-by-side.

<p align="center">
  <img src="screenshots/REVIEW.png" width="900" alt="Review Workspace">
</p>

---

### 5. 📊 Visualizer (Real-time Spectrum)
* Immersive spectrum visualizer with 6 switchable render modes: **✨ Neon Stars**, **🌊 Liquid Fiber Wave**, **🌀 Cosmic Vortex**, **📊 Spectrum Bars**, **🟩 EQ Grid**, and **🌈 Aurora Ribbons**.

<p align="center">
  <img src="screenshots/VISUALIZER.png" width="900" alt="Visualizer Workspace">
</p>

---

### 6. ⚙️ Settings
* App customization, theme selector, font styling, reading size scaling, blue-light night shift filter, data dumping, and workspace resets.

<p align="center">
  <img src="screenshots/SETTINGS.png" width="900" alt="Settings Workspace">
</p>

---

## 🎨 8-Bit Retro Themes

Customize your workstation interface with 9 built-in skins:

| Theme | Name | Preview |
| :--- | :--- | :---: |
| `slate` | **Slate** *(Default)* | <img src="screenshots/SLATE.png" width="280"> |
| `parchment` | **Parchment** | <img src="screenshots/PARCHMENT.png" width="280"> |
| `ember` | **Ember** | <img src="screenshots/EMBER.png" width="280"> |
| `circuit` | **Circuit** | <img src="screenshots/CIRCUIT.png" width="280"> |
| `byte` | **Byte** | <img src="screenshots/BYTE.png" width="280"> |
| `cartridge` | **Cartridge** | <img src="screenshots/CARTRIDGE.png" width="280"> |
| `arcade` | **Arcade** | <img src="screenshots/ARCADE.png" width="280"> |
| `blush` | **Blush** | <img src="screenshots/BLUSH.png" width="280"> |
| `bit` | **Bit** | <img src="screenshots/BIT.png" width="280"> |

---

## 📂 Utilities & Executables

### 1. 🛠️ Database Editor  (`Database Editor.exe`)

#### ❓ What does this tool do?
A full desktop GUI for browsing, editing, validating, and repairing `database.json` directly — no more hand-editing raw JSON. It replaces the old Audit Database.exe with an editor that can also *fix* what it finds, not just report it.

#### 🌟 Key Features:
* **📋 Entry Browser & Editor:** Searchable, A–Z indexed list of every entry with a full form for editing brand, model, variant, year, price, driver config, connector, form factor, tags, and linked measurement files. Add, duplicate, or delete entries; brand names autocomplete against existing casing to prevent duplicates like "Moondrop" vs "moondrop".
* **✅ Validate All Entries:** Checks every entry against the schema — required fields, allowed connector/form-factor/driver-type values, the 4–12 tag count rule, duplicate IDs, and mandatory price-tier tags — and produces a full error report.
* **🏷️ Auto-Fix Price-Tier Tags:** One-click repair for entries whose Budget/Mid-Tier/Premium/Flagship tag doesn't match their `price_usd`. Previews every change before applying it, fixes what it safely can, and flags anything needing manual review (missing or multiple tier tags) instead of guessing.
* **🔍 Run File Audit:** Cross-references every entry's `files` array against what's actually in your `data/` folder and reports Missing Files, Unlinked Files, and Duplicate File Assignments (same file linked to two entries).
* **🧹 Find & Fix Backslash Paths:** Detects and normalizes Windows-style `\` paths to `/` in one click.
* **🩺 JSON Syntax Checker:** Validates any JSON file and reports the exact line/column of a syntax error.
* **↩️ Undo/Redo & Change History:** Every edit is tracked with full undo/redo, plus a persistent changelog you can review at any time.
* **💾 Autosave Working Copy:** Changes autosave to a working copy as you go, with a separate "Export Final Database" step when you're ready to publish.

#### 🚀 How to use it:
1. Place **`Database Editor.exe`** in the same folder as your `data` directory and **`database.json`**.
2. Run **`Database Editor.exe`**.
3. Use the toolbar or **Tools** menu to Validate All, Auto-Fix Price Tiers, Run File Audit, or check JSON syntax — each opens a report you can export as a `.txt` file.
4. Edit entries directly in the form on the right, then **Save Entry** (or **Ctrl+S** to save your working copy at any time).

---

### 2. 🎛️ Curve Converter (`Curve Converter.exe`)

#### ❓ What does this tool do?
Measurement data from sources like Squiglink, Crinacle, and other databases come in different formats, delimiters, and naming styles.

This utility converts raw measurement files into a standardized format ready for **IEM Tool**.

#### 🌟 Key Features:
* **📁 Universal Reader:** Converts raw `.txt` and `.csv` measurement files.
* **⚖️ L/R Channel Averaging:** Detects Left and Right files (e.g., `L`/`R`, `[1]`/`[2]`) and averages them into a single curve.
* **✍️ Clean Formatting:** Standardizes frequency points and column delimiters.
* **📂 Converted Folder Output:** Places output files directly into a clean `Converted/` directory.

#### 🚀 How to use it:
1. Drag & drop `.txt` or `.csv` files onto **`Curve Converter.exe`** (or place them in the same folder and run it).
2. Converted files will be generated in the **`Converted/`** folder ready to import into IEM Tool.

---

### 3. 📦 Split Database (`Split Database.exe`)

#### ❓ What does this tool do?
Large JSON databases can exceed AI model upload limits or context windows, making it difficult to audit and verify entries.

This utility splits a large `database.json` file into smaller AI-friendly JSON chunks while preserving the original database structure and entries.

#### 🌟 Key Features:
* **🧩 Smart JSON Splitting:** Automatically divides large databases into smaller chunk files.
* **🤖 AI-Friendly Chunks:** Creates chunks sized for AI auditing workflows (Gemini, Claude, GPT, etc.).
* **📂 Drag & Drop Support:** Drop any `.json` database file directly onto the executable.
* **📁 Automatic Output:** Creates a `chunks/` folder and generates numbered chunk files.
* **🔒 Data Preservation:** Keeps all original JSON entries intact without modifying the data.

#### 🚀 How to use it:
1. Place **`Split Database.exe`** anywhere convenient.
2. Drag and drop a `.json` database file onto **`Split Database.exe`**.
3. The tool will automatically create a `chunks/` folder.
4. The database will be split into smaller files:

---

### 4. 🗜️ Compress Database (`Compress Database.exe`)

#### ❓ What does this tool do?
IEM Tool loads the measurement catalog from `database.json` (or the smaller `database.json.gz` when available). Large catalogs can take longer to download and parse.
This utility compresses `database.json` into a GZip archive (`database.json.gz`) so the app can load the catalog faster and with less bandwidth, without changing any of the data inside.

#### 🌟 Key Features:
* **📦 GZip Compression:** Creates a standard `database.json.gz` file from `database.json`.
* **🔒 Lossless:** Does not modify or remove any catalog entries — only compresses the file.
* **📂 Same-folder workflow:** Reads and writes next to the executable for a simple drop-in setup.
* **📉 Smaller footprint:** Often reduces catalog size significantly for quicker loading.

#### 🚀 How to use it:
1. Place **`Compress Database.exe`** in the same folder as your **`database.json`**.
2. Run **`Compress Database.exe`**.
3. It will generate **`database.json.gz`** in that same folder.
4. Keep both files (or prefer the `.gz` in your app setup) — IEM Tool can load the compressed catalog when present.

---

## 🖥️ Running / Building

IEM Tool ships as an **Electron** desktop app with a small local HTTP server (`main.js`) serving the app to a sandboxed renderer (`preload.js` exposes no privileged APIs).

* `npm start` — launch the app in Electron.
* `npm run dist-win` / `npm run dist-mac` / `npm run dist-linux` — package platform-specific builds via `electron-builder`.
* `npm run build:js` / `npm run build:css` — rebuild the JS bundle and Tailwind CSS output after editing source files.

---

## 🛠️ Built With

* **Electron** (Desktop packaging, local server bridge, sandboxed preload)
* **HTML5 / Vanilla JavaScript (ES6+)**
* **Tailwind CSS (Static 8-Bit Build)**
* **Web Audio API** (Custom DSP Worklet Node, Biquad Filters, HRTF Spatial Panner, Stereo Panner, Convolver, Dynamics Compressor, Analyser Node)
* **HTML5 Canvas API** (Frequency Response Graphs, Visualizers, Card Exporters)
* **IndexedDB & SafeStorage** (Offline Database Storage & Cache)