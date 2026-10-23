# 🎧 IEM Tool

**The offline audio playground for exploring, tuning, and testing In-Ear Monitors.**

Find budget clones of $1,000 flagships, tune any set with 1-click AutoEQ, and test your gear—100% offline with zero signups or tracking.

[📥 **Download Latest Release (Windows / macOS / Linux)**](https://github.com/MyLittlePrimordia/IEM-Tool/releases/latest)  
*100% Free • Works completely offline*

---

## ✨ What You Can Do

- 💎 **Find Budget "Gems":** Match frequency curves to find cheap alternatives that sound like flagship $1,000+ IEMs.
- 🎛️ **1-Click AutoEQ:** Instantly tune your IEMs and export presets to **Wavelet**, **Peace EQ**, **Qudelix**, and more.
- 🔬 **Acoustic Ear Lab:** Sweep audio frequencies, check channel balance, and run blind audio tests.
- ⚡ **Power Calculator:** Check if your phone or DAC/amp has enough juice to drive your gear.
- 🎨 **Visualizers & Themes:** Enjoy live audio visualizers and 9 unique colour themes.

---

## 📸 Workspaces (All 7 Tabs)

| 1. 🔍 Find | 2. 🎚️ EQ | 3. 🔬 Test |
| :---: | :---: | :---: |
| Filter by price, driver, or signature to find budget twins. | Draw custom curves, AutoEQ solve, and export presets. | Pinpoint ear peaks, check balance, and run blind tests. |
| <img src="screenshots/FIND.png" width="280" alt="Find Workspace"> | <img src="screenshots/EQ.png" width="280" alt="EQ Workspace"> | <img src="screenshots/TEST.png" width="280" alt="Test Workspace"> |

| 4. 📝 Review | 5. 🗃️ Data | 6. 📊 Viz |
| :---: | :---: | :---: |
| Calculate power needs and view side-by-side specs. | Built-in offline database editor to manage curves locally. | Immersive, fullscreen live audio visualizers. |
| <img src="screenshots/REVIEW.png" width="280" alt="Review Workspace"> | <img src="screenshots/DATA.png" width="280" alt="Data Workspace"> | <img src="screenshots/VIZ.png" width="280" alt="Viz Workspace"> |

<div align="center">
<table width="33%">
  <tr><th align="center">7. ⚙️ Setup</th></tr>
  <tr><td align="center">Customize 9 themes, scaling, routing, and backups.</td></tr>
  <tr><td align="center"><img src="screenshots/SETTINGS.png" width="100%" alt="Setup Workspace"></td></tr>
</table>
</div>

---

## 🎨 Themes

Switch between 9 colour themes anytime from settings. Each theme features its own accent color and backdrop pattern:

| ⚫ Black | 🟤 Brown | 🔴 Red |
| :---: | :---: | :---: |
| <img src="screenshots/black.png" width="260" alt="Black theme"> | <img src="screenshots/brown.png" width="260" alt="Brown theme"> | <img src="screenshots/red.png" width="260" alt="Red theme"> |
| **🔵 Blue** | **🟢 Green** | **🟡 Yellow** |
| <img src="screenshots/blue.png" width="260" alt="Blue theme"> | <img src="screenshots/green.png" width="260" alt="Green theme"> | <img src="screenshots/yellow.png" width="260" alt="Yellow theme"> |
| **🟣 Purple** | **🌸 Pink** | **🟠 Orange** |
| <img src="screenshots/purple.png" width="260" alt="Purple theme"> | <img src="screenshots/pink.png" width="260" alt="Pink theme"> | <img src="screenshots/orange.png" width="260" alt="Orange theme"> |

---

## 🚀 Installing & Running

| Platform | File | How |
| :--- | :--- | :--- |
| **Windows** | `IEM-Tool-Setup.exe` | Run the installer and launch from the Start menu or desktop shortcut. |
| **Linux** | `IEM-Tool.appimage` | `chmod +x IEM-Tool.appimage`, then run it. Portable, no install required. |
| **macOS** | `IEM-Tool.dmg` | Open the DMG and drag the app to Applications. |

*Saved settings and reviews are stored locally per user (Windows: `%APPDATA%\iem-tool`).*

---

## 🔄 Updating IEM Data

Get newly measured IEMs without reinstalling the app:
1. Download the latest data bundle from the **[📦 Database Repo](https://github.com/MyLittlePrimordia/Database/archive/refs/heads/main.zip)**.
2. In IEM Tool, go to **Settings → Data → Offline database → Open folder**.
3. Extract the download and drop `database.json` and the `data/` folder into that folder.
4. Restart **IEM Tool**.

---

<details>
<summary><b>🔗 Companion Tools & Ecosystem</b></summary>

| Repository | Description |
| :--- | :--- |
| **[🎧 IEM Tool](https://github.com/MyLittlePrimordia/IEM-Tool)** | The main desktop workspace for exploring, tuning, and testing IEMs. |
| **[📦 Database](https://github.com/MyLittlePrimordia/Database)** | The raw repository hosting measurement curve files and datasets. |
</details>

<details>
<summary><b>💻 Development & Building</b></summary>

```bash
# Install dependencies
npm install

# Start development app
npm start

# Package desktop builds
npm run dist-win
npm run dist-mac
npm run dist-linux
```

</details>

---

## 📜 Third-party notices

Bundled libraries, shipped unmodified (their licence headers are stripped by the
minified build, so they are recorded here):

| Component | Where | Licence |
| :--- | :--- | :--- |
| [Chart.js](https://www.chartjs.org/) 4.5.1 | `app/js/chart.js` | MIT © Chart.js Contributors |
| [ONNX Runtime Web](https://onnxruntime.ai/) | `app/js/vendor/ort*.js`, `ort-wasm-simd.wasm` | MIT © Microsoft Corporation |
| [U²-Net](https://github.com/xuebinqin/U-2-Net) (u2netp) | `app/models/u2netp.onnx` | Apache-2.0 © Xuebin Qin |
| Comfortaa, Comic Sans MS, Hachimarupop, JetBrains Mono, Orbitron, Pixelify Sans, Rubik, Silkscreen | `app/fonts/` | SIL Open Font License 1.1 (per font) |