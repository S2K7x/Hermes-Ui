# CLAUDE.md — Hermes-Ui

Interface web privée mono-utilisateur pour **Hermes Agent**, façon Claude.ai,
tournant sur un Raspberry Pi 5. SvelteKit (adapter-node) + SQLite, exposée sur
le tailnet par Tailscale Serve.

## Le point essentiel

**Hermes n'est pas modifié.** Tout passe par son serveur API OpenAI-compatible
déjà intégré (`127.0.0.1:8642`). Cette UI est un client de la **Sessions API**
(`/api/sessions/*`), qui fournit gratuitement la sidebar, l'historique et le
fork. Ne jamais patcher `/mnt/data/hermes/hermes-agent/` pour un besoin de
l'UI — si quelque chose manque, c'est un contournement côté client.

## Architecture

```
Navigateur / PWA
   │  HTTPS via Tailscale Serve (<machine>.<tailnet>.ts.net)
   ▼
SvelteKit adapter-node — 127.0.0.1:3000  (conteneur Docker)
   ├── src/routes/api/**      proxy de confiance : injecte le Bearer
   ├── src/lib/server/sse.ts  relais SSE
   └── data/hermes-web.db     préférences + cache de titres (UI seulement)
   │  HTTP loopback + Authorization: Bearer
   ▼
Hermes gateway (systemd --user hermes-gateway) — 127.0.0.1:8642
   └── ~/.hermes/state.db     sessions, transcripts, mémoire  ← source de vérité
```

Le navigateur ne parle **jamais** directement à Hermes. `HERMES_API_KEY` reste
côté serveur ; aucune route ne la renvoie, aucun `$env/static/public` ne la
contient.

## Ce qu'il faut savoir avant de toucher au code

Ces points ont tous été vérifiés contre l'implémentation réelle
(`gateway/platforms/api_server.py`), pas contre la doc.

### 1. Le champ `model` d'une session doit être un vrai identifiant

`GET /v1/models` ne renvoie que le nom **virtuel** `hermes-agent`. Si on crée
une session avec ce nom, Hermes le persiste sur la ligne de session puis le
renvoie tel quel au fournisseur, et chaque tour échoue avec
`HTTP 400: hermes-agent is not a valid model ID`.

La liste réelle est dans `GET /api/model/options` (champs `model` = défaut
courant, `providers[].models`). `src/routes/api/sessions/+server.ts` résout
systématiquement ce défaut avant de créer une session.

### 2. Un tour de la Sessions API ne peut pas être interrompu

Deux constats **mesurés**, pas déduits de la doc :

1. `POST /v1/runs/{run_id}/stop` ne connaît que les runs soumis par
   `POST /v1/runs` — seul ce chemin enregistre l'agent dans
   `_active_run_agents`. Le `run_id` émis par
   `/api/sessions/{id}/chat/stream` n'y est pas : le stop répond 404.
2. Couper le flux SSE n'annule pas le run non plus. Le handler appelle bien
   `task.cancel()` quand une écriture échoue, mais ça n'arrive jamais à temps.
   Test : tour coupé à 6 s → l'agent a quand même exécuté ses 3 appels
   `terminal` et persisté sa réponse ~25 s plus tard.

**Conséquence assumée dans l'UI** : le bouton carré *détache* l'affichage. Il
pose `detached` sur le tour, affiche une explication et un bouton
« Recharger » (`chat.reload()`), puisque la réponse finira dans `state.db` de
toute façon. Ne pas rebaptiser ça « Stop » ni tenter `/v1/runs/*/stop`.

**Et l'alternative Runs API ?** Elle donne un vrai stop *et* les événements
d'approbation, mais elle a été testée et rejetée : `POST /v1/runs` accepte un
`session_id` et persiste bien le transcript, mais **ne recharge pas
l'historique de la session** — au deuxième tour l'agent répond « il n'y a pas
de question précédente ». Il faudrait lui repasser `conversation_history`, que
le handler aplatit en `str(content)` : adieu les `tool_calls` structurés et le
multimodal. Le multi-tours fidèle vaut plus que le bouton stop.

### 3. Le modèle d'une session se change — via `POST /api/sessions/{id}/model`

Hermes épingle bien un modèle sur la ligne de session à la création, mais ce
n'est pas définitif : `_handle_session_model_lock` force `require_model_lock`,
écrit un `browser_model_lock` **confirmé** dans le `model_config` de la session
et met à jour la colonne `model` (`model = COALESCE(?, model)` dans
`hermes_state.update_session_runtime_lock`). Chaque tour suivant résout son
runtime par `_effective_session_runtime_request`, où un verrou confirmé passe
**avant** la colonne `model`. Le changement s'applique donc à la conversation
ouverte, dès le message suivant.

