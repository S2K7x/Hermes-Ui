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
   ├── src/lib/server/turns.ts tours en vol (survivent au départ du client)
   ├── data/hermes-web.db     prefs, prompts, thème, titres, agents, push
   └── /skills                bind mount de ~/.hermes/skills (éditeur de skills)
   │
   ├─ HTTPS sortant → service de push (Apple / Google / Mozilla)
   │     └── notification chiffrée quand un tour finit sans spectateur
   │
   ├─ HTTP loopback + Authorization: Bearer
   │  ▼
   │  Hermes gateway (systemd --user hermes-gateway) — 127.0.0.1:8642
   │     └── ~/.hermes/state.db  sessions, transcripts, mémoire ← source de vérité
   │
   └─ HTTP loopback + X-Hermes-Session-Token
      ▼
      Hermes dashboard (systemd --user hermes-dashboard) — 127.0.0.1:9119
         └── ~/.hermes/.env + config.yaml  identifiants des providers
```

Deux serveurs amont, deux secrets distincts, deux rôles : le **gateway** fait
tourner l'agent, le **dashboard** configure Hermes. Aucun des deux ne doit être
patché — voir le point 13 pour ce que ça implique côté providers.

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

Côté serveur, cette même mesure est ce qui justifie le point 16 : puisque
l'agent finit son travail de toute façon, le serveur suit le tour jusqu'au bout
au lieu de couper le `fetch` amont.

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
pas par là mais par `POST /api/sessions/{id}/model` (point 3). Poser
`archived` est accepté, mais rend la conversation invisible à toute liste —
voir le point 12.

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

**Le post-traitement d'un message terminé doit attendre `tick()`.** `html` est
affecté *depuis* un effet, donc quand l'effet suivant s'exécute Svelte n'a pas
encore écrit `{@html html}` dans le DOM : lire `container` à ce moment-là
décore le balisage **précédent**, que l'échange à venir jette. C'est ce qui
faisait que ni la coloration syntaxique ni le bouton « copier » n'apparaissaient
jamais. **Mesuré sur l'app en production** avant correction : un transcript
affichant 13 blocs de code contenait zéro `span.hljs-*`, aucun `data-hl` et zéro
bouton. Ne pas retirer ce `tick()`.

**Et les grammaires de coloration sont chargées à la demande.**
`highlight.js/lib/common`, ce sont 37 langages qui construisent tous leurs
objets `RegExp` à l'initialisation du module. Mesuré : 164 Ko du chunk d'entrée
(389 Ko → 226 Ko brut, 103 Ko → 65 Ko en brotli) et 48 ms d'initialisation sur
le CPU du Pi — contre 22 ms pour `marked` + `dompurify` réunis — payés à chaque
ouverture de l'app, y compris pour une conversation sans une ligne de code. Et
tant que le bug ci-dessus vivait, payés pour **rien du tout**.

D'où un `import()` dynamique dans `src/lib/markdown.ts`, avec trois
conséquences dans le code :

- `highlightCodeBlocks()` **ne fait rien** tant que le paquet n'est pas
  résident, et ne pose alors pas `data-hl` : c'est l'appelant qui rejoue après
  `loadHighlighter()`. Ne pas supposer la coloration synchrone.
- Pour éviter le clignotement « code brut puis coloré », `Markdown.svelte`
  déclenche le chargement dès qu'une fence apparaît **pendant** le stream. Le
  test se fait dans `render()`, donc au rythme du debounce, pas à chaque token.
- Le chunk fait partie du shell préchargé par le service worker : après la
  première visite c'est un hit de cache, pas un aller-retour, et le hors-ligne
  reste entier. Un échec de chargement laisse le code en noir et blanc plutôt
  que de casser le message.

`tests/markdown.test.ts` vérifie qu'aucun `import` **statique** de
`highlight.js` ne revient — ce serait remettre les 164 Ko sur le chemin
critique sans que rien ne le signale.

### 10. Hermes ne recharge pas `.env` à chaud

Après toute modification de `~/.hermes/.env` ou `config.yaml` :
`systemctl --user restart hermes-gateway`.

### 11. L'éditeur de skills touche des fichiers, pas l'API

`GET /v1/skills` (proxifié par `/api/skills`) dit ce que Hermes **a chargé**.
L'éditeur, lui, travaille sur le disque : `SKILLS_DIR` (le bind mount `/skills`
en Docker, rien du tout ailleurs) pointe sur `~/.hermes/skills`, organisé en
`<catégorie>/<skill>/SKILL.md` avec un `DESCRIPTION.md` par catégorie.

Rien ici ne suppose que Hermes relit ses skills à chaud — l'UI dit simplement
qu'un `systemctl --user restart hermes-gateway` peut être nécessaire. Ne pas
prétendre le contraire sans l'avoir mesuré.

Les invariants, tous dans `src/lib/skills.ts` (pur, testé) et
`src/lib/server/skills.ts` (fs) :

- Chaque composant de chemin passe par `skillSegments()` : noms validés
  `^[a-z0-9][a-z0-9-]*$`, 64 caractères max. Ni `..`, ni `/`, ni fichier caché
  ne peuvent en sortir — `.bundled_manifest` et `.curator_state` appartiennent
  au tri automatique de Hermes et ne sont ni listés ni ouverts.
- Seuls `SKILL.md` (niveau skill) et `DESCRIPTION.md` (niveau catégorie) sont
  adressables, et chacun uniquement à son niveau.
- Le répertoire porteur est **realpath-é** et doit rester dans le realpath de
  la racine. C'est ce qui bloque un lien symbolique planté dans l'arbre
  (vérifié : un `escaped -> /tmp/…` répond `invalid_skill_path` en lecture
  comme en écriture). Les répertoires symlinkés ne sont pas non plus listés.
- 256 Ko max en lecture comme en écriture, et l'écriture est atomique
  (fichier temporaire **non caché** dans le même répertoire, puis `rename`).
- Pas de suppression, et pas de création par écrasement : un skill existant
  répond 409 `skill_exists`.
- `SKILLS_DIR` absent ou illisible → `available: false` sur
  `GET /api/skills/files`, et le panneau s'affiche désactivé. C'est le cas
  normal en `npm run dev` hors Docker : ne pas le traiter comme une erreur.

Routes : `GET|POST /api/skills/files` (liste / création) et
`GET|PUT /api/skills/files/content` (lecture / écriture). Elles n'utilisent pas
`proxy()` — il ne connaît que `HermesError` — mais `skillsJson()`, son
équivalent pour `SkillsFsError`.

### 12. Archiver, c'est une porte à sens unique côté API

`GET /api/sessions` ne peut **jamais** renvoyer une conversation archivée.
`_handle_list_sessions` appelle `list_sessions_rich()` sans `include_archived`
(défaut `False`) et n'expose aucun paramètre de requête pour le changer —
`archived_only` non plus. Vérifié : zéro occurrence des deux dans
`api_server.py` (0.20.0). Seul `GET /api/sessions/{id}` atteint une ligne
archivée, car `get_session` ne filtre pas.

Conséquence : filtrer la liste sur `archived` ne peut donner qu'un résultat
vide. La sidebar tient donc **deux** listes distinctes — `chat.sessions`
(vivantes, celles que l'amont renvoie) et `chat.archivedSessions` — et
`toggleArchive()` déplace la ligne de l'une à l'autre au lieu de basculer un
drapeau sur place.

Le contournement pour retrouver les archivées :

- `session_meta` (dans `data/hermes-web.db`, déjà là pour le cache de titres)
  sert d'**index des identifiants déjà vus**. `GET /api/sessions` y enregistre
  chaque id renvoyé (`rememberSessions()`, insertion seule : rafraîchir la
  sidebar ne doit pas réécrire 200 lignes).
- `GET /api/sessions?archived=true` prend les ids connus, retire ceux que la
  liste vivante renvoie encore (`archivedCandidates()`, pur et testé), et
  interroge chaque survivant par `GET /api/sessions/{id}`. Un 404 sort l'id de
  l'index (supprimée ailleurs) ; une ligne non archivée était simplement hors
  fenêtre de récence.
- Le fan-out est plafonné à 60 sondes, 6 en parallèle, et la réponse porte
  `truncated` pour que l'UI le dise au lieu de faire croire à un archivage
  exhaustif. C'est aussi pourquoi cette vue est chargée **à la demande** et
  jamais pendant un `refreshSessions()`.

Limite assumée : une conversation archivée **avant** que son id soit entré dans
l'index reste introuvable. Ça couvre l'archivage fait depuis l'UI, depuis le
CLI, ou par la purge `sessions.auto_archive` de Hermes, tant que la
conversation a été vue au moins une fois dans une liste.

### 13. Les providers passent par le dashboard, jamais par une écriture directe

`~/.hermes/.env` n'est pas la seule copie d'une clé d'API. `config.yaml` en
garde des miroirs dans `model.api_key`, `auxiliary.*.api_key` et
`custom_providers[*]`, et ces miroirs sont **prioritaires**. Écrire `.env`
nous-mêmes laisserait donc l'ancienne clé authentifier après une rotation.

`PUT /api/env` du dashboard passe par `save_provider_env_credential`, qui écrit
et réconcilie les deux. On proxifie, on ne recode pas. Idem pour la suppression
(`remove_provider_env_credential`, qui nettoie aussi `auth.json` et le cache de
modèles).

Ce qui a été vérifié sur cette machine, contre `hermes_cli/web_server.py` :

- **Toute route `/api/*` du dashboard exige le jeton**, y compris
  `GET /api/providers/oauth/{id}/poll/{sid}` : le handler n'appelle pas
  `_require_token`, mais `auth_middleware` gate tout ce qui n'est pas dans
  `PUBLIC_API_PATHS`. Mesuré : `401 {"detail":"Unauthorized"}` sans en-tête.
  Notre proxy envoie le jeton partout, donc ça ne change rien — mais ne pas
  écrire dans l'UI qu'une route serait publique.
- `GET /api/env` renvoie ~320 variables, dont 75 de `category == "provider"` et
  40 avec `is_password`. `groupProviderKeys()` ne garde que ces 40 et tourne
  **côté serveur** : les autres lignes (dont les secrets personnels rangés en
  `category == "custom"`) ne doivent pas atteindre la page, même caviardées.
- Les `*_BASE_URL` sont aussi des lignes `provider`, mais ce sont des réglages,
  pas des identifiants. Le panneau les exclut : un champ « clé » et un champ
  « URL » côte à côte, c'est une clé collée dans le mauvais champ.
- `POST /api/providers/validate` ne sonde que OPENROUTER / OPENAI / XAI /
  GEMINI. Partout ailleurs la réponse est `{ok: true, reachable: false}`, ce qui
  veut dire « inconnu », pas « mauvais » : seul un `{ok: false, reachable:
  true}` bloque l'enregistrement (`validationBlocks()`).
- `flow == "external"` (qwen-oauth, copilot-acp, claude-code) : `POST
  .../start` répond **400 avec la commande CLI à lancer**. Mesuré. Le panneau
  affiche la commande et ne propose pas de bouton — ne pas prétendre gérer ce
  flux.
- `flow == "pkce"` n'existe que pour `anthropic`, et le `submit` est réservé à
  lui. Les autres sont en `device_code` : code + URL de vérification, puis
  sondage jusqu'à `approved | denied | expired | error`.
- `POST /api/model/set` peut répondre `{ok: false, confirm_required: true,
  confirm_message}` **sans rien écrire** quand le garde-fou de coût s'inquiète.
  Le panneau affiche l'avertissement et rejoue avec
  `confirm_expensive_model: true`. Ce modèle global ne vaut que pour les
  **nouvelles** conversations — le changement à chaud reste le point 3.

Ce que l'UI ne fait délibérément pas :

- **`POST /api/env/reveal` n'est pas proxifié.** Le dashboard ne donne que
  `redacted_value` (`sk-o...60c6`) et c'est tout ce qui atteint le navigateur.
  Aucune valeur de clé n'est journalisée non plus.
- `HERMES_DASHBOARD_TOKEN` ne quitte jamais le serveur. Absent → le panneau
  s'affiche désactivé et le reste de l'application fonctionne, exactement comme
  l'éditeur de skills sans son bind mount.
- Les messages d'erreur du dashboard sont déjà en français quand ils viennent
  de `dashboard.ts` (jeton, injoignable, timeout) ; ceux qui viennent de
  FastAPI (`{"detail": ...}`) sont passés tels quels, parce que leur contenu
  *est* l'information utile (« run `hermes auth add qwen-oauth` manually »).
  D'où l'absence de cas supplémentaires dans `humanizeError()`.

Une route de lecture supplémentaire vient du dashboard sans rapport avec les
providers : `GET /api/cron/delivery-targets`, qui dit quelles plateformes ont un
canal d'accueil configuré. Voir le point 14.

Le jeton vient de `HERMES_DASHBOARD_SESSION_TOKEN` dans
`~/.hermes/dashboard.env`, que l'unité systemd `hermes-dashboard.service` lit
via `EnvironmentFile` — il survit donc aux redémarrages du service.

Routes : `GET /api/providers` (clés groupées + comptes, en un aller-retour),
`PUT|DELETE /api/providers/keys`, `POST /api/providers/keys/validate`,
`POST|DELETE /api/providers/oauth/{id}`,
`GET /api/providers/oauth/{id}/poll/{sid}`,
`POST /api/providers/oauth/{id}/submit`,
`DELETE /api/providers/oauth/sessions/{sid}` et `POST /api/providers/model`.
Elles n'utilisent pas `proxy()` mais `dashboardResponse()`, son équivalent pour
`DashboardError`.

Limite assumée : ces routes écrivent dans la configuration de Hermes sans
authentification applicative. C'est le même modèle de menace que le reste de
l'application — quiconque atteint cette UI pilote déjà un agent qui a un
terminal sur le Pi — mais c'est à garder en tête si l'exposition change.

### 14. Les tâches planifiées : `/api/jobs`, avec trois pièges mesurés

Le gateway expose le cron de Hermes en entier — `GET|POST /api/jobs`,
`GET|PATCH|DELETE /api/jobs/{id}`, `POST /api/jobs/{id}/{pause|resume|run}` —
et l'UI en utilise la liste, la création, les trois actions et la suppression
(`ProvidersPanel` a son pendant : `JobsPanel`). Ce qui a été **mesuré** sur
cette machine, contre `api_server.py` et `cron/jobs.py` (0.20.0) :

- **Une tâche mise en pause disparaît de la liste par défaut.** `pause` retire
  `enabled`, et `_handle_list_jobs` appelle `_cron_list()` sans
  `include_disabled` (défaut `False`). Sans le paramètre, la ligne s'évanouit
  au clic sur « Mettre en pause ». `listJobs()` envoie donc toujours
  `?include_disabled=true` et l'UI affiche l'état elle-même.
- **Un horaire invalide répond 500, pas 400.** `_handle_create_job` ne valide
  que `name` et `prompt` ; `parse_schedule` lève un `ValueError` qui tombe dans
  l'`except Exception` générique. D'où `parseSchedule()` dans `src/lib/jobs.ts`
  (pur, testé), qui rejoue les règles amont côté navigateur *et* côté route :
  `every <durée>` d'abord, puis 5+ champs cron, puis un timestamp ISO, puis une
  durée nue. Les bornes des cinq champs cron sont vérifiées en plus, parce que
  `croniter` refuserait `0 25 * * *` en 500 aussi.
- **`schedule` est un objet, pas une chaîne** :
  `{kind, expr|minutes|run_at, display}`. L'afficher tel quel imprime
  `[object Object]` — c'est ce que faisait le `StatusPanel`. `schedule_display`
  est la version lisible, mais elle est en anglais et en minutes brutes
  (« every 720m ») : `scheduleDisplay()` repart des champs structurés et ne
  retombe dessus qu'en dernier recours. De même, `state` est l'état réconcilié
  par `effective_job_state()` (un job `enabled` n'est jamais affiché en pause) —
  il n'existe pas de champ `paused`.

La **livraison** ne se devine pas côté gateway : `deliver` est résolu au
déclenchement à partir des `*_HOME_CHANNEL` de l'environnement, que l'API ne
publie pas. La liste vient donc du dashboard,
`GET /api/cron/delivery-targets`, dont seul `home_target_set` distingue une
plateforme qui livrera vraiment d'une qui résoudrait vers rien
(`usableTargets()`). Le dashboard injoignable ne casse pas le panneau : il ne
reste que `local`, la seule promesse tenable sans cette information.

`deliver = "origin"` n'est **pas** proposé : une tâche créée par cette UI porte
un `origin` `{platform: "api_server", chat_id: "api"}`, qui n'est pas une
destination livrable.

Le gateway sans son module cron répond 501 `Cron module not available` : le
panneau le dit et se désactive, comme l'éditeur de skills sans son bind mount.
Ne pas se fier au drapeau `features.jobs_admin` de `/v1/capabilities` — il est
codé en dur à `false` alors que les routes fonctionnent.

**Une tâche appartient à un agent, et sa fiche voyage dans le prompt.** Le cron
de Hermes ne connaît qu'un prompt par tâche : `_handle_create_job` ne transmet
que `name`, `schedule`, `prompt`, `deliver`, `skills` et `repeat` — ni
`system_message`, ni `model`, alors que `cron/jobs.py::create_job` les accepte.
Faire tourner une tâche « en tant qu'agent » veut donc dire **composer sa fiche
dans le prompt**, ce que fait `composeJobPrompt()` (pur, testé) : la fiche
d'abord, un en-tête qui dit que personne ne regarde, puis l'instruction. Trois
conséquences :

- **L'instruction passe avant la fiche** quand les 5 000 caractères amont sont
  atteints : c'est la fiche qui est rognée, jamais la consigne.
  `jobInstructionLimit()` donne la borne à afficher, et le panneau montre le
  coût réel (« dont N pour la fiche de l'agent ») en rejouant la **même**
  fonction que le serveur.
- Le lien tâche → agent et l'instruction telle que tapée vivent dans
  `job_meta` (`data/hermes-web.db`), pas dans Hermes : une fois composé, le
  prompt amont ne se re-découpe pas. `GET /api/jobs` ajoute `agent_id`,
  `instruction` et `persona_stale` à chaque ligne, comme `agent_id` sur une
  session (point 18). Une tâche planifiée avant cette table n'a pas de ligne :
  son prompt **est** son instruction, et elle n'a pas d'agent.
- `persona_stale` est vrai quand la fiche de l'agent a été modifiée depuis :
  le serveur recompose et compare au prompt que Hermes détient. Le panneau
  propose alors « Mettre à jour » (un `PATCH` avec les mêmes valeurs), au lieu
  de laisser croire qu'éditer un agent met ses tâches à jour toutes seules.

Deux détails mesurés sur l'édition :

- `PATCH /api/jobs/{id}` accepte `schedule` en **chaîne** : `update_job` la
  re-parse et recalcule `next_run_at` lui-même. L'UI envoie donc toujours le
  formulaire entier — un corps sans aucun champ autorisé répond 400 de toute
  façon.
- Ré-envoyer l'horaire d'un **one-shot déjà passé** est refusé par `update_job`
  (`ValueError` → 500). `canEditJob()` le détecte côté client : la tâche
  s'édite quand même, mais il faut choisir une nouvelle date, et le bouton
  « Mettre à jour la fiche » disparaît.

Côté ergonomie, l'horaire ne se tape plus : `scheduleFromSpec()` /
`specFromExpression()` traduisent dans les deux sens entre les sélecteurs
(chaque jour / semaine / mois, intervalle, une fois) et l'expression amont, et
`humanCron()` affiche « chaque vendredi à 19 h 00 » plutôt que `0 19 * * 5`. Ce
qui ne rentre pas dans ces cas (`0 9-18 * * 1-5`) reste en mode « Expression »
et fait l'aller-retour intact.

Routes : `GET|POST /api/jobs` (liste + cibles de livraison en un aller-retour /
création) et `POST|PATCH|DELETE /api/jobs/{id}` (action / édition /
suppression).

### 15. Les prompts enregistrés sont de l'état d'UI, pas de l'état Hermes

Hermes n'a aucun endpoint de bibliothèque de prompts — ni dans
`api_server.py`, ni dans le dashboard. Les prompts enregistrés vivent donc dans
la table `prefs` de `data/hermes-web.db`, sous la clé `saved_prompts`, derrière
`GET|PUT /api/prompts`. Ne pas chercher à les faire porter par une session ni
par la mémoire long-terme de Hermes : ce sont des raccourcis d'interface.

Le stockage est **serveur** et non `localStorage`, et c'est tout l'intérêt : un
prompt enregistré depuis le desktop est là sur le téléphone. Deux conséquences
dans le code :

- La ligne prefs est un seul blob JSON, donc les bornes sont appliquées
  **côté serveur** par `normalizePrompts()` (`src/lib/prompts.ts`, pur et
  testé) : 40 prompts, 4 000 caractères par prompt, 60 pour le titre. La même
  fonction sert de garde-fou au navigateur et de réparateur d'une ligne écrite
  par une version antérieure — elle ne jette jamais.
- `PUT /api/prompts` **refuse** un corps dont `prompts` n'est pas une liste
  (400 `invalid_body`) au lieu de le normaliser en `[]` : un bug côté client ne
  doit pas pouvoir effacer la bibliothèque. L'écriture est un remplacement
  complet, et le store adopte la réponse du serveur — c'est la version bornée.

Côté UI, un prompt choisi est **ajouté** au composeur, jamais substitué : un
message à moitié écrit doit survivre à un tap malheureux sur la bibliothèque.

### 16. Le serveur possède le tour, pas le navigateur

C'est le renversement qui rend les notifications possibles. Avant, le relais SSE
annulait le `fetch` amont dès que le navigateur partait : le serveur n'apprenait
jamais comment le tour s'était terminé. Or on savait déjà (point 2) que
**l'agent, lui, continue** — annuler ne servait donc à rien et coûtait la seule
chose utile : la réponse, au moment où elle arrive, pendant que l'utilisateur
est ailleurs.

`src/lib/server/turns.ts` tient donc un registre des tours en vol. La route
`/api/sessions/{id}/stream` démarre le tour, `beginTurn()` lit le flux amont
**jusqu'à son événement terminal quoi qu'il arrive** et le recopie vers le
navigateur tant qu'il est attaché. Ce qui change concrètement :

- Le signal d'abandon du navigateur n'est **plus** câblé sur le `fetch` amont.
  Fermer l'onglet ou taper le bouton carré détache l'affichage, exactement comme
  avant côté UI, mais la boucle de lecture continue.
- Le créneau du sémaphore `MAX_CONCURRENT_TURNS` est tenu pour **toute** la
  durée du tour, plus seulement pendant que quelqu'un regarde. C'est plus juste
  (le Pi travaille vraiment) mais se détacher puis renvoyer aussitôt peut
  atteindre le plafond.
- Plus rien ne libérerait un tour amont bloqué, d'où `MAX_TURN_MS` (20 min par
  défaut) qui abandonne la lecture et rend le créneau.
- Le flux poussé vers le navigateur utilise une `ByteLengthQueuingStrategy` : un
  client qui ne lit plus (téléphone endormi, socket morte) est lâché au-delà
  d'un mégaoctet en attente au lieu de faire gonfler la mémoire du Pi.
- Aucun événement terminal n'est fabriqué à la fermeture : un flux qui s'arrête
  sans `done` reste ce que le client lit déjà comme « tronqué » (point du
  contrat d'erreurs), avec son bouton « Recharger ».

Un tour lancé sans en-tête `Origin` n'est **pas** notifiable : les navigateurs
en envoient un sur tout POST (c'est l'invariant sur lequel repose déjà
`hooks.server.ts`), donc son absence signifie un script — `scripts/smoke.sh`
joue un vrai tour après chaque déploiement et personne ne veut ça sur son écran
verrouillé à 5 h du matin.

### 17. Notifications push : ce qui est mesuré, ce qui ne l'est pas

Quand un tour se termine et que personne ne regardait, le serveur envoie une
notification Web Push. `shouldNotifyTurn()` (`src/lib/turns.ts`, pur et testé)
combine deux signaux, et **l'un des deux suffit** :

- **Aucun lecteur attaché** au flux SSE. iOS suspend une PWA en arrière-plan et
  la connexion tombe : ce signal seul couvre le téléphone.
- **`document.visibilityState`**, remonté par la page sur
  `POST /api/push/presence` (`visibilitychange` et `pagehide`, en `keepalive`).
  Sans lui, un onglet de bureau en arrière-plan garde son flux ouvert et
  ressemblerait à quelqu'un qui lit. La présence est **globale** au serveur —
  application mono-utilisateur — et ignorée passé 10 minutes.

Le chiffrement est écrit avec `node:crypto` (`src/lib/server/push-crypto.ts`),
sans dépendance : ECDH P-256, HKDF-SHA256, AES-128-GCM, et un JWT ES256 signé
avec `dsaEncoding: 'ieee-p1363'` — c'est ce qui évite la conversion DER → JOSE à
la main. `tests/push-crypto.test.ts` le confronte au **vecteur de test de la
RFC 8291 §5** : secret ECDH, PRK, CEK, nonce, en-tête de 86 octets et
chiffré, valeur par valeur. Ne pas modifier ce module sans que ce test passe.

Les contraintes iOS, à respecter sous peine de silence :

- La permission se demande depuis un **geste utilisateur**. `push.enable()`
  appelle `Notification.requestPermission()` en première instruction, avant tout
  `await` : Safari n'honore la demande que tant que le geste est sur la pile.
- Web Push n'existe que pour une PWA **installée sur l'écran d'accueil**. En
  onglet Safari, `subscribe` lève. `needsHomeScreenInstall()` détecte le cas et
  le panneau explique l'étape au lieu d'afficher un bouton condamné.
- **Chaque push affiche une notification.** Le handler `push` du service worker
  se termine toujours par `showNotification`, même sur charge utile absente ou
  illisible : Safari révoque l'abonnement d'un push silencieux.
- `410` et `404` du service de push suppriment la ligne ;
  `pushsubscriptionchange` se réabonne depuis le service worker (la clé publique
  revient de `GET /api/push`).

Ce qui a été vérifié sur cette machine, contre l'application construite et un
faux service de push qui déchiffre ce qu'il reçoit : client coupé à 1 s → tour
terminé côté serveur puis notification livrée et déchiffrée avec le bon titre de
conversation et le lien `/?s=<id>` ; client resté jusqu'au bout → aucune
notification ; client attaché mais présence « caché » → notification ; abonnement
malformé → ligne supprimée ; endpoint injoignable → `last_error` enregistré.
**Ce qui n'est pas vérifié** : la livraison réelle sur un iPhone. Elle dépend
d'APNs et de l'installation sur l'écran d'accueil — c'est le bouton « Envoyer un
test » du panneau d'état qui le dira.

Stockage : table `push_subscriptions` de `data/hermes-web.db`, une ligne par
appareil. L'endpoint est une **capacité** (le connaître suffit pour pousser vers
l'appareil) et ne sort donc jamais du serveur : l'UI ne voit qu'un condensé
(`deviceId`) et l'hôte du service de push.

**Hors périmètre, ne pas le laisser croire** : les réponses produites par les
tâches planifiées (`/api/jobs`) ou par Telegram ne passent pas par ce flux et ne
déclencheront aucune notification. Un tour dont le flux est tronqué, ou coupé
par `MAX_TURN_MS`, n'en déclenche pas non plus : on ne sait pas ce que Hermes a
répondu, et « quelque chose est peut-être prêt » vaut moins que le silence — la
réponse est de toute façon dans le transcript.

Routes : `GET|POST|DELETE /api/push` (configuration + liste / abonnement /
retrait), `POST /api/push/test`, `POST /api/push/presence`.

### 18. Les agents personnalisés : le prompt part à CHAQUE tour

Une conversation appartient à un **agent** — un nom, un emoji, un métier, un
prompt système, un modèle préféré facultatif, et la liste des agents qu'il a le
droit de piloter. Tout vit dans `data/hermes-web.db` (table `agents`, plus une
colonne `agent_id` ajoutée à `session_meta`) : Hermes n'a aucune notion de
persona, et lui en ajouter une voudrait dire le patcher.

Le point qui commande tout le reste, **vérifié** dans `api_server.py` (0.20.0) :

- `_handle_session_chat_stream` (~ligne 3782) construit son prompt système
  **uniquement** depuis `body.get("system_message") or body.get("instructions")`.
  La colonne `sessions.system_prompt`, elle, n'est jamais relue pour un tour :
  elle ne sert qu'à `has_system_prompt` et à la propagation lors d'un fork.
- `POST /api/sessions/{id}/model` met même cette colonne à NULL.

**Conséquence** : la persona doit être renvoyée dans `system_message` à chaque
message, sinon elle disparaît au deuxième tour — et un changement de modèle
l'effacerait pour de bon. C'est `/api/sessions/{id}/stream` qui la recompose,
via `systemPromptForSession()`, et **le navigateur n'a pas voix au chapitre** :
la route ignore délibérément tout `system_message` reçu dans le corps. Deux
onglets ne peuvent donc pas être en désaccord sur qui parle.

La hiérarchie n'est pas réimplémentée : c'est celle de Hermes. L'outil
`delegate_task` (toolset `delegation`, `tools/delegate_tool.py`) prend `goal`,
`context`, `tasks[]`, `output_schema` et surtout `role: "leaf" | "orchestrator"`
— un enfant `orchestrator` garde le toolset de délégation et peut spawner à son
tour, dans les bornes de `delegation.max_spawn_depth` /
`max_concurrent_children` de `~/.hermes/config.yaml`. Ne pas construire un
système de sous-agents par-dessus.

Ce que ça implique dans le code :

- `composeSystemPrompt()` (`src/lib/agents.ts`, pur et testé) écrit la section
  « Ton équipe » **à partir des fiches des agents enfants**, pas d'un texte
  saisi à la main : modifier le métier d'un spécialiste change ce que son chef
  sait de lui, sans rien réécrire. C'est ça, « facilement personnalisable ».
- Un enfant délégué démarre d'une conversation vide. Sa persona ne peut donc
  arriver que par le texte de l'appel — d'où la consigne, dans le prompt du
  chef, de recopier la fiche du spécialiste dans `context`. La fiche est bornée
  à `CHILD_BRIEF_CHARS` (800) : ce prompt repart à chaque message.
- Les seuls enfants annoncés comme `role: "orchestrator"` sont ceux qui sont
  eux-mêmes marqués orchestrateurs **et** ont une équipe. Un enfant `leaf` se
  voit retirer `delegate_task` par `DELEGATE_BLOCKED_TOOLS` : lui promettre une
  équipe serait un mensonge. `teamTree()` applique la même règle à l'affichage.
- Aucun chiffre de `config.yaml` n'est cité dans le prompt composé
  (profondeur, enfants simultanés) : aucun endpoint ne les publie, et un chiffre
  périmé dans un prompt système est pire que pas de chiffre. Le prompt dit
  seulement quoi faire si Hermes refuse l'appel.
- Une boucle dans l'équipe serait un prompt qui récurse à l'infini. Deux
  garde-fous, pas un : `validateAgent()` refuse le cycle à l'entrée en affichant
  la chaîne fautive (`Chef → Recherche → Chef`), et `normalizeAgents()` **casse**
  les arêtes fautives à la lecture, pour qu'une ligne écrite à la main ne puisse
  pas figer le serveur. `composeSystemPrompt()` et `teamTree()` sont bornés par
  ailleurs.
- Supprimer un agent le retire des équipes qui le citaient et délie ses
  conversations (`removeAgent`, transaction) ; leur transcript est intact, elles
  repassent simplement au prompt par défaut de Hermes.
- Le modèle préféré d'un agent l'emporte sur le sélecteur à la création d'une
  conversation, **mais seulement s'il est routable** : un id de modèle périmé sur
  une ligne de session fait échouer chaque tour (point 1).
- Le fork reprend l'agent du parent : c'est la même conversation continuée.
- `agent_id` sur une ligne de session **n'est pas un champ Hermes**. C'est le
  proxy `/api/sessions*` qui l'ajoute à la sortie, à partir de `session_meta`.

**Ce qui n'est PAS fait, et ne doit pas être promis** : les sous-agents ne sont
pas streamés. Sur la Sessions API une délégation n'apparaît que comme une étape
d'outil `delegate_task` ; les événements `subagent.start` / `subagent.complete`
/ `subagent.text` n'existent que sur le flux de la Runs API, écartée au point 2.
Hermes écrit bien un journal par sous-tâche dans
`<hermes_home>/cache/delegation/live/<delegation_id>/task-<n>.log`
(`tools/delegation_live_log.py`), mais ce répertoire n'est pas monté dans le
conteneur : soit on le monte en lecture seule et on le lit vraiment, soit on ne
promet rien. Pas d'entre-deux.

Routes : `GET|POST /api/agents`, `PATCH|DELETE /api/agents/{id}` et
`POST /api/sessions/{id}/agent` (relier une conversation ouverte à un agent, ou
`null` pour la détacher — effectif au message suivant, comme le verrou de
modèle du point 3).

Une **tâche planifiée** peut elle aussi porter un agent, mais par un tout autre
chemin : le cron n'accepte pas de `system_message`, donc la fiche est composée
**dans le prompt de la tâche** au moment où elle est enregistrée, et ne se met
pas à jour toute seule quand l'agent change. Voir le point 14.

### 19. Le thème : dix couleurs déclarées, tout le reste dérivé

L'apparence est un réglage à part entière, pas une bascule clair/sombre. Un
**préréglage** (`PRESETS` dans `src/lib/theme.ts`) déclare **dix couleurs par
mode** et rien de plus : fond, surface, surface creusée, texte, texte
secondaire, deux accents, tonalité profonde (`rail`), danger, succès. Survols,
bordures, texte discret, fonds doux et bulle de l'assistant sont **calculés**
par `themeVariables()` en `color-mix(in oklab, …)`. C'est ce qui fait qu'un
accent choisi ne peut pas laisser un survol périmé derrière lui : la couleur
n'est écrite qu'à un seul endroit.

Trois choses ne sont **pas** laissées au CSS, parce qu'elles demandent un calcul
qu'aucune feuille de style ne sait faire, et sont donc des fonctions pures
testées :

- `readableInk()` choisit, entre une encre sombre et le blanc, celle qui a le
  meilleur contraste WCAG sur une couleur. C'est ce qui pose le texte des
  badges, du bouton d'envoi et du rail.
- `ensureContrast()` **assombrit un accent juste assez** pour que le blanc
  dessus atteigne 4,5:1, et pas plus. C'est la bulle utilisateur : « orange
  plein, texte blanc » reste vrai même si l'utilisateur choisit un jaune. Le
  test rejoue tous les accents des préréglages plus les cas pathologiques
  (`#ffff00`, `#ffffff`, `#7f7f7f`).
- `ensureVisible()` pousse l'accent vers l'encre jusqu'à ce qu'il tienne 3:1 sur
  **tous** les fonds où il sera dessiné. C'est `--focus`, l'anneau de focus
  clavier — voir le point 22.

Points de détail qui comptent :

- **Le stockage est serveur** (`prefs`, clé `theme`, `GET|PUT /api/theme`),
  pour la même raison que les prompts enregistrés (point 15) : une palette
  choisie sur le bureau doit être celle qu'ouvre le téléphone. `normalizeTheme()`
  est la seule validation — préréglage inconnu, mode inconnu, accent qui n'est
  pas un `#rrggbb` : tout retombe sur le défaut, donc rien d'arbitraire ne peut
  atteindre `style.setProperty()`.
- **Le navigateur garde une copie**, mais des **variables calculées**, pas des
  réglages : le script inline d'`app.html` rejoue une table clé → valeur et ne
  porte aucune logique. Il n'existe donc pas de seconde copie des règles de
  dérivation à tenir à jour. Sans ce cache, chaque ouverture de la PWA flashe
  la palette par défaut avant l'hydratation.
- `src/app.css` déclare les mêmes noms avec des littéraux : c'est le rendu
  d'avant hydratation, et seulement ça. Un token déclaré là mais absent de
  `themeVariables()` garderait sa couleur d'usine au changement de
  préréglage — `tests/theme.test.ts` **lit la feuille de style** pour qu'aucun
  ne passe entre les mailles. Les formes (`--radius-*`, `--gap-panel`,
  `--rail-width`) sont exclues : ce sont le design, pas une préférence.
- Le rail sombre du design n'a de sens qu'en mode clair. En sombre, `p.rail`
  serait une colonne presque noire sur une page presque noire : `--rail` y est
  au contraire **relevé au-dessus de la surface**. `p.rail` reste dans les deux
  cas la tonalité vers laquelle on assombrit.
- **`color-mix` est requis** (Safari 16.2+, Chrome 111+). Tout appareil capable
  des notifications push de cette app (iOS 16.4+) en dispose ; ne pas le
  supposer ailleurs sans vérifier.

### 20. iPhone : le clavier ne redimensionne pas le viewport en PWA installée

`interactive-widget=resizes-visual` est **ignoré** en mode standalone. Dans
l'app installée sur l'écran d'accueil, le viewport de mise en page garde toute
sa hauteur et le clavier recouvre simplement le bas de la page — composeur
compris. La seule mesure fiable est l'**API `visualViewport`** :
`window.innerHeight - visualViewport.height - visualViewport.offsetTop`, écouté
sur `resize` **et** `scroll`, publié par `+page.svelte` en variable CSS
`--keyboard` sur `.app`. Les petits écarts (< 24 px) sont de la barre d'outils
Safari, pas un clavier, et sont ignorés.

Le reste des contraintes tactiles : `viewport-fit=cover` est déjà dans
`app.html` (sans lui `env(safe-area-inset-*)` renvoie 0), l'encoche est gérée
par le `padding-top` de l'entête, la barre d'accueil par le composeur, les
cibles font 44 px, et `-webkit-tap-highlight-color: transparent` retire le
carré gris d'iOS.

Sur téléphone, la refonte en panneaux flottants est **délibérément
désactivée** : des cartes à 14 px de marge sur 390 px de large, c'est de la
place perdue. En dessous de 820 px, `.app` reprend ses gouttières, `main`
perd son rayon, et les panneaux modaux deviennent des **feuilles qui montent du
bas**, arrondies en haut seulement.

Cette feuille n'est écrite qu'**une fois**, dans `Modal.svelte` : voir le
point 21.

### 21. Un seul cadre pour tous les panneaux modaux

`Modal.svelte` porte le voile, la carte centrée, la barre de titre (titre,
sous-titre facultatif, bouton ✕), le pied de page facultatif et la feuille
téléphone du point 20. Les sept panneaux — État, Skills, Providers, Tâches,
Agents, Apparence, Raccourcis — ne fournissent que leur contenu :

```svelte
<Modal {open} title="Tâches planifiées" width={620} {onclose}>
	{#snippet subtitle()}Hermes les exécute seul, même app fermée{/snippet}
	<div class="body">…</div>
	{#snippet footer()}…{/snippet}
</Modal>
```

Ce qui reste au panneau, et pourquoi :

- **Échap**, parce que sa signification diffère : sortir d'un formulaire
  d'édition (Tâches, Agents), refuser de fermer sur des modifications non
  enregistrées (`tryClose` de Skills), ou simplement fermer. Le cadre ne
  connaît que `onclose`, que le panneau branche sur ce qu'il veut.
- Le **corps** : padding, colonnes, défilement. Le cadre est un `flex column`,
  rien de plus.
- Les seuls réglages exposés sont `width` (en px, la carte se rétrécit toute
  seule sur une fenêtre étroite) et `fill` (occuper toute la hauteur, pour les
  panneaux à éditeur plutôt que ceux qui épousent leur contenu).

**Le contenu d'un snippet reste stylé par le panneau, pas par le cadre.** Un
sélecteur écrit dans `Modal.svelte` ne porte que sur les éléments écrits dans
`Modal.svelte` — c'est le scoping de Svelte. Un `footer .muted` côté panneau ne
s'appliquerait donc plus : ces contenus se stylent par leur propre classe.

`tests/panels.test.ts` échoue si un panneau redéclare le cadre ou reprend son
propre `role="dialog"`. Les sept copies avaient déjà divergé (84 vs 86 vs 88vh,
cible de fermeture à 44 px sur un seul, `env(safe-area-inset-bottom)` oublié
là où le pied de page le posait déjà) : c'est ce que fait un bloc copié.

### 22. Le focus appartient au cadre, et l'anneau est une couleur du thème

Deux choses qu'aucun panneau ne faisait, et qui tiennent maintenant en un seul
endroit chacune.

**Le cadre possède le focus.** `Modal.svelte` déplace le focus sur la carte à
l'ouverture, empêche Tab d'en sortir, et le rend à ce qui a ouvert le panneau à
la fermeture. Trois choix, dans cet ordre d'importance :

- Le focus va sur la **carte** (`tabindex="-1"`), pas sur le premier bouton :
  un lecteur d'écran annonce alors le dialogue et son nom avant tout le reste,
  et aucun champ ne vole le curseur — ce qui, sur iPhone, ferait monter le
  clavier pour un panneau qu'on voulait seulement lire. `.panel:focus` n'a donc
  pas d'anneau : l'annonce est le signal.
- Le piège n'agit **qu'aux extrémités** : `trapIndex()` (`src/lib/a11y.ts`,
  pur et testé) ne renvoie un indice que si la tabulation allait sortir. Ailleurs
  le navigateur fait son travail, ce qui laisse intactes la sélection de texte
  et la saisie dans un champ.
- Les arrêts sont filtrés sur `getClientRects().length > 0` — un formulaire
  replié ne doit pas capturer le focus. `offsetParent` ne conviendrait pas :
  la carte est en `position: fixed`.

Mesuré sur l'application construite, pilotée en CDP : à l'ouverture du panneau
Raccourcis le focus est bien sur `[role=dialog]` ; Tab tourne sur le seul arrêt
(✕) sans jamais sortir ; Échap ferme et rend le focus au bouton « Raccourcis ».
Sur le panneau Apparence (10 arrêts), Tab revient au premier après le dernier et
⇧Tab passe du premier au dernier, sans fuite.

**L'anneau de focus est un token.** `--focus` sort de `ensureVisible()`
(`src/lib/theme.ts`) : l'accent, poussé vers l'encre juste assez pour tenir 3:1
(WCAG 1.4.11) sur les **trois** fonds où il peut être dessiné — la page, un
panneau, un champ creusé. Sans ça, l'indigo de « Nocturne » ou n'importe quelle
couleur sombre saisie dans le champ d'accent donnerait un anneau invisible.
`tests/theme.test.ts` rejoue les quatre préréglages × deux modes × les accents
pathologiques.

La règle globale est dans `app.css`, en `:focus-visible` (jamais `:focus` : un
clic à la souris ne doit rien dessiner). Comme presque tout ici est un bouton nu
ou un champ sans bordure, un `outline: none` posé dans un composant supprime la
seule indication de position qui reste — douze le faisaient. `tests/a11y.test.ts`
compte les `outline: none` restants et n'en tolère que trois, chacun justifié :
le composeur (c'est la boîte qui s'allume, `:focus-within`), l'éditeur de skills
(le curseur fait office d'indicateur sur une surface pleine page) et la carte
modale ci-dessus.

Dernier point du même ordre : un `<input type="file">` en `display: none` n'est
**pas** dans l'ordre de tabulation, et son `<label>` ne peut pas prendre le
focus à sa place — joindre une image était à la souris uniquement. L'input est
donc masqué en 1 px transparent, et c'est le label qui porte l'anneau.

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

### Le transcript rechargé, lui, n'a pas la même forme

`groupTranscript()` (`src/lib/transcript.ts`, pur et testé) replie les lignes
persistées — `user → assistant(tool_calls) → tool → … → assistant` — en tours
d'UI, pour qu'un rechargement ressemble à ce que le flux a produit. Deux
constats vérifiés dans les sources de Hermes, qui commandent le pliage :

- **Une ligne `tool` ne porte pas toujours `tool_name`.** Les lignes que Hermes
  synthétise pour un appel refusé (nom d'outil invalide, arguments JSON
  illisibles, `agent/conversation_loop.py`) posent `name` mais pas `tool_name`,
  et `_rows_to_conversation` (`hermes_state.py`) omet la colonne quand elle est
  NULL. Le nom utile vient donc du `tool_calls` de la ligne assistante : la
  fusion des deux lignes par `tool_call_id` **conserve** ce nom, et le générique
  « tool » n'est posé qu'en dernier recours, sur une ligne d'outil orpheline.
- **Les clés d'étapes doivent être uniques dans un tour** : `ToolSteps.svelte`
  rend un `{#each … (step.key)}` clé, et un doublon est une erreur d'exécution,
  pas un défaut d'affichage. D'où la déduplication par `Map` et le `uid()` de
  secours quand une ligne n'a ni `tool_call_id` ni `id`.

## Structure

```
src/
├── lib/
│   ├── server/        code jamais envoyé au navigateur
│   │   ├── config.ts    variables d'env + validation au démarrage
│   │   ├── hermes.ts    client de l'API Hermes (Bearer, timeouts, retries)
│   │   ├── dashboard.ts client du dashboard Hermes (jeton, providers)
│   │   ├── sse.ts       en-têtes SSE + enveloppe d'erreur
│   │   ├── agents.ts    magasin d'agents + lien conversation → agent
│   │   ├── jobs.ts      lien tâche planifiée → agent, prompt composé
│   │   ├── turns.ts     registre des tours en vol, présence, notification
│   │   ├── push.ts      envoi Web Push (abonnements, 410 → oubli)
│   │   ├── push-crypto.ts RFC 8291 + RFC 8292, sans dépendance
│   │   ├── db.ts        better-sqlite3 (prefs, prompts, thème, titres, push)
│   │   │                  — la table `agents` vit dans server/agents.ts
│   │   ├── limits.ts    sémaphore de tours + token bucket
│   │   ├── skills.ts    lecture/écriture des SKILL.md sur le disque
│   │   └── respond.ts   HermesError → réponse JSON typée, `gate`, `readJson`
│   ├── client/        helpers navigateur
│   │   ├── api.ts       fetch typé → ApiError, `withRetry`
│   │   ├── storage.ts   localStorage qui ne peut pas jeter
│   │   └── platform.ts  ⌘ vs Ctrl
│   ├── components/    Sidebar, Message, ToolSteps, Composer, ModelPicker,
│   │                  AgentPicker, Markdown, CommandPalette, Modal (cadre
│   │                  commun des panneaux), StatusPanel, SkillsPanel,
│   │                  ProvidersPanel, JobsPanel, AgentsPanel, PushSettings,
│   │                  ThemePanel, Shortcuts, Toasts
│   ├── stores/
│   │   ├── chat.svelte.ts       tout l'état de conversation (runes Svelte 5)
│   │   ├── agents.svelte.ts     équipe d'agents personnalisés
│   │   ├── skills.svelte.ts     état de l'éditeur de skills
│   │   ├── prompts.svelte.ts    bibliothèque de prompts enregistrés
│   │   ├── providers.svelte.ts  état du panneau providers (dont le flux OAuth)
│   │   ├── jobs.svelte.ts       état du panneau des tâches planifiées
│   │   ├── push.svelte.ts       abonnement Web Push + report de présence
│   │   ├── theme.svelte.ts      palette active + cache d'avant-rendu
│   │   └── toast.svelte.ts      notifications dans la page
│   ├── a11y.ts        arrêts de tabulation d'un dialogue (piège de focus)
│   ├── agents.ts      agents : bornes, cycles, arbre d'équipe, prompt composé
│   ├── errors.ts      ApiError + codes + `humanizeError`
│   ├── jobs.ts        horaires cron validés/traduits/composés, état et tri
│   │                  des tâches, fiche d'agent dans le prompt d'une tâche
│   ├── models.ts      inventaire /api/model/options (provider d'un modèle…)
│   ├── prompts.ts     prompts enregistrés : titres, bornes, recherche
│   ├── push.ts        charge utile d'une notification, libellés, capacités
│   ├── providers.ts   groupement des clés par provider, statut des comptes,
│   │                  machine à états du flux OAuth
│   ├── sessions.ts    groupement par date, recherche, libellés, usage,
│   │                  candidats de la vue archivée
│   ├── skills.ts      chemins de skills validés, gabarits, groupement
│   ├── sse.ts         parseur SSE incrémental (partagé)
│   ├── theme.ts       préréglages, dérivation color-mix, contraste WCAG
│   ├── turns.ts       résumé d'un tour + « faut-il notifier ? »
│   ├── markdown.ts    rendu tolérant à l'incomplet
│   └── transcript.ts  regroupement du transcript persisté en tours UI
├── hooks.server.ts    contrôle d'origine à l'exécution + en-têtes de sécurité
├── routes/
│   ├── +page.svelte   l'écran de chat (`?s=<id>` ouvre une conversation)
│   ├── api/**         proxy authentifié
│   └── health/        sonde du healthcheck Docker
└── service-worker.ts  cache de l'app shell (jamais /api) + handlers push
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
- **Un flux qui s'arrête n'est pas un flux qui se termine.** Un corps SSE
  coupé en plein tour ne lève rien : le lecteur voit une fin de flux normale.
  Vérifié avec un serveur local qui coupe après deux frames — aucune exception,
  aucune erreur, la réponse partielle s'affichait comme une réponse finie.
  `#consume()` exige donc un événement terminal (`isTerminalTurnEvent` :
  `done`, `error`, `run.completed`, `assistant.completed`) ; sans lui le tour
  est marqué `detached: 'truncated'`, ce qui affiche « ce texte est incomplet »
  et un bouton « Recharger », puisque l'agent continue en arrière-plan comme
  après un détachement. Le côté Hermes qui produit ce cas est le `except
  Exception` de la boucle d'écriture SSE (`api_server.py`) : la boucle sort et
  rend la réponse proprement, alors que le `done` posé dans la file par le
  `finally` de la tâche n'est plus écrit sur le fil.
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
- Thème piloté par des tokens CSS. Les littéraux d'`src/app.css` ne sont que
  le rendu d'avant hydratation ; la source est `src/lib/theme.ts`, appliquée
  en propriétés inline sur `<html>` avec `data-theme` pour le mode. Toute
  nouvelle couleur passe par un token, jamais par un littéral dans un
  composant — voir le point 19.

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
`~/.hermes/logs/gateway.log`. Pour le dashboard (panneau Providers) :
`journalctl --user -u hermes-dashboard -f`.

## Si tu lis ceci depuis l'exécution automatique de 05:00

Un timer systemd (`hermes-ui-improve.timer`) lance Claude Code chaque jour dans
un **clone isolé** du dépôt, sous `/opt/stacks/hermes-ui-bot/work/`. Tu n'es
pas dans le déploiement.

- Le déploiement en production est `/opt/stacks/Hermes-Ui` : **ne le touche
  pas directement**. C'est le script du runner qui déploiera ton commit
  (fast-forward + rebuild Docker + smoke test avec retour arrière).
- **Ton travail part en production cette nuit, sans relecture humaine
  préalable.** L'utilisateur le découvre au réveil. Sois conservateur : un
  changement sûr et fini vaut mieux qu'un changement ambitieux et fragile.
- Le runner (`/opt/stacks/hermes-ui-bot/`) ne fait pas partie du dépôt et ne
  doit pas être modifié.
- `git log --oneline -15` te dit ce que les exécutions précédentes ont fait :
  ne recommence pas la même chose.
- La source de vérité sur l'API Hermes est
  `/mnt/data/hermes/hermes-agent/gateway/platforms/api_server.py`, en lecture
  seule. La documentation en ligne est en retard sur cette version (0.20.0).

Les consignes complètes sont dans `/opt/stacks/hermes-ui-bot/prompt.md`.

## Sécurité — non négociable

- Le serveur API exécute **le toolset complet, terminal compris, sur le Pi**.
  `API_SERVER_KEY` est un secret équivalent-root.
- `API_SERVER_HOST=127.0.0.1` — ne jamais binder 8642 ailleurs. Idem pour le
  dashboard sur 9119 : `HERMES_DASHBOARD_TOKEN` ouvre l'écriture de
  `~/.hermes/.env` et de `config.yaml`, c'est un second secret du même ordre.
  Il reste côté serveur, comme `HERMES_API_KEY`.
- Le conteneur ne publie que sur `127.0.0.1:3000`. L'exposition passe par
  Tailscale Serve, pas par une redirection de port sur la box.
- Ne pas activer `API_SERVER_CORS_ORIGINS` : le navigateur n'a aucune raison
  de joindre Hermes directement, et l'activer signifierait exposer la clé.
- Pas d'auth applicative : l'identité est garantie par le tailnet. Ne pas
  bricoler un mot de passe maison.
- `VAPID_PRIVATE_KEY` est une clé de signature : elle reste côté serveur, n'est
  jamais journalisée et ne doit jamais entrer dans le dépôt. `VAPID_PUBLIC_KEY`,
  elle, **doit** être servie au navigateur — c'est son rôle. Les endpoints
  d'abonnement sont eux aussi des secrets porteurs : l'UI ne voit qu'un condensé.
