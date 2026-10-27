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
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt \
    && groupadd --gid 10001 lab \
    && useradd --uid 10001 --gid lab --no-create-home lab \
    && mkdir -p /app/data && chown lab:lab /app/data
COPY backend ./backend
COPY --from=frontend /build/dist ./dist
USER lab
EXPOSE 8787
CMD ["python", "backend/server.py", "--host", "0.0.0.0", "--data-dir", "/app/data"]
