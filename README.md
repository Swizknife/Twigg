# Twigg — AI Browser Sidebar (BROWSER EXTENSION)

Build and develop the Twigg browser extension

"// turbo-all"

## Table of Contents

- Overview
- Features
- Product Overview
- Development
  - Install dependencies
  - Start dev server (hot reload)
  - Load in Chrome (dev)
- Production Build
- Key Files
- Adding a New Model
- Keyboard Shortcut
- Contributing
- License
- Contact

## Overview

Twigg is an AI-powered browser sidebar that transforms ordinary browsing into an intelligent, automated experience. Instead of operating separately from your workflow, Twigg lives inside the browser and understands the live context of the page you are viewing — titles, headings, visible text, forms, tables, and selected content — to generate grounded, context-aware responses.

Twigg can summarize pages, explain concepts, rewrite selected text, answer questions based strictly on page context, and convert natural-language instructions into structured action plans that can be executed after explicit user approval.

## Features

- Context-aware chat and assistance (reads page content and selection)
- Structured action generation and human-in-the-loop execution
- Retrieval-Augmented Generation (RAG) support for reduced hallucinations
- DOM extraction engine for structured data retrieval
- Action execution engine for safe, validated interactions with pages
- Intelligent shopping workflows: Deal Finder and Power Shopper Hub
- Extensible model selection (add your own LLM entries)
- Keyboard shortcut to quickly toggle the sidebar

## Product Overview

Twigg combines natural language understanding with safe execution capabilities. Users can ask it to:

- Summarize and explain page content.
- Rewrite or improve selected text.
- Answer questions grounded in the page (no hallucinations).
- Produce step-by-step action plans (e.g., fill a form, navigate to links) and run them only after user confirmation.

Twigg integrates RAG to fetch real-time data and provide more accurate outputs. It includes selector reliability checks, structured action validation, secure communication between background/sidepanel/content scripts, and controlled execution mechanisms to keep automation safe and auditable.

Twigg introduces shopping-specific features such as price comparison, product tracking, receipt import and analysis, and deal recommendations — all in the same sidebar.

The long-term vision is for Twigg to evolve from an assistant into a proactive browsing layer that can anticipate user needs and automate routine workflows.

## Development

Install dependencies:

```bash
npm install
```

Start dev server (with hot reload):

```bash
npm run dev
```

Load in Chrome (development / testing):

1. Open chrome://extensions
2. Enable Developer mode (top right)
3. Click "Load unpacked" → select the `dist/` folder

If you use a Chromium-based browser other than Chrome, the steps are similar.

## Production Build


## Production Build

Build the extension:

```bash
npm run build
```

Reload in Chrome:

1. Go to chrome://extensions
2. Click the 🔄 refresh icon on the Twigg card (or remove + load unpacked again)

## Key Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension config, permissions, and keyboard shortcut configuration |
| `src/ai/llm.ts` | LLM client (Puter.js — free, no API key by default) |
| `src/sidepanel/App.tsx` | Main sidebar React app |
| `src/content/extractor.ts` | DOM extraction engine (page context parsing) |
| `src/content/executor.ts` | Action execution engine (validated interactions) |
| `src/sidepanel/styles/index.css` | Design system and core styles |

## Adding a New Model

Open `src/sidepanel/components/SettingsPanel.tsx` and add an entry to the `MODELS` array:

```ts
{ value: 'model-id', label: 'Display Name' }
```

Then rebuild the extension:

```bash
npm run build
```

## Keyboard Shortcut

- Ctrl+Shift+Y — Toggle sidebar (configurable in `manifest.json` → `commands`)

## Contributing

We welcome contributions. Please follow these steps:

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/your-feature`.
3. Make changes, run tests, and ensure the dev server builds cleanly.
4. Open a Pull Request with a clear description of the change.

Please open issues for bugs, feature requests, or design discussions.

## License

This project is provided under the MIT License. See the `LICENSE` file for details.

## Contact

If you have questions or want to collaborate, open an issue or reach out to the repository owner.

---
 
Generated/updated README.md to better reflect the Twigg project and development workflow.

Generated/updated README.md to better reflect the Twigg project and development workflow.