`chat.setModel()` fait les deux : il mémorise le choix pour les nouvelles
discussions (`nextModel`, persisté en localStorage) et, si une conversation est
ouverte, pose le verrou dessus. `chat.activeModel` est ce que le sélecteur
affiche : le modèle de la session ouverte, sinon `nextModel`.

Deux pièges :

- Hermes **refuse** un modèle qu'il ne sait pas router (409
  `model_lock_unavailable`) plutôt que de retomber en silence sur le défaut
  global. Un rejet veut dire que le choix est inutilisable : `setModel()`
  annule alors aussi bien la ligne de sidebar que `nextModel`.
- La capacité est annoncée dans `GET /v1/capabilities` sous
  `features.session_model_lock`. L'UI se cale dessus (`chat.canSwitchModel`) et
  retombe sur l'ancien discours — « ce choix s'appliquera à la prochaine
  discussion » — si le gateway ne l'expose pas. Ce constat vient de la lecture
  d'`api_server.py` (0.20.0), pas d'une mesure sur un tour réel : à vérifier en
  relecture.

### 4. `X-Hermes-Session-Key` doit être stable

C'est le scope de la mémoire long-terme (Honcho / FTS5). Il est fixé une fois
pour toutes dans `HERMES_SESSION_KEY` (`agent:main:webui:dm:user`) et injecté
par `hermes.ts` sur chaque appel. S'il suivait `session_id`, la mémoire se
fragmenterait à chaque « nouvelle discussion ». Ne pas le rendre dynamique.

### 5. Pas d'upload de fichiers — images seulement

L'API accepte `image_url` en URL `http(s)` ou `data:image/...;base64`. Tout le
reste (`file`, `input_file`, `file_id`, `data:` non-image) est rejeté en
`400 unsupported_content_type`. `Composer.svelte` filtre côté client et
affiche pourquoi, plutôt que de laisser le tour échouer.

### 6. `PATCH /api/sessions/{id}` n'accepte que 4 champs

`title`, `pinned`, `archived`, `end_reason`. Tout autre champ → 400
`unsupported_session_field`. Le proxy filtre explicitement. Le modèle ne passe
pas par là mais par `POST /api/sessions/{id}/model` (point 3).

### 7. Le fork ferme le parent

`POST /api/sessions/{id}/fork` reprend la sémantique `/branch` du CLI : le
parent passe en `end_reason = "branched"` et l'enfant hérite du transcript.
Après un fork il faut donc rafraîchir **les deux** lignes de la sidebar
(`chat.forkSession` refait un `refreshSessions()` complet).

### 8. Les approbations de commandes dangereuses ne remontent pas ici

`approval.request` n'est émis que sur le flux d'événements de la Runs API. La
Sessions API ne propage que `tool.started` / `tool.completed` / `tool.failed`
et `tool.progress`. Une UI d'approbation impliquerait de basculer le chemin
d'envoi sur `POST /v1/runs` + `GET /v1/runs/{id}/events`, ce qui ferait perdre
la persistance native du transcript. Choix assumé : pas d'approbation dans
l'UI web.

### 9. Le rendu markdown est débouncé, pas immédiat

Un parse markdown complet à chaque token sature le CPU du Pi. `Markdown.svelte`
re-parse toutes les `RENDER_DEBOUNCE_MS` (70 ms) pendant le stream, puis une
fois immédiatement à la fin. `closeOpenConstructs()` équilibre les fences, le
gras et les liens tronqués pour que le texte partiel s'affiche comme ce qu'il
est en train de devenir. La coloration syntaxique n'est appliquée qu'aux
messages terminés.

### 10. Hermes ne recharge pas `.env` à chaud

Après toute modification de `~/.hermes/.env` ou `config.yaml` :
`systemctl --user restart hermes-gateway`.

## Événements SSE de `/api/sessions/{id}/chat/stream`

