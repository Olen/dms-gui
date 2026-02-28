# Multi-stage build for Docker Mailserver GUI
#   docker rm dms-gui dms-gui-dms-gui; docker image prune -f
#   alias buildup='docker-compose up --build --force-recreate'
#   docker buildx build --no-cache -t audioscavenger/dms-gui:latest -t audioscavenger/dms-gui:1.0.6 .
#   docker push audioscavenger/dms-gui --all-tags

# -----------------------------------------------------
# Stage 1: Build frontend https://hub.docker.com/_/node
# https://dev.to/ptuladhar3/avoid-using-bloated-nodejs-docker-image-in-production-3doc
# FROM node:slim AS frontend-builder
FROM node:24-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package.json and install dependencies
COPY frontend/package*.json ./
COPY common.*js* ../

RUN npm ci

# Copy frontend code and build
COPY frontend/ ./
RUN npm run build

# -----------------------------------------------------
# Stage 2: Build backend
FROM node:24-alpine AS backend-builder

WORKDIR /app/backend

# Copy backend package.json and install dependencies
COPY backend/package*.json ./
COPY common.*js* ../

RUN npm ci --omit=dev

# Copy backend code
COPY backend/ ./

# -----------------------------------------------------
# Stage 3: Final image with Nginx and Node.js
FROM node:24-alpine

ARG DMSGUI_VERSION=1.5.23
ARG DMSGUI_DESCRIPTION="A graphical user interface for managing all aspects of DMS including: email accounts, aliases, xapian indexes, and DNS entries."

# alpine Install Nginx and curl (for healthcheck)
RUN apk add --no-cache nginx curl

# Create app directories
WORKDIR /app
RUN mkdir -p /app/backend /app/frontend
COPY common.*js* ./

# Copy backend from backend-builder
COPY --from=backend-builder /app/backend /app/backend

# Copy frontend build from frontend-builder
COPY --from=frontend-builder /app/frontend/dist /app/frontend

RUN mkdir -p /run/nginx

# Nginx configuration
COPY docker/nginx.conf /etc/nginx/http.d/default.conf

# Copy startup script
COPY docker/start.sh /app/start.sh
RUN chmod +x /app/start.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8080/ || exit 1

# Start Nginx and Node.js
CMD ["/app/start.sh"]

# Add metadata to image:
LABEL org.opencontainers.image.title="dms-gui"
LABEL org.opencontainers.image.vendor="audioscavenger"
LABEL org.opencontainers.image.authors="audioscavenger on GitHub"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"
LABEL org.opencontainers.image.description=${DMSGUI_DESCRIPTION}
LABEL org.opencontainers.image.url="https://github.com/audioscavenger/dms-gui"
LABEL org.opencontainers.image.documentation="https://github.com/audioscavenger/dms-gui/blob/master/README.md"
LABEL org.opencontainers.image.source="https://github.com/docker-mailserver/docker-mailserver"
# ARG invalidates cache when it is used by a layer (implicitly affects RUN)
# Thus to maximize cache, keep these lines last:
LABEL org.opencontainers.image.revision=${DMSGUI_VERSION}
LABEL org.opencontainers.image.version=${DMSGUI_VERSION}
ENV DMSGUI_VERSION=${DMSGUI_VERSION}
ENV DMSGUI_DESCRIPTION=${DMSGUI_DESCRIPTION}
