# Shubham's Salesforce Extractor 🚀

A powerful, premium Chrome Extension designed to seamlessly extract CRM data from Salesforce Lightning. Whether you need Leads, Contacts, Accounts, or Opportunities, this tool handles the complex DOM manipulation required to pull records directly into a clean, actionable interface.

## 🛠 How to Install and Use

### Quick Start (Pre-built)
The project includes a pre-built extension in the `dist` folder for immediate use.
1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (top right toggle).
3. Click **Load unpacked** and select the `dist` folder in this repository.

### Manual Installation (If rebuild is needed)
If the pre-built version doesn't work or you want to make changes:
1. **Clone the repository**:
   ```bash
   git clone https://github.com/Shub3am/PowerDialer.git
   cd PowerDialer
   ```
2. **Install Dependencies**:
   ```bash
   npm install
   ```
3. **Build the Extension**:
   ```bash
   npm run build
   ```
4. **Load into Chrome**: Select the newly generated `dist` folder using the "Load unpacked" method described above.

### Usage
1. Open Salesforce in your browser and log in.
2. Click the extension icon in your toolbar.
3. Click **"Extract Data"**. The extension will automatically iterate through Salesforce objects, scrape the data, and display it in the popup.
4. Use the **Tabs** to navigate through different record types or the **Related** tab to see cross-object connections.

---

## ✨ Key Features

*   **Advanced DOM Extraction**: Uses sophisticated selectors and stable-pass algorithms to extract data directly from the Salesforce Lightning grid, bypassing complex API limitations.
*   **Lightning Framework Compatibility**: Built specifically for the modern Salesforce Lightning Experience, handling dynamic rendering and virtualized data tables with ease.
*   **Intelligent 'Related' Engine**: Automatically identifies relationships between different objects (e.g., a Lead and a Contact sharing the same phone number) using a dynamic cross-field matching logic.
*   **Auto-Save & Persistence**: Never lose your data. The extension automatically saves extracted records, allowing you to close and reopen the popup without losing progress.
*   **Clean Data Architecture**: Transforms messy HTML into structured JSON objects while maintaining data integrity across diverse Salesforce categories.
*   **Versatile Export Options**: Download your data in industry-standard formats:
    *   **CSV**: Perfect for Excel or Google Sheets.
    *   **JSON**: Ideal for developers and data integration.

---

## 📡 Technology Stack & Chrome APIs

This extension leverages the latest Chrome Extension (Manifest V3) technologies:

*   **`chrome.scripting`**: Used to inject high-performance scraping logic directly into the Salesforce execution context.
*   **`chrome.tabs`**: Manages automated navigation between different Salesforce object lists (Leads, Accounts, etc.) seamlessly in the background.
*   **`chrome.storage`**: Handles persistent data management (currently optimized with fallback to local storage for maximum reliability).
*   **React + Vite**: A modern frontend stack for a fast, responsive, and premium user interface.
*   **Tailwind CSS**: Provides a sleek, glassmorphic, and professional aesthetic.

---

## 🔗 How URL-Based Fetching Works

The extractor uses a "Navigation-First" approach:
1. It detects your current Salesforce **Base URL** (e.g., `https://your-company.lightning.force.com`).
2. It constructs specific deep-links for each object type based on standard Salesforce List View paths (e.g., `/lightning/o/Contact/list?filterName=allContacts`).
3. The extension opens these views in a background state, waits for the Lightning framework to settle, and then triggers the extraction script.

---

## 🚧 Ongoing Fixes & Known Issues

I am actively improving the tool. Current areas of focus:
1.  **Pagination Stability**: While manual content scripts handle deep pagination well, the extension-triggered script currently faces intermittent issues where the Lightning table only loads partially during deep scrolls.
2.  **Storage Optimization**: Switched to structured `localStorage` within the extension context to bypass certain `chrome.storage.local` quota and serialization errors encountered during high-volume data saves.

---

## 👨‍💻 Connect with Me

Developed with ❤️ by **Shubham**.

*   **Portfolio**: [vshubham.com](https://vshubham.com)
*   **LinkedIn**: [linkedin.com/in/shubhamvs](https://linkedin.com/in/shubhamvs)
*   **GitHub**: [github.com/Shub3am](https://github.com/Shub3am)