| Événement | Charge utile utile | Traitement UI |
|---|---|---|
| `run.started` | `user_message`, `runtime` | — |
| `message.started` | `message.id` | — |
| `assistant.delta` | `delta` | concaténé dans la bulle |
| `tool.progress` | `tool_name`, `delta` | `_thinking` → bloc raisonnement |
| `tool.started` | `tool_name`, `preview`, `args` | ajoute une étape `running` |
| `tool.completed` / `tool.failed` | `tool_name`, `preview` | clôt la dernière étape `running` du même outil |
| `assistant.completed` | `content` (texte final **autoritaire**) | écrase le buffer de deltas |
| `run.completed` | `messages`, `usage`, `runtime` | fin de tour |
| `error` | `message` | bandeau d'erreur |
| `done` | — | ferme le lecteur |

Des commentaires `: keepalive` arrivent toutes les N secondes ; le parseur
(`src/lib/sse.ts`) les ignore. `assistant.completed` est autoritaire parce que
certains contenus (médias résolus en `data:` URL) ne passent pas par les
deltas.

## Structure

```
src/
├── lib/
│   ├── server/        code jamais envoyé au navigateur
│   │   ├── config.ts    variables d'env + validation au démarrage
│   │   ├── hermes.ts    client de l'API Hermes (Bearer, timeouts, retries)
│   │   ├── sse.ts       relais SSE + pont d'abort
│   │   ├── db.ts        better-sqlite3 (prefs, cache de titres)
│   │   ├── limits.ts    sémaphore de tours + token bucket
│   │   └── respond.ts   HermesError → réponse JSON typée, `gate`, `readJson`
│   ├── client/        helpers navigateur
│   │   ├── api.ts       fetch typé → ApiError, `withRetry`
│   │   ├── storage.ts   localStorage qui ne peut pas jeter
│   │   └── platform.ts  ⌘ vs Ctrl
│   ├── components/    Sidebar, Message, ToolSteps, Composer, ModelPicker,
│   │                  Markdown, CommandPalette, StatusPanel, Shortcuts, Toasts
│   ├── stores/
│   │   ├── chat.svelte.ts    tout l'état de conversation (runes Svelte 5)
│   │   └── toast.svelte.ts   notifications
│   ├── errors.ts      ApiError + codes + `humanizeError`
│   ├── models.ts      inventaire /api/model/options (provider d'un modèle…)
│   ├── sessions.ts    groupement par date, recherche, libellés, usage
│   ├── sse.ts         parseur SSE incrémental (partagé)
│   ├── markdown.ts    rendu tolérant à l'incomplet
│   └── transcript.ts  regroupement du transcript persisté en tours UI
├── hooks.server.ts    contrôle d'origine à l'exécution + en-têtes de sécurité
├── routes/
│   ├── +page.svelte   l'écran de chat (`?s=<id>` ouvre une conversation)
│   ├── api/**         proxy authentifié
│   └── health/        sonde du healthcheck Docker
└── service-worker.ts  cache de l'app shell (jamais /api)
```

## Gestion des erreurs — le contrat

Une seule règle : **rien n'échoue en silence, et chaque message dit quoi
faire**. Trois couches, chacune avec son rôle.

**1. `lib/server/hermes.ts`** — timeout par appel (`REQUEST_TIMEOUT_MS`, 30 s ;
les flux SSE passent `timeoutMs: 0` car un tour d'agent dure légitimement des
minutes), et `retries` **uniquement sur les lectures**. Rejouer un POST qui a
créé une session ou lancé un tour dupliquerait le travail — ne jamais mettre
`retries` sur `createSession`, `forkSession` ou un stream.

**2. `lib/server/respond.ts` + `limits.ts`** — `proxy()` traduit `HermesError`
en JSON `{error:{message,code,retry_after}}` avec le statut amont. `gate()`
applique un token bucket par classe de route. Le sémaphore de
`MAX_CONCURRENT_TURNS` (3 par défaut) refuse un 4ᵉ tour **avant** Hermes : le
cap amont est de 10, mais un Pi 5 rame bien avant, surtout si plusieurs agents
lancent Chromium.

**3. `lib/errors.ts`** — `humanizeError()` transforme un code en phrase
actionnable. « Too many concurrent runs (max 10) » ne dit rien à l'utilisateur ;
« Hermes exécute déjà le maximum de tours simultanés » si. Ajouter un cas ici
plutôt que d'afficher le texte amont brut.

Points de détail qui comptent :

- **Les erreurs de streaming voyagent en SSE, pas en HTTP.** Le client lit
  `/api/sessions/{id}/stream` avec un stream reader : un corps JSON d'erreur
  lui apparaîtrait comme un flux tronqué. `sseErrorResponse()` émet donc
  `event: error` + `event: done`, avec `status` et `code` dans la charge utile.
