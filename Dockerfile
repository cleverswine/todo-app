# Build stage - compile the SvelteKit application
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files first (for better Docker layer caching)
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Set the DATABASE_URL environment variable for the build
# (Drizzle needs this to generate types)
ENV DATABASE_URL=/app/data/todos.db

# Build the application
RUN npm run build

# Production stage - run the built application
FROM node:20-alpine AS production

# Set working directory
WORKDIR /app

# Create a non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S sveltekit -u 1001

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy built application from builder stage
COPY --from=builder /app/build ./build

# Create data directory for SQLite database
# This will be mounted as a volume in docker-compose
RUN mkdir -p /app/data && chown -R sveltekit:nodejs /app/data

# Switch to non-root user
USER sveltekit

# Expose the port the app runs on
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATABASE_URL=/app/data/todos.db

# Health check to ensure the container is running properly
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Start the application
CMD ["node", "build"]
