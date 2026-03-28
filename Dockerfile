# Stage 1: Build the frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the backend and combine
FROM node:20-alpine
WORKDIR /app

# Install build dependencies for better-sqlite3 (native modules)
RUN apk add --no-cache python3 make g++

# Copy backend files
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm install --production

COPY backend/ ./
# Copy the built frontend from Stage 1 into the backend's public folder
COPY --from=frontend-builder /app/frontend/out ./public

# Setup data directory for persistence
ENV DATA_DIR=/data
RUN mkdir -p /data
VOLUME /data

EXPOSE 2650
CMD ["node", "index.js"]
