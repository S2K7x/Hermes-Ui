# Hermes-Ui

Interface web privée « type Claude.ai » pour [Hermes Agent](https://hermes-agent.nousresearch.com),
conçue pour tourner sur un Raspberry Pi 5 et remplacer le bot Telegram sans
rien perdre : outils, MCP, mémoire, skills, vision, multi-tours.

<p align="center">
  <em>SvelteKit · SQLite · SSE · PWA · Tailscale Serve</em>
</p>

## Ce que ça fait

- **Fil de conversation** avec streaming token par token et curseur de frappe
- **Sidebar d'historique** groupée par date (Aujourd'hui / Hier / 7 jours / …),
  épinglage, renommage, archivage, suppression, branches, repli sur desktop
- **Palette de commandes** `⌘K` : recherche insensible aux accents dans toutes
  les conversations + actions rapides
- **Timeline des étapes de l'agent** : chaque appel d'outil (terminal, web,
  navigateur, MCP…) affiché en direct, repliable
- **Panneau d'état** `⌘/` : contrôles de disponibilité Hermes (base, modèle,
  disque, gateway, plateformes), outils/skills exposés, tâches planifiées,
  tours en cours, coût et tokens de la conversation
- **Palette de skills** : `/` dans le composeur
- **Éditeur de skills** (📚 dans la sidebar, ou `⌘K` → « Modifier les skills ») :
  liste des `SKILL.md` groupée par catégorie, édition en texte brut,
  création guidée d'un nouveau skill
- **Images en entrée** : coller ou déposer, envoyées en base64
- **Sélecteur de modèle** parmi les fournisseurs configurés dans Hermes,
  applicable à la conversation ouverte dès le message suivant
- **Export markdown** de la conversation
- **PWA** installable sur téléphone, thème sombre, responsive
- **Raccourcis clavier** (`?` pour la liste)
- **Détachement** d'un tour en cours (voir la limite ci-dessous)

### Robustesse

L'app reste utilisable quand Hermes ne l'est pas : bandeau hors-ligne,
reconnexion automatique avec backoff, et un message qui dit quoi faire plutôt
que de recopier l'erreur amont. Les échecs transitoires sont retentés — mais
seulement sur les lectures, jamais sur un tour d'agent. Un plafond local de
tours simultanés (3 par défaut) protège le Pi avant que celui de Hermes (10)
n'entre en jeu. Le détail est dans [CLAUDE.md](CLAUDE.md).

### Skills : ce que l'éditeur fait, et ne fait pas

L'éditeur travaille sur les **fichiers** de `~/.hermes/skills`
(`<catégorie>/<skill>/SKILL.md`, plus un `DESCRIPTION.md` par catégorie), pas
sur ce que Hermes a chargé en mémoire. Conséquence à connaître :
**un skill créé ou renommé n'est pas forcément pris en compte tout de suite** —
`systemctl --user restart hermes-gateway` lève le doute.

Périmètre volontairement étroit : seuls `SKILL.md` et `DESCRIPTION.md` sont
lisibles et modifiables, il n'y a pas de suppression, les fichiers dépassant
256 Ko sont renvoyés vers la ligne de commande, et les fichiers cachés du
tri automatique de Hermes (`.bundled_manifest`, `.curator_state`) ne sont ni
listés ni accessibles. Sans le montage `/skills` (voir `docker-compose.yml`),
le panneau s'affiche désactivé au lieu de casser.

### Une limite à connaître

