FROM node:24.22.1-bookworm-slim AS frontend
WORKDIR /build
COPY package.json package-lock.json .npmrc .nvmrc ./
COPY scripts ./scripts
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM python:3.13-slim AS runtime
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
RUN groupadd --gid 10001 lab \
    && useradd --uid 10001 --gid lab --no-create-home lab \
    && mkdir -p /app/data && chown lab:lab /app/data
COPY backend ./backend
COPY examples ./examples
COPY --from=frontend /build/dist ./dist
# Normalize restrictive host permissions (for example, files cloned with umask 077).
# Runtime code stays root-owned; credential/data permissions are left untouched.
RUN chmod 0755 /app \
    && find /app/backend /app/examples /app/dist -type d -exec chmod 0755 {} + \
    && find /app/backend /app/examples /app/dist -type f -exec chmod 0644 {} +
USER lab
# Fail the build if the actual runtime user cannot read the entrypoint or its imports.
RUN python -S backend/server.py --help > /dev/null
EXPOSE 8787
CMD ["python", "backend/server.py", "--host", "0.0.0.0", "--data-dir", "/app/data"]