- **404 sur une session = re-synchroniser.** Une conversation peut être
  supprimée depuis le CLI, Telegram ou un autre onglet. `openSession` retire la
  ligne fantôme de la sidebar au lieu d'afficher une erreur.
- **Le sondage de santé se ré-accélère quand ça casse** (3 s → 30 s en backoff,
  60 s quand tout va bien) et déclenche un `refreshSessions()` au retour :
  l'état a pu bouger pendant qu'on était aveugle.
- **Le titre est UNIQUE dans le schéma Hermes.** Deux discussions ouvertes par
  le même prompt collisionnent (`invalid_title`, insertion annulée). La route
  `POST /api/sessions` retente sans titre plutôt que de refuser la
  conversation.
- **Le filet de sécurité global** est dans `+layout.svelte`
  (`error` / `unhandledrejection`) : sans lui, une exception dans un effet
  fige l'UI sans un mot. Les `AbortError` y sont ignorés — ce sont des
  annulations voulues.

## Conventions

- **Svelte 5 runes** (`$state`, `$derived`, `$effect`) — pas de stores
  `writable`. Après un `push` dans un tableau `$state`, relire l'élément depuis
  le tableau : seules les mutations à travers le proxy sont réactives.
- **`ssr = false`** (`src/routes/+layout.ts`) : app privée, aucun SEO, et pas
  de rendu serveur à payer sur un Pi.
- **Aucun appel direct à Hermes depuis un composant** — tout passe par
  `/api/*`.
- Interface en **français**.
- Les tests (`tests/*.test.ts`) tournent sous `node --test` avec le
  type-stripping natif : ils importent les sources par leur chemin `.ts`, sans
  étape de build. N'y mettez que de la logique pure (pas de DOM) — c'est
  pourquoi `renderMarkdown` n'est pas testé directement, seulement
  `closeOpenConstructs` et la sortie de `marked`.
- Thème piloté par des tokens CSS dans `src/app.css`, sombre par défaut,
  `data-theme` sur `<html>`.

## Commandes

```bash
npm run dev          # dev sur 127.0.0.1:5173 (lit .env)
npm run build        # sortie dans build/
npm run check        # svelte-check — doit rester à 0 erreur
npm test             # node --test sur tests/ (parseur SSE, markdown, transcript)
npm start            # sert build/ avec node

./scripts/smoke.sh   # chaîne complète, y compris le test bloquant du streaming
./scripts/tailscale-serve.sh
./scripts/backup.sh

docker compose up -d --build
docker compose logs -f
```

Journaux Hermes : `journalctl --user -u hermes-gateway -f` et
`~/.hermes/logs/gateway.log`.

## Si tu lis ceci depuis l'exécution automatique de 05:00

Un timer systemd (`hermes-ui-improve.timer`) lance Claude Code chaque jour dans
un **clone isolé** du dépôt, sous `/opt/stacks/hermes-ui-bot/work/`. Tu n'es
pas dans le déploiement.

- Le déploiement en production est `/opt/stacks/Hermes-Ui` : **ne le touche
  pas**. Il tourne, et un humain le met à jour après avoir fusionné ta PR.
- Le runner (`/opt/stacks/hermes-ui-bot/`) ne fait pas partie du dépôt et ne
  doit pas être modifié depuis une PR.
- Ton travail est relu. Un diff clair et vérifié vaut mieux qu'un gros diff.
- `git log --oneline -15` te dit ce que les exécutions précédentes ont fait :
  ne recommence pas la même chose.
- La source de vérité sur l'API Hermes est
  `/mnt/data/hermes/hermes-agent/gateway/platforms/api_server.py`, en lecture
  seule. La documentation en ligne est en retard sur cette version (0.20.0).

Les consignes complètes sont dans `/opt/stacks/hermes-ui-bot/prompt.md`.

## Sécurité — non négociable

- Le serveur API exécute **le toolset complet, terminal compris, sur le Pi**.
  `API_SERVER_KEY` est un secret équivalent-root.
- `API_SERVER_HOST=127.0.0.1` — ne jamais binder 8642 ailleurs.
- Le conteneur ne publie que sur `127.0.0.1:3000`. L'exposition passe par
  Tailscale Serve, pas par une redirection de port sur la box.
- Ne pas activer `API_SERVER_CORS_ORIGINS` : le navigateur n'a aucune raison
  de joindre Hermes directement, et l'activer signifierait exposer la clé.
- Pas d'auth applicative : l'identité est garantie par le tailnet. Ne pas
  bricoler un mot de passe maison.
