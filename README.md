# Skills Book

App Electron (macOS / Windows) qui liste les `SKILL.md` de la machine et les édite en Markdown.

```bash
npm install
npm start
```

## Build

```bash
npm run dist:mac   # dmg arm64 + x64
npm run dist:win   # installeur NSIS x64 + arm64 (à lancer sur Windows)
```

Sortie dans `dist/`. Builds non signés.

## Fonctionnement

- **Onglets Skills / Agents**. Skill = dossier contenant `SKILL.md`. Agent = `.md` avec frontmatter dans un `agents/` de `.claude` ou d'un plugin (sous-dossiers inclus).
- **Portée** :
  - `Global` : sous un dossier de config du home (`~/.claude`, `~/.codex`, `~/.agents`…), plugins installés compris.
  - `Local` : sous `<projet>/.claude` (ou `.codex`, `.agents`…).
  - `Autre` : dossier libre, hors config.
  Groupes repliables par source (config, plugin, projet), filtre Tout / Global / Local.
- **Dossiers scannés** (bouton en bas de la sidebar) : par défaut `~/.claude/skills`, `~/.claude/agents`, `~/.claude/plugins`, `~/.agents/skills`, `~/.codex/skills`. Ajoute `~/dev` (ou équivalent) pour voir les skills/agents locaux de tes projets. Config dans `userData/config.json`.
- Scan récursif (profondeur 9), ignore `node_modules`, `.git`, `dist`, `build`, etc. Dans `~/.claude/plugins` : seul ce qui est chargé est listé (`cache/`, `synced/`), pas le catalogue `marketplaces/` ni les versions orphelines (`.orphaned_at`). Liens symboliques suivis, doublons fusionnés.
- **Langue** : sélecteur en bas de la sidebar (English par défaut, Français). UI, dialogues natifs et menus ; choix mémorisé dans `config.json`.
- Nom et description tirés du frontmatter (`name`, `description`), sinon nom du dossier/fichier.
- Éditeur EasyMDE : aperçu, côte à côte, frontmatter rendu en tableau dans l'aperçu.
- Sauvegarde : fin de ligne d'origine conservée (LF/CRLF), détection de modification externe (rechargement auto si pas de modif locale, sinon choix Écraser / Recharger).

## Raccourcis

| | |
|---|---|
| `⌘/Ctrl S` | Enregistrer |
| `⌘/Ctrl F` | Filtrer les skills |
| `⌘/Ctrl R` | Rescanner |
| `⌘/Ctrl O` | Ajouter un dossier |
| `⌘/Ctrl P` | Aperçu |
| `F9` | Côte à côte |

## Structure

```
src/
  main.js             process principal, IPC, menu, dialogs
  preload.js          API exposée via contextBridge
  scanner.js          recherche des SKILL.md
  shared/frontmatter.js   parseur YAML minimal (main + renderer)
  shared/i18n.js          traductions (main + renderer) — ajouter une langue = une entrée dans LANGS + dict
  renderer/           UI (HTML/CSS/JS sans bundler)
```

Sécurité : `contextIsolation`, `sandbox`, pas de `nodeIntegration`, CSP stricte. Le main n'accepte lecture/écriture que sur les fichiers issus du dernier scan.
