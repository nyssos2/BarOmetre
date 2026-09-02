# 🎣 BarOmètre

Générateur de programme de pêche au bar, basé sur les marées et le coefficient.
Calcule automatiquement les meilleures fenêtres (±1h autour de chaque étale) pour
n'importe quel port, connecté à l'API [TidesAtlas](https://tidesatlas.com).

## Démarrer en local

```bash
npm install
npm run dev
```

Ouvre ensuite l'URL affichée dans le terminal (en général `http://localhost:5173`).

## Déployer sur GitHub Pages

1. **Crée un repo GitHub** nommé par exemple `barometre` (public ou privé, peu importe pour Pages).

2. **Vérifie le `base` dans `vite.config.js`** — il doit correspondre exactement au nom
   de ton repo :
   ```js
   base: "/barometre/",
   ```
   Si ton repo s'appelle autrement, change cette valeur en conséquence.

3. **Pousse le code** :
   ```bash
   git init
   git add .
   git commit -m "Premier envoi de BarOmètre"
   git branch -M main
   git remote add origin https://github.com/<ton-pseudo>/barometre.git
   git push -u origin main
   ```

4. **Déploie** (le script `deploy` build le projet et pousse le résultat sur la branche `gh-pages`) :
   ```bash
   npm run deploy
   ```

5. **Active GitHub Pages** : dans le repo → *Settings* → *Pages* → source = branche `gh-pages`, dossier `/ (root)`.

6. Ton app sera en ligne à l'adresse `https://<ton-pseudo>.github.io/barometre/`.

## Installer l'app sur ton téléphone (PWA)

Une fois déployée, ouvre l'URL sur ton téléphone (Safari sur iOS, Chrome sur Android),
puis :
- **iOS (Safari)** : bouton Partager → "Sur l'écran d'accueil"
- **Android (Chrome)** : menu ⋮ → "Ajouter à l'écran d'accueil"

Elle s'ouvrira ensuite en plein écran, comme une vraie appli.

## À propos de la clé API et des données

- L'app fonctionne en **mode démo** sans rien configurer (données figées, Le Pouldu, août 2026).
- Pour des données en direct sur n'importe quel port/date, coche "Utiliser l'API en direct"
  et colle une clé [TidesAtlas](https://tidesatlas.com) (gratuite, 50 crédits offerts).
- **Ta clé API n'est jamais envoyée nulle part d'autre qu'à TidesAtlas** — elle reste dans
  ton navigateur (elle n'est même pas sauvegardée : à resaisir à chaque session, sauf si tu
  ajoutes toi-même une persistance dans `localStorage`).
- Le compteur de crédits utilisés, lui, est sauvegardé dans le `localStorage` de ton navigateur,
  par clé API. Il ne se synchronise pas entre appareils.

## Stack

- [Vite](https://vitejs.dev) + React
- [lucide-react](https://lucide.dev) pour les icônes
- Aucun backend : tout tourne côté navigateur, appels directs à l'API TidesAtlas.