Le bouton carré pendant la génération **arrête l'affichage, pas l'agent**.
L'API de Hermes n'expose aucun moyen d'interrompre un tour lancé par la
Sessions API : le tour se termine en arrière-plan et sa réponse apparaît dans
la conversation (bouton « Recharger »). Le détail et l'alternative écartée sont
documentés dans [CLAUDE.md](CLAUDE.md#2-un-tour-de-la-sessions-api-ne-peut-pas-être-interrompu).

L'historique reste dans `~/.hermes/state.db` — le même que celui du CLI et du
bot Telegram. Les conversations démarrées ailleurs apparaissent ici.

## Prérequis

- Hermes Agent installé et le gateway lancé (`systemctl --user status hermes-gateway`)
- Node 22+ (ou Docker) et Tailscale

## Installation

### 1. Activer le serveur API de Hermes

Dans `~/.hermes/.env` :

```bash
API_SERVER_ENABLED=true
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8642
API_SERVER_KEY=$(openssl rand -hex 32)   # ≥16 caractères, sinon Hermes refuse de démarrer
```

Puis, dans `~/.hermes/config.yaml`, donner à la plateforme `api_server` le même
jeu d'outils qu'à Telegram :

```yaml
platform_toolsets:
  api_server:
    - browser
    - code_execution
    - file
    - memory
    - skills
    - terminal
    - web
    # …
```

Hermes ne relit pas `.env` à chaud :

```bash
systemctl --user restart hermes-gateway
curl -s http://127.0.0.1:8642/health
```

### 2. Configurer l'app

```bash
cp .env.example .env
$EDITOR .env          # HERMES_API_KEY = la même valeur que API_SERVER_KEY
chmod 600 .env
```

`HERMES_SKILLS_DIR` (défaut `/home/pi/.hermes/skills`) est le répertoire monté
en lecture-écriture dans le conteneur pour l'éditeur de skills. Retirez le
volume dans `docker-compose.yml` si vous préférez que l'app n'écrive nulle
part hors de `data/`.

### 3. Lancer

Docker (recommandé) :

```bash
docker compose up -d --build
```

Ou directement avec Node :

```bash
npm ci && npm run build && npm start
```

### 4. Publier sur le tailnet

```bash
./scripts/tailscale-serve.sh
```

Le script affiche l'URL `https://<machine>.<tailnet>.ts.net` ; reportez-la dans
`HERMES_PUBLIC_ORIGIN` puis reconstruisez. Ouvrez-la sur le téléphone et
« Ajouter à l'écran d'accueil ».

### 5. Vérifier

```bash
./scripts/smoke.sh
```

Le test bloquant est le streaming : il échoue si les tokens n'arrivent pas en
trames SSE séparées, ce qui signalerait un proxy qui bufferise.

### 6. Sauvegardes

```bash
crontab -e
# 17 3 * * *  /opt/stacks/Hermes-Ui/scripts/backup.sh >> /var/log/hermes-backup.log 2>&1
```

Sauvegarde `state.db` (historique + mémoire), `config.yaml`, les `.env` et la
base de l'UI. Renseignez `BACKUP_REMOTE` pour une copie hors-Pi.

## Pourquoi Tailscale plutôt que Cloudflare

Cloudflare bufferise `text/event-stream` et coupe la requête au bout de 100 s
(erreur 524, *Proxy Read Timeout*, fixe sur Free/Pro/Business). Un tour d'agent
qui réfléchit et enchaîne des outils dépasse régulièrement ce délai. Tailscale
Serve n'impose ni buffering ni durée maximale.

Si un accès hors-tailnet devient nécessaire : Cloudflare Tunnel + Access
(One-Time PIN restreint à votre adresse), avec des heartbeats SSE plus
fréquents que 100 s — en acceptant que ça reste fragile.

## Sécurité

Le serveur API de Hermes exécute **tout le toolset, terminal compris, sur le
Pi**. `API_SERVER_KEY` est un secret équivalent-root :

- Hermes reste sur `127.0.0.1:8642`
- le conteneur ne publie que sur `127.0.0.1:3000`
- la clé ne quitte jamais le proxy SvelteKit
- aucun port n'est ouvert sur la box
- l'éditeur de skills n'écrit que deux noms de fichiers, sous un chemin résolu
  par `realpath` et vérifié comme étant à l'intérieur du répertoire monté :
  ni `..`, ni lien symbolique, ni fichier caché n'en sortent

## Notes matérielles

Placez `~/.hermes/state.db` et `data/` sur un SSD. Les écritures SQLite
fréquentes usent rapidement une carte SD.

## Amélioration automatique quotidienne

Un timer systemd sur le Pi lance Claude Code chaque jour à 05:00. Il travaille
dans un clone isolé du dépôt sur un thème qui tourne avec les jours de la
semaine (robustesse, fonctionnalité, performance, simplification,
accessibilité, tests, intégration Hermes), vérifie son travail avec
`npm run check`, `npm test` et `npm run build`, **déploie le résultat sur
l'application** (fast-forward + rebuild Docker + smoke test, retour arrière
automatique en cas d'échec), puis pousse sur GitHub et notifie Discord.

`main` sur GitHub reflète donc ce qui tourne réellement. Une sauvegarde
horodatée est prise avant chaque exécution, et le message Discord contient la
commande de retour arrière prête à coller.

Le runner vit dans `/opt/stacks/hermes-ui-bot/` (hors dépôt, pour qu'une
mauvaise PR ne puisse pas casser le mécanisme) et sa documentation est dans
`/opt/stacks/hermes-ui-bot/README.md`.

## Documentation développeur

Voir [CLAUDE.md](CLAUDE.md) : contrat exact de l'API, pièges vérifiés
(identifiant de modèle, mécanisme d'arrêt, limites du multimodal) et
conventions du code.
