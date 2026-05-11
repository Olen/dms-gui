#!/bin/sh

# JWT secrets for tokens, without openssl; otherwise that would be openssl rand -hex 32
export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
export JWT_SECRET_REFRESH=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# use demo database
[ "$isDEMO" = "true" ] && cp /app/config/dms-gui-example.sqlite3 /app/config/dms-gui-demo.sqlite3
[ "$isDEMO" = "true" ] && touch /app/config/isDemo || rm -f /app/config/isDemo

cd /app/backend

# Regenerate rest-api.py + rest-api.conf from the image's embedded
# template every startup so the on-disk artefact stays in lockstep
# with what this dms-gui release speaks. Without this, an upgraded
# dms-gui can ship a new action protocol while the older rest-api.py
# (written by a previous "Inject API" click) keeps running and
# returns opaque 500s on every execAction call.
#
# Idempotent: writing identical bytes is a no-op for supervisor.
# After a real version bump, the operator still needs to restart the
# mailserver supervisor process to reload Python's in-memory copy —
# the error message in backend.mjs's postJsonToApi surfaces that hint
# when it detects a version-marker mismatch on a failed request.
node --env-file-if-exists=/app/config/.dms-gui.env --input-type=module -e "
  import('./settings.mjs')
    .then(({ createAPIfiles }) => createAPIfiles('dms'))
    .then(r => { if (!r.success) { console.error(r.error); process.exit(1); } })
    .catch(e => { console.error(e); process.exit(1); });
"

# Start the backend server in the background. --env-file-if-exists
# loads /app/config/.dms-gui.env before any module sees process.env,
# replacing the dotenv module dependency. The -if-exists variant lets
# the file be optional (matches dotenv's silent no-op when absent).
node --env-file-if-exists=/app/config/.dms-gui.env index.js &

# this only detects changes in /backend and does not recompile the frontend. useless
# https://www.metered.ca/blog/how-to-restart-your-node-js-apps-automatically-with-nodemon/
# nodemon index.js &

# Wait a moment to ensure backend is starting up
sleep 2

# Start Nginx in the foreground (this keeps the container running)
nginx -g "daemon off;"
