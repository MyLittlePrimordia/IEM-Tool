# 🎧 IEM Tool

A fast, 100% offline desktop workspace for exploring, tuning, testing, and reviewing In-Ear Monitors (IEMs). 

No servers, no tracking, and no internet connection required.

---

## ⚡ Key Workspaces

### 1. 🔍 Find (Recommendations & Clones)
* **Tuning Search:** find matching sets from the database based on your Tuning Perference.
* **Spec Filters:** Filter by price, year, driver configuration, connectors, & tags.
* **Taste Matcher:** find similar sets based on your favorites.
* **Gems:** Pick a flagship set to find budget alternatives with matching frequency response curves.
* **Upgrade Pathway:** Select a set you own to generate upgrade tiers (*Starter*, *Leap*, *Endgame*).

<p align="center">
  <img src="screenshots/FIND.png" width="900" alt="Find Workspace">
</p>

---

### 2. 🎚️ EQ (Parametric Equalizer)
* **Interactive FR Graph:** Drag EQ sliders or draw custom target curves directly onto the graph.
* **Database & Similar Finder:** Browse the measurement database or use the Similar tab to find matches to the current curve on the graph.
* **AutoEQ Engine:** 1-click solver supporting up to 50 filter bands with anti-clip & auto-gain.
* **Genre Target Overlay:** Real-time matching against music and game genre profiles.
* **Audio Tools:** Crossfeed, Stereo Expander, Loudness Compensation, De-esser, & Reverb Simulator.
* **Export Presets:** 1-click export to **Peace**, **Wavelet**, **Poweramp**, **Qudelix**, and **FxSound**.

<p align="center">
  <img src="screenshots/EQ.png" width="900" alt="EQ Workspace">
</p>

---

### 3. 🔬 Test (Acoustic Lab)
* **Resonance Peak Sweeper:** Sweep the Hz ranges to locate your personal ear canal resonance peak & generate an automatic notch filter.
* **Channel Imbalance & Swap:** Real-time L/R sound meters & 1-click channel swapping.
* **ABX & Blind A/B Testing:** Compare audio tracks side-by-side with crossfading & test scoring.
* **Soundstage & Burn-In:** 3D sound positioning pad, hearing threshold test, & noise generators with rest cycles.

<p align="center">
  <img src="screenshots/TEST.png" width="900" alt="Test Lab Workspace">
</p>

---

### 4. 📝 Review (IEM Evaluation Suite)
* **Spec Configurator:** Set driver counts, crossovers, & acoustic types.
* **Power & DAC Calculator:** Calculate required voltage & power for compatibility across phones, dongles, and desktop amps.
* **Radar Spider Chart:** visual graph breakdown of bass, mids, treble, soundstage, imaging, and technicalities.
* **Profile Library:** Attach photos, save notes, & compare reviews side-by-side.

<p align="center">
  <img src="screenshots/REVIEW.png" width="900" alt="Review Workspace">
</p>

---

### 5. 📊 Visualizers & 🎨 Themes
* **6 Audio Visualizers:** Neon Stars, Liquid Fiber Wave, Cosmic Vortex, Spectrum Bars, EQ Grid, and Aurora Ribbons.
* **9 Retro Skins:** Slate *(Default)*, Parchment, Ember, Circuit, Byte, Cartridge, Arcade, Blush, and Bit with matching pixel fonts.

| Theme | Preview |
| :--- | :---: |
| **Slate** *(Default)* | <img src="screenshots/SLATE.png" width="280" alt="Slate Theme"> |
| **Parchment** | <img src="screenshots/PARCHMENT.png" width="280" alt="Parchment Theme"> |
| **Ember** | <img src="screenshots/EMBER.png" width="280" alt="Ember Theme"> |
| **Circuit** | <img src="screenshots/CIRCUIT.png" width="280" alt="Circuit Theme"> |
| **Byte** | <img src="screenshots/BYTE.png" width="280" alt="Byte Theme"> |
| **Cartridge** | <img src="screenshots/CARTRIDGE.png" width="280" alt="Cartridge Theme"> |
| **Arcade** | <img src="screenshots/ARCADE.png" width="280" alt="Arcade Theme"> |
| **Blush** | <img src="screenshots/BLUSH.png" width="280" alt="Blush Theme"> |
| **Bit** | <img src="screenshots/BIT.png" width="280" alt="Bit Theme"> |

---

## 🔄 Updating the Catalog & Measurement Curves

You do **not** need to redownload or reinstall the entire application to get newly added IEMs, headphones, and frequency response measurements. You can update your local database and curves independently in seconds:

1. Head over to the **[📦 Official Database Repository](https://github.com/MyLittlePrimordia/Database)**.
2. Click **Code** → **[Download ZIP](https://github.com/MyLittlePrimordia/Database/archive/refs/heads/main.zip)** (or `git pull` if cloned).
3. Extract the archive and copy/overwrite the following into your **IEM Tool** directory:
   * `database.json`
   * `database.json.gz`
   * `data/` *(folder containing all raw `.txt` measurement curve files)*

   **Where to place them:**
   * **Windows:** In the same folder as `IEM Tool.exe` (or inside the `resources/` folder if installed).
   * **macOS:** Right-click `IEM Tool.app` → *Show Package Contents* → `Contents/Resources/`.
   * **Linux:** In the same directory alongside the `AppImage` or executable.

4. Relaunch **IEM Tool** — all newly added gear, graph curves, and auto-EQ target profiles will load automatically.

---

## 🔗 Ecosystem & Companion Tools

| Repository | Description |
| :--- | :--- |
| **[🎧 IEM Tool](https://github.com/MyLittlePrimordia/IEM-Tool)** | The main desktop workspace for finding, tuning, testing, and reviewing IEMs. |
| **[🛠️ DB Tool](https://github.com/MyLittlePrimordia/Database-Tool)** | A standalone desktop app for editing, auditing, and maintaining the catalog. |
| **[📦 DB](https://github.com/MyLittlePrimordia/Database)** | The repository hosting `database.json`, `database.json.gz`, and raw measurement curves. |

---

## 💻 Development & Building

Built as an Electron desktop app with a local HTTP server serving a sandboxed renderer.

```bash
# Install dependencies
npm install

# Start development app
npm start

# Rebuild assets after editing
npm run build:js
npm run build:css

# Package platform builds
npm run dist-win
npm run dist-mac
npm run dist-linux
